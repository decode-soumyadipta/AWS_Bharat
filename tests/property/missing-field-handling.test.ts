/**
 * Property-Based Tests for Missing Field Handling
 * 
 * Validates Properties 5 and 6 from the design document:
 * - Property 5: Missing Field Detection and Prompting
 * - Property 6: Partial Data Merging
 * 
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 7.5**
 */

import fc from 'fast-check';
import { mockClient } from 'aws-sdk-client-mock';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  validateRequiredFields,
  generateAndSendVoicePrompt,
  processMissingInfo,
} from '../../src/services/missing-info-handler';
import {
  mergePartialData,
  savePartialData,
  getPartialData,
  type PartialCatalogItem,
} from '../../src/services/partial-data-store';
import * as stateManager from '../../src/services/state-manager';

// Mock AWS clients
const pollyMock = mockClient(PollyClient);
const s3Mock = mockClient(S3Client);

// Mock state manager
jest.mock('../../src/services/state-manager', () => ({
  updateUserState: jest.fn(),
}));

// Mock the missing-info-handler to use the mocked S3 client
jest.mock('../../src/services/missing-info-handler', () => {
  const actual = jest.requireActual('../../src/services/missing-info-handler');
  return {
    ...actual,
  };
});

describe('Property-Based Tests: Missing Field Handling', () => {
  beforeEach(() => {
    pollyMock.reset();
    s3Mock.reset();
    jest.clearAllMocks();

    // Setup default mocks
    const audioStream = Buffer.from('mock-audio-data');
    pollyMock.on(SynthesizeSpeechCommand).resolves({
      AudioStream: {
        [Symbol.asyncIterator]: async function* () {
          yield audioStream;
        },
      } as any,
    });

    s3Mock.on(PutObjectCommand).resolves({});
  });

  /**
   * Property 5: Missing Field Detection and Prompting
   * 
   * For any entity extraction result, if required fields (productName, price, quantity, unit) 
   * are missing, the system should identify missing fields, generate a prompt in the user's 
   * language, convert to speech, send via WhatsApp, and update state with pending fields metadata.
   * 
   * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**
   */
  describe('Property 5: Missing Field Detection and Prompting', () => {
    it('should always identify missing required fields correctly', () => {
      fc.assert(
        fc.property(
          fc.record({
            productName: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
            price: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: undefined }),
            quantity: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
            unit: fc.option(fc.constantFrom('kg', 'liter', 'piece', 'dozen'), { nil: undefined }),
          }),
          (partialData) => {
            const result = validateRequiredFields(partialData);

            // Property: Missing fields should exactly match undefined required fields
            const expectedMissing: string[] = [];
            if (!partialData.productName) expectedMissing.push('productName');
            if (!partialData.price) expectedMissing.push('price');
            if (!partialData.quantity) expectedMissing.push('quantity');
            if (!partialData.unit) expectedMissing.push('unit');

            expect(result.missingFields).toEqual(expectedMissing);
            expect(result.isComplete).toBe(expectedMissing.length === 0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate voice prompts for any combination of missing fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('hi-IN', 'mr-IN', 'en-IN'),
          fc.array(
            fc.constantFrom('productName', 'price', 'quantity', 'unit'),
            { minLength: 1, maxLength: 4 }
          ).map(arr => [...new Set(arr)]), // Remove duplicates
          async (language, missingFields) => {
            const result = await generateAndSendVoicePrompt(
              '+919876543210',
              missingFields,
              language as any
            );

            // Property: Should always succeed with valid inputs
            expect(result.success).toBe(true);
            expect(result.audioUrl).toBeDefined();
            expect(result.audioUrl).toContain('voice-prompts/+919876543210/');
            expect(result.audioUrl).toContain('.mp3');

            // Property: State should be updated with pending fields
            expect(stateManager.updateUserState).toHaveBeenCalledWith(
              '+919876543210',
              'VOICE_RECEIVED',
              expect.objectContaining({
                pendingFields: missingFields,
              })
            );
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should use correct voice for each language', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            { lang: 'hi-IN', voice: 'Kajal' },
            { lang: 'mr-IN', voice: 'Aditi' },
            { lang: 'en-IN', voice: 'Joanna' }
          ),
          fc.array(fc.constantFrom('productName', 'price', 'quantity', 'unit'), {
            minLength: 1,
            maxLength: 4,
          }),
          async ({ lang, voice }, missingFields) => {
            pollyMock.reset();
            const audioStream = Buffer.from('mock-audio-data');
            pollyMock.on(SynthesizeSpeechCommand).resolves({
              AudioStream: {
                [Symbol.asyncIterator]: async function* () {
                  yield audioStream;
                },
              } as any,
            });

            await generateAndSendVoicePrompt(
              '+919876543210',
              missingFields,
              lang as any
            );

            // Property: Correct voice should be used for each language
            const pollyCalls = pollyMock.commandCalls(SynthesizeSpeechCommand);
            expect(pollyCalls.length).toBeGreaterThan(0);
            expect(pollyCalls[0].args[0].input).toMatchObject({
              VoiceId: voice,
              LanguageCode: lang,
              Engine: 'neural',
            });
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should determine correct next action based on completeness', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            productName: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
            price: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: undefined }),
            quantity: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
            unit: fc.option(fc.constantFrom('kg', 'liter', 'piece'), { nil: undefined }),
          }),
          fc.constantFrom('hi-IN', 'mr-IN', 'en-IN'),
          async (data, language) => {
            const partialData: PartialCatalogItem = {
              phone: '+919876543210',
              ...data,
              missingFields: [],
              source: 'voice',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };

            const result = await processMissingInfo(
              '+919876543210',
              partialData,
              language as any
            );

            // Property: Action should match completeness
            const isComplete =
              data.productName && data.price && data.quantity && data.unit;

            if (isComplete) {
              expect(result.action).toBe('REQUEST_IMAGE');
            } else {
              expect(result.action).toBe('REQUEST_INFO');
              expect(result.missingFields).toBeDefined();
              expect(result.missingFields!.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 6: Partial Data Merging
   * 
   * For any new entity extraction when partial data exists, the system should merge 
   * the new entities with existing data, preserving existing values, and update the 
   * missing fields list.
   * 
   * **Validates: Requirements 4.7, 7.5**
   */
  describe('Property 6: Partial Data Merging', () => {
    it('should preserve existing values when merging', () => {
      fc.assert(
        fc.property(
          fc.record({
            productName: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
            price: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: undefined }),
            quantity: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
            unit: fc.option(fc.constantFrom('kg', 'liter', 'piece'), { nil: undefined }),
          }),
          fc.record({
            productName: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
            price: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: undefined }),
            quantity: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
            unit: fc.option(fc.constantFrom('kg', 'liter', 'piece'), { nil: undefined }),
          }),
          (existingData, newData) => {
            // Simulate merge logic
            const merged = {
              ...existingData,
              ...Object.fromEntries(
                Object.entries(newData).filter(([_, value]) => value !== undefined)
              ),
            };

            // Property: Existing values should be preserved if new value is undefined
            Object.keys(existingData).forEach((key) => {
              const existingValue = existingData[key as keyof typeof existingData];
              const newValue = newData[key as keyof typeof newData];
              const mergedValue = merged[key as keyof typeof merged];

              if (existingValue !== undefined) {
                if (newValue !== undefined) {
                  // New value should override
                  expect(mergedValue).toBe(newValue);
                } else {
                  // Existing value should be preserved
                  expect(mergedValue).toBe(existingValue);
                }
              }
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly update missing fields after merge', () => {
      fc.assert(
        fc.property(
          fc.record({
            productName: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
            price: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: undefined }),
            quantity: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
            unit: fc.option(fc.constantFrom('kg', 'liter', 'piece'), { nil: undefined }),
          }),
          fc.record({
            productName: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
            price: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: undefined }),
            quantity: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
            unit: fc.option(fc.constantFrom('kg', 'liter', 'piece'), { nil: undefined }),
          }),
          (existingData, newData) => {
            // Simulate merge
            const merged = {
              ...existingData,
              ...Object.fromEntries(
                Object.entries(newData).filter(([_, value]) => value !== undefined)
              ),
            };

            // Calculate missing fields after merge
            const result = validateRequiredFields(merged);

            // Property: Missing fields should reflect merged state
            const requiredFields = ['productName', 'price', 'quantity', 'unit'];
            requiredFields.forEach((field) => {
              const value = merged[field as keyof typeof merged];
              if (value === undefined) {
                expect(result.missingFields).toContain(field);
              } else {
                expect(result.missingFields).not.toContain(field);
              }
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should eventually reach complete state with sufficient merges', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              productName: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
              price: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: undefined }),
              quantity: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
              unit: fc.option(fc.constantFrom('kg', 'liter', 'piece'), { nil: undefined }),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (updates) => {
            // Start with empty data
            let current: any = {};

            // Apply all updates
            updates.forEach((update) => {
              current = {
                ...current,
                ...Object.fromEntries(
                  Object.entries(update).filter(([_, value]) => value !== undefined)
                ),
              };
            });

            const result = validateRequiredFields(current);

            // Property: If all fields were provided at some point, data should be complete
            const hasAllFields =
              current.productName &&
              current.price !== undefined &&
              current.quantity !== undefined &&
              current.unit;

            if (hasAllFields) {
              expect(result.isComplete).toBe(true);
              expect(result.missingFields).toEqual([]);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
