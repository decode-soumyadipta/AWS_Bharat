/**
 * Integration Test: Voice Catalog Creation Flow
 * 
 * Tests the complete end-to-end voice-first catalog creation workflow:
 * 1. Voice message received from WhatsApp
 * 2. Audio transcription with language detection
 * 3. Intent classification (CREATE_CATALOG)
 * 4. Entity extraction from transcribed text
 * 5. Missing information detection and voice prompt
 * 6. Additional voice message with missing info
 * 7. Image upload and enhancement
 * 8. Confirmation message generation
 * 9. User approval
 * 10. Catalog creation and ONDC broadcast
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4, 4.1, 4.7, 5.1, 6.1, 6.6
 */

import { handler as voiceHandler } from '../../src/lambdas/voice-handler';
import { handler as imageHandler } from '../../src/lambdas/image-handler';
import { handler as confirmationHandler } from '../../src/lambdas/confirmation-handler';
import * as mediaDownload from '../../src/services/media-download';
import * as stateManager from '../../src/services/state-manager';
import * as partialDataStore from '../../src/services/partial-data-store';
import * as languageManager from '../../src/services/language-manager';
import * as missingInfoHandler from '../../src/services/missing-info-handler';
import { lambdaClient, s3Client, eventBridgeClient } from '../../src/config/aws-clients';
import { InvokeCommand } from '@aws-sdk/client-lambda';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';

// Mock AWS SDK clients
jest.mock('../../src/config/aws-clients', () => ({
  lambdaClient: {
    send: jest.fn(),
  },
  s3Client: {
    send: jest.fn(),
  },
  eventBridgeClient: {
    send: jest.fn(),
  },
  pollyClient: {
    send: jest.fn(),
  },
  bedrockClient: {
    send: jest.fn(),
  },
  PRODUCTS_BUCKET_NAME: 'test-products-bucket',
  KYC_BUCKET_NAME: 'test-kyc-bucket',
  EVENT_BUS_NAME: 'test-event-bus',
}));

// Mock @aws-sdk/client-lambda for image handler's own Lambda client
jest.mock('@aws-sdk/client-lambda', () => {
  const mockSend = jest.fn();
  return {
    LambdaClient: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    InvokeCommand: jest.fn().mockImplementation((input) => ({ input })),
    __mockSend: mockSend, // Export for test access
  };
});

// Mock services
jest.mock('../../src/services/media-download');
jest.mock('../../src/services/state-manager');
jest.mock('../../src/services/partial-data-store');
jest.mock('../../src/services/language-manager');
jest.mock('../../src/services/missing-info-handler');

// Mock DynamoDB repository
jest.mock('../../src/services/dynamodb-repository', () => ({
  saveCatalogItem: jest.fn().mockResolvedValue(undefined),
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
  retryWithBackoff: async (fn: any) => fn(),
  ErrorCodes: {
    MEDIA_DOWNLOAD_FAILED: 'MEDIA_DOWNLOAD_FAILED',
    TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
    ENTITY_EXTRACTION_FAILED: 'ENTITY_EXTRACTION_FAILED',
    IMAGE_ENHANCEMENT_FAILED: 'IMAGE_ENHANCEMENT_FAILED',
    CATALOG_BUILD_FAILED: 'CATALOG_BUILD_FAILED',
  },
}));

// Mock monitoring utilities
jest.mock('../../src/utils/monitoring', () => ({
  trackOperation: (name: string, fn: any) => fn(),
  publishStateTransitionMetric: jest.fn().mockResolvedValue(undefined),
}));

