/**
 * Property-Based Test: Voice Transcription Pipeline
 * 
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**
 * 
 * Property 3: Voice Transcription Pipeline
 * For any audio message received when user is in KYC_VERIFIED or VOICE_RECEIVED state,
 * the system should download the audio, transcribe it, detect the language, store the
 * language preference, and pass the transcription to intent classification.
 * 
 * This test verifies:
 * 1. Audio is downloaded from WhatsApp Media API (Requirement 2.1)
 * 2. Audio is transcribed to text using Amazon Transcribe (Requirement 2.2)
 * 3. Language is automatically detected (Hindi, Marathi, or English) (Requirement 2.3)
 * 4. Transcribed text is passed to intent classification (Requirement 2.4)
 * 5. Detected language is stored in user profile (Requirement 2.5)
 * 6. Entities are extracted and merged with partial data
 * 7. Next action is determined based on missing fields
 */

import fc from 'fast-check';
import { handler as voiceHandler } from '../../src/lambdas/voice-handler';
import * as mediaDownload from '../../src/services/media-download';
import * as stateManager from '../../src/services/state-manager';
import * as partialDataStore from '../../src/services/partial-data-store';
import * as languageManager from '../../src/services/language-manager';
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

describe('Property 3: Voice Transcription Pipeline', () => {
  beforeAll(() => {
    process.env.PRODUCTS_BUCKET_NAME = 'test-bucket';
    process.env.EVENT_BUS_NAME = 'test-event-bus';
    process.env.VOICE_TRANSCRIPTION_FUNCTION_NAME = 'voice-transcription';
    process.env.INTENT_CLASSIFICATION_FUNCTION_NAME = 'intent-classification';
    process.env.ENTITY_EXTRACTION_FUNCTION_NAME = 'entity-extraction';
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should complete the full voice transcription pipeline for any valid audio message', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          // User state - must be KYC_VERIFIED or VOICE_RECEIVED
          userState: fc.constantFrom('KYC_VERIFIED', 'VOICE_RECEIVED'),
          // Language detection
          detectedLanguage: fc.constantFrom<'hi-IN' | 'mr-IN' | 'en-IN'>('hi-IN', 'mr-IN', 'en-IN'),
          // User identifiers
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
          messageId: fc.uuid(),
          mediaId: fc.uuid(),
          // Transcription result
          transcription: fc.string({ minLength: 20, maxLength: 200 }).filter(s => s.trim().length >= 20),
          confidence: fc.integer({ min: 70, max: 99 }).map(c => c / 100),
          // Intent classification
          intent: fc.constantFrom('CREATE_CATALOG', 'UPDATE_CATALOG', 'QUERY_STATUS'),
          intentConfidence: fc.integer({ min: 70, max: 99 }).map(c => c / 100),
          // Entity extraction - may have missing fields
          entities: fc.record({
            product_name: fc.option(fc.string({ minLength: 3, maxLength: 50 }), { nil: undefined }),
            price: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: undefined }),
            quantity: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
            unit: fc.option(fc.constantFrom('kg', 'liter', 'piece', 'dozen'), { nil: undefined }),
            category: fc.option(fc.constantFrom('food', 'clothing', 'electronics'), { nil: undefined }),
          }),
        }),
        async ({ userState, detectedLanguage, phone, messageId, mediaId, transcription, confidence, intent, intentConfidence, entities }) => {
          // Calculate missing fields
          const missingFields: string[] = [];
          if (!entities.product_name) missingFields.push('productName');
          if (!entities.price) missingFields.push('price');
          if (!entities.quantity) missingFields.push('quantity');
          if (!entities.unit) missingFields.push('unit');

          const s3Url = `s3://test-bucket/audio/${Date.now()}-${mediaId}.ogg`;

          // Mock audio download (Requirement 2.1)
          (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
            success: true,
            s3Url,
            mimeType: 'audio/ogg',
            size: 50000,
          });

          // Mock voice transcription (Requirements 2.2, 2.3)
          (lambdaClient.send as jest.Mock)
            .mockResolvedValueOnce({
              Payload: new TextEncoder().encode(JSON.stringify({
                success: true,
                transcription,
                detectedLanguage,
                confidence,
              })),
            })
            // Mock intent classification (Requirement 2.4)
            .mockResolvedValueOnce({
              Payload: new TextEncoder().encode(JSON.stringify({
                success: true,
                intent,
                confidence: intentConfidence,
              })),
            })
            // Mock entity extraction
            .mockResolvedValueOnce({
              Payload: new TextEncoder().encode(JSON.stringify({
                success: true,
                entities,
                missingFields,
              })),
            });

          // Mock language storage (Requirement 2.5)
          (languageManager.storeLanguagePreference as jest.Mock).mockResolvedValue(undefined);

          // Mock partial data merge
          const mergedData = {
            phone,
            productName: entities.product_name,
            price: entities.price,
            quantity: entities.quantity,
            unit: entities.unit,
            category: entities.category,
            missingFields,
            source: 'voice' as const,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          (partialDataStore.mergePartialData as jest.Mock).mockResolvedValue(mergedData);
          (partialDataStore.isPartialDataComplete as jest.Mock).mockReturnValue(missingFields.length === 0);

          // Mock state update
          (stateManager.updateUserState as jest.Mock).mockResolvedValue(undefined);

          // Mock EventBridge
          (eventBridgeClient.send as jest.Mock).mockResolvedValue({
            Entries: [{ EventId: 'event-123' }],
          });

          // Execute voice handler
          const event = {
            phone,
            messageId,
            mediaId,
            state: {
              state: userState,
              language: detectedLanguage,
            },
          };

          const result = await voiceHandler(event);

          // PROPERTY VERIFICATION: Pipeline should complete successfully
          expect(result.success).toBe(true);

          // Requirement 2.1: Audio should be downloaded from WhatsApp
          expect(mediaDownload.downloadAudio).toHaveBeenCalledWith(
            mediaId,
            'test-bucket'
          );

          // Requirements 2.2, 2.3: Audio should be transcribed with language detection
          // Verify transcription Lambda was called
          const transcriptionCalls = (lambdaClient.send as jest.Mock).mock.calls.filter(
            call => {
              const payload = call[0]?.input?.Payload;
              if (payload) {
                try {
                  let decoded;
                  if (typeof payload === 'string') {
                    decoded = JSON.parse(payload);
                  } else {
                    decoded = JSON.parse(new TextDecoder().decode(payload));
                  }
                  return decoded.audioUrl !== undefined;
                } catch {
                  return false;
                }
              }
              return false;
            }
          );
          expect(transcriptionCalls.length).toBeGreaterThan(0);

          // Verify transcription result
          expect(result.transcription).toBe(transcription);
          expect(result.detectedLanguage).toBe(detectedLanguage);

          // Requirement 2.5: Language should be stored in user profile
          expect(languageManager.storeLanguagePreference).toHaveBeenCalledWith(
            phone,
            detectedLanguage
          );

          // Requirement 2.4: Transcription should be passed to intent classification
          const intentCallPayload = (lambdaClient.send as jest.Mock).mock.calls.find(
            call => {
              const payload = call[0]?.input?.Payload;
              if (payload) {
                try {
                  let decoded;
                  if (typeof payload === 'string') {
                    decoded = JSON.parse(payload);
                  } else {
                    decoded = JSON.parse(new TextDecoder().decode(payload));
                  }
                  return decoded.transcribedText !== undefined;
                } catch {
                  return false;
                }
              }
              return false;
            }
          );
          expect(intentCallPayload).toBeDefined();

          // Verify entity extraction was called
          expect(result.entities).toBeDefined();

          // Verify next action is determined correctly
          if (intent === 'CREATE_CATALOG') {
            if (missingFields.length > 0) {
              expect(result.nextAction).toBe('REQUEST_INFO');
              expect(result.missingFields).toEqual(missingFields);
              
              // Verify state updated to VOICE_RECEIVED with missing fields
              expect(stateManager.updateUserState).toHaveBeenCalledWith(
                phone,
                'VOICE_RECEIVED',
                { missingFields }
              );

              // Verify missing info event published
              expect(eventBridgeClient.send).toHaveBeenCalled();
            } else {
              expect(result.nextAction).toBe('REQUEST_IMAGE');
              expect(result.missingFields).toEqual([]);
              
              // Verify state updated to IMAGE_PENDING
              expect(stateManager.updateUserState).toHaveBeenCalledWith(
                phone,
                'IMAGE_PENDING'
              );

              // Verify image request event published
              expect(eventBridgeClient.send).toHaveBeenCalled();
            }

            // Verify partial data was merged
            expect(partialDataStore.mergePartialData).toHaveBeenCalledWith(
              phone,
              expect.objectContaining({
                source: 'voice',
              })
            );
          }
        }
      ),
      { numRuns: 20 }
    );
  }, 120000); // 120 second timeout for property-based test


  it('should handle pipeline with different audio formats and sizes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
          messageId: fc.uuid(),
          mediaId: fc.uuid(),
          // Different audio formats
          mimeType: fc.constantFrom('audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/amr', 'audio/aac'),
          // Different file sizes (within limits)
          fileSize: fc.integer({ min: 1000, max: 16 * 1024 * 1024 }), // Up to 16MB
          detectedLanguage: fc.constantFrom<'hi-IN' | 'mr-IN' | 'en-IN'>('hi-IN', 'mr-IN', 'en-IN'),
          transcription: fc.string({ minLength: 20, maxLength: 200 }).filter(s => s.trim().length >= 20),
        }),
        async ({ phone, messageId, mediaId, mimeType, fileSize, detectedLanguage, transcription }) => {
          const s3Url = `s3://test-bucket/audio/${Date.now()}-${mediaId}.${mimeType.split('/')[1]}`;

          // Mock audio download with specific format and size
          (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
            success: true,
            s3Url,
            mimeType,
            size: fileSize,
          });

          // Mock transcription
          (lambdaClient.send as jest.Mock)
            .mockResolvedValueOnce({
              Payload: new TextEncoder().encode(JSON.stringify({
                success: true,
                transcription,
                detectedLanguage,
                confidence: 0.9,
              })),
            })
            .mockResolvedValueOnce({
              Payload: new TextEncoder().encode(JSON.stringify({
                success: true,
                intent: 'CREATE_CATALOG',
                confidence: 0.85,
              })),
            })
            .mockResolvedValueOnce({
              Payload: new TextEncoder().encode(JSON.stringify({
                success: true,
                entities: {
                  product_name: 'Test Product',
                  price: 100,
                  quantity: 1,
                  unit: 'piece',
                },
                missingFields: [],
              })),
            });

          (languageManager.storeLanguagePreference as jest.Mock).mockResolvedValue(undefined);
          (partialDataStore.mergePartialData as jest.Mock).mockResolvedValue({
            phone,
            productName: 'Test Product',
            price: 100,
            quantity: 1,
            unit: 'piece',
            missingFields: [],
            source: 'voice',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          (partialDataStore.isPartialDataComplete as jest.Mock).mockReturnValue(true);
          (stateManager.updateUserState as jest.Mock).mockResolvedValue(undefined);
          (eventBridgeClient.send as jest.Mock).mockResolvedValue({
            Entries: [{ EventId: 'event-123' }],
          });

          const event = {
            phone,
            messageId,
            mediaId,
          };

          const result = await voiceHandler(event);

          // PROPERTY: Pipeline should handle all supported audio formats and sizes
          expect(result.success).toBe(true);
          expect(result.transcription).toBe(transcription);
          expect(result.detectedLanguage).toBe(detectedLanguage);

          // Verify audio was downloaded
          expect(mediaDownload.downloadAudio).toHaveBeenCalledWith(mediaId, 'test-bucket');
        }
      ),
      { numRuns: 15 }
    );
  }, 120000);

  it('should preserve language consistency throughout the pipeline', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
          messageId: fc.uuid(),
          mediaId: fc.uuid(),
          detectedLanguage: fc.constantFrom<'hi-IN' | 'mr-IN' | 'en-IN'>('hi-IN', 'mr-IN', 'en-IN'),
          transcription: fc.string({ minLength: 20, maxLength: 200 }).filter(s => s.trim().length >= 20),
        }),
        async ({ phone, messageId, mediaId, detectedLanguage, transcription }) => {
          // Reset mocks for this iteration
          jest.clearAllMocks();

          const s3Url = `s3://test-bucket/audio/${Date.now()}-${mediaId}.ogg`;

          (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
            success: true,
            s3Url,
            mimeType: 'audio/ogg',
            size: 50000,
          });

          (lambdaClient.send as jest.Mock)
            .mockResolvedValueOnce({
              Payload: new TextEncoder().encode(JSON.stringify({
                success: true,
                transcription,
                detectedLanguage,
                confidence: 0.9,
              })),
            })
            .mockResolvedValueOnce({
              Payload: new TextEncoder().encode(JSON.stringify({
                success: true,
                intent: 'CREATE_CATALOG',
                confidence: 0.85,
              })),
            })
            .mockResolvedValueOnce({
              Payload: new TextEncoder().encode(JSON.stringify({
                success: true,
                entities: {},
                missingFields: ['productName', 'price'],
              })),
            });

          (languageManager.storeLanguagePreference as jest.Mock).mockResolvedValue(undefined);
          (partialDataStore.mergePartialData as jest.Mock).mockResolvedValue({
            phone,
            missingFields: ['productName', 'price'],
            source: 'voice',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          (partialDataStore.isPartialDataComplete as jest.Mock).mockReturnValue(false);
          (stateManager.updateUserState as jest.Mock).mockResolvedValue(undefined);
          (eventBridgeClient.send as jest.Mock).mockResolvedValue({
            Entries: [{ EventId: 'event-123' }],
          });

          const event = {
            phone,
            messageId,
            mediaId,
          };

          const result = await voiceHandler(event);

          // PROPERTY: Language should be consistent and stored
          expect(result.success).toBe(true);
          expect(result.detectedLanguage).toBe(detectedLanguage);

          // Verify language was stored exactly once
          expect(languageManager.storeLanguagePreference).toHaveBeenCalledTimes(1);
          expect(languageManager.storeLanguagePreference).toHaveBeenCalledWith(
            phone,
            detectedLanguage
          );

          // Verify missing info event includes the detected language
          const eventBridgeCalls = (eventBridgeClient.send as jest.Mock).mock.calls;
          expect(eventBridgeCalls.length).toBeGreaterThan(0);
          
          const eventDetail = JSON.parse(eventBridgeCalls[0][0].input.Entries[0].Detail);
          expect(eventDetail.language).toBe(detectedLanguage);
        }
      ),
      { numRuns: 15 }
    );
  }, 120000);

  it('should handle EventBridge event format correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
          messageId: fc.uuid(),
          mediaId: fc.uuid(),
          userState: fc.constantFrom('KYC_VERIFIED', 'VOICE_RECEIVED'),
          detectedLanguage: fc.constantFrom<'hi-IN' | 'mr-IN' | 'en-IN'>('hi-IN', 'mr-IN', 'en-IN'),
          transcription: fc.string({ minLength: 20, maxLength: 200 }).filter(s => s.trim().length >= 20),
        }),
        async ({ phone, messageId, mediaId, userState, detectedLanguage, transcription }) => {
          const s3Url = `s3://test-bucket/audio/${Date.now()}-${mediaId}.ogg`;

          (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
            success: true,
            s3Url,
            mimeType: 'audio/ogg',
            size: 50000,
          });

          (lambdaClient.send as jest.Mock)
            .mockResolvedValueOnce({
              Payload: new TextEncoder().encode(JSON.stringify({
                success: true,
                transcription,
                detectedLanguage,
                confidence: 0.9,
              })),
            })
            .mockResolvedValueOnce({
              Payload: new TextEncoder().encode(JSON.stringify({
                success: true,
                intent: 'CREATE_CATALOG',
                confidence: 0.85,
              })),
            })
            .mockResolvedValueOnce({
              Payload: new TextEncoder().encode(JSON.stringify({
                success: true,
                entities: {
                  product_name: 'Product',
                  price: 100,
                  quantity: 1,
                  unit: 'piece',
                },
                missingFields: [],
              })),
            });

          (languageManager.storeLanguagePreference as jest.Mock).mockResolvedValue(undefined);
          (partialDataStore.mergePartialData as jest.Mock).mockResolvedValue({
            phone,
            productName: 'Product',
            price: 100,
            quantity: 1,
            unit: 'piece',
            missingFields: [],
            source: 'voice',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          (partialDataStore.isPartialDataComplete as jest.Mock).mockReturnValue(true);
          (stateManager.updateUserState as jest.Mock).mockResolvedValue(undefined);
          (eventBridgeClient.send as jest.Mock).mockResolvedValue({
            Entries: [{ EventId: 'event-123' }],
          });

          // Test EventBridge format
          const event = {
            detail: {
              phone,
              messageId,
              mediaId,
              state: {
                state: userState,
                language: detectedLanguage,
              },
            },
          };

          const result = await voiceHandler(event);

          // PROPERTY: Pipeline should work with EventBridge event format
          expect(result.success).toBe(true);
          expect(result.transcription).toBe(transcription);
          expect(mediaDownload.downloadAudio).toHaveBeenCalledWith(mediaId, 'test-bucket');
        }
      ),
      { numRuns: 10 }
    );
  }, 120000);

  it('should handle partial data merging correctly for multiple voice messages', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
          messageId: fc.uuid(),
          mediaId: fc.uuid(),
          detectedLanguage: fc.constantFrom<'hi-IN' | 'mr-IN' | 'en-IN'>('hi-IN', 'mr-IN', 'en-IN'),
          transcription: fc.string({ minLength: 20, maxLength: 200 }).filter(s => s.trim().length >= 20),
          // First message provides some fields
          firstMessageEntities: fc.record({
            product_name: fc.option(fc.string({ minLength: 3, maxLength: 50 }), { nil: undefined }),
            price: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: undefined }),
          }),
          // Second message provides remaining fields
          secondMessageEntities: fc.record({
            quantity: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
            unit: fc.option(fc.constantFrom('kg', 'liter', 'piece'), { nil: undefined }),
          }),
        }),
        async ({ phone, messageId, mediaId, detectedLanguage, transcription, firstMessageEntities, secondMessageEntities }) => {
          const s3Url = `s3://test-bucket/audio/${Date.now()}-${mediaId}.ogg`;

          // Calculate missing fields after first message
          const firstMissingFields: string[] = [];
          if (!firstMessageEntities.product_name) firstMissingFields.push('productName');
          if (!firstMessageEntities.price) firstMissingFields.push('price');
          if (!secondMessageEntities.quantity) firstMissingFields.push('quantity');
          if (!secondMessageEntities.unit) firstMissingFields.push('unit');

          (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
            success: true,
            s3Url,
            mimeType: 'audio/ogg',
            size: 50000,
          });

          (lambdaClient.send as jest.Mock)
            .mockResolvedValueOnce({
              Payload: new TextEncoder().encode(JSON.stringify({
                success: true,
                transcription,
                detectedLanguage,
                confidence: 0.9,
              })),
            })
            .mockResolvedValueOnce({
              Payload: new TextEncoder().encode(JSON.stringify({
                success: true,
                intent: 'CREATE_CATALOG',
                confidence: 0.85,
              })),
            })
            .mockResolvedValueOnce({
              Payload: new TextEncoder().encode(JSON.stringify({
                success: true,
                entities: {
                  ...firstMessageEntities,
                  ...secondMessageEntities,
                },
                missingFields: firstMissingFields,
              })),
            });

          (languageManager.storeLanguagePreference as jest.Mock).mockResolvedValue(undefined);

          // Mock merge that combines both messages
          const mergedData = {
            phone,
            productName: firstMessageEntities.product_name,
            price: firstMessageEntities.price,
            quantity: secondMessageEntities.quantity,
            unit: secondMessageEntities.unit,
            missingFields: firstMissingFields,
            source: 'voice' as const,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          (partialDataStore.mergePartialData as jest.Mock).mockResolvedValue(mergedData);
          (partialDataStore.isPartialDataComplete as jest.Mock).mockReturnValue(firstMissingFields.length === 0);
          (stateManager.updateUserState as jest.Mock).mockResolvedValue(undefined);
          (eventBridgeClient.send as jest.Mock).mockResolvedValue({
            Entries: [{ EventId: 'event-123' }],
          });

          const event = {
            phone,
            messageId,
            mediaId,
          };

          const result = await voiceHandler(event);

          // PROPERTY: Partial data should be merged correctly
          expect(result.success).toBe(true);
          expect(partialDataStore.mergePartialData).toHaveBeenCalledWith(
            phone,
            expect.objectContaining({
              source: 'voice',
            })
          );

          // Verify missing fields are tracked
          expect(result.missingFields).toEqual(firstMissingFields);
        }
      ),
      { numRuns: 15 }
    );
  }, 120000);
});
