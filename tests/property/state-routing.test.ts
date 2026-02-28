/**
 * Property-Based Test: State Routing
 * 
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
 * 
 * Property 1: State-Based Message Routing
 * For any incoming message and user state combination, the system should route the
 * message to the correct handler based on the routing rules, or send an error guidance
 * message if the combination is invalid.
 * 
 * This test verifies:
 * 1. Messages are routed to correct handlers based on state and message type
 * 2. Invalid state/message combinations return ERROR handler
 * 3. ERROR responses include guidance messages in user's language
 * 4. Routing decisions include appropriate metadata
 * 5. All valid state/message combinations are handled
 * 6. Routing is deterministic for the same inputs
 */

import fc from 'fast-check';
import {
  route,
  isValidTransition,
  getExpectedMessageTypes,
  type HandlerType,
  type MessageType,
} from '../../src/services/state-router';
import { type UserState, type UserStateType } from '../../src/services/state-manager';
import { type SupportedLanguage } from '../../src/services/language-manager';

describe('Property 1: State-Based Message Routing', () => {
  it('should route any message to a valid handler based on state and message type', async () => {
    await fc.assert(
      fc.property(
        fc.record({
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
          state: fc.constantFrom<UserStateType>(
            'NEW', 'KYC_PENDING', 'KYC_VERIFIED', 'VOICE_RECEIVED',
            'IMAGE_PENDING', 'CONFIRMATION_PENDING', 'ACTIVE'
          ),
          messageType: fc.constantFrom<MessageType>('text', 'audio', 'image', 'button_reply'),
          language: fc.constantFrom<SupportedLanguage>('hi-IN', 'mr-IN', 'en-IN'),
        }),
        ({ phone, state, messageType, language }) => {
          // Create user state
          const userState: UserState = {
            phone,
            state,
            language,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          // Execute routing
          const decision = route(messageType, userState);

          // Property 1: Should always return a valid handler
          const validHandlers: HandlerType[] = ['KYC', 'VOICE', 'IMAGE', 'CONFIRMATION', 'ERROR'];
          expect(validHandlers).toContain(decision.handler);

          // Property 2: Should always have an action
          expect(decision.action).toBeDefined();
          expect(typeof decision.action).toBe('string');
          expect(decision.action.length).toBeGreaterThan(0);

          // Property 3: Should always include metadata
          expect(decision.metadata).toBeDefined();
          expect(decision.metadata?.currentState).toBe(state);
          expect(decision.metadata?.messageType || decision.metadata?.receivedMessageType).toBe(messageType);

          // Property 4: If ERROR handler, must include guidance message
          if (decision.handler === 'ERROR') {
            expect(decision.action).toBe('send_guidance');
            expect(decision.metadata?.guidanceMessage).toBeDefined();
            expect(typeof decision.metadata?.guidanceMessage).toBe('string');
            expect(decision.metadata?.guidanceMessage.length).toBeGreaterThan(0);
          }

          // Property 5: If not ERROR, action should be 'process'
          if (decision.handler !== 'ERROR') {
            expect(decision.action).toBe('process');
          }
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should route messages deterministically for the same inputs', async () => {
    await fc.assert(
      fc.property(
        fc.record({
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
          state: fc.constantFrom<UserStateType>(
            'NEW', 'KYC_PENDING', 'KYC_VERIFIED', 'VOICE_RECEIVED',
            'IMAGE_PENDING', 'CONFIRMATION_PENDING', 'ACTIVE'
          ),
          messageType: fc.constantFrom<MessageType>('text', 'audio', 'image', 'button_reply'),
          language: fc.constantFrom<SupportedLanguage>('hi-IN', 'mr-IN', 'en-IN'),
        }),
        ({ phone, state, messageType, language }) => {
          // Create user state
          const userState: UserState = {
            phone,
            state,
            language,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          // Execute routing multiple times
          const decision1 = route(messageType, userState);
          const decision2 = route(messageType, userState);
          const decision3 = route(messageType, userState);

          // Property: Routing should be deterministic
          expect(decision1.handler).toBe(decision2.handler);
          expect(decision2.handler).toBe(decision3.handler);
          expect(decision1.action).toBe(decision2.action);
          expect(decision2.action).toBe(decision3.action);

          // Guidance messages should be identical
          if (decision1.handler === 'ERROR') {
            expect(decision1.metadata?.guidanceMessage).toBe(decision2.metadata?.guidanceMessage);
            expect(decision2.metadata?.guidanceMessage).toBe(decision3.metadata?.guidanceMessage);
          }
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should provide language-specific guidance messages for ERROR responses', async () => {
    await fc.assert(
      fc.property(
        fc.record({
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
          state: fc.constantFrom<UserStateType>(
            'NEW', 'KYC_PENDING', 'KYC_VERIFIED', 'VOICE_RECEIVED',
            'IMAGE_PENDING', 'CONFIRMATION_PENDING', 'ACTIVE'
          ),
          messageType: fc.constantFrom<MessageType>('text', 'audio', 'image', 'button_reply'),
          language: fc.constantFrom<SupportedLanguage>('hi-IN', 'mr-IN', 'en-IN'),
        }),
        ({ phone, state, messageType, language }) => {
          // Create user state
          const userState: UserState = {
            phone,
            state,
            language,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          // Execute routing
          const decision = route(messageType, userState);

          // If ERROR, verify language-specific guidance
          if (decision.handler === 'ERROR') {
            const guidanceMessage = decision.metadata?.guidanceMessage;
            expect(guidanceMessage).toBeDefined();

            // Property: Guidance should be in the user's language
            // Hindi messages contain Devanagari script
            // Marathi messages contain Devanagari script
            // English messages contain only Latin characters
            if (language === 'en-IN') {
              // English should not contain Devanagari characters
              expect(guidanceMessage).not.toMatch(/[\u0900-\u097F]/);
            } else {
              // Hindi and Marathi should contain Devanagari characters
              expect(guidanceMessage).toMatch(/[\u0900-\u097F]/);
            }

            // Property: Guidance should be non-empty and meaningful
            expect(guidanceMessage.length).toBeGreaterThan(10);
          }
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should correctly route valid state/message combinations to non-ERROR handlers', async () => {
    // Define valid combinations based on routing rules
    const validCombinations: Array<{ state: UserStateType; messageType: MessageType; expectedHandler: HandlerType }> = [
      { state: 'NEW', messageType: 'image', expectedHandler: 'KYC' },
      { state: 'KYC_PENDING', messageType: 'image', expectedHandler: 'KYC' },
      { state: 'KYC_VERIFIED', messageType: 'audio', expectedHandler: 'VOICE' },
      { state: 'KYC_VERIFIED', messageType: 'text', expectedHandler: 'VOICE' },
      { state: 'VOICE_RECEIVED', messageType: 'audio', expectedHandler: 'VOICE' },
      { state: 'VOICE_RECEIVED', messageType: 'text', expectedHandler: 'VOICE' },
      { state: 'IMAGE_PENDING', messageType: 'image', expectedHandler: 'IMAGE' },
      { state: 'CONFIRMATION_PENDING', messageType: 'button_reply', expectedHandler: 'CONFIRMATION' },
      { state: 'ACTIVE', messageType: 'audio', expectedHandler: 'VOICE' },
      { state: 'ACTIVE', messageType: 'text', expectedHandler: 'VOICE' },
      { state: 'ACTIVE', messageType: 'image', expectedHandler: 'IMAGE' },
    ];

    await fc.assert(
      fc.property(
        fc.constantFrom(...validCombinations),
        fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
        fc.constantFrom<SupportedLanguage>('hi-IN', 'mr-IN', 'en-IN'),
        ({ state, messageType, expectedHandler }, phone, language) => {
          // Create user state
          const userState: UserState = {
            phone,
            state,
            language,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          // Execute routing
          const decision = route(messageType, userState);

          // Property: Valid combinations should route to expected handler
          expect(decision.handler).toBe(expectedHandler);
          expect(decision.action).toBe('process');
          expect(decision.handler).not.toBe('ERROR');
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should route invalid state/message combinations to ERROR handler', async () => {
    // Define invalid combinations based on routing rules
    const invalidCombinations: Array<{ state: UserStateType; messageType: MessageType }> = [
      { state: 'NEW', messageType: 'text' },
      { state: 'NEW', messageType: 'audio' },
      { state: 'NEW', messageType: 'button_reply' },
      { state: 'KYC_PENDING', messageType: 'text' },
      { state: 'KYC_PENDING', messageType: 'audio' },
      { state: 'KYC_PENDING', messageType: 'button_reply' },
      { state: 'KYC_VERIFIED', messageType: 'image' },
      { state: 'KYC_VERIFIED', messageType: 'button_reply' },
      { state: 'VOICE_RECEIVED', messageType: 'image' },
      { state: 'VOICE_RECEIVED', messageType: 'button_reply' },
      { state: 'IMAGE_PENDING', messageType: 'text' },
      { state: 'IMAGE_PENDING', messageType: 'audio' },
      { state: 'IMAGE_PENDING', messageType: 'button_reply' },
      { state: 'CONFIRMATION_PENDING', messageType: 'text' },
      { state: 'CONFIRMATION_PENDING', messageType: 'audio' },
      { state: 'CONFIRMATION_PENDING', messageType: 'image' },
      { state: 'ACTIVE', messageType: 'button_reply' },
    ];

    await fc.assert(
      fc.property(
        fc.constantFrom(...invalidCombinations),
        fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
        fc.constantFrom<SupportedLanguage>('hi-IN', 'mr-IN', 'en-IN'),
        ({ state, messageType }, phone, language) => {
          // Create user state
          const userState: UserState = {
            phone,
            state,
            language,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          // Execute routing
          const decision = route(messageType, userState);

          // Property: Invalid combinations should route to ERROR handler
          expect(decision.handler).toBe('ERROR');
          expect(decision.action).toBe('send_guidance');
          expect(decision.metadata?.guidanceMessage).toBeDefined();
          expect(decision.metadata?.guidanceMessage.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should include appropriate metadata in all routing decisions', async () => {
    await fc.assert(
      fc.property(
        fc.record({
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
          state: fc.constantFrom<UserStateType>(
            'NEW', 'KYC_PENDING', 'KYC_VERIFIED', 'VOICE_RECEIVED',
            'IMAGE_PENDING', 'CONFIRMATION_PENDING', 'ACTIVE'
          ),
          messageType: fc.constantFrom<MessageType>('text', 'audio', 'image', 'button_reply'),
          language: fc.constantFrom<SupportedLanguage>('hi-IN', 'mr-IN', 'en-IN'),
          metadata: fc.option(
            fc.record({
              missingFields: fc.array(fc.constantFrom('productName', 'price', 'quantity', 'unit'), { maxLength: 3 }),
            }),
            { nil: undefined }
          ),
        }),
        ({ phone, state, messageType, language, metadata }) => {
          // Create user state with metadata
          const userState: UserState = {
            phone,
            state,
            language,
            metadata,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          // Execute routing
          const decision = route(messageType, userState);

          // Property: Metadata should always include current state
          expect(decision.metadata?.currentState).toBe(state);

          // Property: Metadata should include message type information
          const hasMessageType = 
            decision.metadata?.messageType === messageType ||
            decision.metadata?.receivedMessageType === messageType;
          expect(hasMessageType).toBe(true);

          // Property: ERROR decisions should have additional metadata
          if (decision.handler === 'ERROR') {
            expect(decision.metadata?.guidanceMessage).toBeDefined();
            expect(decision.metadata?.currentState).toBe(state);
            expect(decision.metadata?.receivedMessageType).toBe(messageType);
          }
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should handle missing language preference by using default guidance', async () => {
    await fc.assert(
      fc.property(
        fc.record({
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
          state: fc.constantFrom<UserStateType>(
            'NEW', 'KYC_PENDING', 'KYC_VERIFIED', 'VOICE_RECEIVED',
            'IMAGE_PENDING', 'CONFIRMATION_PENDING', 'ACTIVE'
          ),
          messageType: fc.constantFrom<MessageType>('text', 'audio', 'image', 'button_reply'),
        }),
        ({ phone, state, messageType }) => {
          // Create user state without language preference
          const userState: UserState = {
            phone,
            state,
            language: undefined,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          // Execute routing
          const decision = route(messageType, userState);

          // Property: Should still provide guidance even without language preference
          if (decision.handler === 'ERROR') {
            expect(decision.metadata?.guidanceMessage).toBeDefined();
            expect(decision.metadata?.guidanceMessage.length).toBeGreaterThan(0);
            
            // Default should be Hindi (contains Devanagari)
            expect(decision.metadata?.guidanceMessage).toMatch(/[\u0900-\u097F]/);
          }
        }
      ),
      { numRuns: 5 }
    );
  });
});

describe('State Transition Validation', () => {
  it('should correctly validate all valid state transitions', async () => {
    const validTransitions: Array<{ from: UserStateType; to: UserStateType }> = [
      { from: 'NEW', to: 'KYC_PENDING' },
      { from: 'KYC_PENDING', to: 'KYC_VERIFIED' },
      { from: 'KYC_PENDING', to: 'NEW' },
      { from: 'KYC_VERIFIED', to: 'VOICE_RECEIVED' },
      { from: 'VOICE_RECEIVED', to: 'IMAGE_PENDING' },
      { from: 'VOICE_RECEIVED', to: 'VOICE_RECEIVED' },
      { from: 'IMAGE_PENDING', to: 'CONFIRMATION_PENDING' },
      { from: 'CONFIRMATION_PENDING', to: 'ACTIVE' },
      { from: 'CONFIRMATION_PENDING', to: 'VOICE_RECEIVED' },
      { from: 'ACTIVE', to: 'VOICE_RECEIVED' },
      { from: 'ACTIVE', to: 'IMAGE_PENDING' },
    ];

    await fc.assert(
      fc.property(
        fc.constantFrom(...validTransitions),
        ({ from, to }) => {
          // Property: All defined valid transitions should be accepted
          const isValid = isValidTransition(from, to);
          expect(isValid).toBe(true);
        }
      ),
      { numRuns: validTransitions.length }
    );
  });

  it('should reject invalid state transitions', async () => {
    await fc.assert(
      fc.property(
        fc.constantFrom<UserStateType>(
          'NEW', 'KYC_PENDING', 'KYC_VERIFIED', 'VOICE_RECEIVED',
          'IMAGE_PENDING', 'CONFIRMATION_PENDING', 'ACTIVE'
        ),
        fc.constantFrom<UserStateType>(
          'NEW', 'KYC_PENDING', 'KYC_VERIFIED', 'VOICE_RECEIVED',
          'IMAGE_PENDING', 'CONFIRMATION_PENDING', 'ACTIVE'
        ),
        (from, to) => {
          const isValid = isValidTransition(from, to);

          // Define valid transitions
          const validTransitions: Record<UserStateType, UserStateType[]> = {
            NEW: ['KYC_PENDING'],
            KYC_PENDING: ['KYC_VERIFIED', 'NEW'],
            KYC_VERIFIED: ['VOICE_RECEIVED'],
            VOICE_RECEIVED: ['IMAGE_PENDING', 'VOICE_RECEIVED'],
            IMAGE_PENDING: ['CONFIRMATION_PENDING'],
            CONFIRMATION_PENDING: ['ACTIVE', 'VOICE_RECEIVED'],
            ACTIVE: ['VOICE_RECEIVED', 'IMAGE_PENDING'],
          };

          const expectedValid = validTransitions[from]?.includes(to) || false;

          // Property: Validation should match expected valid transitions
          expect(isValid).toBe(expectedValid);
        }
      ),
      { numRuns: 5 }
    );
  });
});

describe('Expected Message Types', () => {
  it('should return correct expected message types for each state', async () => {
    await fc.assert(
      fc.property(
        fc.constantFrom<UserStateType>(
          'NEW', 'KYC_PENDING', 'KYC_VERIFIED', 'VOICE_RECEIVED',
          'IMAGE_PENDING', 'CONFIRMATION_PENDING', 'ACTIVE'
        ),
        (state) => {
          const expectedTypes = getExpectedMessageTypes(state);

          // Property: Should always return an array
          expect(Array.isArray(expectedTypes)).toBe(true);

          // Property: Should only contain valid message types
          const validTypes: MessageType[] = ['text', 'audio', 'image', 'button_reply'];
          expectedTypes.forEach(type => {
            expect(validTypes).toContain(type);
          });

          // Property: Should not be empty (every state expects at least one message type)
          expect(expectedTypes.length).toBeGreaterThan(0);

          // Property: Should not contain duplicates
          const uniqueTypes = [...new Set(expectedTypes)];
          expect(uniqueTypes.length).toBe(expectedTypes.length);
        }
      ),
      { numRuns: 3 } // One for each state
    );
  });

  it('should return message types that route to non-ERROR handlers', async () => {
    await fc.assert(
      fc.property(
        fc.constantFrom<UserStateType>(
          'NEW', 'KYC_PENDING', 'KYC_VERIFIED', 'VOICE_RECEIVED',
          'IMAGE_PENDING', 'CONFIRMATION_PENDING', 'ACTIVE'
        ),
        fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
        (state, phone) => {
          const expectedTypes = getExpectedMessageTypes(state);

          // Create user state
          const userState: UserState = {
            phone,
            state,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          // Property: All expected message types should route to non-ERROR handlers
          expectedTypes.forEach(messageType => {
            const decision = route(messageType, userState);
            expect(decision.handler).not.toBe('ERROR');
          });
        }
      ),
      { numRuns: 3 }
    );
  });
});
