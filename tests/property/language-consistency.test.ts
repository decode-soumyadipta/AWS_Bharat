/**
 * Property-Based Test: Language Consistency
 * 
 * **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**
 * 
 * Property 9: Language Consistency
 * For any user interaction after language detection, all text responses, voice responses,
 * and prompts should use the stored language preference, defaulting to Hindi if no
 * preference exists.
 * 
 * This test verifies:
 * 1. Language is detected and stored from voice transcription
 * 2. Text responses use the stored language preference
 * 3. Voice responses use the stored language preference
 * 4. System defaults to Hindi when no language preference exists
 * 5. Language preference is updated when user switches languages
 * 6. All message templates are available in all supported languages
 * 7. Message translations are consistent across all message types
 */

import fc from 'fast-check';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  detectLanguage,
  storeLanguagePreference,
  getLanguagePreference,
  translateMessage,
  generateMissingFieldsPrompt,
  formatCatalogDetails,
  type SupportedLanguage,
  type MessageKey,
} from '../../src/services/language-manager';

const dynamoMock = mockClient(DynamoDBDocumentClient);

// Mock environment variables
process.env.TABLE_NAME = 'test-table';

describe('Property 9: Language Consistency', () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
  });

  it('should detect and store language from transcription', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
          transcription: fc.oneof(
            // Hindi text with Devanagari script
            fc.constantFrom(
              'मुझे आम चाहिए',
              'यह कितने का है',
              'मैं उत्पाद बेचना चाहता हूं'
            ),
            // Marathi text with Devanagari script and Marathi-specific words
            fc.constantFrom(
              'मला आंबे हवे आहे',
              'हे किती आहे',
              'मी उत्पादन विकायचे नाही'
            ),
            // English text
            fc.constantFrom(
              'I want mangoes',
              'What is the price',
              'I want to sell products'
            )
          ),
        }),
        async ({ phone, transcription }) => {
          // Reset mock for each iteration
          dynamoMock.reset();

          // Detect language from transcription
          const detectedLanguage = detectLanguage(transcription);

          // Verify language is one of the supported languages
          expect(['hi-IN', 'mr-IN', 'en-IN']).toContain(detectedLanguage);

          // Verify language detection is consistent with content
          if (transcription.includes('आहे') || transcription.includes('नाही') || transcription.includes('काय')) {
            expect(detectedLanguage).toBe('mr-IN');
          } else if (/[\u0900-\u097F]/.test(transcription)) {
            expect(detectedLanguage).toBe('hi-IN');
          } else {
            expect(detectedLanguage).toBe('en-IN');
          }

          // Mock UpdateCommand for storing language preference
          dynamoMock.on(UpdateCommand).resolves({});

          // Store language preference
          await storeLanguagePreference(phone, detectedLanguage);

          // Verify UpdateCommand was called with correct parameters
          const updateCalls = dynamoMock.commandCalls(UpdateCommand);
          expect(updateCalls.length).toBeGreaterThan(0);

          const lastCall = updateCalls[updateCalls.length - 1];
          const input = lastCall.args[0].input;

          // Verify language was stored
          expect(input.Key).toEqual({
            PK: `USER#${phone}`,
            SK: 'STATE',
          });
          expect(input.ExpressionAttributeValues).toHaveProperty(':language', detectedLanguage);
          expect(input.ExpressionAttributeValues).toHaveProperty(':updatedAt');
        }
      ),
      { numRuns: 5 }
    );
  }, 30000);

  it('should use stored language preference for all responses', async () => {
    await fc.assert(
      fc.property(
        fc.record({
          language: fc.constantFrom<SupportedLanguage>('hi-IN', 'mr-IN', 'en-IN'),
          messageKey: fc.constantFrom<MessageKey>(
            'KYC_SUCCESS',
            'KYC_ERROR',
            'IMAGE_REQUEST',
            'CATALOG_SUCCESS',
            'DOCUMENT_UNCLEAR',
            'AUDIO_TOO_LARGE',
            'UNEXPECTED_STATE',
            'HELP_MESSAGE'
          ),
        }),
        ({ language, messageKey }) => {
          // Get message in user's language
          const message = translateMessage(messageKey, language);

          // Verify message is not empty
          expect(message).toBeTruthy();
          expect(message.length).toBeGreaterThan(0);

          // Verify message is in the correct language
          // Hindi and Marathi use Devanagari script
          if (language === 'hi-IN' || language === 'mr-IN') {
            expect(/[\u0900-\u097F]/.test(message)).toBe(true);
          } else {
            // English should not contain Devanagari
            expect(/[\u0900-\u097F]/.test(message)).toBe(false);
          }

          // Verify the same message key returns different text for different languages
          const allLanguages: SupportedLanguage[] = ['hi-IN', 'mr-IN', 'en-IN'];
          const messages = allLanguages.map(lang => translateMessage(messageKey, lang));
          
          // All messages should be defined
          messages.forEach(msg => {
            expect(msg).toBeTruthy();
            expect(msg.length).toBeGreaterThan(0);
          });

          // Messages in different languages should be different (unless it's a very short message)
          if (messages[0].length > 5) {
            const uniqueMessages = new Set(messages);
            expect(uniqueMessages.size).toBeGreaterThan(1);
          }
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should default to Hindi when no language preference exists', async () => {
    await fc.assert(
      fc.property(
        fc.constantFrom<MessageKey>(
          'KYC_SUCCESS',
          'IMAGE_REQUEST',
          'CATALOG_SUCCESS',
          'HELP_MESSAGE'
        ),
        (messageKey) => {
          // Get message without language preference
          const messageWithoutLang = translateMessage(messageKey);
          
          // Get message explicitly with Hindi
          const messageWithHindi = translateMessage(messageKey, 'hi-IN');

          // Verify they are the same (defaults to Hindi)
          expect(messageWithoutLang).toBe(messageWithHindi);

          // Verify it's in Hindi (contains Devanagari script)
          expect(/[\u0900-\u097F]/.test(messageWithoutLang)).toBe(true);

          // Verify getLanguagePreference defaults to Hindi
          const defaultLang = getLanguagePreference();
          expect(defaultLang).toBe('hi-IN');

          const defaultLangUndefined = getLanguagePreference(undefined);
          expect(defaultLangUndefined).toBe('hi-IN');
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should generate missing field prompts in user language', async () => {
    await fc.assert(
      fc.property(
        fc.record({
          language: fc.constantFrom<SupportedLanguage>('hi-IN', 'mr-IN', 'en-IN'),
          missingFields: fc.array(
            fc.constantFrom('productName', 'price', 'quantity', 'unit'),
            { minLength: 1, maxLength: 4 }
          ).map(arr => Array.from(new Set(arr))), // Remove duplicates
        }),
        ({ language, missingFields }) => {
          // Generate prompt for missing fields
          const prompt = generateMissingFieldsPrompt(missingFields, language);

          // Verify prompt is not empty
          expect(prompt).toBeTruthy();
          expect(prompt.length).toBeGreaterThan(0);

          // Verify prompt is in the correct language
          if (language === 'hi-IN' || language === 'mr-IN') {
            expect(/[\u0900-\u097F]/.test(prompt)).toBe(true);
          } else {
            expect(/[\u0900-\u097F]/.test(prompt)).toBe(false);
          }

          // Verify all missing fields are addressed in the prompt
          missingFields.forEach(field => {
            // Map field names to message keys
            const messageKeyMap: Record<string, MessageKey> = {
              'productName': 'MISSING_PRODUCT_NAME',
              'price': 'MISSING_PRICE',
              'quantity': 'MISSING_QUANTITY',
              'unit': 'MISSING_UNIT',
            };
            
            const messageKey = messageKeyMap[field];
            if (messageKey) {
              const fieldMessage = translateMessage(messageKey, language);
              // The prompt should contain the field-specific message
              expect(prompt).toContain(fieldMessage);
            }
          });

          // Verify prompt length increases with more missing fields
          if (missingFields.length > 1) {
            const singleFieldPrompt = generateMissingFieldsPrompt([missingFields[0]], language);
            expect(prompt.length).toBeGreaterThan(singleFieldPrompt.length);
          }
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should format catalog details in user language', async () => {
    await fc.assert(
      fc.property(
        fc.record({
          language: fc.constantFrom<SupportedLanguage>('hi-IN', 'mr-IN', 'en-IN'),
          catalogItem: fc.record({
            productName: fc.option(fc.string({ minLength: 3, maxLength: 50 }), { nil: undefined }),
            price: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: undefined }),
            quantity: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
            unit: fc.option(fc.constantFrom('kg', 'liter', 'piece', 'dozen'), { nil: undefined }),
            category: fc.option(fc.constantFrom('food', 'clothing', 'electronics'), { nil: undefined }),
            description: fc.option(fc.string({ minLength: 10, maxLength: 200 }), { nil: undefined }),
          }),
        }),
        ({ language, catalogItem }) => {
          // Format catalog details
          const formatted = formatCatalogDetails(catalogItem, language);

          // If no fields are present, formatted should be empty
          const hasAnyField = Object.values(catalogItem).some(v => v !== undefined);
          if (!hasAnyField) {
            expect(formatted).toBe('');
            return;
          }

          // Verify formatted output is not empty when fields exist
          expect(formatted).toBeTruthy();

          // Verify formatted output is in the correct language
          if (language === 'hi-IN' || language === 'mr-IN') {
            expect(/[\u0900-\u097F]/.test(formatted)).toBe(true);
          }

          // Verify all present fields are included in formatted output
          if (catalogItem.productName) {
            expect(formatted).toContain(catalogItem.productName);
          }
          if (catalogItem.price !== undefined) {
            expect(formatted).toContain(`₹${catalogItem.price}`);
          }
          if (catalogItem.quantity !== undefined && catalogItem.unit) {
            expect(formatted).toContain(`${catalogItem.quantity}`);
            expect(formatted).toContain(catalogItem.unit);
          }
          if (catalogItem.category) {
            expect(formatted).toContain(catalogItem.category);
          }
          if (catalogItem.description) {
            expect(formatted).toContain(catalogItem.description);
          }

          // Verify format uses newlines to separate fields
          if (hasAnyField) {
            const lines = formatted.split('\n').filter(line => line.trim().length > 0);
            expect(lines.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should maintain language consistency across multiple interactions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
          initialLanguage: fc.constantFrom<SupportedLanguage>('hi-IN', 'mr-IN', 'en-IN'),
          interactions: fc.array(
            fc.constantFrom<MessageKey>(
              'KYC_SUCCESS',
              'IMAGE_REQUEST',
              'MISSING_PRODUCT_NAME',
              'MISSING_PRICE',
              'CATALOG_SUCCESS'
            ),
            { minLength: 2, maxLength: 5 }
          ),
        }),
        async ({ phone, initialLanguage, interactions }) => {
          // Reset mock for each iteration
          dynamoMock.reset();

          // Mock UpdateCommand for storing language
          dynamoMock.on(UpdateCommand).resolves({});

          // Store initial language preference
          await storeLanguagePreference(phone, initialLanguage);

          // Generate messages for all interactions
          const messages = interactions.map(messageKey => 
            translateMessage(messageKey, initialLanguage)
          );

          // Verify all messages are in the same language
          messages.forEach(message => {
            expect(message).toBeTruthy();
            
            // All messages should be in the same script
            if (initialLanguage === 'hi-IN' || initialLanguage === 'mr-IN') {
              expect(/[\u0900-\u097F]/.test(message)).toBe(true);
            } else {
              expect(/[\u0900-\u097F]/.test(message)).toBe(false);
            }
          });

          // Verify language preference was stored
          const updateCalls = dynamoMock.commandCalls(UpdateCommand);
          expect(updateCalls.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 5 }
    );
  }, 30000);

  it('should update language preference when user switches languages', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
          languages: fc.array(
            fc.constantFrom<SupportedLanguage>('hi-IN', 'mr-IN', 'en-IN'),
            { minLength: 2, maxLength: 3 }
          ).filter(langs => new Set(langs).size > 1), // Ensure at least one language switch
        }),
        async ({ phone, languages }) => {
          // Reset mock for each iteration
          dynamoMock.reset();

          // Mock UpdateCommand
          dynamoMock.on(UpdateCommand).resolves({});

          // Store each language preference in sequence
          for (const language of languages) {
            await storeLanguagePreference(phone, language);
          }

          // Verify UpdateCommand was called for each language change
          const updateCalls = dynamoMock.commandCalls(UpdateCommand);
          expect(updateCalls.length).toBe(languages.length);

          // Verify each call stored the correct language
          updateCalls.forEach((call, index) => {
            const input = call.args[0].input;
            expect(input.ExpressionAttributeValues).toHaveProperty(':language', languages[index]);
          });
        }
      ),
      { numRuns: 5 }
    );
  }, 30000);

  it('should have all message templates available in all supported languages', async () => {
    await fc.assert(
      fc.property(
        fc.constantFrom<MessageKey>(
          'WELCOME_MESSAGE',
          'KYC_SUCCESS',
          'KYC_ERROR',
          'KYC_INVALID_DOCUMENT',
          'IMAGE_REQUEST',
          'CATALOG_SUCCESS',
          'DOCUMENT_UNCLEAR',
          'AUDIO_TOO_LARGE',
          'IMAGE_TOO_LARGE',
          'UNEXPECTED_STATE',
          'MISSING_PRODUCT_NAME',
          'MISSING_PRICE',
          'MISSING_QUANTITY',
          'MISSING_UNIT',
          'CONFIRMATION_TEXT',
          'EDIT_PROMPT',
          'HELP_MESSAGE'
        ),
        (messageKey) => {
          const languages: SupportedLanguage[] = ['hi-IN', 'mr-IN', 'en-IN'];

          // Verify message exists in all languages
          languages.forEach(language => {
            const message = translateMessage(messageKey, language);
            
            // Message should not be empty
            expect(message).toBeTruthy();
            expect(message.length).toBeGreaterThan(0);

            // Message should be in the correct language
            if (language === 'hi-IN' || language === 'mr-IN') {
              expect(/[\u0900-\u097F]/.test(message)).toBe(true);
            } else {
              // English messages should not contain Devanagari
              // (unless they contain product names or other user data)
              if (!messageKey.includes('CONFIRMATION')) {
                expect(/[\u0900-\u097F]/.test(message)).toBe(false);
              }
            }
          });

          // Verify messages are different across languages
          const messages = languages.map(lang => translateMessage(messageKey, lang));
          const uniqueMessages = new Set(messages);
          
          // At least 2 different translations should exist
          // (Hindi and Marathi might be similar for very short messages)
          expect(uniqueMessages.size).toBeGreaterThanOrEqual(2);
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should support parameter substitution in templates while maintaining language', async () => {
    await fc.assert(
      fc.property(
        fc.record({
          language: fc.constantFrom<SupportedLanguage>('hi-IN', 'mr-IN', 'en-IN'),
          catalogDetails: fc.string({ minLength: 10, maxLength: 100 })
            .filter(s => !s.includes('{') && !s.includes('}')), // Avoid template syntax in test data
        }),
        ({ language, catalogDetails }) => {
          // Generate confirmation message with parameters
          const message = translateMessage(
            'CONFIRMATION_TEXT',
            language,
            { details: catalogDetails }
          );

          // Verify message does not contain the template placeholder
          expect(message).not.toContain('{details}');

          // Verify message contains the substituted parameter
          expect(message).toContain(catalogDetails);

          // Verify message is in the correct language
          if (language === 'hi-IN' || language === 'mr-IN') {
            expect(/[\u0900-\u097F]/.test(message)).toBe(true);
          }

          // Verify template structure is maintained
          expect(message.length).toBeGreaterThan(catalogDetails.length);
        }
      ),
      { numRuns: 5 }
    );
  });
});
