import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { VyaparVaaniStack } from '../../infrastructure/stacks/vyapar-vaani-stack';

describe('VyaparVaaniStack Infrastructure', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new VyaparVaaniStack(app, 'TestStack');
    template = Template.fromStack(stack);
  });

  describe('DynamoDB Table', () => {
    it('should create a DynamoDB table with correct configuration', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        BillingMode: 'PAY_PER_REQUEST',
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
        StreamSpecification: {
          StreamViewType: 'NEW_AND_OLD_IMAGES',
        },
      });
    });

    it('should create GSI1 for phone number lookup', () => {
      const table = template.findResources('AWS::DynamoDB::Table');
      const tableResource = Object.values(table)[0] as any;
      const gsi1 = tableResource.Properties.GlobalSecondaryIndexes.find(
        (gsi: any) => gsi.IndexName === 'GSI1'
      );
      expect(gsi1).toBeDefined();
      expect(gsi1.KeySchema).toEqual([
        { AttributeName: 'GSI1PK', KeyType: 'HASH' },
        { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
      ]);
      expect(gsi1.Projection.ProjectionType).toBe('ALL');
    });

    it('should create GSI2 for order status lookup', () => {
      const table = template.findResources('AWS::DynamoDB::Table');
      const tableResource = Object.values(table)[0] as any;
      const gsi2 = tableResource.Properties.GlobalSecondaryIndexes.find(
        (gsi: any) => gsi.IndexName === 'GSI2'
      );
      expect(gsi2).toBeDefined();
      expect(gsi2.KeySchema).toEqual([
        { AttributeName: 'GSI2PK', KeyType: 'HASH' },
        { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
      ]);
      expect(gsi2.Projection.ProjectionType).toBe('ALL');
    });

    it('should create GSI3 for catalog category lookup', () => {
      const table = template.findResources('AWS::DynamoDB::Table');
      const tableResource = Object.values(table)[0] as any;
      const gsi3 = tableResource.Properties.GlobalSecondaryIndexes.find(
        (gsi: any) => gsi.IndexName === 'GSI3'
      );
      expect(gsi3).toBeDefined();
      expect(gsi3.KeySchema).toEqual([
        { AttributeName: 'GSI3PK', KeyType: 'HASH' },
        { AttributeName: 'GSI3SK', KeyType: 'RANGE' },
      ]);
      expect(gsi3.Projection.ProjectionType).toBe('ALL');
    });
  });

  describe('S3 Buckets', () => {
    it('should create KYC documents bucket with encryption', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: 'aws:kms',
              },
            },
          ],
        },
        VersioningConfiguration: {
          Status: 'Enabled',
        },
      });
    });

    it('should create products bucket with CORS configuration', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        CorsConfiguration: {
          CorsRules: [
            {
              AllowedMethods: ['GET', 'PUT'],
              AllowedOrigins: ['*'],
              AllowedHeaders: ['*'],
              MaxAge: 3000,
            },
          ],
        },
      });
    });

    it('should configure lifecycle policies for KYC bucket', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        LifecycleConfiguration: {
          Rules: [
            {
              Id: 'TransitionToGlacier',
              Status: 'Enabled',
              Transitions: [
                {
                  StorageClass: 'GLACIER',
                  TransitionInDays: 90,
                },
              ],
            },
            {
              Id: 'DeleteAfter7Years',
              Status: 'Enabled',
              ExpirationInDays: 2555,
            },
          ],
        },
      });
    });

    it('should configure lifecycle policies for products bucket', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        LifecycleConfiguration: {
          Rules: [
            {
              Id: 'DeleteTempFiles',
              Status: 'Enabled',
              Prefix: 'temp/',
              ExpirationInDays: 1,
            },
            {
              Id: 'TransitionRawToIA',
              Status: 'Enabled',
              Prefix: 'raw/',
              Transitions: [
                {
                  StorageClass: 'STANDARD_IA',
                  TransitionInDays: 30,
                },
              ],
            },
          ],
        },
      });
    });
  });

  describe('EventBridge', () => {
    it('should create an EventBridge event bus', () => {
      template.hasResourceProperties('AWS::Events::EventBus', {
        Name: 'vyapar-vaani-events',
      });
    });

    it('should create an event archive', () => {
      template.hasResourceProperties('AWS::Events::Archive', {
        ArchiveName: 'vyapar-vaani-archive',
        RetentionDays: 30,
      });
    });
  });

  describe('KMS', () => {
    it('should create a KMS key with rotation enabled', () => {
      template.hasResourceProperties('AWS::KMS::Key', {
        EnableKeyRotation: true,
      });
    });
  });

  describe('CloudWatch Log Groups', () => {
    const logGroupNames = [
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

    logGroupNames.forEach((name) => {
      it(`should create log group for ${name}`, () => {
        template.hasResourceProperties('AWS::Logs::LogGroup', {
          LogGroupName: `/aws/lambda/vyapar-vaani/${name}`,
          RetentionInDays: 30,
        });
      });
    });
  });

  describe('IAM Role', () => {
    it('should create Lambda execution role with basic permissions', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                Service: 'lambda.amazonaws.com',
              },
            },
          ],
        },
      });
    });

    it('should grant AI service permissions', () => {
      const policies = template.findResources('AWS::IAM::Policy');
      const policyResource = Object.values(policies)[0] as any;
      const statements = policyResource.Properties.PolicyDocument.Statement;
      
      const aiStatement = statements.find((stmt: any) => {
        const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
        return actions.some((action: string) => action.startsWith('textract:') || action.startsWith('bedrock:'));
      });
      
      expect(aiStatement).toBeDefined();
      const actions = Array.isArray(aiStatement.Action) ? aiStatement.Action : [aiStatement.Action];
      expect(actions).toEqual(
        expect.arrayContaining([
          'textract:AnalyzeDocument',
          'textract:DetectDocumentText',
          'transcribe:StartTranscriptionJob',
          'transcribe:GetTranscriptionJob',
          'bedrock:InvokeModel',
          'rekognition:DetectLabels',
          'rekognition:CompareFaces',
        ])
      );
      expect(aiStatement.Effect).toBe('Allow');
    });

    it('should grant Step Functions permissions', () => {
      const policies = template.findResources('AWS::IAM::Policy');
      const policyResource = Object.values(policies)[0] as any;
      const statements = policyResource.Properties.PolicyDocument.Statement;
      
      const sfnStatement = statements.find((stmt: any) => {
        const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
        return actions.some((action: string) => action.startsWith('states:'));
      });
      
      expect(sfnStatement).toBeDefined();
      const actions = Array.isArray(sfnStatement.Action) ? sfnStatement.Action : [sfnStatement.Action];
      expect(actions).toEqual(
        expect.arrayContaining([
          'states:StartExecution',
          'states:DescribeExecution',
          'states:StopExecution',
        ])
      );
      expect(sfnStatement.Effect).toBe('Allow');
    });
  });

  describe('Stack Outputs', () => {
    it('should export DynamoDB table name', () => {
      template.hasOutput('DataTableName', {
        Export: {
          Name: 'VyaparVaaniDataTableName',
        },
      });
    });

    it('should export KYC bucket name', () => {
      template.hasOutput('KYCBucketName', {
        Export: {
          Name: 'VyaparVaaniKYCBucketName',
        },
      });
    });

    it('should export products bucket name', () => {
      template.hasOutput('ProductsBucketName', {
        Export: {
          Name: 'VyaparVaaniProductsBucketName',
        },
      });
    });

    it('should export event bus name', () => {
      template.hasOutput('EventBusName', {
        Export: {
          Name: 'VyaparVaaniEventBusName',
        },
      });
    });

    it('should export encryption key ID', () => {
      template.hasOutput('EncryptionKeyId', {
        Export: {
          Name: 'VyaparVaaniEncryptionKeyId',
        },
      });
    });
  });
});
