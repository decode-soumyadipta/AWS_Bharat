
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';

interface MarketplaceIntegrationProps {

  dataTable: dynamodb.Table;

  eventBus: events.EventBus;

  lambdaExecutionRole: iam.Role;

  productsBucket: s3.IBucket;

  whatsappConfig: {
    apiEndpoint: string;
    accessToken: string;
    phoneNumberId: string;
  };
}

export class MarketplaceIntegration extends Construct {
  public readonly marketplaceProductsTable: dynamodb.Table;
  public readonly marketplaceApi: apigateway.RestApi;
  public readonly marketplaceBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: MarketplaceIntegrationProps) {
    super(scope, id);

    this.marketplaceProductsTable = new dynamodb.Table(this, 'MarketplaceProductsTable', {
      tableName: 'marketplace-products',
      partitionKey: { name: 'productId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.marketplaceProductsTable.addGlobalSecondaryIndex({
      indexName: 'CategoryIndex',
      partitionKey: { name: 'category', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.marketplaceProductsTable.addGlobalSecondaryIndex({
      indexName: 'CreatedAtIndex',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const catalogSyncLambda = new lambda.Function(this, 'CatalogSyncLambda', {
      functionName: 'marketplace-catalog-sync',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambdas/marketplace-catalog-sync.handler',
      code: lambda.Code.fromAsset('dist/backend'),
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      role: props.lambdaExecutionRole,
      environment: {
        VYAPAR_VAANI_TABLE: props.dataTable.tableName,
        MARKETPLACE_PRODUCTS_TABLE: this.marketplaceProductsTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    props.dataTable.grantReadData(catalogSyncLambda);
    this.marketplaceProductsTable.grantReadWriteData(catalogSyncLambda);

    catalogSyncLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['arn:aws:bedrock:*::foundation-model/amazon.nova-pro-v1:0'],
    }));

    new events.Rule(this, 'CatalogSyncRule', {
      eventBus: props.eventBus,
      eventPattern: {
        source: ['vyapar.vaani.internal'],
        detailType: ['catalog.created'],
      },
      targets: [new targets.LambdaFunction(catalogSyncLambda)],
    });

    new events.Rule(this, 'CatalogDeleteRule', {
      eventBus: props.eventBus,
      eventPattern: {
        source: ['vyapar.vaani.internal'],
        detailType: ['catalog.deleted'],
      },
      targets: [new targets.LambdaFunction(catalogSyncLambda)],
    });

    const getProductsLambda = new lambda.Function(this, 'GetProductsLambda', {
      functionName: 'marketplace-get-products',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambdas/getProducts.handler',
      code: lambda.Code.fromAsset('dist/backend'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        PRODUCTS_TABLE_NAME: this.marketplaceProductsTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    this.marketplaceProductsTable.grantReadData(getProductsLambda);

    props.productsBucket.grantRead(getProductsLambda);

    const submitOrderLambda = new lambda.Function(this, 'SubmitOrderLambda', {
      functionName: 'marketplace-submit-order',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambdas/submitOrder.handler',
      code: lambda.Code.fromAsset('dist/backend'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        WHATSAPP_API_ENDPOINT: props.whatsappConfig.apiEndpoint,
        WHATSAPP_ACCESS_TOKEN: props.whatsappConfig.accessToken,
        WHATSAPP_PHONE_NUMBER_ID: props.whatsappConfig.phoneNumberId,
        VYAPAR_VAANI_TABLE: props.dataTable.tableName,
        MARKETPLACE_PRODUCTS_TABLE: this.marketplaceProductsTable.tableName,
        EVENT_BUS_NAME: props.eventBus.eventBusName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    props.dataTable.grantReadWriteData(submitOrderLambda);

    this.marketplaceProductsTable.grantReadWriteData(submitOrderLambda);

    props.eventBus.grantPutEventsTo(submitOrderLambda);

    const verifyPaymentLambda = new lambda.Function(this, 'VerifyPaymentLambda', {
      functionName: 'marketplace-verify-payment',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'lambdas/verifyPayment.handler',
      code: lambda.Code.fromAsset('dist/backend'),
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      environment: {
        VYAPAR_VAANI_TABLE: props.dataTable.tableName,
        WHATSAPP_API_ENDPOINT: props.whatsappConfig.apiEndpoint,
        WHATSAPP_ACCESS_TOKEN: props.whatsappConfig.accessToken,
        WHATSAPP_PHONE_NUMBER_ID: props.whatsappConfig.phoneNumberId,
        PRODUCTS_BUCKET: props.productsBucket.bucketName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    props.dataTable.grantReadWriteData(verifyPaymentLambda);
    props.productsBucket.grantReadWrite(verifyPaymentLambda);

    verifyPaymentLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['arn:aws:bedrock:*::foundation-model/amazon.nova-pro-v1:0'],
    }));

    this.marketplaceApi = new apigateway.RestApi(this, 'MarketplaceApi', {
      restApiName: 'marketplace-buyer-api',
      description: 'API for marketplace buyer interface',
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
      },
    });

    const products = this.marketplaceApi.root.addResource('products');
    products.addMethod('GET', new apigateway.LambdaIntegration(getProductsLambda), {
      apiKeyRequired: true,
    });

    const orders = this.marketplaceApi.root.addResource('orders');
    orders.addMethod('POST', new apigateway.LambdaIntegration(submitOrderLambda), {
      apiKeyRequired: true,
    });

    const orderById = orders.addResource('{orderId}');
    orderById.addMethod('GET', new apigateway.LambdaIntegration(submitOrderLambda), {
      apiKeyRequired: true,
    });

    const verifyPayment = orderById.addResource('verify-payment');
    verifyPayment.addMethod('POST', new apigateway.LambdaIntegration(verifyPaymentLambda), {
      apiKeyRequired: true,
    });

    const apiKey = this.marketplaceApi.addApiKey('MarketplaceApiKey', {
      apiKeyName: 'marketplace-buyer-key',
      description: 'API key for marketplace buyer interface',
    });

    const usagePlan = this.marketplaceApi.addUsagePlan('MarketplaceUsagePlan', {
      name: 'marketplace-standard',
      description: 'Standard usage plan for marketplace API',
      throttle: {
        rateLimit: 200,
        burstLimit: 400,
      },
      quota: {
        limit: 500000,
        period: apigateway.Period.DAY,
      },
    });

    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({ stage: this.marketplaceApi.deploymentStage });

    this.marketplaceBucket = new s3.Bucket(this, 'MarketplaceFrontendBucket', {
      bucketName: `marketplace-frontend-${cdk.Stack.of(this).account}`,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: 'OAI for marketplace frontend',
    });

    this.marketplaceBucket.grantRead(originAccessIdentity);

    this.distribution = new cloudfront.Distribution(this, 'MarketplaceDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(this.marketplaceBucket, {
          originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    new s3deploy.BucketDeployment(this, 'DeployMarketplaceFrontend', {
      sources: [s3deploy.Source.asset('./marketplace')],
      destinationBucket: this.marketplaceBucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });

    new cdk.CfnOutput(this, 'MarketplaceProductsTableName', {
      value: this.marketplaceProductsTable.tableName,
      description: 'Marketplace products DynamoDB table',
    });

    new cdk.CfnOutput(this, 'MarketplaceApiUrl', {
      value: this.marketplaceApi.url,
      description: 'Marketplace API Gateway URL',
    });

    new cdk.CfnOutput(this, 'MarketplaceFrontendUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'Marketplace frontend CloudFront URL',
    });

    new cdk.CfnOutput(this, 'MarketplaceBucketName', {
      value: this.marketplaceBucket.bucketName,
      description: 'Marketplace frontend S3 bucket',
    });
  }
}
