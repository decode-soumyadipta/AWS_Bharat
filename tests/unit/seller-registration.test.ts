/**
 * Unit Tests for ONDC Seller Registration Lambda
 * 
 * Tests:
 * - Ed25519 key pair generation
 * - Aadhar number encryption
 * - KYC document storage in S3
 * - ONDC registration payload construction
 * - Seller profile creation
 * - Error handling
 * 
 * Validates: Requirements 1.5, 1.7
 */

import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { KMSClient, EncryptCommand } from '@aws-sdk/client-kms';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  handler,
  generateEd25519KeyPair,
  encryptAadharNumber,
  storeKYCDocuments,
  registerWithONDC,
  SellerRegistrationRequest,
} from '../../src/lambdas/seller-registration';
import { ExtractedKYCData } from '../../src/models/kyc';

// Mock AWS clients
const s3Mock = mockClient(S3Client);
const kmsMock = mockClient(KMSClient);
const dynamoMock = mockClient(DynamoDBDocumentClient);

// Mock fetch for document downloads
global.fetch = jest.fn();

describe('Seller Registration Lambda', () => {
  beforeEach(() => {
    // Reset all mocks
    s3Mock.reset();
    kmsMock.reset();
    dynamoMock.reset();
    jest.clearAllMocks();

    // Setup default mock responses
    kmsMock.on(EncryptCommand).resolves({
      CiphertextBlob: Buffer.from('encrypted-aadhar', 'utf-8'),
    });

    s3Mock.on(PutObjectCommand).resolves({});
    dynamoMock.on(PutCommand).resolves({});

    (global.fetch as jest.Mock).mockResolvedValue({
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
    });
  });

  describe('generateEd25519KeyPair', () => {
    it('should generate a valid Ed25519 key pair', () => {
      const keyPair = generateEd25519KeyPair();

      expect(keyPair).toHaveProperty('publicKey');
      expect(keyPair).toHaveProperty('privateKey');
      expect(typeof keyPair.publicKey).toBe('string');
      expect(typeof keyPair.privateKey).toBe('string');
      expect(keyPair.publicKey.length).toBeGreaterThan(0);
      expect(keyPair.privateKey.length).toBeGreaterThan(0);
    });

    it('should generate different key pairs on each call', () => {
      const keyPair1 = generateEd25519KeyPair();
      const keyPair2 = generateEd25519KeyPair();

      expect(keyPair1.publicKey).not.toBe(keyPair2.publicKey);
      expect(keyPair1.privateKey).not.toBe(keyPair2.privateKey);
    });

    it('should generate base64 encoded keys', () => {
      const keyPair = generateEd25519KeyPair();

      // Base64 regex pattern
      const base64Regex = /^[A-Za-z0-9+/]+=*$/;
      expect(keyPair.publicKey).toMatch(base64Regex);
      expect(keyPair.privateKey).toMatch(base64Regex);
    });
  });

  describe('encryptAadharNumber', () => {
    it('should encrypt Aadhar number using KMS', async () => {
      const aadharNumber = '123456789012';

      const encrypted = await encryptAadharNumber(aadharNumber);

      expect(encrypted).toBe('ZW5jcnlwdGVkLWFhZGhhcg=='); // base64 of 'encrypted-aadhar'
      expect(kmsMock.calls()).toHaveLength(1);
    });

    it('should remove spaces from Aadhar number before encryption', async () => {
      const aadharNumber = '1234 5678 9012';

      await encryptAadharNumber(aadharNumber);

      const call = kmsMock.call(0);
      const input = call.args[0].input as any;
      const plaintext = Buffer.from(input.Plaintext as Uint8Array).toString('utf-8');
      expect(plaintext).toBe('123456789012');
    });

    it('should return empty string for empty Aadhar number', async () => {
      const encrypted = await encryptAadharNumber('');

      expect(encrypted).toBe('');
      expect(kmsMock.calls()).toHaveLength(0);
    });

    it('should throw error if KMS encryption fails', async () => {
      kmsMock.on(EncryptCommand).resolves({
        CiphertextBlob: undefined,
      });

      await expect(encryptAadharNumber('123456789012')).rejects.toThrow(
        'KMS encryption failed: no ciphertext returned'
      );
    });
  });

  describe('storeKYCDocuments', () => {
    it('should store KYC documents in S3 with encryption', async () => {
      const sellerId = 'test-seller-123';
      const documentUrls = [
        'https://example.com/pan.jpg',
        'https://example.com/aadhar.jpg',
      ];

      const storedUrls = await storeKYCDocuments(sellerId, documentUrls);

      expect(storedUrls).toHaveLength(2);
      expect(storedUrls[0]).toMatch(/^s3:\/\/.*\/kyc-documents\/test-seller-123\/document_0_\d+\.jpg$/);
      expect(storedUrls[1]).toMatch(/^s3:\/\/.*\/kyc-documents\/test-seller-123\/document_1_\d+\.jpg$/);
      expect(s3Mock.calls()).toHaveLength(2); // 2 documents only
    });

    it('should use server-side encryption with KMS', async () => {
      const sellerId = 'test-seller-123';
      const documentUrls = ['https://example.com/pan.jpg'];

      await storeKYCDocuments(sellerId, documentUrls);

      const call = s3Mock.call(0);
      const input = call.args[0].input as any;
      expect(input.ServerSideEncryption).toBe('aws:kms');
      expect(input.SSEKMSKeyId).toBeDefined();
    });

    it('should download documents from source URLs', async () => {
      const sellerId = 'test-seller-123';
      const documentUrls = ['https://example.com/pan.jpg'];

      await storeKYCDocuments(sellerId, documentUrls);

      expect(global.fetch).toHaveBeenCalledWith('https://example.com/pan.jpg');
    });

    it('should handle empty document URLs array', async () => {
      const sellerId = 'test-seller-123';
      const documentUrls: string[] = [];

      const storedUrls = await storeKYCDocuments(sellerId, documentUrls);

      expect(storedUrls).toHaveLength(0);
    });
  });

  describe('registerWithONDC', () => {
    it('should construct valid ONDC subscriber payload', async () => {
      const payload = {
        subscriber_id: 'vyapar-vaani.ondc.in/sellers/test-123',
        subscriber_url: 'https://api.vyapar-vaani.ondc.in/sellers/test-123',
        type: 'BPP' as const,
        domain: 'nic2004:52110',
        city: '*',
        country: 'IND',
        signing_public_key: 'test-public-key',
        encryption_public_key: 'test-public-key',
        valid_from: '2024-01-01T00:00:00.000Z',
        valid_until: '2025-01-01T00:00:00.000Z',
      };

      // Should not throw
      await expect(registerWithONDC(payload)).resolves.not.toThrow();
    });
  });

  describe('handler', () => {
    const mockRequest: SellerRegistrationRequest = {
      extractedData: {
        documentType: 'PAN',
        panNumber: {
          value: 'ABCDE1234F',
          confidence: 0.95,
        },
        aadharNumber: {
          value: '123456789012',
          confidence: 0.95,
        },
        name: {
          value: 'Test Seller',
          confidence: 0.95,
        },
        overallConfidence: 0.95,
        rawFields: {},
      } as ExtractedKYCData,
      phone: '+919876543210',
      language: 'hi',
      documentUrls: ['https://example.com/pan.jpg'],
    };

    it('should successfully register a seller', async () => {
      const response = await handler(mockRequest);

      expect(response.success).toBe(true);
      expect(response.sellerId).toBeDefined();
      expect(response.subscriberId).toBeDefined();
      expect(response.subscriberId).toContain(response.sellerId);
      expect(response.error).toBeUndefined();
    });

    it('should generate unique seller ID', async () => {
      const response1 = await handler(mockRequest);
      const response2 = await handler(mockRequest);

      expect(response1.sellerId).not.toBe(response2.sellerId);
    });

    it('should create seller profile in DynamoDB', async () => {
      await handler(mockRequest);

      expect(dynamoMock.calls()).toHaveLength(1);
      const call = dynamoMock.call(0);
      const item = (call.args[0].input as any).Item;

      expect(item.entityType).toBe('SELLER_PROFILE');
      expect(item.phone).toBe('+919876543210');
      expect(item.name).toBe('Test Seller');
      expect(item.language).toBe('hi');
      expect(item.kyc.status).toBe('VERIFIED');
    });

    it('should encrypt Aadhar number before storing', async () => {
      await handler(mockRequest);

      const call = dynamoMock.call(0);
      const item = (call.args[0].input as any).Item;

      expect(item.kyc.aadharNumber).toBe('ZW5jcnlwdGVkLWFhZGhhcg==');
      expect(item.kyc.aadharNumber).not.toBe('123456789012');
    });

    it('should store KYC documents in S3', async () => {
      await handler(mockRequest);

      // Should have calls for: document upload + private key upload
      expect(s3Mock.calls().length).toBeGreaterThanOrEqual(2);
    });

    it('should include ONDC registration details in profile', async () => {
      await handler(mockRequest);

      const call = dynamoMock.call(0);
      const item = (call.args[0].input as any).Item;

      expect(item.ondc.subscriberId).toBeDefined();
      expect(item.ondc.subscriberUrl).toBeDefined();
      expect(item.ondc.signingPublicKey).toBeDefined();
      expect(item.ondc.encryptionPublicKey).toBeDefined();
    });

    it('should handle missing Aadhar number gracefully', async () => {
      const requestWithoutAadhar = {
        ...mockRequest,
        extractedData: {
          ...mockRequest.extractedData,
          aadharNumber: undefined,
        },
      };

      const response = await handler(requestWithoutAadhar);

      expect(response.success).toBe(true);
    });

    it('should handle errors and return error response', async () => {
      dynamoMock.on(PutCommand).rejects(new Error('DynamoDB error'));

      const response = await handler(mockRequest);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe('Error');
      expect(response.error?.message).toContain('DynamoDB error');
    });

    it('should set KYC status to VERIFIED', async () => {
      await handler(mockRequest);

      const call = dynamoMock.call(0);
      const item = (call.args[0].input as any).Item;

      expect(item.kyc.status).toBe('VERIFIED');
      expect(item.kyc.verifiedAt).toBeDefined();
    });

    it('should store PAN number in plain text', async () => {
      await handler(mockRequest);

      const call = dynamoMock.call(0);
      const item = (call.args[0].input as any).Item;

      expect(item.kyc.panNumber).toBe('ABCDE1234F');
    });

    it('should use correct DynamoDB keys', async () => {
      const response = await handler(mockRequest);

      const call = dynamoMock.call(0);
      const item = (call.args[0].input as any).Item;

      expect(item.PK).toBe(`SELLER#${response.sellerId}`);
      expect(item.SK).toBe('PROFILE');
      expect(item.GSI1PK).toBe('+919876543210');
      expect(item.GSI1SK).toBe('PROFILE');
    });
  });
});
