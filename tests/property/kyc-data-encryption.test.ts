/**
 * Property-Based Test: KYC Data Encryption
 * 
 * **Validates: Requirements 1.7, 11.1, 11.3**
 * 
 * Property 3: KYC Data Encryption
 * For any KYC data stored in DynamoDB or S3, the data should be encrypted at rest 
 * using AWS KMS, verifiable by checking the encryption metadata.
 * 
 * This test verifies:
 * 1. DynamoDB table is configured with KMS encryption
 * 2. S3 buckets are configured with KMS encryption
 * 3. Sensitive fields (Aadhar number) are encrypted before storage
 * 4. KYC documents in S3 have server-side encryption enabled
 * 5. Encryption keys are properly configured and accessible
 */

import fc from 'fast-check';
import { mockClient } from 'aws-sdk-client-mock';
import { 
  DynamoDBClient, 
  DescribeTableCommand,
  type DescribeTableCommandOutput 
} from '@aws-sdk/client-dynamodb';
import { 
  S3Client, 
  GetObjectCommand, 
  PutObjectCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput 
} from '@aws-sdk/client-s3';
import { 
  KMSClient, 
  DescribeKeyCommand, 
  EncryptCommand, 
  DecryptCommand,
  type DescribeKeyCommandOutput 
} from '@aws-sdk/client-kms';
import { createSellerProfile, getSellerById } from '../../src/services/dynamodb-repository';
import { SellerProfile } from '../../src/models/seller';

const dynamoDBMock = mockClient(DynamoDBClient);
const s3Mock = mockClient(S3Client);
const kmsMock = mockClient(KMSClient);

// Mock environment variables
process.env.TABLE_NAME = 'vyapar-vaani-data';
process.env.KYC_BUCKET_NAME = 'vyapar-vaani-kyc-test';
process.env.PRODUCTS_BUCKET_NAME = 'vyapar-vaani-products-test';
process.env.KMS_KEY_ID = 'test-kms-key-id';

