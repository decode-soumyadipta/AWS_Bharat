/**
 * Unit Tests for Voice Handler Lambda
 * 
 * Tests the voice message processing pipeline including:
 * - Audio download from WhatsApp
 * - Voice transcription
 * - Language detection and storage
 * - Intent classification
 * - Entity extraction
 * - Partial data merging
 * - State transitions
 */

import { handler } from '../../src/lambdas/voice-handler';
import * as mediaDownload from '../../src/services/media-download';
import * as stateManager from '../../src/services/state-manager';
import * as partialDataStore from '../../src/services/partial-data-store';
import * as languageManager from '../../src/services/language-manager';
import * as conversationMemory from '../../src/services/conversation-memory';
import { lambdaClient, eventBridgeClient } from '../../src/config/aws-clients';

// Mock AWS clients
jest.mock('../../src/config/aws-clients', () => ({
  lambdaClient: {
    send: jest.fn(),
  },
  eventBridgeClient: {
    send: jest.fn(),
  },
  s3Client: {},
  docClient: {},
  transcribeClient: {},
  bedrockClient: {},
}));

// Mock services
jest.mock('../../src/services/media-download');
jest.mock('../../src/services/state-manager');
jest.mock('../../src/services/partial-data-store');
jest.mock('../../src/services/language-manager');
jest.mock('../../src/services/conversation-memory');

