import {
  docClient,
  s3Client,
  eventBridgeClient,
  sfnClient,
  lambdaClient,
  cloudWatchLogsClient,
  textractClient,
  transcribeClient,
  bedrockClient,
  rekognitionClient,
  kmsClient,
  snsClient,
  TABLE_NAME,
  EVENT_BUS_NAME,
} from '../../src/config/aws-clients';

describe('AWS Clients Configuration', () => {
  describe('Client Instances', () => {
    it('should export DynamoDB Document Client', () => {
      expect(docClient).toBeDefined();
      expect(docClient.send).toBeDefined();
    });

    it('should export S3 Client', () => {
      expect(s3Client).toBeDefined();
      expect(s3Client.send).toBeDefined();
    });

    it('should export EventBridge Client', () => {
      expect(eventBridgeClient).toBeDefined();
      expect(eventBridgeClient.send).toBeDefined();
    });

    it('should export Step Functions Client', () => {
      expect(sfnClient).toBeDefined();
      expect(sfnClient.send).toBeDefined();
    });

    it('should export Lambda Client', () => {
      expect(lambdaClient).toBeDefined();
      expect(lambdaClient.send).toBeDefined();
    });

    it('should export CloudWatch Logs Client', () => {
      expect(cloudWatchLogsClient).toBeDefined();
      expect(cloudWatchLogsClient.send).toBeDefined();
    });

    it('should export Textract Client', () => {
      expect(textractClient).toBeDefined();
      expect(textractClient.send).toBeDefined();
    });

    it('should export Transcribe Client', () => {
      expect(transcribeClient).toBeDefined();
      expect(transcribeClient.send).toBeDefined();
    });

    it('should export Bedrock Runtime Client', () => {
      expect(bedrockClient).toBeDefined();
      expect(bedrockClient.send).toBeDefined();
    });

    it('should export Rekognition Client', () => {
      expect(rekognitionClient).toBeDefined();
      expect(rekognitionClient.send).toBeDefined();
    });

    it('should export KMS Client', () => {
      expect(kmsClient).toBeDefined();
      expect(kmsClient.send).toBeDefined();
    });

    it('should export SNS Client', () => {
      expect(snsClient).toBeDefined();
      expect(snsClient.send).toBeDefined();
    });
  });

  describe('Environment Variables', () => {
    it('should have default table name', () => {
      expect(TABLE_NAME).toBe('vyapar-vaani-data');
    });

    it('should have default event bus name', () => {
      expect(EVENT_BUS_NAME).toBe('vyapar-vaani-events');
    });
  });
});
