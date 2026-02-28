/**
 * Property-Based Test: Intent Classification Completeness
 * 
 * **Validates: Requirements 2.2, 4.3**
 * 
 * Property 5: Intent Classification Completeness
 * For any transcribed text, the system should classify it into exactly one 
 * of the supported intents (CREATE_CATALOG, UPDATE_INVENTORY, ACCEPT_ORDER, 
 * REJECT_ORDER, UPDATE_FULFILLMENT, QUERY_STATUS) with a confidence score 
 * between 0.0 and 1.0.
 * 
 * This test verifies:
 * 1. Every transcribed text is classified into exactly one intent
 * 2. The intent is one of the six supported intent types
 * 3. Confidence score is always between 0.0 and 1.0
 * 4. Language is correctly identified as hi, mr, or en
 * 5. Low confidence (< 0.7) triggers clarification flag
 * 6. High confidence (>= 0.7) does not trigger clarification flag
 * 7. Classification succeeds for all supported languages
 */

import fc from 'fast-check';
import { handler as classifyIntent } from '../../src/lambdas/intent-classification';
import { mockClient } from 'aws-sdk-client-mock';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import {
  IntentClassificationRequest,
  IntentType,
} from '../../src/models/intent';

const bedrockMock = mockClient(BedrockRuntimeClient);

// Mock environment variables
process.env.AWS_REGION = 'ap-south-1';