describe('Voice Handler Lambda', () => {
  const mockPhone = '+919876543210';
  const mockMessageId = 'msg-123';
  const mockMediaId = 'media-456';
  const mockS3Url = 's3://bucket/audio/123.ogg';
  const mockTranscription = 'मैं आम अचार बेचना चाहता हूं पांच सौ रुपये किलो';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PRODUCTS_BUCKET_NAME = 'test-bucket';
    process.env.EVENT_BUS_NAME = 'test-event-bus';
    process.env.VOICE_TRANSCRIPTION_FUNCTION_NAME = 'voice-transcription';
    process.env.INTENT_CLASSIFICATION_FUNCTION_NAME = 'intent-classification';
    process.env.ENTITY_EXTRACTION_FUNCTION_NAME = 'entity-extraction';
    
    // Mock conversation memory service
    (conversationMemory.addConversationMessage as jest.Mock).mockResolvedValue(undefined);
    (conversationMemory.getConversationContext as jest.Mock).mockResolvedValue(null);
    (conversationMemory.generateContextualResponse as jest.Mock).mockReturnValue('');
    (conversationMemory.updateUserPreferences as jest.Mock).mockResolvedValue(undefined);
  });

  describe('Complete voice processing pipeline', () => {
    it('should process voice message and merge entities with partial data', async () => {
      // Mock audio download
      (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
        success: true,
        s3Url: mockS3Url,
        mimeType: 'audio/ogg',
        size: 50000,
      });

      // Mock Lambda invocations
      (lambdaClient.send as jest.Mock)
        // Voice transcription
        .mockResolvedValueOnce({
          Payload: new TextEncoder().encode(JSON.stringify({
            success: true,
            transcription: mockTranscription,
            detectedLanguage: 'hi-IN',
            confidence: 0.95,
          })),
        })
        // Intent classification
        .mockResolvedValueOnce({
          Payload: new TextEncoder().encode(JSON.stringify({
            success: true,
            intent: 'CREATE_CATALOG',
            confidence: 0.92,
          })),
        })
        // Entity extraction
        .mockResolvedValueOnce({
          Payload: new TextEncoder().encode(JSON.stringify({
            success: true,
            entities: {
              product_name: 'आम अचार',
              price: 500,
              quantity: null,
              unit: 'kg',
              category: 'food',
            },
            missingFields: ['quantity'],
          })),
        });

      // Mock partial data merge
      (partialDataStore.mergePartialData as jest.Mock).mockResolvedValue({
        phone: mockPhone,
        productName: 'आम अचार',
        price: 500,
        unit: 'kg',
        category: 'food',
        missingFields: ['quantity'],
        source: 'voice',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      (partialDataStore.isPartialDataComplete as jest.Mock).mockReturnValue(false);

      // Mock EventBridge
      (eventBridgeClient.send as jest.Mock).mockResolvedValue({
        Entries: [{ EventId: 'event-123' }],
      });

      const event = {
        phone: mockPhone,
        messageId: mockMessageId,
        mediaId: mockMediaId,
      };

      const result = await handler(event);

      expect(result.success).toBe(true);
      expect(result.transcription).toBe(mockTranscription);
      expect(result.detectedLanguage).toBe('hi-IN');
      expect(result.entities).toBeDefined();
      expect(result.missingFields).toEqual(['quantity']);
      expect(result.nextAction).toBe('REQUEST_INFO');

      // Verify audio download
      expect(mediaDownload.downloadAudio).toHaveBeenCalledWith(
        mockMediaId,
        'test-bucket'
      );

      // Verify language storage
      expect(languageManager.storeLanguagePreference).toHaveBeenCalledWith(
        mockPhone,
        'hi-IN'
      );

      // Verify partial data merge
      expect(partialDataStore.mergePartialData).toHaveBeenCalledWith(
        mockPhone,
        expect.objectContaining({
          productName: 'आम अचार',
          price: 500,
          unit: 'kg',
          source: 'voice',
        })
      );

      // Verify state update
      expect(stateManager.updateUserState).toHaveBeenCalledWith(
        mockPhone,
        'VOICE_RECEIVED',
        { missingFields: ['quantity'] }
      );

      // Verify missing info event published
      expect(eventBridgeClient.send).toHaveBeenCalled();
    });

    it('should request image when all required fields are present', async () => {
      // Mock audio download
      (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
        success: true,
        s3Url: mockS3Url,
      });

      // Mock Lambda invocations with complete entities
      (lambdaClient.send as jest.Mock)
        .mockResolvedValueOnce({
          Payload: new TextEncoder().encode(JSON.stringify({
            success: true,
            transcription: mockTranscription,
            detectedLanguage: 'hi-IN',
          })),
        })
        .mockResolvedValueOnce({
          Payload: new TextEncoder().encode(JSON.stringify({
            success: true,
            intent: 'CREATE_CATALOG',
          })),
        })
        .mockResolvedValueOnce({
          Payload: new TextEncoder().encode(JSON.stringify({
            success: true,
            entities: {
              product_name: 'आम अचार',
              price: 500,
              quantity: 5,
              unit: 'kg',
              category: 'food',
            },
            missingFields: [],
          })),
        });

      // Mock complete partial data
      (partialDataStore.mergePartialData as jest.Mock).mockResolvedValue({
        phone: mockPhone,
        productName: 'आम अचार',
        price: 500,
        quantity: 5,
        unit: 'kg',
        category: 'food',
        missingFields: [],
        source: 'voice',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      (partialDataStore.isPartialDataComplete as jest.Mock).mockReturnValue(true);

      (eventBridgeClient.send as jest.Mock).mockResolvedValue({
        Entries: [{ EventId: 'event-123' }],
      });

      const event = {
        phone: mockPhone,
        messageId: mockMessageId,
        mediaId: mockMediaId,
      };

      const result = await handler(event);

      expect(result.success).toBe(true);
      expect(result.missingFields).toEqual([]);
      expect(result.nextAction).toBe('REQUEST_IMAGE');

      // Verify state updated to IMAGE_PENDING
      expect(stateManager.updateUserState).toHaveBeenCalledWith(
        mockPhone,
        'IMAGE_PENDING'
      );

      // Verify image request event published
      expect(eventBridgeClient.send).toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should handle audio download failure', async () => {
      (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Failed to download audio from WhatsApp',
      });

      const event = {
        phone: mockPhone,
        messageId: mockMessageId,
        mediaId: mockMediaId,
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to download audio');
    });

    it('should handle transcription failure', async () => {
      (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
        success: true,
        s3Url: mockS3Url,
      });

      (lambdaClient.send as jest.Mock).mockResolvedValueOnce({
        Payload: new TextEncoder().encode(JSON.stringify({
          success: false,
          error: { message: 'Transcription service unavailable' },
        })),
      });

      const event = {
        phone: mockPhone,
        messageId: mockMessageId,
        mediaId: mockMediaId,
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Transcription');
    });

    it('should handle intent classification failure', async () => {
      (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
        success: true,
        s3Url: mockS3Url,
      });

      (lambdaClient.send as jest.Mock)
        .mockResolvedValueOnce({
          Payload: new TextEncoder().encode(JSON.stringify({
            success: true,
            transcription: mockTranscription,
            detectedLanguage: 'hi-IN',
          })),
        })
        .mockResolvedValueOnce({
          Payload: new TextEncoder().encode(JSON.stringify({
            success: false,
            error: { message: 'Intent classification failed' },
          })),
        });

      const event = {
        phone: mockPhone,
        messageId: mockMessageId,
        mediaId: mockMediaId,
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Intent classification');
    });

    it('should handle entity extraction failure', async () => {
      (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
        success: true,
        s3Url: mockS3Url,
      });

      (lambdaClient.send as jest.Mock)
        .mockResolvedValueOnce({
          Payload: new TextEncoder().encode(JSON.stringify({
            success: true,
            transcription: mockTranscription,
            detectedLanguage: 'hi-IN',
          })),
        })
        .mockResolvedValueOnce({
          Payload: new TextEncoder().encode(JSON.stringify({
            success: true,
            intent: 'CREATE_CATALOG',
          })),
        })
        .mockResolvedValueOnce({
          Payload: new TextEncoder().encode(JSON.stringify({
            success: false,
            error: { message: 'Entity extraction failed' },
          })),
        });

      const event = {
        phone: mockPhone,
        messageId: mockMessageId,
        mediaId: mockMediaId,
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Entity extraction');
    });

    it('should handle missing PRODUCTS_BUCKET_NAME', async () => {
      delete process.env.PRODUCTS_BUCKET_NAME;

      const event = {
        phone: mockPhone,
        messageId: mockMessageId,
        mediaId: mockMediaId,
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('PRODUCTS_BUCKET_NAME');
    });
  });

  describe('Event parsing', () => {
    it('should parse EventBridge event format', async () => {
      (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
        success: true,
        s3Url: mockS3Url,
      });

      (lambdaClient.send as jest.Mock)
        .mockResolvedValueOnce({
          Payload: new TextEncoder().encode(JSON.stringify({
            success: true,
            transcription: mockTranscription,
            detectedLanguage: 'hi-IN',
          })),
        })
        .mockResolvedValueOnce({
          Payload: new TextEncoder().encode(JSON.stringify({
            success: true,
            intent: 'CREATE_CATALOG',
          })),
        })
        .mockResolvedValueOnce({
          Payload: new TextEncoder().encode(JSON.stringify({
            success: true,
            entities: {},
            missingFields: [],
          })),
        });

      (partialDataStore.mergePartialData as jest.Mock).mockResolvedValue({
        phone: mockPhone,
        missingFields: [],
        source: 'voice',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      (partialDataStore.isPartialDataComplete as jest.Mock).mockReturnValue(true);

      (eventBridgeClient.send as jest.Mock).mockResolvedValue({
        Entries: [{ EventId: 'event-123' }],
      });

      const event = {
        detail: {
          phone: mockPhone,
          messageId: mockMessageId,
          mediaId: mockMediaId,
          state: {
            state: 'KYC_VERIFIED',
            language: 'hi-IN',
          },
        },
      };

      const result = await handler(event);

      expect(result.success).toBe(true);
      expect(mediaDownload.downloadAudio).toHaveBeenCalledWith(
        mockMediaId,
        'test-bucket'
      );
    });
  });

  describe('Language detection', () => {
    it('should store detected language in user profile', async () => {
      (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
        success: true,
        s3Url: mockS3Url,
      });

      (lambdaClient.send as jest.Mock)
        .mockResolvedValueOnce({
          Payload: new TextEncoder().encode(JSON.stringify({
            success: true,
            transcription: 'मराठी मध्ये संदेश',
            detectedLanguage: 'mr-IN',
          })),
        })
        .mockResolvedValueOnce({
          Payload: new TextEncoder().encode(JSON.stringify({
            success: true,
            intent: 'CREATE_CATALOG',
          })),
        })
        .mockResolvedValueOnce({
          Payload: new TextEncoder().encode(JSON.stringify({
            success: true,
            entities: {},
            missingFields: [],
          })),
        });

      (partialDataStore.mergePartialData as jest.Mock).mockResolvedValue({
        phone: mockPhone,
        missingFields: [],
        source: 'voice',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      (partialDataStore.isPartialDataComplete as jest.Mock).mockReturnValue(true);

      (eventBridgeClient.send as jest.Mock).mockResolvedValue({
        Entries: [{ EventId: 'event-123' }],
      });

      const event = {
        phone: mockPhone,
        messageId: mockMessageId,
        mediaId: mockMediaId,
      };

      const result = await handler(event);

      expect(result.success).toBe(true);
      expect(result.detectedLanguage).toBe('mr-IN');
      expect(languageManager.storeLanguagePreference).toHaveBeenCalledWith(
        mockPhone,
        'mr-IN'
      );
    });
  });

  describe('Voice error handling (Requirements 2.7, 2.8)', () => {
    it('should handle transcription failure after retries (Requirement 2.7)', async () => {
      (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
        success: true,
        s3Url: mockS3Url,
      });

      // Simulate transcription failure
      (lambdaClient.send as jest.Mock).mockResolvedValueOnce({
        Payload: new TextEncoder().encode(JSON.stringify({
          success: false,
          error: { 
            code: 'TRANSCRIPTION_ERROR',
            message: 'Transcription failed after 3 retries' 
          },
        })),
      });

      const event = {
        phone: mockPhone,
        messageId: mockMessageId,
        mediaId: mockMediaId,
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Transcription');
      
      // Verify audio was downloaded
      expect(mediaDownload.downloadAudio).toHaveBeenCalled();
    });

    it('should handle unsupported audio format (Requirement 2.8)', async () => {
      // Simulate unsupported format error from media download
      (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Unsupported MIME type: audio/wav. Supported types: audio/ogg, audio/mpeg, audio/mp4, audio/amr, audio/aac',
      });

      const event = {
        phone: mockPhone,
        messageId: mockMessageId,
        mediaId: mockMediaId,
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported MIME type');
    });

    it('should handle audio file too large error', async () => {
      (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
        success: false,
        error: 'File size 20000000 bytes exceeds limit of 16777216 bytes',
      });

      const event = {
        phone: mockPhone,
        messageId: mockMessageId,
        mediaId: mockMediaId,
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('File size');
    });

    it('should handle network timeout during audio download', async () => {
      (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Network timeout after 3 retry attempts',
      });

      const event = {
        phone: mockPhone,
        messageId: mockMessageId,
        mediaId: mockMediaId,
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network timeout');
    });

    it('should handle expired WhatsApp media URL', async () => {
      (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Failed to get media URL: 410 Media URL expired',
      });

      const event = {
        phone: mockPhone,
        messageId: mockMessageId,
        mediaId: mockMediaId,
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Media URL expired');
    });
  });
});