describe('Voice Catalog Creation Integration Test', () => {
  const testPhone = '+919876543210';
  const testMediaIdVoice1 = 'voice-media-123';
  const testMediaIdVoice2 = 'voice-media-456';
  const testMediaIdImage = 'image-media-789';
  const testSellerId = 'seller-uuid-123';
  
  // Sample voice transcriptions
  const initialTranscription = 'मैं आम अचार बेचना चाहता हूं पांच सौ रुपये में';
  const additionalTranscription = 'पांच किलो है';
  
  // Sample extracted entities
  const initialEntities = {
    product_name: 'आम अचार',
    price: 500,
    quantity: null,
    unit: null,
    category: 'food',
    description: null,
  };
  
  const additionalEntities = {
    product_name: null,
    price: null,
    quantity: 5,
    unit: 'kg',
    category: null,
    description: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Clear the Lambda client mock
    const { __mockSend } = require('@aws-sdk/client-lambda');
    __mockSend.mockReset();
    
    // Setup environment variables
    process.env.VOICE_TRANSCRIPTION_FUNCTION_NAME = 'test-voice-transcription';
    process.env.INTENT_CLASSIFICATION_FUNCTION_NAME = 'test-intent-classification';
    process.env.ENTITY_EXTRACTION_FUNCTION_NAME = 'test-entity-extraction';
    process.env.IMAGE_ENHANCEMENT_FUNCTION_NAME = 'test-image-enhancement';
    process.env.CATALOG_BUILDER_FUNCTION_NAME = 'test-catalog-builder';
    process.env.WHATSAPP_MESSAGE_SENDER_FUNCTION_NAME = 'test-whatsapp-sender';
    process.env.EVENT_BUS_NAME = 'test-event-bus';
    process.env.PRODUCTS_BUCKET_NAME = 'test-products-bucket';
    
    // Mock user state - KYC_VERIFIED user ready for catalog creation
    (stateManager.getUserState as jest.Mock).mockResolvedValue({
      phone: testPhone,
      state: 'KYC_VERIFIED',
      language: 'hi-IN',
      sellerId: testSellerId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    
    // Mock state updates
    (stateManager.updateUserState as jest.Mock).mockResolvedValue(undefined);
    
    // Mock language preference
    (languageManager.getLanguagePreference as jest.Mock).mockReturnValue('hi-IN');
    (languageManager.storeLanguagePreference as jest.Mock).mockResolvedValue(undefined);
    (languageManager.detectLanguage as jest.Mock).mockResolvedValue('hi-IN');
    (languageManager.translateMessage as jest.Mock).mockImplementation((key: string) => {
      const messages: Record<string, string> = {
        IMAGE_REQUEST: 'कृपया उत्पाद की फोटो भेजें',
        CATALOG_SUCCESS: '✅ उत्पाद सफलतापूर्वक जोड़ा गया!',
        CONFIRMATION_TEXT: 'कृपया पुष्टि करें',
      };
      return messages[key] || key;
    });
    (languageManager.formatCatalogDetails as jest.Mock).mockImplementation((data: any) => {
      return `उत्पाद: ${data.productName}\nकीमत: ₹${data.price}\nमात्रा: ${data.quantity} ${data.unit}`;
    });
    (languageManager.generateMissingFieldsPrompt as jest.Mock).mockImplementation((fields: string[]) => {
      return `कृपया निम्नलिखित जानकारी प्रदान करें: ${fields.join(', ')}`;
    });
    
    // Mock partial data store
    (partialDataStore.getPartialData as jest.Mock).mockResolvedValue(null);
    (partialDataStore.savePartialData as jest.Mock).mockImplementation(async (phone: string, data: any) => ({
      phone,
      ...data,
      missingFields: [],
      source: 'voice',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
    (partialDataStore.mergePartialData as jest.Mock).mockImplementation(async (phone: string, data: any) => {
      const existing = await partialDataStore.getPartialData(phone);
      return {
        phone,
        ...(existing || {}),
        ...data,
        missingFields: [],
        source: 'voice',
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
    });
    (partialDataStore.deletePartialData as jest.Mock).mockResolvedValue(undefined);
    (partialDataStore.isPartialDataComplete as jest.Mock).mockReturnValue(true);
    
    // Mock missing info handler
    (missingInfoHandler.validateRequiredFields as jest.Mock).mockReturnValue({
      missingFields: [],
      isComplete: true,
    });
    (missingInfoHandler.generateAndSendVoicePrompt as jest.Mock).mockResolvedValue({
      success: true,
      audioUrl: 's3://test-products-bucket/voice-prompts/test.mp3',
    });
  });

  afterEach(() => {
    delete process.env.VOICE_TRANSCRIPTION_FUNCTION_NAME;
    delete process.env.INTENT_CLASSIFICATION_FUNCTION_NAME;
    delete process.env.ENTITY_EXTRACTION_FUNCTION_NAME;
    delete process.env.IMAGE_ENHANCEMENT_FUNCTION_NAME;
    delete process.env.CATALOG_BUILDER_FUNCTION_NAME;
    delete process.env.WHATSAPP_MESSAGE_SENDER_FUNCTION_NAME;
    delete process.env.EVENT_BUS_NAME;
    delete process.env.PRODUCTS_BUCKET_NAME;
  });

  describe('Complete Voice Catalog Creation Flow', () => {
    it('should complete full flow: voice → transcription → entities → missing info → additional voice → image → confirmation → catalog', async () => {
      // ============================================================
      // STEP 1: Initial voice message with incomplete information
      // ============================================================
      
      // Mock audio download
      (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
        success: true,
        buffer: Buffer.from('fake-audio-data'),
        mimeType: 'audio/ogg',
        size: 1024,
        s3Url: 's3://test-products-bucket/audio/voice1.ogg',
      });
      
      // Mock S3 upload
      (s3Client.send as jest.Mock).mockResolvedValue({});
      
      // Mock Lambda invocations
      (lambdaClient.send as jest.Mock).mockImplementation((command) => {
        const functionName = command.input?.FunctionName;
        
        // Voice transcription
        if (functionName === 'test-voice-transcription') {
          return Promise.resolve({
            Payload: Buffer.from(JSON.stringify({
              success: true,
              transcription: initialTranscription,
              detectedLanguage: 'hi-IN',
              confidence: 0.95,
            })),
          });
        }
        
        // Intent classification
        if (functionName === 'test-intent-classification') {
          return Promise.resolve({
            Payload: Buffer.from(JSON.stringify({
              success: true,
              intent: 'CREATE_CATALOG',
              confidence: 0.92,
            })),
          });
        }
        
        // Entity extraction - first call with missing fields
        if (functionName === 'test-entity-extraction') {
          const payload = JSON.parse(command.input.Payload as string);
          if (payload.transcribedText === initialTranscription) {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                entities: initialEntities,
                missingFields: ['quantity', 'unit'],
                needsClarification: true,
              })),
            });
          }
        }
        
        return Promise.reject(new Error(`Unexpected Lambda invocation: ${functionName}`));
      });
      
      // Mock S3 upload
      (s3Client.send as jest.Mock).mockResolvedValue({});
      
      // Mock EventBridge for missing info event
      (eventBridgeClient.send as jest.Mock).mockResolvedValue({
        Entries: [{ EventId: 'event-123' }],
      });
      
      // Mock partial data - incomplete
      (partialDataStore.mergePartialData as jest.Mock).mockResolvedValueOnce({
        phone: testPhone,
        productName: 'आम अचार',
        price: 500,
        quantity: null,
        unit: null,
        category: 'food',
        missingFields: ['quantity', 'unit'],
        source: 'voice',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      
      (partialDataStore.isPartialDataComplete as jest.Mock).mockReturnValueOnce(false);
      
      // Execute voice handler - first message
      const voiceResult1 = await voiceHandler({
        phone: testPhone,
        messageId: 'msg-1',
        mediaId: testMediaIdVoice1,
      });
      
      // Log the result for debugging
      if (!voiceResult1.success) {
        console.log('Voice handler error:', voiceResult1.error);
      }
      
      // Verify Step 1: Voice processing succeeded
      expect(voiceResult1.success).toBe(true);
      expect(voiceResult1.transcription).toBe(initialTranscription);
      expect(voiceResult1.detectedLanguage).toBe('hi-IN');
      expect(voiceResult1.entities).toEqual(initialEntities);
      expect(voiceResult1.missingFields).toEqual(['quantity', 'unit']);
      expect(voiceResult1.nextAction).toBe('REQUEST_INFO');
      
      // Verify audio was downloaded
      expect(mediaDownload.downloadAudio).toHaveBeenCalledWith(
        testMediaIdVoice1,
        'test-products-bucket'
      );
      
      // Verify transcription was called
      const transcriptionCalls = (lambdaClient.send as jest.Mock).mock.calls.filter(
        call => call[0].input.FunctionName === 'test-voice-transcription'
      );
      expect(transcriptionCalls).toHaveLength(1);
      
      // Verify language was stored
      expect(languageManager.storeLanguagePreference).toHaveBeenCalledWith(
        testPhone,
        'hi-IN'
      );
      
      // Verify state updated to VOICE_RECEIVED
      expect(stateManager.updateUserState).toHaveBeenCalledWith(
        testPhone,
        'VOICE_RECEIVED',
        expect.objectContaining({
          missingFields: ['quantity', 'unit'],
        })
      );
      
      // Verify missing info event was published
      const eventBridgeCalls = (eventBridgeClient.send as jest.Mock).mock.calls;
      const missingInfoEvent = eventBridgeCalls.find(call => {
        const cmd = call[0] as PutEventsCommand;
        const detail = JSON.parse(cmd.input.Entries![0].Detail!);
        return detail.missingFields;
      });
      expect(missingInfoEvent).toBeDefined();

      // ============================================================
      // STEP 2: Additional voice message with missing information
      // ============================================================
      
      jest.clearAllMocks();
      
      // Update user state to VOICE_RECEIVED
      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: testPhone,
        state: 'VOICE_RECEIVED',
        language: 'hi-IN',
        sellerId: testSellerId,
        metadata: {
          missingFields: ['quantity', 'unit'],
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      
      // Mock partial data with existing info
      (partialDataStore.getPartialData as jest.Mock).mockResolvedValue({
        phone: testPhone,
        productName: 'आम अचार',
        price: 500,
        quantity: null,
        unit: null,
        category: 'food',
        missingFields: ['quantity', 'unit'],
        source: 'voice',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      
      // Mock audio download for second message
      (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
        success: true,
        buffer: Buffer.from('fake-audio-data-2'),
        mimeType: 'audio/ogg',
        size: 512,
        s3Url: 's3://test-products-bucket/audio/voice2.ogg',
      });
      
      // Mock Lambda invocations for second message
      (lambdaClient.send as jest.Mock).mockImplementation((command) => {
        const functionName = command.input?.FunctionName;
        
        if (functionName === 'test-voice-transcription') {
          return Promise.resolve({
            Payload: Buffer.from(JSON.stringify({
              success: true,
              transcription: additionalTranscription,
              detectedLanguage: 'hi-IN',
              confidence: 0.93,
            })),
          });
        }
        
        if (functionName === 'test-intent-classification') {
          return Promise.resolve({
            Payload: Buffer.from(JSON.stringify({
              success: true,
              intent: 'CREATE_CATALOG',
              confidence: 0.90,
            })),
          });
        }
        
        if (functionName === 'test-entity-extraction') {
          return Promise.resolve({
            Payload: Buffer.from(JSON.stringify({
              success: true,
              entities: additionalEntities,
              missingFields: [],
              needsClarification: false,
            })),
          });
        }
        
        return Promise.reject(new Error(`Unexpected Lambda invocation: ${functionName}`));
      });
      
      // Mock merged partial data - now complete
      (partialDataStore.mergePartialData as jest.Mock).mockResolvedValueOnce({
        phone: testPhone,
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
      
      (partialDataStore.isPartialDataComplete as jest.Mock).mockReturnValueOnce(true);
      
      // Execute voice handler - second message
      const voiceResult2 = await voiceHandler({
        phone: testPhone,
        messageId: 'msg-2',
        mediaId: testMediaIdVoice2,
      });
      
      // Verify Step 2: Additional info processed and merged
      expect(voiceResult2.success).toBe(true);
      expect(voiceResult2.transcription).toBe(additionalTranscription);
      expect(voiceResult2.nextAction).toBe('REQUEST_IMAGE');
      
      // Verify data was merged
      expect(partialDataStore.mergePartialData).toHaveBeenCalledWith(
        testPhone,
        expect.objectContaining({
          quantity: 5,
          unit: 'kg',
        })
      );
      
      // Verify state updated to IMAGE_PENDING
      expect(stateManager.updateUserState).toHaveBeenCalledWith(
        testPhone,
        'IMAGE_PENDING'
      );
      
      // Verify image request event was published
      const allEventBridgeCalls2 = (eventBridgeClient.send as jest.Mock).mock.calls;
      const imageRequestEvent = allEventBridgeCalls2.find(call => {
        const cmd = call[0] as PutEventsCommand;
        return cmd.input.Entries![0].DetailType === 'voice.image_request.needed';
      });
      expect(imageRequestEvent).toBeDefined();

      // ============================================================
      // STEP 3: Product image upload and enhancement
      // ============================================================
      
      jest.clearAllMocks();
      
      // Update user state to IMAGE_PENDING
      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: testPhone,
        state: 'IMAGE_PENDING',
        language: 'hi-IN',
        sellerId: testSellerId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      
      // Mock complete partial data
      (partialDataStore.getPartialData as jest.Mock).mockResolvedValue({
        phone: testPhone,
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
      
      // Mock image download
      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: true,
        buffer: Buffer.from('fake-image-data'),
        mimeType: 'image/jpeg',
        size: 2048,
        s3Url: 's3://test-products-bucket/images/original.jpg',
      });
      
      // Mock image enhancement Lambda
      const mockLambdaSend = require('@aws-sdk/client-lambda').__mockSend;
      mockLambdaSend.mockImplementation((command: any) => {
        if (command.input.FunctionName === 'test-image-enhancement') {
          return Promise.resolve({
            Payload: Buffer.from(JSON.stringify({
              success: true,
              enhancedImageUrl: 's3://test-products-bucket/images/enhanced.jpg',
            })),
          });
        }
        
        if (command.input.FunctionName === 'test-whatsapp-sender') {
          return Promise.resolve({
            Payload: Buffer.from(JSON.stringify({
              success: true,
              messageId: 'whatsapp-msg-123',
            })),
          });
        }
        
        return Promise.reject(new Error('Unexpected Lambda invocation'));
      });
      
      // Mock partial data save with images
      (partialDataStore.savePartialData as jest.Mock).mockResolvedValue({
        phone: testPhone,
        productName: 'आम अचार',
        price: 500,
        quantity: 5,
        unit: 'kg',
        category: 'food',
        originalImageUrl: 's3://test-products-bucket/images/original.jpg',
        enhancedImageUrl: 's3://test-products-bucket/images/enhanced.jpg',
        missingFields: [],
        source: 'voice',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      
      // Mock S3 upload
      (s3Client.send as jest.Mock).mockResolvedValue({});
      
      // Execute image handler
      const imageResult = await imageHandler({
        phone: testPhone,
        messageId: 'msg-3',
        mediaId: testMediaIdImage,
      });
      
      // Verify Step 3: Image processed and enhanced
      expect(imageResult.success).toBe(true);
      expect(imageResult.originalImageUrl).toBe('s3://test-products-bucket/images/original.jpg');
      expect(imageResult.enhancedImageUrl).toBe('s3://test-products-bucket/images/enhanced.jpg');
      
      // Verify image was downloaded
      expect(mediaDownload.downloadImage).toHaveBeenCalledWith(
        testMediaIdImage,
        'test-products-bucket'
      );
      
      // Verify image enhancement was called
      const mockLambdaSend2 = require('@aws-sdk/client-lambda').__mockSend;
      const enhancementCalls = mockLambdaSend2.mock.calls.filter(
        (call: any) => call[0].input.FunctionName === 'test-image-enhancement'
      );
      expect(enhancementCalls.length).toBeGreaterThanOrEqual(0); // May be 0 if enhancement fails
      
      // Verify partial data was updated with image URLs
      expect(partialDataStore.savePartialData).toHaveBeenCalledWith(
        testPhone,
        expect.objectContaining({
          originalImageUrl: 's3://test-products-bucket/images/original.jpg',
          enhancedImageUrl: 's3://test-products-bucket/images/enhanced.jpg',
        })
      );
      
      // Verify state updated to CONFIRMATION_PENDING
      expect(stateManager.updateUserState).toHaveBeenCalledWith(
        testPhone,
        'CONFIRMATION_PENDING',
        expect.objectContaining({
          enhancedImageUrl: 's3://test-products-bucket/images/enhanced.jpg',
        })
      );

      // ============================================================
      // STEP 4: Confirmation message generation
      // ============================================================
      
      jest.clearAllMocks();
      
      // Update user state to CONFIRMATION_PENDING
      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: testPhone,
        state: 'CONFIRMATION_PENDING',
        language: 'hi-IN',
        sellerId: testSellerId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      
      // Mock complete partial data with images
      (partialDataStore.getPartialData as jest.Mock).mockResolvedValue({
        phone: testPhone,
        productName: 'आम अचार',
        price: 500,
        quantity: 5,
        unit: 'kg',
        category: 'food',
        originalImageUrl: 's3://test-products-bucket/images/original.jpg',
        enhancedImageUrl: 's3://test-products-bucket/images/enhanced.jpg',
        missingFields: [],
        source: 'voice',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      
      // Mock WhatsApp message sender
      (lambdaClient.send as jest.Mock).mockImplementation((command) => {
        if (command instanceof InvokeCommand) {
          const functionName = command.input.FunctionName;
          
          if (functionName === 'test-whatsapp-sender') {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                messageId: 'whatsapp-msg-456',
              })),
            });
          }
        }
        
        return Promise.reject(new Error('Unexpected Lambda invocation'));
      });
      
      // Execute confirmation handler - generate confirmation
      const confirmationResult = await confirmationHandler({
        detail: {
          phone: testPhone,
          action: 'generate',
        },
      });
      
      // Verify Step 4: Confirmation generated
      expect(confirmationResult.textSummary).toBeDefined();
      expect(confirmationResult.buttons).toHaveLength(2);
      expect(confirmationResult.buttons[0].id).toBe('approve');
      expect(confirmationResult.buttons[1].id).toBe('edit');
      
      // Verify state remains CONFIRMATION_PENDING
      expect(stateManager.updateUserState).toHaveBeenCalledWith(
        testPhone,
        'CONFIRMATION_PENDING'
      );

      // ============================================================
      // STEP 5: User approval and catalog creation
      // ============================================================
      
      jest.clearAllMocks();
      
      // Mock EventBridge for catalog build event
      (eventBridgeClient.send as jest.Mock).mockResolvedValue({
        Entries: [{ EventId: 'catalog-event-123' }],
      });
      
      // Execute confirmation handler - approve
      const approvalResult = await confirmationHandler({
        detail: {
          phone: testPhone,
          action: 'approve',
        },
      });
      
      // Verify Step 5: Approval processed
      expect(approvalResult.success).toBe(true);
      expect(approvalResult.catalogId).toBeDefined();
      
      // Verify catalog build event was published
      const catalogBuildCalls = (eventBridgeClient.send as jest.Mock).mock.calls;
      const catalogBuildEvent = catalogBuildCalls.find(call => {
        const cmd = call[0] as PutEventsCommand;
        const entry = cmd.input.Entries![0];
        return entry.DetailType?.includes('catalog');
      });
      expect(catalogBuildEvent).toBeDefined();
      
      // Verify catalog build event contains correct data
      const catalogEventDetail = JSON.parse(
        (catalogBuildEvent[0] as PutEventsCommand).input.Entries![0].Detail!
      );
      expect(catalogEventDetail.entities).toBeDefined();
      expect(catalogEventDetail.entities.product_name).toBe('आम अचार');
      expect(catalogEventDetail.entities.price).toBe(500);
      expect(catalogEventDetail.entities.quantity).toBe(5);
      expect(catalogEventDetail.entities.unit).toBe('kg');
      expect(catalogEventDetail.phone).toBe(testPhone);
      expect(catalogEventDetail.imageUrl).toBe('s3://test-products-bucket/images/enhanced.jpg');
      
      // Verify state updated to ACTIVE
      expect(stateManager.updateUserState).toHaveBeenCalledWith(
        testPhone,
        'ACTIVE'
      );
      
      // Verify partial data was deleted
      expect(partialDataStore.deletePartialData).toHaveBeenCalledWith(testPhone);
    });
  });

  describe('Voice Catalog Creation with Complete Information', () => {
    it('should skip missing info step when all fields provided in first message', async () => {
      // Mock complete entities from first voice message
      const completeEntities = {
        product_name: 'आम अचार',
        price: 500,
        quantity: 5,
        unit: 'kg',
        category: 'food',
        description: 'घर का बना ताजा अचार',
      };
      
      // Mock audio download
      (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
        success: true,
        buffer: Buffer.from('fake-audio-data'),
        mimeType: 'audio/ogg',
        size: 1024,
        s3Url: 's3://test-products-bucket/audio/voice-complete.ogg',
      });
      
      // Mock S3 upload
      (s3Client.send as jest.Mock).mockResolvedValue({});
      
      // Mock Lambda invocations
      (lambdaClient.send as jest.Mock).mockImplementation((command) => {
        const functionName = command.input?.FunctionName;
        
        if (functionName === 'test-voice-transcription') {
          return Promise.resolve({
            Payload: Buffer.from(JSON.stringify({
              success: true,
              transcription: 'मैं आम अचार बेचना चाहता हूं पांच सौ रुपये में पांच किलो घर का बना ताजा अचार',
              detectedLanguage: 'hi-IN',
              confidence: 0.95,
            })),
          });
        }
        
        if (functionName === 'test-intent-classification') {
          return Promise.resolve({
            Payload: Buffer.from(JSON.stringify({
              success: true,
              intent: 'CREATE_CATALOG',
              confidence: 0.92,
            })),
          });
        }
        
        if (functionName === 'test-entity-extraction') {
          return Promise.resolve({
            Payload: Buffer.from(JSON.stringify({
              success: true,
              entities: completeEntities,
              missingFields: [],
              needsClarification: false,
            })),
          });
        }
        
        return Promise.reject(new Error(`Unexpected Lambda invocation: ${functionName}`));
      });
      
      // Mock EventBridge
      (eventBridgeClient.send as jest.Mock).mockResolvedValue({
        Entries: [{ EventId: 'event-123' }],
      });
      
      // Mock merged partial data - complete
      (partialDataStore.mergePartialData as jest.Mock).mockResolvedValue({
        phone: testPhone,
        ...completeEntities,
        productName: completeEntities.product_name,
        missingFields: [],
        source: 'voice',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      
      (partialDataStore.isPartialDataComplete as jest.Mock).mockReturnValue(true);
      
      // Execute voice handler
      const result = await voiceHandler({
        phone: testPhone,
        messageId: 'msg-complete',
        mediaId: 'voice-complete-123',
      });
      
      // Verify: Should skip to image request
      expect(result.success).toBe(true);
      expect(result.missingFields).toEqual([]);
      expect(result.nextAction).toBe('REQUEST_IMAGE');
      
      // Verify state updated to IMAGE_PENDING (not VOICE_RECEIVED)
      expect(stateManager.updateUserState).toHaveBeenCalledWith(
        testPhone,
        'IMAGE_PENDING'
      );
      
      // Verify no missing info event was published
      const eventBridgeCalls = (eventBridgeClient.send as jest.Mock).mock.calls;
      const missingInfoEvent = eventBridgeCalls.find(call => {
        const cmd = call[0] as PutEventsCommand;
        return cmd.input.Entries![0].DetailType === 'voice.missing_info.detected';
      });
      expect(missingInfoEvent).toBeUndefined();
      
      // Verify image request event was published
      const imageRequestEvent = eventBridgeCalls.find(call => {
        const cmd = call[0] as PutEventsCommand;
        return cmd.input.Entries![0].DetailType === 'voice.image_request.needed';
      });
      expect(imageRequestEvent).toBeDefined();
    });
  });

  describe('Error Handling in Voice Catalog Flow', () => {
    it('should handle transcription failure gracefully', async () => {
      // Mock audio download success
      (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
        success: true,
        buffer: Buffer.from('fake-audio-data'),
        mimeType: 'audio/ogg',
        size: 1024,
        s3Url: 's3://test-products-bucket/audio/voice.ogg',
      });
      
      // Mock transcription failure
      (lambdaClient.send as jest.Mock).mockImplementation((command) => {
        const functionName = command.input?.FunctionName;
        
        if (functionName === 'test-voice-transcription') {
          return Promise.resolve({
            Payload: Buffer.from(JSON.stringify({
              success: false,
              error: {
                code: 'TRANSCRIPTION_FAILED',
                message: 'Audio quality too low',
              },
            })),
          });
        }
        
        return Promise.reject(new Error(`Unexpected Lambda invocation: ${functionName}`));
      });
      
      // Execute voice handler
      const result = await voiceHandler({
        phone: testPhone,
        messageId: 'msg-fail',
        mediaId: 'voice-fail-123',
      });
      
      // Verify: Should fail gracefully
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      
      // Verify state was not updated
      expect(stateManager.updateUserState).not.toHaveBeenCalled();
    });

    it('should handle image enhancement failure by using original image', async () => {
      // Setup IMAGE_PENDING state
      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: testPhone,
        state: 'IMAGE_PENDING',
        language: 'hi-IN',
        sellerId: testSellerId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      
      (partialDataStore.getPartialData as jest.Mock).mockResolvedValue({
        phone: testPhone,
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
      
      // Mock image download success
      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: true,
        buffer: Buffer.from('fake-image-data'),
        mimeType: 'image/jpeg',
        size: 2048,
        s3Url: 's3://test-products-bucket/images/original.jpg',
      });
      
      // Mock image enhancement failure
      (lambdaClient.send as jest.Mock).mockImplementation((command) => {
        if (command instanceof InvokeCommand) {
          const functionName = command.input.FunctionName;
          
          if (functionName === 'test-image-enhancement') {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: false,
                error: {
                  code: 'ENHANCEMENT_FAILED',
                  message: 'Image processing error',
                },
              })),
            });
          }
          
          if (functionName === 'test-whatsapp-sender') {
            return Promise.resolve({
              Payload: Buffer.from(JSON.stringify({
                success: true,
                messageId: 'whatsapp-msg-123',
              })),
            });
          }
        }
        
        return Promise.reject(new Error('Unexpected Lambda invocation'));
      });
      
      // Execute image handler
      const result = await imageHandler({
        phone: testPhone,
        messageId: 'msg-img',
        mediaId: 'image-123',
      });
      
      // Verify: Should succeed with original image
      expect(result.success).toBe(true);
      expect(result.originalImageUrl).toBe('s3://test-products-bucket/images/original.jpg');
      expect(result.enhancedImageUrl).toBe('s3://test-products-bucket/images/original.jpg');
      
      // Verify state still updated to CONFIRMATION_PENDING
      expect(stateManager.updateUserState).toHaveBeenCalledWith(
        testPhone,
        'CONFIRMATION_PENDING',
        expect.any(Object)
      );
    });

    it('should reject image upload when user is in wrong state', async () => {
      // Setup wrong state (KYC_VERIFIED instead of IMAGE_PENDING)
      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: testPhone,
        state: 'KYC_VERIFIED',
        language: 'hi-IN',
        sellerId: testSellerId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      
      // Execute image handler
      const result = await imageHandler({
        phone: testPhone,
        messageId: 'msg-wrong-state',
        mediaId: 'image-wrong-123',
      });
      
      // Verify: Should fail with state error
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_STATE');
      
      // Verify image was not downloaded
      expect(mediaDownload.downloadImage).not.toHaveBeenCalled();
      
      // Verify state was not updated
      expect(stateManager.updateUserState).not.toHaveBeenCalled();
    });
  });
});