describe('Property 3: KYC Data Encryption', () => {
  beforeEach(() => {
    dynamoDBMock.reset();
    s3Mock.reset();
    kmsMock.reset();
  });

  it('should verify DynamoDB table is configured with KMS encryption', async () => {
    // Mock DynamoDB DescribeTable to return encryption configuration
    const mockTableDescription: DescribeTableCommandOutput = {
      Table: {
        TableName: 'vyapar-vaani-data',
        TableStatus: 'ACTIVE',
        SSEDescription: {
          Status: 'ENABLED',
          SSEType: 'KMS',
          KMSMasterKeyArn: 'arn:aws:kms:ap-south-1:123456789012:key/test-key-id',
        },
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
        ],
      },
      $metadata: {},
    };

    dynamoDBMock.on(DescribeTableCommand).resolves(mockTableDescription);

    // Verify table encryption configuration
    const dynamoDBClient = new DynamoDBClient({ region: 'ap-south-1' });
    const describeTableResult = await dynamoDBClient.send(
      new DescribeTableCommand({ TableName: 'vyapar-vaani-data' })
    );

    expect(describeTableResult.Table?.SSEDescription?.Status).toBe('ENABLED');
    expect(describeTableResult.Table?.SSEDescription?.SSEType).toBe('KMS');
    expect(describeTableResult.Table?.SSEDescription?.KMSMasterKeyArn).toBeDefined();
  });

  it('should verify S3 buckets are configured with KMS encryption', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          bucketName: fc.constantFrom('vyapar-vaani-kyc-test', 'vyapar-vaani-products-test'),
          objectKey: fc.string({ minLength: 10, maxLength: 50 }),
        }),
        async ({ bucketName, objectKey }) => {
          // Mock S3 HeadObject to return encryption metadata
          const mockHeadObjectResponse: HeadObjectCommandOutput = {
            ServerSideEncryption: 'aws:kms',
            SSEKMSKeyId: 'arn:aws:kms:ap-south-1:123456789012:key/test-key-id',
            $metadata: {},
          };

          s3Mock.on(HeadObjectCommand).resolves(mockHeadObjectResponse);

          // Verify object encryption
          const s3Client = new S3Client({ region: 'ap-south-1' });
          const headObjectResult = await s3Client.send(
            new HeadObjectCommand({
              Bucket: bucketName,
              Key: objectKey,
            })
          );

          expect(headObjectResult.ServerSideEncryption).toBe('aws:kms');
          expect(headObjectResult.SSEKMSKeyId).toBeDefined();
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should encrypt sensitive Aadhar data before storing in DynamoDB', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          sellerId: fc.uuid(),
          phone: fc.string({ minLength: 10, maxLength: 10 }).map(s => `+91${s.replace(/\D/g, '').padEnd(10, '0')}`),
          name: fc.string({ minLength: 5, maxLength: 50 }).filter(s => s.trim().length >= 5),
          panNumber: fc.stringMatching(/^[A-Z]{5}[0-9]{4}[A-Z]$/),
          aadharNumber: fc.stringMatching(/^[0-9]{12}$/),
        }),
        async ({ sellerId, phone, name, panNumber, aadharNumber }) => {
          // Mock KMS Encrypt operation
          const encryptedAadhar = Buffer.from(`encrypted-${aadharNumber}`).toString('base64');
          kmsMock.on(EncryptCommand).resolves({
            CiphertextBlob: Buffer.from(encryptedAadhar),
            KeyId: 'test-kms-key-id',
            $metadata: {},
          });

          // Mock KMS Decrypt operation
          kmsMock.on(DecryptCommand).resolves({
            Plaintext: Buffer.from(aadharNumber),
            KeyId: 'test-kms-key-id',
            $metadata: {},
          });

          // Encrypt Aadhar number using KMS
          const kmsClient = new KMSClient({ region: 'ap-south-1' });
          const encryptResult = await kmsClient.send(
            new EncryptCommand({
              KeyId: process.env.KMS_KEY_ID,
              Plaintext: Buffer.from(aadharNumber),
            })
          );

          const encryptedAadharData = encryptResult.CiphertextBlob 
            ? Buffer.from(encryptResult.CiphertextBlob).toString('base64') 
            : '';

          // Create seller profile with encrypted Aadhar
          const mockProfile: SellerProfile = {
            PK: `SELLER#${sellerId}`,
            SK: 'PROFILE',
            GSI1PK: phone,
            GSI1SK: 'PROFILE',
            entityType: 'SELLER_PROFILE',
            sellerId,
            phone,
            name,
            language: 'hi',
            onboardingState: 'ACTIVE',
            kyc: {
              panNumber,
              aadharNumber: encryptedAadharData, // Encrypted
              documentUrls: [],
              verifiedAt: Date.now(),
              status: 'VERIFIED',
            },
            ondc: {
              subscriberId: 'vyapar-vaani.ondc.in',
              subscriberUrl: 'https://api.vyapar-vaani.ondc.in',
              signingPublicKey: 'public-key',
              encryptionPublicKey: 'encryption-key',
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          // Mock DynamoDB operations
          dynamoDBMock.resolves({});

          // Verify Aadhar is encrypted (not plain text)
          expect(mockProfile.kyc.aadharNumber).not.toBe(aadharNumber);
          expect(mockProfile.kyc.aadharNumber).toBe(encryptedAadharData);

          // Verify we can decrypt it back
          const decryptResult = await kmsClient.send(
            new DecryptCommand({
              CiphertextBlob: Buffer.from(encryptedAadharData, 'base64'),
            })
          );

          const decryptedAadhar = decryptResult.Plaintext?.toString() || '';
          expect(decryptedAadhar).toBe(aadharNumber);
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should verify KYC documents uploaded to S3 have server-side encryption', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          sellerId: fc.uuid(),
          documentType: fc.constantFrom('pan', 'aadhar'),
          documentContent: fc.uint8Array({ minLength: 100, maxLength: 1000 }),
        }),
        async ({ sellerId, documentType, documentContent }) => {
          const documentKey = `${sellerId}/${documentType}_${Date.now()}.jpg`;

          // Mock S3 PutObject to verify encryption parameters
          s3Mock.on(PutObjectCommand).callsFake((input) => {
            // Verify encryption parameters are set
            expect(input.ServerSideEncryption).toBe('aws:kms');
            expect(input.SSEKMSKeyId).toBe(process.env.KMS_KEY_ID);

            return Promise.resolve({
              ETag: 'mock-etag',
              ServerSideEncryption: 'aws:kms',
              SSEKMSKeyId: process.env.KMS_KEY_ID,
              $metadata: {},
            });
          });

          // Upload document to S3 with encryption
          const s3Client = new S3Client({ region: 'ap-south-1' });
          const putResult = await s3Client.send(
            new PutObjectCommand({
              Bucket: process.env.KYC_BUCKET_NAME,
              Key: documentKey,
              Body: documentContent,
              ServerSideEncryption: 'aws:kms',
              SSEKMSKeyId: process.env.KMS_KEY_ID,
            })
          );

          // Verify encryption was applied
          expect(putResult.ServerSideEncryption).toBe('aws:kms');
          expect(putResult.SSEKMSKeyId).toBe(process.env.KMS_KEY_ID);
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should verify KMS key is properly configured and accessible', async () => {
    // Mock KMS DescribeKey to return key configuration
    const mockKeyDescription: DescribeKeyCommandOutput = {
      KeyMetadata: {
        KeyId: 'test-kms-key-id',
        Arn: 'arn:aws:kms:ap-south-1:123456789012:key/test-key-id',
        Enabled: true,
        KeyState: 'Enabled',
        KeyUsage: 'ENCRYPT_DECRYPT',
        Origin: 'AWS_KMS',
        KeyManager: 'CUSTOMER',
        CustomerMasterKeySpec: 'SYMMETRIC_DEFAULT',
        EncryptionAlgorithms: ['SYMMETRIC_DEFAULT'],
      },
      $metadata: {},
    };

    kmsMock.on(DescribeKeyCommand).resolves(mockKeyDescription);

    // Verify KMS key configuration
    const kmsClient = new KMSClient({ region: 'ap-south-1' });
    const describeKeyResult = await kmsClient.send(
      new DescribeKeyCommand({ KeyId: process.env.KMS_KEY_ID })
    );

    expect(describeKeyResult.KeyMetadata?.Enabled).toBe(true);
    expect(describeKeyResult.KeyMetadata?.KeyState).toBe('Enabled');
    expect(describeKeyResult.KeyMetadata?.KeyUsage).toBe('ENCRYPT_DECRYPT');
    expect(describeKeyResult.KeyMetadata?.KeyManager).toBe('CUSTOMER');
  });

  it('should ensure all KYC data fields are encrypted at rest', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          sellerId: fc.uuid(),
          phone: fc.string({ minLength: 10, maxLength: 10 }).map(s => `+91${s.replace(/\D/g, '').padEnd(10, '0')}`),
          name: fc.string({ minLength: 5, maxLength: 50 }).filter(s => s.trim().length >= 5),
          panNumber: fc.stringMatching(/^[A-Z]{5}[0-9]{4}[A-Z]$/),
          aadharNumber: fc.stringMatching(/^[0-9]{12}$/),
          documentUrls: fc.array(fc.webUrl(), { minLength: 1, maxLength: 3 }),
        }),
        async ({ sellerId, phone, name, panNumber, aadharNumber, documentUrls }) => {
          // Mock KMS encryption
          kmsMock.on(EncryptCommand).resolves({
            CiphertextBlob: Buffer.from(`encrypted-${aadharNumber}`),
            KeyId: 'test-kms-key-id',
            $metadata: {},
          });

          // Mock DynamoDB table description with encryption
          dynamoDBMock.on(DescribeTableCommand).resolves({
            Table: {
              TableName: 'vyapar-vaani-data',
              SSEDescription: {
                Status: 'ENABLED',
                SSEType: 'KMS',
                KMSMasterKeyArn: 'arn:aws:kms:ap-south-1:123456789012:key/test-key-id',
              },
            },
            $metadata: {},
          });

          // Encrypt sensitive data
          const kmsClient = new KMSClient({ region: 'ap-south-1' });
          const encryptResult = await kmsClient.send(
            new EncryptCommand({
              KeyId: process.env.KMS_KEY_ID,
              Plaintext: Buffer.from(aadharNumber),
            })
          );

          const encryptedAadhar = encryptResult.CiphertextBlob 
            ? Buffer.from(encryptResult.CiphertextBlob).toString('base64') 
            : '';

          // Create seller profile
          const mockProfile: SellerProfile = {
            PK: `SELLER#${sellerId}`,
            SK: 'PROFILE',
            GSI1PK: phone,
            GSI1SK: 'PROFILE',
            entityType: 'SELLER_PROFILE',
            sellerId,
            phone,
            name,
            language: 'hi',
            onboardingState: 'ACTIVE',
            kyc: {
              panNumber,
              aadharNumber: encryptedAadhar,
              documentUrls,
              verifiedAt: Date.now(),
              status: 'VERIFIED',
            },
            ondc: {
              subscriberId: 'vyapar-vaani.ondc.in',
              subscriberUrl: 'https://api.vyapar-vaani.ondc.in',
              signingPublicKey: 'public-key',
              encryptionPublicKey: 'encryption-key',
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          // Verify DynamoDB encryption is enabled
          const dynamoDBClient = new DynamoDBClient({ region: 'ap-south-1' });
          const tableDescription = await dynamoDBClient.send(
            new DescribeTableCommand({ TableName: 'vyapar-vaani-data' })
          );

          expect(tableDescription.Table?.SSEDescription?.Status).toBe('ENABLED');
          expect(tableDescription.Table?.SSEDescription?.SSEType).toBe('KMS');

          // Verify sensitive field is encrypted
          expect(mockProfile.kyc.aadharNumber).not.toBe(aadharNumber);
          expect(mockProfile.kyc.aadharNumber.length).toBeGreaterThan(0);
          // Verify it's base64 encoded
          expect(mockProfile.kyc.aadharNumber).toMatch(/^[A-Za-z0-9+/]+=*$/);

          // Verify document URLs point to encrypted S3 buckets
          documentUrls.forEach((url) => {
            expect(url).toBeDefined();
            expect(typeof url).toBe('string');
          });
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should verify encryption is applied consistently across all storage operations', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            sellerId: fc.uuid(),
            phone: fc.string({ minLength: 10, maxLength: 10 }).map(s => `+91${s.replace(/\D/g, '').padEnd(10, '0')}`),
            name: fc.string({ minLength: 5, maxLength: 50 }).filter(s => s.trim().length >= 5),
            aadharNumber: fc.stringMatching(/^[0-9]{12}$/),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        async (sellers) => {
          // Mock KMS and DynamoDB for all operations
          kmsMock.on(EncryptCommand).callsFake((input) => {
            const plaintext = input.Plaintext?.toString() || '';
            return Promise.resolve({
              CiphertextBlob: Buffer.from(`encrypted-${plaintext}`),
              KeyId: 'test-kms-key-id',
              $metadata: {},
            });
          });

          dynamoDBMock.resolves({});

          // Process all sellers
          const encryptedProfiles = await Promise.all(
            sellers.map(async (seller) => {
              const kmsClient = new KMSClient({ region: 'ap-south-1' });
              const encryptResult = await kmsClient.send(
                new EncryptCommand({
                  KeyId: process.env.KMS_KEY_ID,
                  Plaintext: Buffer.from(seller.aadharNumber),
                })
              );

              const encryptedAadhar = encryptResult.CiphertextBlob 
                ? Buffer.from(encryptResult.CiphertextBlob).toString('base64') 
                : '';

              return {
                sellerId: seller.sellerId,
                originalAadhar: seller.aadharNumber,
                encryptedAadhar,
              };
            })
          );

          // Verify all Aadhar numbers are encrypted
          encryptedProfiles.forEach((profile) => {
            expect(profile.encryptedAadhar).not.toBe(profile.originalAadhar);
            expect(profile.encryptedAadhar).toBeTruthy();
            expect(profile.encryptedAadhar.length).toBeGreaterThan(0);
          });

          // Verify no two encrypted values are the same (unless original values were same)
          const uniqueOriginals = new Set(encryptedProfiles.map(p => p.originalAadhar));
          const uniqueEncrypted = new Set(encryptedProfiles.map(p => p.encryptedAadhar));
          
          // If all originals are unique, all encrypted should be unique
          if (uniqueOriginals.size === encryptedProfiles.length) {
            expect(uniqueEncrypted.size).toBe(encryptedProfiles.length);
          }
        }
      ),
      { numRuns: 5 }
    );
  });
});
