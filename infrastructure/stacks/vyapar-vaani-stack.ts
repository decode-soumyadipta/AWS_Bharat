import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { MarketplaceIntegration } from './marketplace-integration';

// Event pattern constants
const EVENT_SOURCES = {
  WHATSAPP: 'vyapar.vaani.whatsapp',
  ONDC: 'vyapar.vaani.ondc',
  INTERNAL: 'vyapar.vaani.internal',
} as const;

const WHATSAPP_EVENT_TYPES = {
  MESSAGE_RECEIVED_VOICE: 'message.received.voice',
  MESSAGE_RECEIVED_IMAGE: 'message.received.image',
  MESSAGE_RECEIVED_TEXT: 'message.received.text',
  BUTTON_CLICKED: 'button.clicked',
} as const;

export class VyaparVaaniStack extends cdk.Stack {
  public readonly dataTable: dynamodb.Table;
  public readonly kycBucket: s3.Bucket;
  public readonly productsBucket: s3.Bucket;
  public readonly eventBus: events.EventBus;
  public readonly encryptionKey: kms.Key;
  public readonly kycProcessingStateMachine: sfn.StateMachine;
  public readonly httpApi: apigatewayv2.HttpApi;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // KMS Key for encryption at rest
    this.encryptionKey = new kms.Key(this, 'VyaparVaaniEncryptionKey', {
      description: 'Encryption key for Vyapar-Vaani data',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // DynamoDB Single Table with GSIs
    this.dataTable = new dynamodb.Table(this, 'VyaparVaaniDataTable', {
      tableName: 'vyapar-vaani-data',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // On-demand billing for scale-to-zero
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.encryptionKey,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Protect production data
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // GSI1: Phone Number Lookup
    this.dataTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2: Order Status Lookup
    this.dataTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI3: Catalog Category Lookup
    this.dataTable.addGlobalSecondaryIndex({
      indexName: 'GSI3',
      partitionKey: { name: 'GSI3PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI3SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI4: User State Lookup (for analytics and monitoring)
    this.dataTable.addGlobalSecondaryIndex({
      indexName: 'GSI4',
      partitionKey: { name: 'GSI4PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI4SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Enable TTL for automatic cleanup of abandoned flows and temporary data
    // TTL attribute should be set on items that need automatic expiration
    // (e.g., user state records, partial catalog data)
    const cfnTable = this.dataTable.node.defaultChild as dynamodb.CfnTable;
    cfnTable.timeToLiveSpecification = {
      attributeName: 'TTL',
      enabled: true,
    };

    // S3 Bucket for KYC Documents
    this.kycBucket = new s3.Bucket(this, 'KYCDocumentsBucket', {
      bucketName: `vyapar-vaani-kyc-${this.account}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      lifecycleRules: [
        {
          id: 'TransitionToGlacier',
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
        {
          id: 'DeleteAfter7Years',
          expiration: cdk.Duration.days(2555), // 7 years as per Indian data retention regulations
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // S3 Bucket for Product Images
    this.productsBucket = new s3.Bucket(this, 'ProductImagesBucket', {
      bucketName: `vyapar-vaani-products-${this.account}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: 'DeleteTempFiles',
          prefix: 'temp/',
          expiration: cdk.Duration.days(1),
        },
        {
          id: 'TransitionRawToIA',
          prefix: 'raw/',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // EventBridge Event Bus
    this.eventBus = new events.EventBus(this, 'VyaparVaaniEventBus', {
      eventBusName: 'vyapar-vaani-events',
    });

    // Enable event archiving for debugging
    new events.Archive(this, 'VyaparVaaniEventArchive', {
      sourceEventBus: this.eventBus,
      archiveName: 'vyapar-vaani-archive',
      retention: cdk.Duration.days(30),
      eventPattern: {
        source: events.Match.prefix('vyapar.vaani'),
      },
    });

    // CloudWatch Log Groups
    const logGroups = [
      'whatsapp-webhook',
      'whatsapp-sender',
      'kyc-processor',
      'voice-transcription',
      'intent-classification',
      'catalog-builder',
      'image-enhancer',
      'order-manager',
      'inventory-sync',
      'bpp-adapter',
    ];

    logGroups.forEach((name) => {
      new logs.LogGroup(this, `${name}LogGroup`, {
        logGroupName: `/aws/lambda/vyapar-vaani/${name}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
    });

    // CloudWatch Metrics Namespace (defined via custom metrics in Lambda functions)
    // Namespace: VyaparVaani
    // Metrics: TimeToNetwork, CatalogRejectionRate, ImageEnhancementSuccessRate, OrderAcceptanceRate

    // IAM Role for Lambda Functions (base permissions)
    const lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant permissions to Lambda role
    this.dataTable.grantReadWriteData(lambdaExecutionRole);
    this.kycBucket.grantReadWrite(lambdaExecutionRole);
    this.productsBucket.grantReadWrite(lambdaExecutionRole);
    this.eventBus.grantPutEventsTo(lambdaExecutionRole);
    this.encryptionKey.grantEncryptDecrypt(lambdaExecutionRole);

    // Add explicit EventBridge PutEvents permission
    lambdaExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [this.eventBus.eventBusArn],
      })
    );

    // Grant AWS AI service permissions
    lambdaExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'textract:AnalyzeDocument',
          'textract:DetectDocumentText',
          'transcribe:StartTranscriptionJob',
          'transcribe:GetTranscriptionJob',
          'bedrock:InvokeModel',
          'rekognition:DetectLabels',
          'rekognition:CompareFaces',
          'aws-marketplace:ViewSubscriptions',
          'aws-marketplace:Subscribe',
          'polly:SynthesizeSpeech',
        ],
        resources: ['*'],
      })
    );

    // Grant Step Functions permissions
    lambdaExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'states:StartExecution',
          'states:DescribeExecution',
          'states:StopExecution',
        ],
        resources: ['*'],
      })
    );

    // Grant Lambda invoke permissions (for Lambda-to-Lambda calls)
    lambdaExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: ['*'],
      })
    );

    // Grant SNS permissions for error notifications
    lambdaExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sns:Publish'],
        resources: ['*'],
      })
    );

    // Grant CloudWatch Metrics permissions
    lambdaExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      })
    );

    // Lambda Functions for KYC Processing Workflow
    
    // Document Extraction Lambda
    const documentExtractionLambda = new lambda.Function(this, 'DocumentExtractionLambda', {
      functionName: 'vyapar-vaani-document-extraction',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambdas/document-extraction.handler',
      code: lambda.Code.fromAsset('dist/src'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      role: lambdaExecutionRole,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        KYC_BUCKET_NAME: this.kycBucket.bucketName,
        PRODUCTS_BUCKET_NAME: this.productsBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        KMS_KEY_ID: this.encryptionKey.keyId,
        
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // KYC Validation Lambda
    const kycValidationLambda = new lambda.Function(this, 'KYCValidationLambda', {
      functionName: 'vyapar-vaani-kyc-validation',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambdas/kyc-validation.handler',
      code: lambda.Code.fromAsset('dist/src'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      role: lambdaExecutionRole,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        KYC_BUCKET_NAME: this.kycBucket.bucketName,
        PRODUCTS_BUCKET_NAME: this.productsBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        KMS_KEY_ID: this.encryptionKey.keyId,
        
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Seller Registration Lambda
    const sellerRegistrationLambda = new lambda.Function(this, 'SellerRegistrationLambda', {
      functionName: 'vyapar-vaani-seller-registration',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambdas/seller-registration.handler',
      code: lambda.Code.fromAsset('dist/src'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      role: lambdaExecutionRole,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        KYC_BUCKET_NAME: this.kycBucket.bucketName,
        PRODUCTS_BUCKET_NAME: this.productsBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        KMS_KEY_ID: this.encryptionKey.keyId,
        
        ONDC_REGISTRY_URL: 'https://registry.ondc.org/api/v1',
        NETWORK_PARTICIPANT_ID: 'vyapar-vaani.ondc.in',
        BPP_BASE_URL: 'https://api.vyapar-vaani.ondc.in',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // WhatsApp Message Sender Lambda
    const whatsappSenderLambda = new lambda.Function(this, 'WhatsAppSenderLambda', {
      functionName: 'vyapar-vaani-whatsapp-sender',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambdas/whatsapp-message-sender.handler',
      code: lambda.Code.fromAsset('dist/src'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      role: lambdaExecutionRole,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        KYC_BUCKET_NAME: this.kycBucket.bucketName,
        PRODUCTS_BUCKET_NAME: this.productsBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        KMS_KEY_ID: this.encryptionKey.keyId,
        
        WHATSAPP_API_ENDPOINT: process.env.WHATSAPP_API_ENDPOINT || 'https://graph.facebook.com/v22.0',
        WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
        WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || '',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Voice Transcription Lambda
    const voiceTranscriptionLambda = new lambda.Function(this, 'VoiceTranscriptionLambda', {
      functionName: 'vyapar-vaani-voice-transcription',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambdas/voice-transcription.handler',
      code: lambda.Code.fromAsset('dist/src'),
      timeout: cdk.Duration.minutes(3), // Transcription can take time
      memorySize: 512,
      role: lambdaExecutionRole,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        KYC_BUCKET_NAME: this.kycBucket.bucketName,
        PRODUCTS_BUCKET_NAME: this.productsBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        KMS_KEY_ID: this.encryptionKey.keyId,
        
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Intent Classification Lambda
    const intentClassificationLambda = new lambda.Function(this, 'IntentClassificationLambda', {
      functionName: 'vyapar-vaani-intent-classification',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambdas/intent-classification.handler',
      code: lambda.Code.fromAsset('dist/src'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      role: lambdaExecutionRole,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        KYC_BUCKET_NAME: this.kycBucket.bucketName,
        PRODUCTS_BUCKET_NAME: this.productsBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        KMS_KEY_ID: this.encryptionKey.keyId,
        
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Entity Extraction Lambda
    const entityExtractionLambda = new lambda.Function(this, 'EntityExtractionLambda', {
      functionName: 'vyapar-vaani-entity-extraction',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambdas/entity-extraction.handler',
      code: lambda.Code.fromAsset('dist/src'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      role: lambdaExecutionRole,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        KYC_BUCKET_NAME: this.kycBucket.bucketName,
        PRODUCTS_BUCKET_NAME: this.productsBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        KMS_KEY_ID: this.encryptionKey.keyId,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Catalog Builder Lambda
    const catalogBuilderLambda = new lambda.Function(this, 'CatalogBuilderLambda', {
      functionName: 'vyapar-vaani-catalog-builder',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambdas/catalog-builder.handler',
      code: lambda.Code.fromAsset('dist/src'),
      timeout: cdk.Duration.seconds(30), // Increased for AI processing
      memorySize: 512, // Increased for AI processing
      role: lambdaExecutionRole,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        KYC_BUCKET_NAME: this.kycBucket.bucketName,
        PRODUCTS_BUCKET_NAME: this.productsBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        KMS_KEY_ID: this.encryptionKey.keyId,
        MARKETPLACE_PRODUCTS_TABLE: 'marketplace-products',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Catalog Storage Broadcast Lambda
    const catalogStorageBroadcastLambda = new lambda.Function(this, 'CatalogStorageBroadcastLambda', {
      functionName: 'vyapar-vaani-catalog-storage-broadcast',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambdas/catalog-storage-broadcast.handler',
      code: lambda.Code.fromAsset('dist/src'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      role: lambdaExecutionRole,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        KYC_BUCKET_NAME: this.kycBucket.bucketName,
        PRODUCTS_BUCKET_NAME: this.productsBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        KMS_KEY_ID: this.encryptionKey.keyId,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // ========================================
    // BPP Adapter Lambda — ONDC Beckn Protocol Gateway
    // ========================================
    const bppAdapterLambda = new lambda.Function(this, 'BPPAdapterLambda', {
      functionName: 'vyapar-vaani-bpp-adapter',
      description: 'Beckn Protocol Provider (BPP) adapter for ONDC network',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambdas/bpp-adapter.handler',
      code: lambda.Code.fromAsset('dist/src'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      role: lambdaExecutionRole,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        KYC_BUCKET_NAME: this.kycBucket.bucketName,
        PRODUCTS_BUCKET_NAME: this.productsBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        KMS_KEY_ID: this.encryptionKey.keyId,
        NETWORK_PARTICIPANT_ID: 'vyapar-vaani.ondc.in',
        BPP_BASE_URL: 'https://api.vyapar-vaani.ondc.in',
        ONDC_REGISTRY_URL: 'https://registry.ondc.org/api/v1',
        VERIFY_BECKN_SIGNATURES: 'false', // Enable in production after ONDC onboarding
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // BPP Adapter API Gateway routes — added after HTTP API is created (see below)

    // WhatsApp Webhook Handler Lambda
    const webhookLambdaRole = new iam.Role(this, 'WebhookLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant webhook Lambda permissions
    this.dataTable.grantReadWriteData(webhookLambdaRole);
    this.kycBucket.grantReadWrite(webhookLambdaRole);
    this.productsBucket.grantReadWrite(webhookLambdaRole);
    this.eventBus.grantPutEventsTo(webhookLambdaRole);
    this.encryptionKey.grantEncryptDecrypt(webhookLambdaRole);
    
    // Grant Polly permissions for voice synthesis
    webhookLambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['polly:SynthesizeSpeech'],
      resources: ['*'],
    }));

    const whatsappWebhookLambda = new lambda.Function(this, 'WhatsAppWebhookLambda', {
      functionName: 'vyapar-vaani-whatsapp-webhook',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambdas/whatsapp-webhook-handler.handler',
      code: lambda.Code.fromAsset('dist/src'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      role: webhookLambdaRole,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        KYC_BUCKET_NAME: this.kycBucket.bucketName,
        PRODUCTS_BUCKET_NAME: this.productsBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        KMS_KEY_ID: this.encryptionKey.keyId,
        WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN || 'vyapar-vaani-webhook-token',
        WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || '',
        WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
        WHATSAPP_API_ENDPOINT: process.env.WHATSAPP_API_ENDPOINT || 'https://graph.facebook.com/v22.0',
        STATE_TTL_DAYS: process.env.STATE_TTL_DAYS || '7',
        VOICE_FIRST_ENABLED: process.env.VOICE_FIRST_ENABLED || 'true',
        KYC_FLOW_ENABLED: process.env.KYC_FLOW_ENABLED || 'true',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // HTTP API Gateway for WhatsApp Webhook
    this.httpApi = new apigatewayv2.HttpApi(this, 'WhatsAppWebhookApi', {
      apiName: 'vyapar-vaani-whatsapp-webhook',
      description: 'WhatsApp webhook endpoint for Vyapar-Vaani',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigatewayv2.CorsHttpMethod.GET, apigatewayv2.CorsHttpMethod.POST],
        allowHeaders: ['*'],
      },
    });

    // Lambda integration
    const webhookIntegration = new HttpLambdaIntegration('WhatsAppWebhookIntegration', whatsappWebhookLambda);

    // Add routes
    this.httpApi.addRoutes({
      path: '/whatsapp/webhook',
      methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST],
      integration: webhookIntegration,
    });

    // Add BPP Adapter routes for Beckn protocol
    const bppIntegration = new HttpLambdaIntegration('BPPAdapterIntegration', bppAdapterLambda);
    this.httpApi.addRoutes({
      path: '/beckn/{action}',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: bppIntegration,
    });

    // EventBridge Rules to wire up the complete flow
    
    // Rule 1: Text messages → Intent Classification
    new events.Rule(this, 'TextMessageRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: [EVENT_SOURCES.WHATSAPP],
        detailType: [WHATSAPP_EVENT_TYPES.MESSAGE_RECEIVED_TEXT],
      },
      targets: [new targets.LambdaFunction(intentClassificationLambda)],
    });

    // Rule 2: Voice messages → Voice Transcription
    new events.Rule(this, 'VoiceMessageRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: [EVENT_SOURCES.WHATSAPP],
        detailType: [WHATSAPP_EVENT_TYPES.MESSAGE_RECEIVED_VOICE],
      },
      targets: [new targets.LambdaFunction(voiceTranscriptionLambda)],
    });

    // Rule 3: Image messages → Image Enhancement
    const imageEnhancementLambda = new lambda.Function(this, 'ImageEnhancementLambda', {
      functionName: 'vyapar-vaani-image-enhancement',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambdas/image-enhancement.handler',
      code: lambda.Code.fromAsset('dist/src'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 1024,
      role: lambdaExecutionRole,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        KYC_BUCKET_NAME: this.kycBucket.bucketName,
        PRODUCTS_BUCKET_NAME: this.productsBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        KMS_KEY_ID: this.encryptionKey.keyId,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // NOTE: Image enhancement is handled INLINE by the agent handler Lambda.
    // The standalone imageEnhancementLambda is kept for potential direct invocation
    // but no longer needs an EventBridge rule (the AgentHandlerRule covers images).

    // Rule 4: Intent classified → Entity Extraction
    new events.Rule(this, 'IntentClassifiedRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['vyapar.vaani.internal'],
        detailType: ['intent.classified'],
      },
      targets: [new targets.LambdaFunction(entityExtractionLambda)],
    });

    // Rule 5: WhatsApp message send events → WhatsApp Sender
    new events.Rule(this, 'WhatsAppSendRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['vyapar.vaani.internal'],
        detailType: ['whatsapp.message.send'],
      },
      targets: [new targets.LambdaFunction(whatsappSenderLambda)],
    });

    // Rule 6: Catalog build requested (after confirmation) → Catalog Builder
    // NOTE: Changed from 'entities.extracted' to 'catalog.build_requested'
    // to prevent premature catalog creation before image and confirmation
    new events.Rule(this, 'CatalogCreationRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['vyapar.vaani.internal'],
        detailType: ['catalog.build_requested'],
      },
      targets: [new targets.LambdaFunction(catalogBuilderLambda)],
    });

    // Rule 7: Catalog created → Catalog Storage Broadcast
    new events.Rule(this, 'CatalogStorageRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['vyapar.vaani.internal'],
        detailType: ['catalog.created'],
      },
      targets: [new targets.LambdaFunction(catalogStorageBroadcastLambda)],
    });

    // ========================================
    // ONDC Event Rules — Route ONDC events to BPP Adapter
    // ========================================

    // Rule: ONDC order events → BPP Adapter for Beckn protocol handling
    new events.Rule(this, 'ONDCOrderEventsRule', {
      eventBus: this.eventBus,
      ruleName: 'vyapar-vaani-ondc-order-events',
      description: 'Routes ONDC order lifecycle events to BPP adapter',
      eventPattern: {
        source: [EVENT_SOURCES.ONDC],
        detailType: [
          'order.confirm.received',
          'order.status.requested',
          'order.cancel.requested',
          'order.update.requested',
        ],
      },
      targets: [new targets.LambdaFunction(bppAdapterLambda)],
    });

    // Rule: ONDC search events → BPP Adapter
    new events.Rule(this, 'ONDCSearchEventsRule', {
      eventBus: this.eventBus,
      ruleName: 'vyapar-vaani-ondc-search-events',
      description: 'Routes ONDC search/select/init events to BPP adapter',
      eventPattern: {
        source: [EVENT_SOURCES.ONDC],
        detailType: [
          'catalog.search.received',
          'order.select.received',
          'order.init.received',
        ],
      },
      targets: [new targets.LambdaFunction(bppAdapterLambda)],
    });

    // Step Functions State Machine for KYC Processing
    
    // Define state machine tasks
    const extractDocumentTask = new tasks.LambdaInvoke(this, 'ExtractText', {
      lambdaFunction: documentExtractionLambda,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    const parseKYCFieldsTask = new sfn.Pass(this, 'ParseKYCFields', {
      comment: 'Parse extracted KYC data (handled by document extraction Lambda)',
    });

    const validateFieldsTask = new tasks.LambdaInvoke(this, 'ValidateFields', {
      lambdaFunction: kycValidationLambda,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    const registerSellerTask = new tasks.LambdaInvoke(this, 'RegisterSeller', {
      lambdaFunction: sellerRegistrationLambda,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    const sendConfirmationTask = new tasks.LambdaInvoke(this, 'SendConfirmation', {
      lambdaFunction: whatsappSenderLambda,
      payload: sfn.TaskInput.fromObject({
        'to.$': '$.phone',
        'type': 'text',
        'content': {
          'text.$': "States.Format('✅ आपका पंजीकरण सफल रहा! विक्रेता ID: {}', $.sellerId)",
        },
        'language.$': '$.language',
      }),
      resultPath: '$.confirmationResult',
      retryOnServiceExceptions: true,
    });

    const requestClarificationTask = new tasks.LambdaInvoke(this, 'RequestClarification', {
      lambdaFunction: whatsappSenderLambda,
      payload: sfn.TaskInput.fromObject({
        'to.$': '$.phone',
        'type': 'text',
        'content': {
          'text.$': "States.Format('❌ कृपया स्पष्ट दस्तावेज़ की फोटो भेजें। त्रुटि: {}', $.validationResult.errors[0])",
        },
        'language.$': '$.language',
      }),
      resultPath: '$.clarificationResult',
      retryOnServiceExceptions: true,
    });

    // Define state machine flow
    const validationChoice = new sfn.Choice(this, 'IsValidationSuccessful?')
      .when(
        sfn.Condition.booleanEquals('$.validationResult.valid', true),
        registerSellerTask
          .next(sendConfirmationTask)
          .next(new sfn.Succeed(this, 'KYCProcessingComplete'))
      )
      .otherwise(
        requestClarificationTask
          .next(new sfn.Fail(this, 'KYCValidationFailed', {
            cause: 'KYC validation failed',
            error: 'VALIDATION_ERROR',
          }))
      );

    const definition = extractDocumentTask
      .next(parseKYCFieldsTask)
      .next(validateFieldsTask)
      .next(validationChoice);

    // Create state machine with error handling and timeout
    this.kycProcessingStateMachine = new sfn.StateMachine(this, 'KYCProcessingStateMachine', {
      stateMachineName: 'vyapar-vaani-kyc-processing',
      definition,
      timeout: cdk.Duration.minutes(2), // 2 minutes total workflow timeout
      logs: {
        destination: new logs.LogGroup(this, 'KYCStateMachineLogGroup', {
          logGroupName: '/aws/vendedlogs/states/vyapar-vaani-kyc-processing',
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        level: sfn.LogLevel.ALL,
        includeExecutionData: true,
      },
      tracingEnabled: true,
    });

    // Update webhook Lambda with state machine ARN
    whatsappWebhookLambda.addEnvironment('KYC_STATE_MACHINE_ARN', this.kycProcessingStateMachine.stateMachineArn);
    
    // Grant webhook Lambda permission to start state machine executions
    this.kycProcessingStateMachine.grantStartExecution(webhookLambdaRole);

    // Add retry logic with exponential backoff to Lambda tasks
    extractDocumentTask.addRetry({
      errors: ['States.TaskFailed', 'States.Timeout', 'Lambda.ServiceException'],
      interval: cdk.Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2.0,
    });

    validateFieldsTask.addRetry({
      errors: ['States.TaskFailed', 'States.Timeout', 'Lambda.ServiceException'],
      interval: cdk.Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2.0,
    });

    registerSellerTask.addRetry({
      errors: ['States.TaskFailed', 'States.Timeout', 'Lambda.ServiceException'],
      interval: cdk.Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2.0,
    });

    sendConfirmationTask.addRetry({
      errors: ['States.TaskFailed', 'States.Timeout', 'Lambda.ServiceException'],
      interval: cdk.Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2.0,
    });

    requestClarificationTask.addRetry({
      errors: ['States.TaskFailed', 'States.Timeout', 'Lambda.ServiceException'],
      interval: cdk.Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2.0,
    });

    // Grant state machine permission to invoke Lambda functions
    documentExtractionLambda.grantInvoke(this.kycProcessingStateMachine);
    kycValidationLambda.grantInvoke(this.kycProcessingStateMachine);
    sellerRegistrationLambda.grantInvoke(this.kycProcessingStateMachine);
    whatsappSenderLambda.grantInvoke(this.kycProcessingStateMachine);

    // Voice-First Workflow Handler Lambdas

    // KYC Handler Lambda
    const kycHandlerLambda = new lambda.Function(this, 'KYCHandlerLambda', {
      functionName: 'vyapar-vaani-kyc-handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambdas/kyc-handler.handler',
      code: lambda.Code.fromAsset('dist/src'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      role: lambdaExecutionRole,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        KYC_BUCKET_NAME: this.kycBucket.bucketName,
        PRODUCTS_BUCKET_NAME: this.productsBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        KMS_KEY_ID: this.encryptionKey.keyId,
        WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || '',
        WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
        WHATSAPP_API_ENDPOINT: process.env.WHATSAPP_API_ENDPOINT || 'https://graph.facebook.com/v22.0',
        MAX_IMAGE_SIZE_MB: process.env.MAX_IMAGE_SIZE_MB || '5',
        STATE_TTL_DAYS: process.env.STATE_TTL_DAYS || '7',
        VOICE_FIRST_ENABLED: process.env.VOICE_FIRST_ENABLED || 'true',
        KYC_FLOW_ENABLED: process.env.KYC_FLOW_ENABLED || 'true',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Voice Handler Lambda
    const voiceHandlerLambda = new lambda.Function(this, 'VoiceHandlerLambda', {
      functionName: 'vyapar-vaani-voice-handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambdas/voice-handler.handler',
      code: lambda.Code.fromAsset('dist/src'),
      timeout: cdk.Duration.minutes(5), // Voice processing can take time
      memorySize: 1024,
      role: lambdaExecutionRole,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        KYC_BUCKET_NAME: this.kycBucket.bucketName,
        PRODUCTS_BUCKET_NAME: this.productsBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        KMS_KEY_ID: this.encryptionKey.keyId,
        WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || '',
        WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
        MAX_AUDIO_SIZE_MB: process.env.MAX_AUDIO_SIZE_MB || '16',
        STATE_TTL_DAYS: process.env.STATE_TTL_DAYS || '7',
        POLLY_VOICE_ID_HINDI: process.env.POLLY_VOICE_ID_HINDI || 'Kajal',
        POLLY_VOICE_ID_MARATHI: process.env.POLLY_VOICE_ID_MARATHI || 'Aditi',
        POLLY_VOICE_ID_ENGLISH: process.env.POLLY_VOICE_ID_ENGLISH || 'Joanna',
        VOICE_FIRST_ENABLED: process.env.VOICE_FIRST_ENABLED || 'true',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Image Handler Lambda
    const imageHandlerLambda = new lambda.Function(this, 'ImageHandlerLambda', {
      functionName: 'vyapar-vaani-image-handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambdas/image-handler.handler',
      code: lambda.Code.fromAsset('dist/src'),
      timeout: cdk.Duration.minutes(3), // Image enhancement can take time
      memorySize: 1024,
      role: lambdaExecutionRole,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        KYC_BUCKET_NAME: this.kycBucket.bucketName,
        PRODUCTS_BUCKET_NAME: this.productsBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        KMS_KEY_ID: this.encryptionKey.keyId,
        WHATSAPP_API_ENDPOINT: process.env.WHATSAPP_API_ENDPOINT || 'https://graph.facebook.com/v22.0',
        WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || '',
        WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
        MAX_IMAGE_SIZE_MB: process.env.MAX_IMAGE_SIZE_MB || '5',
        STATE_TTL_DAYS: process.env.STATE_TTL_DAYS || '7',
        IMAGE_ENHANCEMENT_ENABLED: process.env.IMAGE_ENHANCEMENT_ENABLED || 'true',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Confirmation Handler Lambda
    const confirmationHandlerLambda = new lambda.Function(this, 'ConfirmationHandlerLambda', {
      functionName: 'vyapar-vaani-confirmation-handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambdas/confirmation-handler.handler',
      code: lambda.Code.fromAsset('dist/src'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      role: lambdaExecutionRole,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        KYC_BUCKET_NAME: this.kycBucket.bucketName,
        PRODUCTS_BUCKET_NAME: this.productsBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        KMS_KEY_ID: this.encryptionKey.keyId,
        WHATSAPP_API_ENDPOINT: process.env.WHATSAPP_API_ENDPOINT || 'https://graph.facebook.com/v22.0',
        WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || '',
        WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
        POLLY_VOICE_ID_HINDI: process.env.POLLY_VOICE_ID_HINDI || 'Kajal',
        POLLY_VOICE_ID_MARATHI: process.env.POLLY_VOICE_ID_MARATHI || 'Aditi',
        POLLY_VOICE_ID_ENGLISH: process.env.POLLY_VOICE_ID_ENGLISH || 'Joanna',
        STATE_TTL_DAYS: process.env.STATE_TTL_DAYS || '7',
        VOICE_FIRST_ENABLED: process.env.VOICE_FIRST_ENABLED || 'true',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Grant Polly permissions to confirmation handler
    confirmationHandlerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['polly:SynthesizeSpeech'],
        resources: ['*'],
      })
    );

    // Grant Polly permissions to voice handler for missing info prompts
    voiceHandlerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['polly:SynthesizeSpeech'],
        resources: ['*'],
      })
    );

    // EventBridge Rules for Voice-First Workflow State-Based Routing

    // Rule: KYC Handler - Image messages in NEW or KYC_PENDING state
    new events.Rule(this, 'KYCHandlerRule', {
      eventBus: this.eventBus,
      ruleName: 'vyapar-vaani-kyc-handler-rule',
      description: 'Routes image messages to KYC handler when user is in NEW or KYC_PENDING state',
      eventPattern: {
        source: [EVENT_SOURCES.WHATSAPP],
        detailType: [WHATSAPP_EVENT_TYPES.MESSAGE_RECEIVED_IMAGE],
        detail: {
          handler: ['KYC'],
          state: ['NEW', 'KYC_PENDING'],
        },
      },
      targets: [new targets.LambdaFunction(kycHandlerLambda)],
    });

    // Rule: Voice Handler - Audio/text messages in KYC_VERIFIED, VOICE_RECEIVED, or ACTIVE state
    new events.Rule(this, 'VoiceHandlerRule', {
      eventBus: this.eventBus,
      ruleName: 'vyapar-vaani-voice-handler-rule',
      description: 'Routes voice/text messages to voice handler when user is in appropriate state',
      eventPattern: {
        source: [EVENT_SOURCES.WHATSAPP],
        detailType: [
          WHATSAPP_EVENT_TYPES.MESSAGE_RECEIVED_VOICE,
          WHATSAPP_EVENT_TYPES.MESSAGE_RECEIVED_TEXT,
        ],
        detail: {
          handler: ['VOICE'],
          state: ['KYC_VERIFIED', 'VOICE_RECEIVED', 'ACTIVE', 'CONFIRMATION_PENDING'],
        },
      },
      targets: [new targets.LambdaFunction(voiceHandlerLambda)],
    });

    // Agent Handler Lambda - Unified AI agent for all message types
    const agentHandlerLambda = new lambda.Function(this, 'AgentHandlerLambda', {
      functionName: 'vyapar-vaani-agent-handler',
      description: 'Unified AI agent handler for natural language processing',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambdas/agent-handler.handler',
      code: lambda.Code.fromAsset('dist/src'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        PRODUCTS_BUCKET_NAME: this.productsBucket.bucketName,
        WHATSAPP_API_ENDPOINT: process.env.WHATSAPP_API_ENDPOINT || 'https://graph.facebook.com/v22.0',
        WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
        WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || '',
        WHATSAPP_BUSINESS_ACCOUNT_ID: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
        CONFIRMATION_HANDLER_FUNCTION_NAME: 'vyapar-vaani-confirmation-handler',
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant permissions to agent handler
    this.dataTable.grantReadWriteData(agentHandlerLambda);
    this.eventBus.grantPutEventsTo(agentHandlerLambda);
    this.productsBucket.grantReadWrite(agentHandlerLambda);
    whatsappSenderLambda.grantInvoke(agentHandlerLambda);
    voiceTranscriptionLambda.grantInvoke(agentHandlerLambda);
    imageEnhancementLambda.grantInvoke(agentHandlerLambda);
    confirmationHandlerLambda.grantInvoke(agentHandlerLambda);

    // Grant Bedrock permissions for AI agent (Nova Pro + Titan Image Generator v2)
    agentHandlerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/amazon.nova-pro-v1:0',
          'arn:aws:bedrock:*::foundation-model/amazon.titan-image-generator-v2:0',
        ],
      })
    );

    // Grant Polly permissions for voice synthesis
    agentHandlerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['polly:SynthesizeSpeech'],
        resources: ['*'],
      })
    );

    // Grant Transcribe permissions for voice transcription
    agentHandlerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'transcribe:StartTranscriptionJob',
          'transcribe:GetTranscriptionJob',
          'transcribe:DeleteTranscriptionJob',
        ],
        resources: ['*'],
      })
    );

    // Grant CloudWatch Metrics permissions
    agentHandlerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      })
    );

    // Rule: Agent Handler - ALL messages routed to AGENT handler across all post-KYC states
    new events.Rule(this, 'AgentHandlerRule', {
      eventBus: this.eventBus,
      ruleName: 'vyapar-vaani-agent-handler-rule',
      description: 'Routes all messages to AI agent for natural language processing',
      eventPattern: {
        source: [EVENT_SOURCES.WHATSAPP],
        detailType: [
          WHATSAPP_EVENT_TYPES.MESSAGE_RECEIVED_VOICE,
          WHATSAPP_EVENT_TYPES.MESSAGE_RECEIVED_TEXT,
          WHATSAPP_EVENT_TYPES.MESSAGE_RECEIVED_IMAGE,
          WHATSAPP_EVENT_TYPES.BUTTON_CLICKED,
        ],
        detail: {
          state: ['ACTIVE', 'KYC_VERIFIED', 'VOICE_RECEIVED', 'IMAGE_PENDING', 'CONFIRMATION_PENDING'],
          handler: ['AGENT'],
        },
      },
      targets: [new targets.LambdaFunction(agentHandlerLambda)],
    });

    // Rule: Image Handler - Image messages in IMAGE_PENDING or ACTIVE state
    new events.Rule(this, 'ImageHandlerRule', {
      eventBus: this.eventBus,
      ruleName: 'vyapar-vaani-image-handler-rule',
      description: 'Routes image messages to image handler when user is in IMAGE_PENDING or ACTIVE state',
      eventPattern: {
        source: [EVENT_SOURCES.WHATSAPP],
        detailType: [WHATSAPP_EVENT_TYPES.MESSAGE_RECEIVED_IMAGE],
        detail: {
          handler: ['IMAGE'],
          state: ['IMAGE_PENDING', 'ACTIVE'],
        },
      },
      targets: [new targets.LambdaFunction(imageHandlerLambda)],
    });

    // Rule: Image Request - Send WhatsApp message requesting product image
    new events.Rule(this, 'ImageRequestRule', {
      eventBus: this.eventBus,
      ruleName: 'vyapar-vaani-image-request-rule',
      description: 'Sends WhatsApp message requesting product image after voice processing',
      eventPattern: {
        source: [EVENT_SOURCES.INTERNAL],
        detailType: ['voice.image_request.needed'],
      },
      targets: [new targets.LambdaFunction(whatsappSenderLambda)],
    });

    // Rule: Confirmation Handler - Button clicks in CONFIRMATION_PENDING state
    // This rule matches button_reply events when the user is in CONFIRMATION_PENDING state
    // The event detail structure from whatsapp-webhook-handler includes:
    // - messageType: 'button_reply'
    // - state: 'CONFIRMATION_PENDING'
    // - handler: 'CONFIRMATION'
    // - content.buttonPayload: 'approve' | 'edit_quantity' | 'view_products'
    new events.Rule(this, 'ConfirmationHandlerRule', {
      eventBus: this.eventBus,
      ruleName: 'vyapar-vaani-confirmation-handler-rule',
      description: 'Routes button clicks to confirmation handler when user is in CONFIRMATION_PENDING state',
      eventPattern: {
        source: [EVENT_SOURCES.WHATSAPP],
        detailType: [WHATSAPP_EVENT_TYPES.BUTTON_CLICKED],
        detail: {
          messageType: ['button_reply'],
          state: ['CONFIRMATION_PENDING'],
          handler: ['CONFIRMATION'],
        },
      },
      targets: [new targets.LambdaFunction(confirmationHandlerLambda)],
    });

    // Outputs
    new cdk.CfnOutput(this, 'DataTableName', {
      value: this.dataTable.tableName,
      description: 'DynamoDB table name',
      exportName: 'VyaparVaaniDataTableName',
    });

    new cdk.CfnOutput(this, 'KYCBucketName', {
      value: this.kycBucket.bucketName,
      description: 'S3 bucket for KYC documents',
      exportName: 'VyaparVaaniKYCBucketName',
    });

    new cdk.CfnOutput(this, 'ProductsBucketName', {
      value: this.productsBucket.bucketName,
      description: 'S3 bucket for product images',
      exportName: 'VyaparVaaniProductsBucketName',
    });

    new cdk.CfnOutput(this, 'EventBusName', {
      value: this.eventBus.eventBusName,
      description: 'EventBridge event bus name',
      exportName: 'VyaparVaaniEventBusName',
    });

    new cdk.CfnOutput(this, 'EncryptionKeyId', {
      value: this.encryptionKey.keyId,
      description: 'KMS encryption key ID',
      exportName: 'VyaparVaaniEncryptionKeyId',
    });

    new cdk.CfnOutput(this, 'KYCStateMachineArn', {
      value: this.kycProcessingStateMachine.stateMachineArn,
      description: 'KYC Processing Step Functions state machine ARN',
      exportName: 'VyaparVaaniKYCStateMachineArn',
    });

    new cdk.CfnOutput(this, 'WhatsAppWebhookUrl', {
      value: `${this.httpApi.url}whatsapp/webhook`,
      description: 'WhatsApp webhook URL for Meta Developer Portal',
      exportName: 'VyaparVaaniWhatsAppWebhookUrl',
    });

    // ========================================
    // Marketplace Buyer Interface Integration
    // ========================================
    const marketplace = new MarketplaceIntegration(this, 'MarketplaceIntegration', {
      dataTable: this.dataTable,
      eventBus: this.eventBus,
      lambdaExecutionRole,
      productsBucket: this.productsBucket,
      whatsappConfig: {
        apiEndpoint: process.env.WHATSAPP_API_ENDPOINT || 'https://graph.facebook.com/v22.0',
        accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
      },
    });

    // Grant agent handler access to marketplace products table for UPI sync
    marketplace.marketplaceProductsTable.grantReadWriteData(agentHandlerLambda);
    agentHandlerLambda.addEnvironment('MARKETPLACE_PRODUCTS_TABLE', marketplace.marketplaceProductsTable.tableName);

    new cdk.CfnOutput(this, 'MarketplaceFrontendUrl', {
      value: `https://${marketplace.distribution.distributionDomainName}`,
      description: 'Marketplace buyer interface URL',
      exportName: 'MarketplaceFrontendUrl',
    });

    new cdk.CfnOutput(this, 'MarketplaceApiUrl', {
      value: marketplace.marketplaceApi.url,
      description: 'Marketplace API URL',
      exportName: 'MarketplaceApiUrl',
    });

    new cdk.CfnOutput(this, 'BPPAdapterUrl', {
      value: `${this.httpApi.url}beckn/{action}`,
      description: 'BPP Adapter Beckn Protocol endpoint (POST /beckn/{action})',
      exportName: 'VyaparVaaniBPPAdapterUrl',
    });
  }
}
