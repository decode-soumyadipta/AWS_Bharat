/**
 * Property-Based Tests for Confirmation and Approval Flow
 * 
 * **Property 8: Confirmation and Approval Flow**
 * 
 * For any complete catalog item in CONFIRMATION_PENDING state, the system should:
 * - Generate text and voice confirmations in the user's language
 * - Send with approve/edit buttons
 * - Upon approval: create catalog entry, broadcast to ONDC, transition to ACTIVE,
 *   delete partial data, and send success message
 * 
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.6, 6.8, 6.9, 7.8**
 */

import fc from 'fast-check';
import { generateConfirmation, processApproval, processEdit } from '../../src/lambdas/confirmation-handler';
import * as stateManager from '../../src/services/state-manager';
import * as partialDataStore from '../../src/services/partial-data-store';
import * as whatsappSender from '../../src/lambdas/whatsapp-message-sender';
import { PartialCatalogItem } from '../../src/services/partial-data-store';
import { SupportedLanguage } from '../../src/services/language-manager';

// Mock dependencies
jest.mock('../../src/services/state-manager');
jest.mock('../../src/services/partial-data-store');
jest.mock('../../src/lambdas/whatsapp-message-sender');
jest.mock('../../src/config/aws-clients', () => ({
  eventBridgeClient: {
    send: jest.fn().mockResolvedValue({}),
  },
  s3Client: {
    send: jest.fn().mockResolvedValue({}),
  },
  PRODUCTS_BUCKET_NAME: 'test-bucket',
}));

// Mock Polly client
jest.mock('@aws-sdk/client-polly', () => ({
  PollyClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({
      AudioStream: {
        async *[Symbol.asyncIterator]() {
          yield Buffer.from('mock audio data');
        },
      },
    }),
  })),
  SynthesizeSpeechCommand: jest.fn(),
}));

