/**
 * Property-Based Tests for Voice Handler Lambda
 * 
 * **Property 3: Voice Transcription Pipeline**
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**
 * 
 * For any audio message received when user is in KYC_VERIFIED or VOICE_RECEIVED state,
 * the system should download the audio, transcribe it, detect the language, store the
 * language preference, and pass the transcription to intent classification.
 */

import fc from 'fast-check';
import { handler } from '../../src/lambdas/voice-handler';
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

describe('Voice Handler Property Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PRODUCTS_BUCKET_NAME = 'test-bucket';
    process.env.EVENT_BUS_NAME = 'test-event-bus';
    process.env.VOICE_TRANSCRIPTION_FUNCTION_NAME = 'voice-transcription';
    process.env.INTENT_CLASSIFICATION_FUNCTION_NAME = 'intent-classification';
    process.env.ENTITY_EXTRACTION_FUNCTION_NAME = 'entity-extraction';
  });

  /**
   * Property 3: Voice Transcription Pipeline
   * 
   * For any audio message, the system should:
   * 1. Download audio from WhatsApp
   * 2. Transcribe it
   * 3. Detect language
   * 4. Store language preference
   * 5. Pass to intent classification
   * 6. Pass to entity extraction
   * 7. Merge with partial data
   */
  describe('Property 3: Voice Transcription Pipeline', () => {
    it('should complete full pipeline for any valid audio message', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/[^0-9]/g, '').substring(0, 10)}`),
            messageId: fc.uuid(),
            mediaId: fc.uuid(),
            transcription: fc.string({ minLength: 10, maxLength: 200 }),
            detectedLanguage: fc.constantFrom('hi-IN', 'mr-IN', 'en-IN'),
            intent: fc.constantFrom('CREATE_CATALOG', 'UPDATE_INVENTORY', 'ACCEPT_ORDER'),
            entities: fc.record({
              product_name: fc.option(fc.string({ minLength: 3, maxLength: 50 }), { nil: null }),
              price: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: null }),
              quantity: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: null }),
              unit: fc.option(fc.constantFrom('kg', 'liters', 'pieces', 'packets'), { nil: null }),
              category: fc.option(fc.constantFrom('food', 'grocery', 'handicraft'), { nil: null }),
            }),
          }),
          async ({ phone, messageId, mediaId, transcription, detectedLanguage, intent, entities }) => {
            // Mock audio download
            (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
              success: true,
              s3Url: `s3://test-bucket/audio/${mediaId}.ogg`,
              mimeType: 'audio/ogg',
              size: 50000,
            });

            // Mock Lambda invocations
            (lambdaClient.send as jest.Mock)
              // Voice transcription
              .mockResolvedValueOnce({
                Payload: new TextEncoder().encode(JSON.stringify({
                  success: true,
                  transcription,
                  detectedLanguage,
                  confidence: 0.95,
                })),
              })
              // Intent classification
              .mockResolvedValueOnce({
                Payload: new TextEncoder().encode(JSON.stringify({
                  success: true,
                  intent,
                  confidence: 0.92,
                })),
              })
              // Entity extraction
              .mockResolvedValueOnce({
                Payload: new TextEncoder().encode(JSON.stringify({
                  success: true,
                  entities,
                  missingFields: [],
                })),
              });

            // Calculate missing fields
            const missingFields: string[] = [];
            if (!entities.product_name) missingFields.push('productName');
            if (entities.price === null || entities.price === undefined) missingFields.push('price');
            if (entities.quantity === null || entities.quantity === undefined) missingFields.push('quantity');
            if (!entities.unit) missingFields.push('unit');

            // Mock partial data merge
            (partialDataStore.mergePartialData as jest.Mock).mockResolvedValue({
              phone,
              productName: entities.product_name,
              price: entities.price,
              quantity: entities.quantity,
              unit: entities.unit,
              category: entities.category,
              missingFields,
              source: 'voice',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });

            (partialDataStore.isPartialDataComplete as jest.Mock).mockReturnValue(missingFields.length === 0);

            (eventBridgeClient.send as jest.Mock).mockResolvedValue({
              Entries: [{ EventId: 'event-123' }],
            });

            const event = {
              phone,
              messageId,
              mediaId,
            };

            const result = await handler(event);

            // Property assertions
            // 1. Pipeline should complete successfully
            expect(result.success).toBe(true);

            // 2. Audio should be downloaded (Requirement 2.1)
            expect(mediaDownload.downloadAudio).toHaveBeenCalledWith(
              mediaId,
              'test-bucket'
            );

            // 3. Transcription should be returned (Requirement 2.2)
            expect(result.transcription).toBe(transcription);

            // 4. Language should be detected (Requirement 2.3)
            expect(result.detectedLanguage).toBe(detectedLanguage);

            // 5. Language preference should be stored (Requirement 2.5)
            expect(languageManager.storeLanguagePreference).toHaveBeenCalledWith(
              phone,
              detectedLanguage
            );

            // 6. Intent classification should be called (Requirement 2.4)
            const intentCalls = (lambdaClient.send as jest.Mock).mock.calls.filter(
              call => call[0]?.input?.FunctionName === 'intent-classification'
            );
            expect(intentCalls.length).toBeGreaterThan(0);

            // 7. Entity extraction should be called (Requirement 2.4)
            const entityCalls = (lambdaClient.send as jest.Mock).mock.calls.filter(
              call => call[0]?.input?.FunctionName === 'entity-extraction'
            );
            expect(entityCalls.length).toBeGreaterThan(0);

            // 8. For CREATE_CATALOG intent, entities should be merged with partial data
            if (intent === 'CREATE_CATALOG') {
              expect(partialDataStore.mergePartialData).toHaveBeenCalledWith(
                phone,
                expect.objectContaining({
                  source: 'voice',
                })
              );

              // 9. State should be updated based on completeness
              if (missingFields.length > 0) {
                expect(stateManager.updateUserState).toHaveBeenCalledWith(
                  phone,
                  'VOICE_RECEIVED',
                  { missingFields }
                );
                expect(result.nextAction).toBe('REQUEST_INFO');
              } else {
                expect(stateManager.updateUserState).toHaveBeenCalledWith(
                  phone,
                  'IMAGE_PENDING'
                );
                expect(result.nextAction).toBe('REQUEST_IMAGE');
              }
            }
          }
        ),
        { numRuns: 50 } // Run 50 iterations for property test
      );
    });

    it('should handle transcription with any supported language', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/[^0-9]/g, '').substring(0, 10)}`),
            messageId: fc.uuid(),
            mediaId: fc.uuid(),
            detectedLanguage: fc.constantFrom('hi-IN', 'mr-IN', 'en-IN'),
          }),
          async ({ phone, messageId, mediaId, detectedLanguage }) => {
            // Mock successful pipeline
            (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
              success: true,
              s3Url: `s3://test-bucket/audio/${mediaId}.ogg`,
            });

            (lambdaClient.send as jest.Mock)
              .mockResolvedValueOnce({
                Payload: new TextEncoder().encode(JSON.stringify({
                  success: true,
                  transcription: 'test transcription',
                  detectedLanguage,
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
              phone,
              missingFields: [],
              source: 'voice',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });

            (partialDataStore.isPartialDataComplete as jest.Mock).mockReturnValue(true);

            (eventBridgeClient.send as jest.Mock).mockResolvedValue({
              Entries: [{ EventId: 'event-123' }],
            });

            const event = { phone, messageId, mediaId };
            const result = await handler(event);

            // Property: Language should always be stored for any supported language
            expect(result.success).toBe(true);
            expect(result.detectedLanguage).toBe(detectedLanguage);
            expect(languageManager.storeLanguagePreference).toHaveBeenCalledWith(
              phone,
              detectedLanguage
            );
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should always invoke all pipeline steps in correct order', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/[^0-9]/g, '').substring(0, 10)}`),
            messageId: fc.uuid(),
            mediaId: fc.uuid(),
          }),
          async ({ phone, messageId, mediaId }) => {
            const callOrder: string[] = [];

            // Track call order
            (mediaDownload.downloadAudio as jest.Mock).mockImplementation(async () => {
              callOrder.push('download');
              return {
                success: true,
                s3Url: `s3://test-bucket/audio/${mediaId}.ogg`,
              };
            });

            (lambdaClient.send as jest.Mock).mockImplementation(async (command: any) => {
              const functionName = command?.input?.FunctionName;
              if (functionName === 'voice-transcription') {
                callOrder.push('transcription');
                return {
                  Payload: new TextEncoder().encode(JSON.stringify({
                    success: true,
                    transcription: 'test',
                    detectedLanguage: 'hi-IN',
                  })),
                };
              } else if (functionName === 'intent-classification') {
                callOrder.push('intent');
                return {
                  Payload: new TextEncoder().encode(JSON.stringify({
                    success: true,
                    intent: 'CREATE_CATALOG',
                  })),
                };
              } else if (functionName === 'entity-extraction') {
                callOrder.push('entity');
                return {
                  Payload: new TextEncoder().encode(JSON.stringify({
                    success: true,
                    entities: {},
                    missingFields: [],
                  })),
                };
              }
              return { Payload: new TextEncoder().encode('{}') };
            });

            (languageManager.storeLanguagePreference as jest.Mock).mockImplementation(async () => {
              callOrder.push('language');
            });

            (partialDataStore.mergePartialData as jest.Mock).mockImplementation(async () => {
              callOrder.push('merge');
              return {
                phone,
                missingFields: [],
                source: 'voice',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              };
            });

            (partialDataStore.isPartialDataComplete as jest.Mock).mockReturnValue(true);

            (eventBridgeClient.send as jest.Mock).mockResolvedValue({
              Entries: [{ EventId: 'event-123' }],
            });

            const event = { phone, messageId, mediaId };
            await handler(event);

            // Property: Steps should always execute in correct order
            expect(callOrder).toEqual([
              'download',
              'transcription',
              'language',
              'intent',
              'entity',
              'merge',
            ]);
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});
