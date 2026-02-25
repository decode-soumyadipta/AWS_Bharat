import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';

export class VyaparVaaniStack extends cdk.Stack {
  public readonly dataTable: dynamodb.Table;
  public readonly kycBucket: s3.Bucket;
  public readonly productsBucket: s3.Bucket;
  public readonly eventBus: events.EventBus;
  public readonly encryptionKey: kms.Key;
  public readonly kycProcessingStateMachine: sfn.StateMachine;

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

    // Grant SNS permissions for error notifications
    lambdaExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sns:Publish'],
        resources: ['*'],
      })
    );

    // Lambda Functions for KYC Processing Workflow
    
    // Document Extraction Lambda
    const documentExtractionLambda = new lambda.Function(this, 'DocumentExtractionLambda', {
      functionName: 'vyapar-vaani-document-extraction',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'document-extraction.handler',
      code: lambda.Code.fromAsset('dist/src/lambdas'),
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
      handler: 'kyc-validation.handler',
      code: lambda.Code.fromAsset('dist/src/lambdas'),
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
      handler: 'seller-registration.handler',
      code: lambda.Code.fromAsset('dist/src/lambdas'),
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
      handler: 'whatsapp-message-sender.handler',
      code: lambda.Code.fromAsset('dist/src/lambdas'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      role: lambdaExecutionRole,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        KYC_BUCKET_NAME: this.kycBucket.bucketName,
        PRODUCTS_BUCKET_NAME: this.productsBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        KMS_KEY_ID: this.encryptionKey.keyId,
        
        WHATSAPP_API_ENDPOINT: process.env.WHATSAPP_API_ENDPOINT || '',
        WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Voice Transcription Lambda
    const voiceTranscriptionLambda = new lambda.Function(this, 'VoiceTranscriptionLambda', {
      functionName: 'vyapar-vaani-voice-transcription',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'voice-transcription.handler',
      code: lambda.Code.fromAsset('dist/src/lambdas'),
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
      handler: 'intent-classification.handler',
      code: lambda.Code.fromAsset('dist/src/lambdas'),
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
  }
}