describe('Property 5: Intent Classification Completeness', () => {
  beforeEach(() => {
    bedrockMock.reset();
    jest.clearAllMocks();
  });

  it('should classify any transcribed text into exactly one supported intent with valid confidence', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          intent: fc.constantFrom<IntentType>(
            'CREATE_CATALOG',
            'UPDATE_INVENTORY',
            'ACCEPT_ORDER',
            'REJECT_ORDER',
            'UPDATE_FULFILLMENT',
            'QUERY_STATUS'
          ),
          language: fc.constantFrom<'hi-IN' | 'mr-IN' | 'en-IN'>('hi-IN', 'mr-IN', 'en-IN'),
          confidence: fc.integer({ min: 70, max: 100 }).map(c => c / 100),
          transcribedText: fc.string({ minLength: 5, maxLength: 200 })
            .filter(s => s.trim().length >= 5),
          messageId: fc.uuid(),
          sellerId: fc.uuid(),
        }),
        async ({ intent, language, confidence, transcribedText, messageId, sellerId }) => {
          bedrockMock.reset();

          const langCode = language.split('-')[0] as 'hi' | 'mr' | 'en';
          const mockNovaResponse = {
            output: {
              message: {
                content: [{ text: JSON.stringify({ intent, confidence, language: langCode }) }],
              },
            },
          };

          bedrockMock.on(InvokeModelCommand).resolves({
            body: new TextEncoder().encode(JSON.stringify(mockNovaResponse)) as any,
          });

          const request: IntentClassificationRequest = {
            transcribedText,
            language,
            messageId,
            sellerId,
          };

          const response = await classifyIntent(request);

          // Property 1: Classification succeeds
          expect(response.success).toBe(true);

          // Property 2: Exactly one intent is returned
          expect(response.intent).toBeDefined();
          expect(typeof response.intent).toBe('string');

          // Property 3: Intent is one of the six supported types
          const validIntents: IntentType[] = [
            'CREATE_CATALOG',
            'UPDATE_INVENTORY',
            'ACCEPT_ORDER',
            'REJECT_ORDER',
            'UPDATE_FULFILLMENT',
            'QUERY_STATUS',
          ];
          expect(validIntents).toContain(response.intent);

          // Property 4: Confidence score is between 0.0 and 1.0
          expect(response.confidence).toBeDefined();
          expect(response.confidence).toBeGreaterThanOrEqual(0.0);
          expect(response.confidence).toBeLessThanOrEqual(1.0);

          // Property 5: Language is correctly identified
          expect(response.language).toBeDefined();
          expect(['hi', 'mr', 'en']).toContain(response.language);

          // Property 6: High confidence does not trigger clarification
          expect(response.needsClarification).toBe(false);

          // Property 7: No error is present
          expect(response.error).toBeUndefined();
        }
      ),
      { numRuns: 5 }
    );
  }, 30000);

  it('should flag for clarification when confidence is below 0.7', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          intent: fc.constantFrom<IntentType>(
            'CREATE_CATALOG',
            'UPDATE_INVENTORY',
            'ACCEPT_ORDER',
            'REJECT_ORDER',
            'UPDATE_FULFILLMENT',
            'QUERY_STATUS'
          ),
          language: fc.constantFrom('hi', 'mr', 'en'),
          confidence: fc.integer({ min: 0, max: 69 }).map(c => c / 100),
          transcribedText: fc.string({ minLength: 5, maxLength: 200 })
            .filter(s => s.trim().length >= 5),
          messageId: fc.uuid(),
        }),
        async ({ intent, language, confidence, transcribedText, messageId }) => {
          bedrockMock.reset();

          const mockNovaResponse = {
            output: {
              message: {
                content: [{ text: JSON.stringify({ intent, confidence, language }) }],
              },
            },
          };

          bedrockMock.on(InvokeModelCommand).resolves({
            body: new TextEncoder().encode(JSON.stringify(mockNovaResponse)) as any,
          });

          const request: IntentClassificationRequest = { transcribedText, messageId };
          const response = await classifyIntent(request);

          expect(response.success).toBe(true);
          expect(response.intent).toBeDefined();
          expect(response.confidence).toBeLessThan(0.7);
          expect(response.needsClarification).toBe(true);
          expect(['hi', 'mr', 'en']).toContain(response.language);
        }
      ),
      { numRuns: 5 }
    );
  }, 30000);

  it('should handle edge cases in confidence scores', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          intent: fc.constantFrom<IntentType>(
            'CREATE_CATALOG',
            'UPDATE_INVENTORY',
            'ACCEPT_ORDER',
            'REJECT_ORDER',
            'UPDATE_FULFILLMENT',
            'QUERY_STATUS'
          ),
          language: fc.constantFrom('hi', 'mr', 'en'),
          confidence: fc.constantFrom(0.0, 0.69, 0.7, 0.99, 1.0),
          transcribedText: fc.string({ minLength: 5, maxLength: 100 })
            .filter(s => s.trim().length >= 5),
        }),
        async ({ intent, language, confidence, transcribedText }) => {
          bedrockMock.reset();

          const mockNovaResponse = {
            output: {
              message: {
                content: [{ text: JSON.stringify({ intent, confidence, language }) }],
              },
            },
          };

          bedrockMock.on(InvokeModelCommand).resolves({
            body: new TextEncoder().encode(JSON.stringify(mockNovaResponse)) as any,
          });

          const request: IntentClassificationRequest = { transcribedText };
          const response = await classifyIntent(request);

          expect(response.success).toBe(true);
          expect(response.confidence).toBe(confidence);

          if (confidence < 0.7) {
            expect(response.needsClarification).toBe(true);
          } else {
            expect(response.needsClarification).toBe(false);
          }

          expect(response.confidence).toBeGreaterThanOrEqual(0.0);
          expect(response.confidence).toBeLessThanOrEqual(1.0);
        }
      ),
      { numRuns: 5 }
    );
  }, 30000);

  it('should return error for empty or invalid transcribed text', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('', '   ', '\n\n', '\t\t'),
        async (invalidText) => {
          const request: IntentClassificationRequest = { transcribedText: invalidText };
          const response = await classifyIntent(request);

          expect(response.success).toBe(false);
          expect(response.error).toBeDefined();
          // Empty string throws "No text content found in event"
          // Whitespace-only throws "Transcribed text is required"
          expect(
            response.error?.message === 'No text content found in event' ||
            response.error?.message === 'Transcribed text is required'
          ).toBe(true);
          expect(response.intent).toBeUndefined();
          expect(response.confidence).toBeUndefined();
        }
      ),
      { numRuns: 5 }
    );
  }, 30000);
});
