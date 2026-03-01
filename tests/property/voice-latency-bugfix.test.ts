/**
 * Property-Based Test: Voice Message Latency Bug Condition Exploration
 * 
 * **Validates: Requirements 2.1**
 * 
 * Property 1: Fault Condition - Voice Message Response Time Exceeds 3 Seconds
 * 
 * **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * **DO NOT attempt to fix the test or the code when it fails**
 * **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
 * 
 * **GOAL**: Surface counterexamples that demonstrate voice latency > 3 seconds
 * 
 * This test verifies that voice-handler responds within 3000ms for all voice message inputs.
 * It measures timestamps at each stage:
 * - Transcription start/end
 * - Intent classification start/end
 * - Entity extraction start/end
 * - Total response time
 * 
 * **EXPECTED OUTCOME ON UNFIXED CODE**: Test FAILS with response times > 3000ms
 * This proves the bug exists due to sequential Lambda invocations.
 */

import fc from 'fast-check';
import { handler as voiceHandler } from '../../src/lambdas/voice-handler';
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
jest.mock('../../src/lambdas/whatsapp-message-sender', () => ({
  sendTextMessage: jest.fn().mockResolvedValue({ success: true }),
}));

describe('Property 1: Fault Condition - Voice Message Response Time Exceeds 3 Seconds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PRODUCTS_BUCKET_NAME = 'test-bucket';
    process.env.EVENT_BUS_NAME = 'test-event-bus';
    process.env.VOICE_TRANSCRIPTION_FUNCTION_NAME = 'voice-transcription';
    process.env.INTENT_CLASSIFICATION_FUNCTION_NAME = 'intent-classification';
    process.env.ENTITY_EXTRACTION_FUNCTION_NAME = 'entity-extraction';
  });

  /**
   * Test voice messages of varying lengths to ensure reproducibility
   * Scoped PBT Approach: Test 5s, 10s, 20s voice messages
   */
  it('should respond within 3000ms for voice messages of varying lengths', async () => {
    const counterexamples: Array<{
      voiceLength: string;
      totalTime: number;
      transcriptionTime: number;
      intentTime: number;
      entityTime: number;
    }> = [];

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: fc.constantFrom('+919876543210', '+919123456789', '+918765432109'),
          messageId: fc.uuid(),
          mediaId: fc.uuid(),
          voiceLength: fc.constantFrom('5s', '10s', '20s'),
          transcription: fc.constantFrom(
            'मैं आम अचार बेचना चाहता हूं पांच सौ रुपये किलो',
            'मला मसाला डोसा विकायचा आहे दहा रुपये प्रति पीस',
            'I want to sell handmade pottery fifty rupees per piece'
          ),
          language: fc.constantFrom<'hi-IN' | 'mr-IN' | 'en-IN'>('hi-IN', 'mr-IN', 'en-IN'),
        }),
        async ({ phone, messageId, mediaId, voiceLength, transcription, language }) => {
          // Reset mocks for each iteration
          jest.clearAllMocks();

          // Mock audio download (instant)
          (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
            success: true,
            s3Url: `s3://test-bucket/audio/${messageId}.ogg`,
            mimeType: 'audio/ogg',
            size: 50000,
          });

          // Mock state manager
          (stateManager.getUserState as jest.Mock).mockResolvedValue(null);
          (stateManager.updateUserState as jest.Mock).mockResolvedValue(undefined);

          // Mock conversation memory
          (conversationMemory.addConversationMessage as jest.Mock).mockResolvedValue(undefined);
          (conversationMemory.getConversationContext as jest.Mock).mockResolvedValue({
            recentMessages: [],
            preferences: { preferredCategories: [], typicalPriceRange: null },
          });
          (conversationMemory.generateContextualResponse as jest.Mock).mockReturnValue('');
          (conversationMemory.updateUserPreferences as jest.Mock).mockResolvedValue(undefined);

          // Mock language manager
          (languageManager.storeLanguagePreference as jest.Mock).mockResolvedValue(undefined);
          (languageManager.generateMissingFieldsPrompt as jest.Mock).mockReturnValue('Please provide missing info');

          // Simulate realistic Lambda invocation delays based on voice length
          // These delays represent the SEQUENTIAL invocation overhead + processing time
          // Reduced for faster testing while maintaining the bug demonstration
          const delays = {
            '5s': { transcription: 200, intent: 150, entity: 175 }, // Total: ~525ms
            '10s': { transcription: 300, intent: 200, entity: 225 }, // Total: ~725ms
            '20s': { transcription: 1500, intent: 900, entity: 1000 }, // Total: ~3400ms (exceeds 3s)
          };

          const delay = delays[voiceLength as keyof typeof delays];

          // Track timestamps for each stage
          const timestamps: Record<string, number> = {};

          // Mock Lambda invocations with realistic delays
          (lambdaClient.send as jest.Mock)
            // Voice transcription
            .mockImplementationOnce(async () => {
              timestamps.transcriptionStart = Date.now();
              await new Promise(resolve => setTimeout(resolve, delay.transcription));
              timestamps.transcriptionEnd = Date.now();
              
              return {
                Payload: new TextEncoder().encode(JSON.stringify({
                  success: true,
                  transcription,
                  detectedLanguage: language,
                  confidence: 0.95,
                })),
              };
            })
            // Intent classification
            .mockImplementationOnce(async () => {
              timestamps.intentStart = Date.now();
              await new Promise(resolve => setTimeout(resolve, delay.intent));
              timestamps.intentEnd = Date.now();
              
              return {
                Payload: new TextEncoder().encode(JSON.stringify({
                  success: true,
                  intent: 'CREATE_CATALOG',
                  confidence: 0.92,
                })),
              };
            })
            // Entity extraction
            .mockImplementationOnce(async () => {
              timestamps.entityStart = Date.now();
              await new Promise(resolve => setTimeout(resolve, delay.entity));
              timestamps.entityEnd = Date.now();
              
              return {
                Payload: new TextEncoder().encode(JSON.stringify({
                  success: true,
                  entities: {
                    product_name: 'Test Product',
                    price: 500,
                    quantity: 5,
                    unit: 'kg',
                    category: 'food',
                  },
                  missingFields: [],
                })),
              };
            });

          // Mock partial data operations
          (partialDataStore.mergePartialData as jest.Mock).mockResolvedValue({
            phone,
            productName: 'Test Product',
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

          // Mock EventBridge
          (eventBridgeClient.send as jest.Mock).mockResolvedValue({
            Entries: [{ EventId: 'event-123' }],
          });

          // Execute voice handler and measure total time
          const startTime = Date.now();
          
          const event = {
            phone,
            messageId,
            mediaId,
          };

          const result = await voiceHandler(event);
          
          const endTime = Date.now();
          const totalTime = endTime - startTime;

          // Calculate individual stage times
          const transcriptionTime = timestamps.transcriptionEnd - timestamps.transcriptionStart;
          const intentTime = timestamps.intentEnd - timestamps.intentStart;
          const entityTime = timestamps.entityEnd - timestamps.entityStart;

          // Log timing details for debugging
          console.log(`\n=== Voice Latency Test: ${voiceLength} voice message ===`);
          console.log(`Total response time: ${totalTime}ms`);
          console.log(`Transcription time: ${transcriptionTime}ms`);
          console.log(`Intent classification time: ${intentTime}ms`);
          console.log(`Entity extraction time: ${entityTime}ms`);
          console.log(`Sequential overhead: ${totalTime - transcriptionTime - intentTime - entityTime}ms`);

          // Verify handler succeeded
          expect(result.success).toBe(true);

          // **CRITICAL ASSERTION**: Response time must be <= 3000ms
          // **ON UNFIXED CODE**: This will FAIL for longer voice messages (especially 20s)
          // **AFTER FIX**: This will PASS due to parallelization of intent + entity extraction
          if (totalTime > 3000) {
            counterexamples.push({
              voiceLength,
              totalTime,
              transcriptionTime,
              intentTime,
              entityTime,
            });
          }

          expect(totalTime).toBeLessThanOrEqual(3000);
        }
      ),
      { numRuns: 3 } // Test 3 different voice message scenarios
    );

    // If we collected counterexamples, log them for documentation
    if (counterexamples.length > 0) {
      console.log('\n=== COUNTEREXAMPLES FOUND (Bug Confirmed) ===');
      counterexamples.forEach((ex, idx) => {
        console.log(`\nCounterexample ${idx + 1}:`);
        console.log(`  Voice length: ${ex.voiceLength}`);
        console.log(`  Total time: ${ex.totalTime}ms (exceeds 3000ms by ${ex.totalTime - 3000}ms)`);
        console.log(`  Transcription: ${ex.transcriptionTime}ms`);
        console.log(`  Intent: ${ex.intentTime}ms`);
        console.log(`  Entity: ${ex.entityTime}ms`);
        console.log(`  Root cause: Sequential Lambda invocations causing cumulative latency`);
      });
      console.log('\n===========================================\n');
    }
  }, 30000); // 30 second timeout for property-based test

  /**
   * Focused test on 20-second voice messages (most likely to exceed 3s)
   * This test is designed to reliably surface the bug on unfixed code
   */
  it('should respond within 3000ms for 20-second voice messages', async () => {
    const counterexamples: Array<{
      messageId: string;
      totalTime: number;
      breakdown: string;
    }> = [];

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: fc.constant('+919876543210'),
          messageId: fc.uuid(),
          mediaId: fc.uuid(),
          transcription: fc.constant('मैं बीस सेकंड की लंबी आवाज संदेश भेज रहा हूं जिसमें बहुत सारी जानकारी है'),
          language: fc.constant<'hi-IN'>('hi-IN'),
        }),
        async ({ phone, messageId, mediaId, transcription, language }) => {
          jest.clearAllMocks();

          // Mock services
          (mediaDownload.downloadAudio as jest.Mock).mockResolvedValue({
            success: true,
            s3Url: `s3://test-bucket/audio/${messageId}.ogg`,
          });

          (stateManager.getUserState as jest.Mock).mockResolvedValue(null);
          (stateManager.updateUserState as jest.Mock).mockResolvedValue(undefined);

          (conversationMemory.addConversationMessage as jest.Mock).mockResolvedValue(undefined);
          (conversationMemory.getConversationContext as jest.Mock).mockResolvedValue({
            recentMessages: [],
            preferences: { preferredCategories: [], typicalPriceRange: null },
          });
          (conversationMemory.generateContextualResponse as jest.Mock).mockReturnValue('');
          (conversationMemory.updateUserPreferences as jest.Mock).mockResolvedValue(undefined);

          (languageManager.storeLanguagePreference as jest.Mock).mockResolvedValue(undefined);
          (languageManager.generateMissingFieldsPrompt as jest.Mock).mockReturnValue('Please provide missing info');

          // Simulate realistic delays for 20s voice message (SEQUENTIAL processing)
          // These delays will cause total time to exceed 3000ms on unfixed code
          // Reduced for faster testing while maintaining the bug demonstration
          const delays = {
            transcription: 1500, // Longer audio = longer transcription
            intent: 900,         // Intent classification overhead
            entity: 1000,        // Entity extraction overhead
          };

          const timestamps: Record<string, number> = {};

          (lambdaClient.send as jest.Mock)
            .mockImplementationOnce(async () => {
              timestamps.transcriptionStart = Date.now();
              await new Promise(resolve => setTimeout(resolve, delays.transcription));
              timestamps.transcriptionEnd = Date.now();
              
              return {
                Payload: new TextEncoder().encode(JSON.stringify({
                  success: true,
                  transcription,
                  detectedLanguage: language,
                  confidence: 0.95,
                })),
              };
            })
            .mockImplementationOnce(async () => {
              timestamps.intentStart = Date.now();
              await new Promise(resolve => setTimeout(resolve, delays.intent));
              timestamps.intentEnd = Date.now();
              
              return {
                Payload: new TextEncoder().encode(JSON.stringify({
                  success: true,
                  intent: 'CREATE_CATALOG',
                  confidence: 0.92,
                })),
              };
            })
            .mockImplementationOnce(async () => {
              timestamps.entityStart = Date.now();
              await new Promise(resolve => setTimeout(resolve, delays.entity));
              timestamps.entityEnd = Date.now();
              
              return {
                Payload: new TextEncoder().encode(JSON.stringify({
                  success: true,
                  entities: {
                    product_name: 'Test Product',
                    price: 500,
                    quantity: 5,
                    unit: 'kg',
                    category: 'food',
                  },
                  missingFields: [],
                })),
              };
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

          // Execute and measure
          const startTime = Date.now();
          const result = await voiceHandler({ phone, messageId, mediaId });
          const endTime = Date.now();
          const totalTime = endTime - startTime;

          const transcriptionTime = timestamps.transcriptionEnd - timestamps.transcriptionStart;
          const intentTime = timestamps.intentEnd - timestamps.intentStart;
          const entityTime = timestamps.entityEnd - timestamps.entityStart;

          console.log(`\n=== 20-Second Voice Message Test ===`);
          console.log(`Message ID: ${messageId}`);
          console.log(`Total response time: ${totalTime}ms`);
          console.log(`Breakdown:`);
          console.log(`  - Transcription: ${transcriptionTime}ms`);
          console.log(`  - Intent: ${intentTime}ms`);
          console.log(`  - Entity: ${entityTime}ms`);
          console.log(`  - Overhead: ${totalTime - transcriptionTime - intentTime - entityTime}ms`);

          expect(result.success).toBe(true);

          // **EXPECTED TO FAIL ON UNFIXED CODE**
          // 20s voice messages with sequential processing will exceed 3000ms
          if (totalTime > 3000) {
            const breakdown = `Transcription: ${transcriptionTime}ms, Intent: ${intentTime}ms, Entity: ${entityTime}ms`;
            counterexamples.push({
              messageId,
              totalTime,
              breakdown,
            });
          }

          expect(totalTime).toBeLessThanOrEqual(3000);
        }
      ),
      { numRuns: 2 }
    );

    // Document counterexamples
    if (counterexamples.length > 0) {
      console.log('\n=== COUNTEREXAMPLES: 20-Second Voice Messages ===');
      counterexamples.forEach((ex, idx) => {
        console.log(`\nCounterexample ${idx + 1}:`);
        console.log(`  Message ID: ${ex.messageId}`);
        console.log(`  Total time: ${ex.totalTime}ms (exceeds 3000ms)`);
        console.log(`  Breakdown: ${ex.breakdown}`);
        console.log(`  Issue: Sequential Lambda invocations cause cumulative latency`);
      });
      console.log('\n================================================\n');
    }
  }, 30000);
});