describe('Property 8: Confirmation and Approval Flow', () => {
  // Helper function to reset mocks between property test iterations
  const resetMocksForIteration = () => {
    // Only clear specific mocks, not all mocks (to preserve module-level mocks like Polly)
    (stateManager.updateUserState as jest.Mock).mockClear();
    (stateManager.updateUserState as jest.Mock).mockImplementation(() => Promise.resolve());
    
    (partialDataStore.deletePartialData as jest.Mock).mockClear();
    (partialDataStore.deletePartialData as jest.Mock).mockImplementation(() => Promise.resolve());
    
    (whatsappSender.sendInteractiveMessage as jest.Mock).mockClear();
    (whatsappSender.sendInteractiveMessage as jest.Mock).mockImplementation(() => Promise.resolve({ success: true }));
    
    (whatsappSender.sendTextMessage as jest.Mock).mockClear();
    (whatsappSender.sendTextMessage as jest.Mock).mockImplementation(() => Promise.resolve({ success: true }));
    
    // Reset AWS client mocks
    const { eventBridgeClient, s3Client } = require('../../src/config/aws-clients');
    if (eventBridgeClient?.send) {
      eventBridgeClient.send.mockClear();
      eventBridgeClient.send.mockImplementation(() => Promise.resolve({}));
    }
    if (s3Client?.send) {
      s3Client.send.mockClear();
      s3Client.send.mockImplementation(() => Promise.resolve({}));
    }
  };
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
    
    // Setup default mocks with proper implementations
    (stateManager.updateUserState as jest.Mock).mockImplementation(() => Promise.resolve());
    (partialDataStore.deletePartialData as jest.Mock).mockImplementation(() => Promise.resolve());
    (whatsappSender.sendInteractiveMessage as jest.Mock).mockImplementation(() => Promise.resolve({ success: true }));
    (whatsappSender.sendTextMessage as jest.Mock).mockImplementation(() => Promise.resolve({ success: true }));
    
    // Reset AWS client mocks
    const { eventBridgeClient, s3Client } = require('../../src/config/aws-clients');
    if (eventBridgeClient?.send) {
      eventBridgeClient.send.mockReset();
      eventBridgeClient.send.mockImplementation(() => Promise.resolve({}));
    }
    if (s3Client?.send) {
      s3Client.send.mockReset();
      s3Client.send.mockImplementation(() => Promise.resolve({}));
    }
  });

  /**
   * Arbitrary for generating phone numbers
   */
  const phoneArbitrary = fc.integer({ min: 1000000000, max: 9999999999 }).map(n => `+91${n}`);

  /**
   * Arbitrary for generating supported languages
   */
  const languageArbitrary = fc.constantFrom<SupportedLanguage>('hi-IN', 'mr-IN', 'en-IN');

  /**
   * Arbitrary for generating complete partial catalog items
   */
  const completePartialDataArbitrary = phoneArbitrary.chain(phone =>
    fc.record({
      phone: fc.constant(phone),
      productName: fc.string({ minLength: 3, maxLength: 50 }).filter(s => s.trim().length > 0),
      price: fc.integer({ min: 1, max: 100000 }),
      quantity: fc.integer({ min: 1, max: 1000 }),
      unit: fc.constantFrom('kg', 'liter', 'piece', 'dozen'),
      category: fc.constantFrom('food', 'grocery', 'handicraft', 'textile', 'other'),
      description: fc.option(fc.string({ minLength: 10, maxLength: 200 }), { nil: undefined }),
      originalImageUrl: fc.option(fc.webUrl(), { nil: undefined }),
      enhancedImageUrl: fc.option(fc.webUrl(), { nil: undefined }),
    }).map(data => ({
      ...data,
      missingFields: [] as string[],
      source: 'voice' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }))
  );

  it('Property 8.1: Confirmation generation includes text summary and buttons', () => {
    fc.assert(
      fc.asyncProperty(
        completePartialDataArbitrary,
        languageArbitrary,
        async (partialData, language) => {
          // Use helper to reset mocks
          resetMocksForIteration();
          
          // Generate confirmation
          const result = await generateConfirmation(partialData.phone, partialData, language);

          // Should have text summary
          expect(result.textSummary).toBeDefined();
          expect(result.textSummary.length).toBeGreaterThan(0);

          // Should contain product details
          if (partialData.productName) {
            expect(result.textSummary).toContain(partialData.productName);
          }
          if (partialData.price !== undefined) {
            expect(result.textSummary).toContain(partialData.price.toString());
          }

          // Should have exactly 2 buttons (Approve and Edit)
          expect(result.buttons).toHaveLength(2);
          expect(result.buttons[0].id).toBe('approve');
          expect(result.buttons[1].id).toBe('edit');

          // Buttons should have titles
          expect(result.buttons[0].title.length).toBeGreaterThan(0);
          expect(result.buttons[1].title.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('Property 8.2: Confirmation sends interactive message with buttons', () => {
    fc.assert(
      fc.asyncProperty(
        completePartialDataArbitrary,
        languageArbitrary,
        async (partialData, language) => {
          // Use helper to reset mocks
          resetMocksForIteration();
          
          await generateConfirmation(partialData.phone, partialData, language);

          // Should call sendInteractiveMessage
          expect(whatsappSender.sendInteractiveMessage).toHaveBeenCalled();

          const call = (whatsappSender.sendInteractiveMessage as jest.Mock).mock.calls[0];
          expect(call[0]).toBe(partialData.phone);
          expect(call[1]).toBeDefined(); // text
          expect(call[2]).toHaveLength(2); // buttons
          expect(call[3]).toBeDefined(); // language
        }
      ),
      { numRuns: 50 }
    );
  });

  it('Property 8.3: Confirmation updates state to CONFIRMATION_PENDING', () => {
    fc.assert(
      fc.asyncProperty(
        completePartialDataArbitrary,
        languageArbitrary,
        async (partialData, language) => {
          // Use helper to reset mocks
          resetMocksForIteration();
          
          await generateConfirmation(partialData.phone, partialData, language);

          // Should update state to CONFIRMATION_PENDING
          expect(stateManager.updateUserState).toHaveBeenCalledWith(
            partialData.phone,
            'CONFIRMATION_PENDING'
          );
        }
      ),
      { numRuns: 50 }
    );
  });

  it('Property 8.4: Approval publishes catalog build event', () => {
    fc.assert(
      fc.asyncProperty(
        completePartialDataArbitrary,
        languageArbitrary,
        async (partialData, language) => {
          // Use helper to reset mocks
          resetMocksForIteration();

          await processApproval(partialData.phone, partialData, language);

          const { eventBridgeClient } = require('../../src/config/aws-clients');
          // Should publish event to EventBridge
          expect(eventBridgeClient.send).toHaveBeenCalled();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('Property 8.5: Approval transitions state to ACTIVE', () => {
    fc.assert(
      fc.asyncProperty(
        completePartialDataArbitrary,
        languageArbitrary,
        async (partialData, language) => {
          // Use helper to reset mocks
          resetMocksForIteration();
          
          await processApproval(partialData.phone, partialData, language);

          // Should update state to ACTIVE
          expect(stateManager.updateUserState).toHaveBeenCalledWith(
            partialData.phone,
            'ACTIVE'
          );
        }
      ),
      { numRuns: 50 }
    );
  });

  it('Property 8.6: Approval deletes partial data', () => {
    fc.assert(
      fc.asyncProperty(
        completePartialDataArbitrary,
        languageArbitrary,
        async (partialData, language) => {
          // Use helper to reset mocks
          resetMocksForIteration();
          
          await processApproval(partialData.phone, partialData, language);

          // Should delete partial data
          expect(partialDataStore.deletePartialData).toHaveBeenCalledWith(partialData.phone);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('Property 8.7: Approval sends success message', () => {
    fc.assert(
      fc.asyncProperty(
        completePartialDataArbitrary,
        languageArbitrary,
        async (partialData, language) => {
          // Use helper to reset mocks
          resetMocksForIteration();
          
          await processApproval(partialData.phone, partialData, language);

          // Should send success message
          expect(whatsappSender.sendTextMessage).toHaveBeenCalled();
          
          const call = (whatsappSender.sendTextMessage as jest.Mock).mock.calls[0];
          expect(call[0]).toBe(partialData.phone);
          expect(call[1]).toBeDefined(); // message text
        }
      ),
      { numRuns: 50 }
    );
  });

  it('Property 8.8: Approval returns success result', () => {
    fc.assert(
      fc.asyncProperty(
        completePartialDataArbitrary,
        languageArbitrary,
        async (partialData, language) => {
          const result = await processApproval(partialData.phone, partialData, language);

          // Should return success
          expect(result.success).toBe(true);
          expect(result.catalogId).toBeDefined();
          expect(result.error).toBeUndefined();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('Property 8.9: Edit transitions state back to VOICE_RECEIVED', () => {
    fc.assert(
      fc.asyncProperty(
        phoneArbitrary,
        fc.option(fc.constantFrom('productName', 'price', 'quantity', 'unit'), { nil: undefined }),
        languageArbitrary,
        async (phone, field, language) => {
          // Use helper to reset mocks
          resetMocksForIteration();
          
          await processEdit(phone, field, language);

          // Should update state to VOICE_RECEIVED
          expect(stateManager.updateUserState).toHaveBeenCalledWith(
            phone,
            'VOICE_RECEIVED',
            expect.objectContaining({ editingField: field })
          );
        }
      ),
      { numRuns: 50 }
    );
  });

  it('Property 8.10: Edit sends prompt message', () => {
    fc.assert(
      fc.asyncProperty(
        phoneArbitrary,
        fc.option(fc.constantFrom('productName', 'price', 'quantity', 'unit'), { nil: undefined }),
        languageArbitrary,
        async (phone, field, language) => {
          // Use helper to reset mocks
          resetMocksForIteration();
          
          await processEdit(phone, field, language);

          // Should send edit prompt
          expect(whatsappSender.sendTextMessage).toHaveBeenCalled();
          
          const call = (whatsappSender.sendTextMessage as jest.Mock).mock.calls[0];
          expect(call[0]).toBe(phone);
          expect(call[1]).toBeDefined(); // message text
        }
      ),
      { numRuns: 50 }
    );
  });

  it('Property 8.11: Language consistency in confirmation messages', () => {
    fc.assert(
      fc.asyncProperty(
        completePartialDataArbitrary,
        languageArbitrary,
        async (partialData, language) => {
          // Use helper to reset mocks
          resetMocksForIteration();
          
          const result = await generateConfirmation(partialData.phone, partialData, language);

          // Button titles should match language
          const langCode = language.split('-')[0] as 'hi' | 'mr' | 'en';
          
          if (langCode === 'hi') {
            expect(result.buttons[0].title).toContain('स्वीकार');
          } else if (langCode === 'mr') {
            expect(result.buttons[0].title).toContain('स्वीकार');
          } else {
            expect(result.buttons[0].title).toContain('Approve');
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('Property 8.12: Approval uses enhanced image URL when available', () => {
    fc.assert(
      fc.asyncProperty(
        completePartialDataArbitrary.filter(data => data.enhancedImageUrl !== undefined),
        languageArbitrary,
        async (partialData, language) => {
          // Use helper to reset mocks
          resetMocksForIteration();

          await processApproval(partialData.phone, partialData, language);

          const { eventBridgeClient } = require('../../src/config/aws-clients');
          const call = eventBridgeClient.send.mock.calls[0];
          const eventDetail = JSON.parse(call[0].input.Entries[0].Detail);
          
          // Should use enhanced image URL
          expect(eventDetail.imageUrl).toBe(partialData.enhancedImageUrl);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('Property 8.13: Approval falls back to original image URL when enhanced not available', () => {
    fc.assert(
      fc.asyncProperty(
        completePartialDataArbitrary
          .filter(data => data.originalImageUrl !== undefined)
          .map(data => ({ ...data, enhancedImageUrl: undefined })),
        languageArbitrary,
        async (partialData, language) => {
          // Use helper to reset mocks
          resetMocksForIteration();

          await processApproval(partialData.phone, partialData, language);

          const { eventBridgeClient } = require('../../src/config/aws-clients');
          const call = eventBridgeClient.send.mock.calls[0];
          const eventDetail = JSON.parse(call[0].input.Entries[0].Detail);
          
          // Should use original image URL
          expect(eventDetail.imageUrl).toBe(partialData.originalImageUrl);
        }
      ),
      { numRuns: 30 }
    );
  });
});
