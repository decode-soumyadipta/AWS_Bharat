/**
 * Unit Tests for KYC Handler Lambda
 * 
 * Tests the KYC verification flow including:
 * - Image download and upload with KMS encryption
 * - Document extraction integration
 * - PAN/Aadhaar validation
 * - Seller registration integration
 * - State management updates
 * - WhatsApp message sending
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8
 */

import { handler, KYCHandlerRequest } from '../../src/lambdas/kyc-handler';
import * as mediaDownload from '../../src/services/media-download';
import * as stateManager from '../../src/services/state-manager';
import { lambdaClient, s3Client } from '../../src/config/aws-clients';

// Mock AWS SDK clients
jest.mock('../../src/config/aws-clients', () => ({
  lambdaClient: {
    send: jest.fn(),
  },
  s3Client: {
    send: jest.fn(),
  },
  KYC_BUCKET_NAME: 'test-kyc-bucket',
  KMS_KEY_ID: 'test-kms-key-id',
}));

// Mock services
jest.mock('../../src/services/media-download');
jest.mock('../../src/services/state-manager');

describe('KYC Handler Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Successful KYC Flow', () => {
    it('should process valid PAN card and complete KYC verification', async () => {
      // Arrange
      const request: KYCHandlerRequest = {
        phone: '+919876543210',
        mediaId: 'test-media-id',
        messageId: 'test-message-id',
      };

      // Mock user state
      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: request.phone,
        state: 'NEW',
        language: 'hi-IN',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Mock image download
      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: true,
        buffer: Buffer.from('fake-image-data'),
        mimeType: 'image/jpeg',
        size: 1024,
        s3Url: 's3://test-kyc-bucket/images/test.jpg',
      });

      // Mock S3 upload
      (s3Client.send as jest.Mock).mockResolvedValue({} as any);

      // Mock document extraction Lambda
      (lambdaClient.send as jest.Mock).mockImplementation(async (command: any) => {
        const payload = JSON.parse(command.input.Payload);
        
        // Document extraction Lambda
        if (command.input.FunctionName?.includes('document-extraction')) {
          return {
            Payload: Buffer.from(JSON.stringify({
              success: true,
              data: {
                documentType: 'PAN',
                panNumber: {
                  value: 'ABCDE1234F',
                  confidence: 0.95,
                },
                aadharNumber: {
                  value: '123456789012',
                  confidence: 0.90,
                },
                name: {
                  value: 'Test User',
                  confidence: 0.92,
                },
                overallConfidence: 0.92,
                rawFields: {},
              },
            })),
          } as any;
        }
        
        // Seller registration Lambda
        if (command.input.FunctionName?.includes('seller-registration')) {
          return {
            Payload: Buffer.from(JSON.stringify({
              success: true,
              sellerId: 'test-seller-id',
              subscriberId: 'test-subscriber-id',
            })),
          } as any;
        }
        
        // WhatsApp message sender Lambda
        if (command.input.FunctionName?.includes('whatsapp-message-sender')) {
          return {
            Payload: Buffer.from(JSON.stringify({
              success: true,
              messageId: 'test-whatsapp-message-id',
            })),
          } as any;
        }
        
        return {} as any;
      });

      // Mock state updates
      (stateManager.updateUserState as jest.Mock).mockResolvedValue(undefined);
      (stateManager.updateUserSellerId as jest.Mock).mockResolvedValue(undefined);

      // Act
      const result = await handler(request, {} as any);

      // Assert
      expect(result.success).toBe(true);
      expect(result.sellerId).toBe('test-seller-id');
      
      // Verify image download was called
      expect(mediaDownload.downloadImage).toHaveBeenCalledWith(
        request.mediaId,
        'test-kyc-bucket'
      );
      
      // Verify state was updated to KYC_VERIFIED
      expect(stateManager.updateUserState).toHaveBeenCalledWith(
        request.phone,
        'KYC_VERIFIED'
      );
      
      // Verify seller ID was stored
      expect(stateManager.updateUserSellerId).toHaveBeenCalledWith(
        request.phone,
        'test-seller-id'
      );
    });

    it('should handle KYC_PENDING state', async () => {
      // Arrange
      const request: KYCHandlerRequest = {
        phone: '+919876543210',
        mediaId: 'test-media-id',
      };

      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: request.phone,
        state: 'KYC_PENDING',
        language: 'en-IN',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: true,
        buffer: Buffer.from('fake-image-data'),
        mimeType: 'image/jpeg',
        size: 1024,
        s3Url: 's3://test-kyc-bucket/images/test.jpg',
      });

      (s3Client.send as jest.Mock).mockResolvedValue({} as any);

      (lambdaClient.send as jest.Mock).mockImplementation(async (command: any) => {
        if (command.input.FunctionName?.includes('document-extraction')) {
          return {
            Payload: Buffer.from(JSON.stringify({
              success: true,
              data: {
                documentType: 'PAN',
                panNumber: { value: 'ABCDE1234F', confidence: 0.95 },
                aadharNumber: { value: '123456789012', confidence: 0.90 },
                overallConfidence: 0.92,
                rawFields: {},
              },
            })),
          } as any;
        }
        
        if (command.input.FunctionName?.includes('seller-registration')) {
          return {
            Payload: Buffer.from(JSON.stringify({
              success: true,
              sellerId: 'test-seller-id',
            })),
          } as any;
        }
        
        return {} as any;
      });

      (stateManager.updateUserState as jest.Mock).mockResolvedValue(undefined);
      (stateManager.updateUserSellerId as jest.Mock).mockResolvedValue(undefined);

      // Act
      const result = await handler(request, {} as any);

      // Assert
      expect(result.success).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle image download failure', async () => {
      // Arrange
      const request: KYCHandlerRequest = {
        phone: '+919876543210',
        mediaId: 'test-media-id',
      };

      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: request.phone,
        state: 'NEW',
        language: 'hi-IN',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Failed to download image from WhatsApp',
      });

      // Mock WhatsApp message sender for error message
      (lambdaClient.send as jest.Mock).mockResolvedValue({
        Payload: Buffer.from(JSON.stringify({ success: true })),
      } as any);

      // Act
      const result = await handler(request, {} as any);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('download');
      
      // Verify error message was sent
      expect(lambdaClient.send).toHaveBeenCalled();
    });

    it('should handle document extraction failure', async () => {
      // Arrange
      const request: KYCHandlerRequest = {
        phone: '+919876543210',
        mediaId: 'test-media-id',
      };

      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: request.phone,
        state: 'NEW',
        language: 'mr-IN',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: true,
        buffer: Buffer.from('fake-image-data'),
        mimeType: 'image/jpeg',
        size: 1024,
        s3Url: 's3://test-kyc-bucket/images/test.jpg',
      });

      (s3Client.send as jest.Mock).mockResolvedValue({} as any);

      // Mock document extraction failure
      (lambdaClient.send as jest.Mock).mockImplementation(async (command: any) => {
        if (command.input.FunctionName?.includes('document-extraction')) {
          return {
            Payload: Buffer.from(JSON.stringify({
              success: false,
              error: {
                code: 'EXTRACTION_ERROR',
                message: 'Failed to extract text from document',
              },
            })),
          } as any;
        }
        
        // WhatsApp message sender
        return {
          Payload: Buffer.from(JSON.stringify({ success: true })),
        } as any;
      });

      // Act
      const result = await handler(request, {} as any);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('extract');
    });

    it('should handle invalid PAN format', async () => {
      // Arrange
      const request: KYCHandlerRequest = {
        phone: '+919876543210',
        mediaId: 'test-media-id',
      };

      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: request.phone,
        state: 'NEW',
        language: 'en-IN',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: true,
        buffer: Buffer.from('fake-image-data'),
        mimeType: 'image/jpeg',
        size: 1024,
        s3Url: 's3://test-kyc-bucket/images/test.jpg',
      });

      (s3Client.send as jest.Mock).mockResolvedValue({} as any);

      // Mock document extraction with invalid PAN
      (lambdaClient.send as jest.Mock).mockImplementation(async (command: any) => {
        if (command.input.FunctionName?.includes('document-extraction')) {
          return {
            Payload: Buffer.from(JSON.stringify({
              success: true,
              data: {
                documentType: 'PAN',
                panNumber: {
                  value: 'INVALID123', // Invalid format
                  confidence: 0.95,
                },
                aadharNumber: {
                  value: '123456789012',
                  confidence: 0.90,
                },
                overallConfidence: 0.92,
                rawFields: {},
              },
            })),
          } as any;
        }
        
        // WhatsApp message sender
        return {
          Payload: Buffer.from(JSON.stringify({ success: true })),
        } as any;
      });

      // Act
      const result = await handler(request, {} as any);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_PAN');
    });

    it('should handle missing Aadhaar number', async () => {
      // Arrange
      const request: KYCHandlerRequest = {
        phone: '+919876543210',
        mediaId: 'test-media-id',
      };

      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: request.phone,
        state: 'NEW',
        language: 'hi-IN',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: true,
        buffer: Buffer.from('fake-image-data'),
        mimeType: 'image/jpeg',
        size: 1024,
        s3Url: 's3://test-kyc-bucket/images/test.jpg',
      });

      (s3Client.send as jest.Mock).mockResolvedValue({} as any);

      // Mock document extraction without Aadhaar
      (lambdaClient.send as jest.Mock).mockImplementation(async (command: any) => {
        if (command.input.FunctionName?.includes('document-extraction')) {
          return {
            Payload: Buffer.from(JSON.stringify({
              success: true,
              data: {
                documentType: 'PAN',
                panNumber: {
                  value: 'ABCDE1234F',
                  confidence: 0.95,
                },
                // Missing aadharNumber
                overallConfidence: 0.95,
                rawFields: {},
              },
            })),
          } as any;
        }
        
        // WhatsApp message sender
        return {
          Payload: Buffer.from(JSON.stringify({ success: true })),
        } as any;
      });

      // Act
      const result = await handler(request, {} as any);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('MISSING_AADHAAR');
    });

    it('should handle low confidence extraction', async () => {
      // Arrange
      const request: KYCHandlerRequest = {
        phone: '+919876543210',
        mediaId: 'test-media-id',
      };

      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: request.phone,
        state: 'NEW',
        language: 'hi-IN',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: true,
        buffer: Buffer.from('fake-image-data'),
        mimeType: 'image/jpeg',
        size: 1024,
        s3Url: 's3://test-kyc-bucket/images/test.jpg',
      });

      (s3Client.send as jest.Mock).mockResolvedValue({} as any);

      // Mock document extraction with low confidence
      (lambdaClient.send as jest.Mock).mockImplementation(async (command: any) => {
        if (command.input.FunctionName?.includes('document-extraction')) {
          return {
            Payload: Buffer.from(JSON.stringify({
              success: true,
              data: {
                documentType: 'PAN',
                panNumber: {
                  value: 'ABCDE1234F',
                  confidence: 0.3,
                },
                aadharNumber: {
                  value: '123456789012',
                  confidence: 0.3,
                },
                overallConfidence: 0.3, // Below threshold
                rawFields: {},
              },
            })),
          } as any;
        }
        
        // WhatsApp message sender
        return {
          Payload: Buffer.from(JSON.stringify({ success: true })),
        } as any;
      });

      // Act
      const result = await handler(request, {} as any);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('LOW_CONFIDENCE');
    });

    it('should handle seller registration failure', async () => {
      // Arrange
      const request: KYCHandlerRequest = {
        phone: '+919876543210',
        mediaId: 'test-media-id',
      };

      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: request.phone,
        state: 'NEW',
        language: 'hi-IN',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: true,
        buffer: Buffer.from('fake-image-data'),
        mimeType: 'image/jpeg',
        size: 1024,
        s3Url: 's3://test-kyc-bucket/images/test.jpg',
      });

      (s3Client.send as jest.Mock).mockResolvedValue({} as any);

      // Mock successful extraction but failed registration
      (lambdaClient.send as jest.Mock).mockImplementation(async (command: any) => {
        if (command.input.FunctionName?.includes('document-extraction')) {
          return {
            Payload: Buffer.from(JSON.stringify({
              success: true,
              data: {
                documentType: 'PAN',
                panNumber: { value: 'ABCDE1234F', confidence: 0.95 },
                aadharNumber: { value: '123456789012', confidence: 0.90 },
                overallConfidence: 0.92,
                rawFields: {},
              },
            })),
          } as any;
        }
        
        if (command.input.FunctionName?.includes('seller-registration')) {
          return {
            Payload: Buffer.from(JSON.stringify({
              success: false,
              error: {
                code: 'REGISTRATION_ERROR',
                message: 'Failed to register seller',
              },
            })),
          } as any;
        }
        
        // WhatsApp message sender
        return {
          Payload: Buffer.from(JSON.stringify({ success: true })),
        } as any;
      });

      // Act
      const result = await handler(request, {} as any);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('register');
    });

    it('should handle invalid user state', async () => {
      // Arrange
      const request: KYCHandlerRequest = {
        phone: '+919876543210',
        mediaId: 'test-media-id',
      };

      // User already KYC verified
      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: request.phone,
        state: 'KYC_VERIFIED',
        language: 'hi-IN',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Mock WhatsApp message sender for error message
      (lambdaClient.send as jest.Mock).mockResolvedValue({
        Payload: Buffer.from(JSON.stringify({ success: true })),
      } as any);

      // Act
      const result = await handler(request, {} as any);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid state');
    });

    it('should handle unknown document type', async () => {
      // Arrange
      const request: KYCHandlerRequest = {
        phone: '+919876543210',
        mediaId: 'test-media-id',
      };

      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: request.phone,
        state: 'NEW',
        language: 'hi-IN',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: true,
        buffer: Buffer.from('fake-image-data'),
        mimeType: 'image/jpeg',
        size: 1024,
        s3Url: 's3://test-kyc-bucket/images/test.jpg',
      });

      (s3Client.send as jest.Mock).mockResolvedValue({} as any);

      // Mock document extraction with unknown type
      (lambdaClient.send as jest.Mock).mockImplementation(async (command: any) => {
        if (command.input.FunctionName?.includes('document-extraction')) {
          return {
            Payload: Buffer.from(JSON.stringify({
              success: true,
              data: {
                documentType: 'UNKNOWN',
                overallConfidence: 0.5,
                rawFields: {},
              },
            })),
          } as any;
        }
        
        // WhatsApp message sender
        return {
          Payload: Buffer.from(JSON.stringify({ success: true })),
        } as any;
      });

      // Act
      const result = await handler(request, {} as any);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('UNKNOWN_DOCUMENT_TYPE');
    });
  });

  describe('Language Support', () => {
    it('should send messages in Hindi for hi-IN users', async () => {
      // Arrange
      const request: KYCHandlerRequest = {
        phone: '+919876543210',
        mediaId: 'test-media-id',
      };

      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: request.phone,
        state: 'NEW',
        language: 'hi-IN',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: true,
        buffer: Buffer.from('fake-image-data'),
        mimeType: 'image/jpeg',
        size: 1024,
        s3Url: 's3://test-kyc-bucket/images/test.jpg',
      });

      (s3Client.send as jest.Mock).mockResolvedValue({} as any);

      (lambdaClient.send as jest.Mock).mockImplementation(async (command: any) => {
        if (command.input.FunctionName?.includes('document-extraction')) {
          return {
            Payload: Buffer.from(JSON.stringify({
              success: true,
              data: {
                documentType: 'PAN',
                panNumber: { value: 'ABCDE1234F', confidence: 0.95 },
                aadharNumber: { value: '123456789012', confidence: 0.90 },
                overallConfidence: 0.92,
                rawFields: {},
              },
            })),
          } as any;
        }
        
        if (command.input.FunctionName?.includes('seller-registration')) {
          return {
            Payload: Buffer.from(JSON.stringify({
              success: true,
              sellerId: 'test-seller-id',
            })),
          } as any;
        }
        
        // Capture WhatsApp message
        if (command.input.FunctionName?.includes('whatsapp-message-sender')) {
          const payload = JSON.parse(command.input.Payload);
          expect(payload.language).toBe('hi');
          return {
            Payload: Buffer.from(JSON.stringify({ success: true })),
          } as any;
        }
        
        return {} as any;
      });

      (stateManager.updateUserState as jest.Mock).mockResolvedValue(undefined);
      (stateManager.updateUserSellerId as jest.Mock).mockResolvedValue(undefined);

      // Act
      await handler(request, {} as any);

      // Assert - verified in mock implementation above
    });
  });
});
