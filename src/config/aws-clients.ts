import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { SFNClient } from '@aws-sdk/client-sfn';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import { TextractClient } from '@aws-sdk/client-textract';
import { TranscribeClient } from '@aws-sdk/client-transcribe';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { RekognitionClient } from '@aws-sdk/client-rekognition';
import { KMSClient } from '@aws-sdk/client-kms';
import { SNSClient } from '@aws-sdk/client-sns';

// AWS Region configuration
const AWS_REGION = process.env.AWS_REGION || 'ap-south-1';

// DynamoDB Client with Document Client wrapper
const dynamoDBClient = new DynamoDBClient({ region: AWS_REGION });
export const docClient = DynamoDBDocumentClient.from(dynamoDBClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  },
  unmarshallOptions: {
    wrapNumbers: false,
  },
});

// S3 Client
export const s3Client = new S3Client({ region: AWS_REGION });

// EventBridge Client
export const eventBridgeClient = new EventBridgeClient({ region: AWS_REGION });

// Step Functions Client
export const sfnClient = new SFNClient({ region: AWS_REGION });

// Lambda Client
export const lambdaClient = new LambdaClient({ region: AWS_REGION });

// CloudWatch Logs Client
export const cloudWatchLogsClient = new CloudWatchLogsClient({ region: AWS_REGION });

// Amazon Textract Client
export const textractClient = new TextractClient({ region: AWS_REGION });

// Amazon Transcribe Client
export const transcribeClient = new TranscribeClient({ region: AWS_REGION });

// Amazon Bedrock Runtime Client
export const bedrockClient = new BedrockRuntimeClient({ region: AWS_REGION });

// Amazon Rekognition Client
export const rekognitionClient = new RekognitionClient({ region: AWS_REGION });

// AWS KMS Client
export const kmsClient = new KMSClient({ region: AWS_REGION });

// Amazon SNS Client
export const snsClient = new SNSClient({ region: AWS_REGION });

// Environment variables for resource names
export const TABLE_NAME = process.env.TABLE_NAME || 'vyapar-vaani-data';
export const KYC_BUCKET_NAME = process.env.KYC_BUCKET_NAME || '';
export const PRODUCTS_BUCKET_NAME = process.env.PRODUCTS_BUCKET_NAME || '';
export const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'vyapar-vaani-events';
export const KMS_KEY_ID = process.env.KMS_KEY_ID || '';
