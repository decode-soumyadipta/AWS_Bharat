/**
 * Integration Test: Complete KYC Flow
 * 
 * Tests the end-to-end KYC verification flow:
 * 1. Image upload from WhatsApp
 * 2. Document extraction (PAN/Aadhaar)
 * 3. Seller registration with ONDC
 * 4. State transition to KYC_VERIFIED
 * 5. Confirmation message sent to user
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */

import { handler as kycHandler } from '../../src/lambdas/kyc-handler';
import { handler as documentExtraction } from '../../src/lambdas/document-extraction';
import { handler as sellerRegistration } from '../../src/lambdas/seller-registration';
import * as mediaDownload from '../../src/services/media-download';
import * as stateManager from '../../src/services/state-manager';
import * as languageManager from '../../src/services/language-manager';
import { lambdaClient, s3Client, textractClient } from '../../src/config/aws-clients';
import { InvokeCommand } from '@aws-sdk/client-lambda';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { AnalyzeDocumentCommand } from '@aws-sdk/client-textract';

// Mock AWS SDK clients
jest.mock('../../src/config/aws-clients', () => ({
  lambdaClient: {
    send: jest.fn(),
  },
  s3Client: {
    send: jest.fn(),
  },
  textractClient: {
    send: jest.fn(),
  },
  kmsClient: {
    send: jest.fn(),
  },
  KYC_BUCKET_NAME: 'test-kyc-bucket',
  KMS_KEY_ID: 'test-kms-key-id',
  PRODUCTS_BUCKET_NAME: 'test-products-bucket',
  EVENT_BUS_NAME: 'test-event-bus',
}));

// Mock media download service
jest.mock('../../src/services/media-download');

// Mock state manager
jest.mock('../../src/services/state-manager');

// Mock language manager
jest.mock('../../src/services/language-manager');

// Mock DynamoDB repository
jest.mock('../../src/services/dynamodb-repository', () => ({
  createSellerProfile: jest.fn().mockResolvedValue(undefined),
}));

// Mock X-Ray tracing utilities
jest.mock('../../src/utils/xray-config', () => ({
  withXRayTracing: (fn: any) => fn,
  Annotations: {
    setUser: jest.fn(),
    setOperation: jest.fn(),
    setState: jest.fn(),
    setSuccess: jest.fn(),
    setErrorCode: jest.fn(),
  },
  Metadata: {
    setResponseDetails: jest.fn(),
    setErrorDetails: jest.fn(),
  },
  traceSubsegment: (name: string, fn: any) => fn(),
}));

// Mock error handler utilities
jest.mock('../../src/utils/error-handler', () => ({
  withErrorHandling: (fn: any) => fn(),
  logStructured: jest.fn(),
  ErrorCodes: {
    MEDIA_DOWNLOAD_FAILED: 'MEDIA_DOWNLOAD_FAILED',
    DOCUMENT_EXTRACTION_FAILED: 'DOCUMENT_EXTRACTION_FAILED',
    INVALID_PAN_FORMAT: 'INVALID_PAN_FORMAT',
    KYC_REGISTRATION_FAILED: 'KYC_REGISTRATION_FAILED',
    UNEXPECTED_ERROR: 'UNEXPECTED_ERROR',
  },
}));

// Mock monitoring utilities
jest.mock('../../src/utils/monitoring', () => ({
  trackOperation: (name: string, fn: any) => fn(),
}));

describe('Complete KYC Flow Integration Test', () => {
  const testPhone = '+919876543210';
  const testMediaId = 'media-123';
  const testSellerId = 'seller-uuid-123';
  
  // Sample PAN card data
  const mockPANCardImage = Buffer.from('fake-pan-card-image');
  const mockExtractedPANData = {
    documentType: 'PAN' as const,
    panNumber: {
      value: 'ABCDE1234F',
      confidence: 0.95,
    },
    aadharNumber: {
      value: '123456789012',
      confidence: 0.92,
    },
    name: {
      value: 'राज कुमार',
      confidence: 0.88,
    },
    dateOfBirth: {
      value: '01/01/1990',
      confidence: 0.85,
    },
    rawFields: {},
    overallConfidence: 0.90,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup environment variables
    process.env.DOCUMENT_EXTRACTION_LAMBDA_NAME = 'test-document-extraction';
    process.env.SELLER_REGISTRATION_LAMBDA_NAME = 'test-seller-registration';
    process.env.WHATSAPP_MESSAGE_SENDER_LAMBDA_NAME = 'test-whatsapp-sender';
    
    // Mock user state - NEW user
    (stateManager.getUserState as jest.Mock).mockResolvedValue({
      phone: testPhone,
      state: 'NEW',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    
    // Mock state updates
    (stateManager.updateUserState as jest.Mock).mockResolvedValue(undefined);
    (stateManager.updateUserSellerId as jest.Mock).mockResolvedValue(undefined);
    
    // Mock language preference
    (languageManager.getLanguagePreference as jest.Mock).mockReturnValue('hi-IN');
    (languageManager.translateMessage as jest.Mock).mockImplementation((key: string) => {
      const messages: Record<string, string> = {
        KYC_SUCCESS: 'आपका पंजीकरण सफल रहा! अब आप उत्पाद जोड़ सकते हैं।',
        DOCUMENT_UNCLEAR: 'दस्तावेज़ स्पष्ट नहीं है। कृपया फिर से फोटो भेजें।',
        KYC_ERROR: 'पंजीकरण में त्रुटि। कृपया पुनः प्रयास करें।',
        KYC_INVALID_DOCUMENT: 'अमान्य दस्तावेज़। कृपया वैध पैन कार्ड भेजें।',
      };
      return messages[key] || key;
    });
  });

  afterEach(() => {
    delete process.env.DOCUMENT_EXTRACTION_LAMBDA_NAME;
    delete process.env.SELLER_REGISTRATION_LAMBDA_NAME;
    delete process.env.WHATSAPP_MESSAGE_SENDER_LAMBDA_NAME;
  });

  describe('Successful KYC Flow', () => {
    it('should complete full KYC flow: image upload → extraction → registration → confirmation', async () => {
      // Step 1: Mock image download from WhatsApp
      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: true,
        buffer: mockPANCardImage,
        mimeType: 'image/jpeg',
        size: mockPANCardImage.length,
        s3Url: `s3://test-kyc-bucket/kyc-documents/${testPhone}/${Date.now()}-${testMediaId}.jpg`,
      });

      // Step 2: Mock S3 upload with KMS encryption
      (s3Client.send as jest.Mock).mockImplementation((command) => {
        if (command instanceof PutObjectCommand) {
          return Promise.resolve({});
        }
        return Promise.reject(new Error('Unexpected S3 command'));
      });

      // Step 3: Mock document extraction Lambda response
      (lambdaClient.send as jest.Mock).mockImplementation((command) => {
        if (command instanceof InvokeCommand) {
          const functionName = command.input.FunctionName;
          
          if (functionName === 'test-document-extraction') {
            // Return successful document extraction
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                data: mockExtractedPANData,
              })),
            });
          }
          
          if (functionName === 'test-seller-registration') {
            // Return successful seller registration
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                sellerId: testSellerId,
                subscriberId: `vyapar-vaani.ondc.in/sellers/${testSellerId}`,
              })),
            });
          }
          
          if (functionName === 'test-whatsapp-sender') {
            // Return successful message send
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                messageId: 'msg-123',
              })),
            });
          }
        }
        
        return Promise.reject(new Error('Unexpected Lambda invocation'));
      });

      // Execute KYC handler
      const result = await kycHandler(
        {
          phone: testPhone,
          mediaId: testMediaId,
          messageId: 'whatsapp-msg-123',
        },
        { requestId: 'test-request-123' }
      );

      // Verify result
      expect(result.success).toBe(true);
      expect(result.sellerId).toBe(testSellerId);
      expect(result.error).toBeUndefined();

      // Verify Step 1: Image download was called
      expect(mediaDownload.downloadImage).toHaveBeenCalledWith(
        testMediaId,
        'test-kyc-bucket'
      );

      // Verify Step 2: Image uploaded to S3 with KMS encryption
      const s3Calls = (s3Client.send as jest.Mock).mock.calls;
      const putObjectCall = s3Calls.find(call => call[0] instanceof PutObjectCommand);
      expect(putObjectCall).toBeDefined();
      
      const putObjectCommand = putObjectCall[0] as PutObjectCommand;
      expect(putObjectCommand.input.Bucket).toBe('test-kyc-bucket');
      expect(putObjectCommand.input.Key).toMatch(/^kyc-documents\//);
      expect(putObjectCommand.input.ServerSideEncryption).toBe('aws:kms');
      expect(putObjectCommand.input.SSEKMSKeyId).toBe('test-kms-key-id');

      // Verify Step 3: Document extraction Lambda was called
      const lambdaCalls = (lambdaClient.send as jest.Mock).mock.calls;
      const extractionCall = lambdaCalls.find(call => {
        const cmd = call[0] as InvokeCommand;
        return cmd.input.FunctionName === 'test-document-extraction';
      });
      expect(extractionCall).toBeDefined();
      
      const extractionCommand = extractionCall[0] as InvokeCommand;
      const extractionPayload = JSON.parse(extractionCommand.input.Payload as string);
      expect(extractionPayload.documentUrl).toMatch(/^s3:\/\/test-kyc-bucket\/kyc-documents\//);
      expect(extractionPayload.sellerId).toBe(testPhone);

      // Verify Step 4: Seller registration Lambda was called
      const registrationCall = lambdaCalls.find(call => {
        const cmd = call[0] as InvokeCommand;
        return cmd.input.FunctionName === 'test-seller-registration';
      });
      expect(registrationCall).toBeDefined();
      
      const registrationCommand = registrationCall[0] as InvokeCommand;
      const registrationPayload = JSON.parse(registrationCommand.input.Payload as string);
      expect(registrationPayload.phone).toBe(testPhone);
      expect(registrationPayload.extractedData).toEqual(mockExtractedPANData);
      expect(registrationPayload.language).toBe('hi');
      expect(registrationPayload.documentUrls).toHaveLength(1);

      // Verify Step 5: User state updated to KYC_VERIFIED
      expect(stateManager.updateUserState).toHaveBeenCalledWith(
        testPhone,
        'KYC_VERIFIED'
      );
      expect(stateManager.updateUserSellerId).toHaveBeenCalledWith(
        testPhone,
        testSellerId
      );

      // Verify Step 6: Confirmation message sent
      const messageSendCall = lambdaCalls.find(call => {
        const cmd = call[0] as InvokeCommand;
        return cmd.input.FunctionName === 'test-whatsapp-sender';
      });
      expect(messageSendCall).toBeDefined();
      
      const messageCommand = messageSendCall[0] as InvokeCommand;
      const messagePayload = JSON.parse(messageCommand.input.Payload as string);
      expect(messagePayload.to).toBe(testPhone);
      expect(messagePayload.type).toBe('text');
      expect(messagePayload.content.text).toContain('पंजीकरण सफल');
    });

    it('should handle KYC flow for user in KYC_PENDING state', async () => {
      // Mock user in KYC_PENDING state
      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: testPhone,
        state: 'KYC_PENDING',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Setup mocks same as successful flow
      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: true,
        buffer: mockPANCardImage,
        mimeType: 'image/jpeg',
        size: mockPANCardImage.length,
        s3Url: `s3://test-kyc-bucket/kyc-documents/${testPhone}/${Date.now()}-${testMediaId}.jpg`,
      });

      (s3Client.send as jest.Mock).mockResolvedValue({});

      (lambdaClient.send as jest.Mock).mockImplementation((command) => {
        if (command instanceof InvokeCommand) {
          const functionName = command.input.FunctionName;
          
          if (functionName === 'test-document-extraction') {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                data: mockExtractedPANData,
              })),
            });
          }
          
          if (functionName === 'test-seller-registration') {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                sellerId: testSellerId,
                subscriberId: `vyapar-vaani.ondc.in/sellers/${testSellerId}`,
              })),
            });
          }
          
          if (functionName === 'test-whatsapp-sender') {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                messageId: 'msg-123',
              })),
            });
          }
        }
        
        return Promise.reject(new Error('Unexpected Lambda invocation'));
      });

      // Execute KYC handler
      const result = await kycHandler(
        {
          phone: testPhone,
          mediaId: testMediaId,
        },
        { requestId: 'test-request-123' }
      );

      // Should succeed for KYC_PENDING state
      expect(result.success).toBe(true);
      expect(result.sellerId).toBe(testSellerId);
      
      // Should update state to KYC_VERIFIED
      expect(stateManager.updateUserState).toHaveBeenCalledWith(
        testPhone,
        'KYC_VERIFIED'
      );
    });
  });

  describe('Error Handling in KYC Flow', () => {
    it('should handle image download failure', async () => {
      // Mock failed image download
      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Failed to download from WhatsApp',
      });

      // Mock WhatsApp message sender
      (lambdaClient.send as jest.Mock).mockImplementation((command) => {
        if (command instanceof InvokeCommand) {
          const functionName = command.input.FunctionName;
          
          if (functionName === 'test-whatsapp-sender') {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                messageId: 'msg-123',
              })),
            });
          }
        }
        
        return Promise.reject(new Error('Unexpected Lambda invocation'));
      });

      // Execute KYC handler
      const result = await kycHandler(
        {
          phone: testPhone,
          mediaId: testMediaId,
        },
        { requestId: 'test-request-123' }
      );

      // Should fail
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.sellerId).toBeUndefined();

      // Should send error message to user
      const lambdaCalls = (lambdaClient.send as jest.Mock).mock.calls;
      const messageSendCall = lambdaCalls.find(call => {
        const cmd = call[0] as InvokeCommand;
        return cmd.input.FunctionName === 'test-whatsapp-sender';
      });
      expect(messageSendCall).toBeDefined();
      
      const messageCommand = messageSendCall[0] as InvokeCommand;
      const messagePayload = JSON.parse(messageCommand.input.Payload as string);
      expect(messagePayload.content.text).toContain('स्पष्ट नहीं');
      
      // Should NOT update state
      expect(stateManager.updateUserState).not.toHaveBeenCalled();
    });

    it('should handle document extraction failure', async () => {
      // Mock successful image download
      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: true,
        buffer: mockPANCardImage,
        mimeType: 'image/jpeg',
        size: mockPANCardImage.length,
        s3Url: `s3://test-kyc-bucket/kyc-documents/${testPhone}/${Date.now()}-${testMediaId}.jpg`,
      });

      (s3Client.send as jest.Mock).mockResolvedValue({});

      // Mock failed document extraction
      (lambdaClient.send as jest.Mock).mockImplementation((command) => {
        if (command instanceof InvokeCommand) {
          const functionName = command.input.FunctionName;
          
          if (functionName === 'test-document-extraction') {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: false,
                error: {
                  code: 'EXTRACTION_ERROR',
                  message: 'Failed to extract text from document',
                },
              })),
            });
          }
          
          if (functionName === 'test-whatsapp-sender') {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                messageId: 'msg-123',
              })),
            });
          }
        }
        
        return Promise.reject(new Error('Unexpected Lambda invocation'));
      });

      // Execute KYC handler
      const result = await kycHandler(
        {
          phone: testPhone,
          mediaId: testMediaId,
        },
        { requestId: 'test-request-123' }
      );

      // Should fail
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('extract');
      
      // Should send error message
      const lambdaCalls = (lambdaClient.send as jest.Mock).mock.calls;
      const messageSendCall = lambdaCalls.find(call => {
        const cmd = call[0] as InvokeCommand;
        return cmd.input.FunctionName === 'test-whatsapp-sender';
      });
      expect(messageSendCall).toBeDefined();
      
      // Should NOT update state
      expect(stateManager.updateUserState).not.toHaveBeenCalled();
    });

    it('should handle invalid PAN format', async () => {
      // Mock successful image download
      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: true,
        buffer: mockPANCardImage,
        mimeType: 'image/jpeg',
        size: mockPANCardImage.length,
        s3Url: `s3://test-kyc-bucket/kyc-documents/${testPhone}/${Date.now()}-${testMediaId}.jpg`,
      });

      (s3Client.send as jest.Mock).mockResolvedValue({});

      // Mock extraction with invalid PAN
      const invalidPANData = {
        ...mockExtractedPANData,
        panNumber: {
          value: 'INVALID123', // Invalid format
          confidence: 0.95,
        },
      };

      (lambdaClient.send as jest.Mock).mockImplementation((command) => {
        if (command instanceof InvokeCommand) {
          const functionName = command.input.FunctionName;
          
          if (functionName === 'test-document-extraction') {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                data: invalidPANData,
              })),
            });
          }
          
          if (functionName === 'test-whatsapp-sender') {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                messageId: 'msg-123',
              })),
            });
          }
        }
        
        return Promise.reject(new Error('Unexpected Lambda invocation'));
      });

      // Execute KYC handler
      const result = await kycHandler(
        {
          phone: testPhone,
          mediaId: testMediaId,
        },
        { requestId: 'test-request-123' }
      );

      // Should fail
      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_PAN');
      
      // Should send error message about invalid document
      const lambdaCalls = (lambdaClient.send as jest.Mock).mock.calls;
      const messageSendCall = lambdaCalls.find(call => {
        const cmd = call[0] as InvokeCommand;
        return cmd.input.FunctionName === 'test-whatsapp-sender';
      });
      expect(messageSendCall).toBeDefined();
      
      const messageCommand = messageSendCall[0] as InvokeCommand;
      const messagePayload = JSON.parse(messageCommand.input.Payload as string);
      expect(messagePayload.content.text).toContain('अमान्य');
      
      // Should NOT call seller registration
      const registrationCall = lambdaCalls.find(call => {
        const cmd = call[0] as InvokeCommand;
        return cmd.input.FunctionName === 'test-seller-registration';
      });
      expect(registrationCall).toBeUndefined();
      
      // Should NOT update state
      expect(stateManager.updateUserState).not.toHaveBeenCalled();
    });

    it('should handle missing Aadhaar number', async () => {
      // Mock successful image download
      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: true,
        buffer: mockPANCardImage,
        mimeType: 'image/jpeg',
        size: mockPANCardImage.length,
        s3Url: `s3://test-kyc-bucket/kyc-documents/${testPhone}/${Date.now()}-${testMediaId}.jpg`,
      });

      (s3Client.send as jest.Mock).mockResolvedValue({});

      // Mock extraction without Aadhaar
      const noAadhaarData = {
        ...mockExtractedPANData,
        aadharNumber: undefined,
      };

      (lambdaClient.send as jest.Mock).mockImplementation((command) => {
        if (command instanceof InvokeCommand) {
          const functionName = command.input.FunctionName;
          
          if (functionName === 'test-document-extraction') {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                data: noAadhaarData,
              })),
            });
          }
          
          if (functionName === 'test-whatsapp-sender') {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                messageId: 'msg-123',
              })),
            });
          }
        }
        
        return Promise.reject(new Error('Unexpected Lambda invocation'));
      });

      // Execute KYC handler
      const result = await kycHandler(
        {
          phone: testPhone,
          mediaId: testMediaId,
        },
        { requestId: 'test-request-123' }
      );

      // Should fail
      expect(result.success).toBe(false);
      expect(result.error).toBe('MISSING_AADHAAR');
      
      // Should NOT update state
      expect(stateManager.updateUserState).not.toHaveBeenCalled();
    });

    it('should handle seller registration failure', async () => {
      // Mock successful image download and extraction
      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: true,
        buffer: mockPANCardImage,
        mimeType: 'image/jpeg',
        size: mockPANCardImage.length,
        s3Url: `s3://test-kyc-bucket/kyc-documents/${testPhone}/${Date.now()}-${testMediaId}.jpg`,
      });

      (s3Client.send as jest.Mock).mockResolvedValue({});

      (lambdaClient.send as jest.Mock).mockImplementation((command) => {
        if (command instanceof InvokeCommand) {
          const functionName = command.input.FunctionName;
          
          if (functionName === 'test-document-extraction') {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                data: mockExtractedPANData,
              })),
            });
          }
          
          if (functionName === 'test-seller-registration') {
            // Return failed registration
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: false,
                error: {
                  code: 'REGISTRATION_ERROR',
                  message: 'Failed to register with ONDC',
                },
              })),
            });
          }

          if (functionName === 'test-whatsapp-sender') {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                messageId: 'msg-123',
              })),
            });
          }
        }
        
        return Promise.reject(new Error('Unexpected Lambda invocation'));
      });

      // Execute KYC handler
      const result = await kycHandler(
        {
          phone: testPhone,
          mediaId: testMediaId,
        },
        { requestId: 'test-request-123' }
      );

      // Should fail
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('register');
      
      // Should send error message
      const lambdaCalls = (lambdaClient.send as jest.Mock).mock.calls;
      const messageSendCall = lambdaCalls.find(call => {
        const cmd = call[0] as InvokeCommand;
        return cmd.input.FunctionName === 'test-whatsapp-sender';
      });
      expect(messageSendCall).toBeDefined();
      
      // Should NOT update state
      expect(stateManager.updateUserState).not.toHaveBeenCalled();
    });

    it('should reject KYC for user in wrong state', async () => {
      // Mock user in KYC_VERIFIED state (wrong state for KYC)
      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: testPhone,
        state: 'KYC_VERIFIED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Execute KYC handler
      const result = await kycHandler(
        {
          phone: testPhone,
          mediaId: testMediaId,
        },
        { requestId: 'test-request-123' }
      );

      // Should fail
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid state');
      
      // Should NOT download image
      expect(mediaDownload.downloadImage).not.toHaveBeenCalled();
      
      // Should NOT update state
      expect(stateManager.updateUserState).not.toHaveBeenCalled();
    });
  });

  describe('Language Support in KYC Flow', () => {
    it('should send confirmation message in Marathi when user language is mr-IN', async () => {
      // Mock Marathi language preference
      (languageManager.getLanguagePreference as jest.Mock).mockReturnValue('mr-IN');
      (languageManager.translateMessage as jest.Mock).mockImplementation((key: string) => {
        const messages: Record<string, string> = {
          KYC_SUCCESS: 'तुमची नोंदणी यशस्वी झाली! आता तुम्ही उत्पादने जोडू शकता.',
        };
        return messages[key] || key;
      });

      // Setup successful flow mocks
      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: true,
        buffer: mockPANCardImage,
        mimeType: 'image/jpeg',
        size: mockPANCardImage.length,
        s3Url: `s3://test-kyc-bucket/kyc-documents/${testPhone}/${Date.now()}-${testMediaId}.jpg`,
      });

      (s3Client.send as jest.Mock).mockResolvedValue({});

      (lambdaClient.send as jest.Mock).mockImplementation((command) => {
        if (command instanceof InvokeCommand) {
          const functionName = command.input.FunctionName;
          
          if (functionName === 'test-document-extraction') {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                data: mockExtractedPANData,
              })),
            });
          }
          
          if (functionName === 'test-seller-registration') {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                sellerId: testSellerId,
                subscriberId: `vyapar-vaani.ondc.in/sellers/${testSellerId}`,
              })),
            });
          }
          
          if (functionName === 'test-whatsapp-sender') {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                messageId: 'msg-123',
              })),
            });
          }
        }
        
        return Promise.reject(new Error('Unexpected Lambda invocation'));
      });

      // Execute KYC handler
      const result = await kycHandler(
        {
          phone: testPhone,
          mediaId: testMediaId,
        },
        { requestId: 'test-request-123' }
      );

      // Should succeed
      expect(result.success).toBe(true);
      
      // Verify Marathi message was sent
      const lambdaCalls = (lambdaClient.send as jest.Mock).mock.calls;
      const messageSendCall = lambdaCalls.find(call => {
        const cmd = call[0] as InvokeCommand;
        return cmd.input.FunctionName === 'test-whatsapp-sender';
      });
      expect(messageSendCall).toBeDefined();
      
      const messageCommand = messageSendCall[0] as InvokeCommand;
      const messagePayload = JSON.parse(messageCommand.input.Payload as string);
      expect(messagePayload.content.text).toContain('नोंदणी यशस्वी');
      expect(messagePayload.language).toBe('mr');
    });

    it('should send confirmation message in English when user language is en-IN', async () => {
      // Mock English language preference
      (languageManager.getLanguagePreference as jest.Mock).mockReturnValue('en-IN');
      (languageManager.translateMessage as jest.Mock).mockImplementation((key: string) => {
        const messages: Record<string, string> = {
          KYC_SUCCESS: 'Your registration is successful! You can now add products.',
        };
        return messages[key] || key;
      });

      // Setup successful flow mocks
      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: true,
        buffer: mockPANCardImage,
        mimeType: 'image/jpeg',
        size: mockPANCardImage.length,
        s3Url: `s3://test-kyc-bucket/kyc-documents/${testPhone}/${Date.now()}-${testMediaId}.jpg`,
      });

      (s3Client.send as jest.Mock).mockResolvedValue({});

      (lambdaClient.send as jest.Mock).mockImplementation((command) => {
        if (command instanceof InvokeCommand) {
          const functionName = command.input.FunctionName;
          
          if (functionName === 'test-document-extraction') {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                data: mockExtractedPANData,
              })),
            });
          }

          if (functionName === 'test-seller-registration') {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                sellerId: testSellerId,
                subscriberId: `vyapar-vaani.ondc.in/sellers/${testSellerId}`,
              })),
            });
          }
          
          if (functionName === 'test-whatsapp-sender') {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                messageId: 'msg-123',
              })),
            });
          }
        }
        
        return Promise.reject(new Error('Unexpected Lambda invocation'));
      });

      // Execute KYC handler
      const result = await kycHandler(
        {
          phone: testPhone,
          mediaId: testMediaId,
        },
        { requestId: 'test-request-123' }
      );

      // Should succeed
      expect(result.success).toBe(true);
      
      // Verify English message was sent
      const lambdaCalls = (lambdaClient.send as jest.Mock).mock.calls;
      const messageSendCall = lambdaCalls.find(call => {
        const cmd = call[0] as InvokeCommand;
        return cmd.input.FunctionName === 'test-whatsapp-sender';
      });
      expect(messageSendCall).toBeDefined();
      
      const messageCommand = messageSendCall[0] as InvokeCommand;
      const messagePayload = JSON.parse(messageCommand.input.Payload as string);
      expect(messagePayload.content.text).toContain('registration is successful');
      expect(messagePayload.language).toBe('en');
    });
  });
});
