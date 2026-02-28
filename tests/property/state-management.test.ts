/**
 * Property-Based Test: State Management
 * 
 * **Validates: Requirements 1.5, 3.8, 6.5, 6.8, 7.1, 7.2, 7.3, 7.4, 7.7**
 * 
 * Property 2: State Transition Consistency
 * For any successful operation (KYC completion, voice processing, image upload, approval),
 * the user state should transition to the next appropriate state and be persisted to
 * DynamoDB with a timestamp.
 * 
 * Property 11: State Persistence and Recovery
 * For any user message, the system should retrieve both state and partial data in a
 * single query, and for new users initialize with NEW state and empty partial data.
 * 
 * This test verifies:
 * 1. State transitions are consistent and follow valid paths
 * 2. State changes are persisted to DynamoDB with timestamps
 * 3. State retrieval works correctly for existing users
 * 4. New users are initialized with NEW state
 * 5. Partial data is correctly stored and retrieved
 * 6. State and partial data can be retrieved together
 * 7. TTL is set correctly for incomplete flows
 */

import fc from 'fast-check';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  getUserState,
  updateUserState,
  initializeNewUser,
  type UserStateType,
  type UserState,
} from '../../src/services/state-manager';
import {
  savePartialData,
  getPartialData,
  mergePartialData,
  type PartialCatalogItem,
} from '../../src/services/partial-data-store';

const dynamoMock = mockClient(DynamoDBDocumentClient);

// Mock environment variables
process.env.TABLE_NAME = 'test-table';

describe('Property 2: State Transition Consistency', () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
  });

  it('should persist state transitions with timestamps for any valid operation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
          currentState: fc.constantFrom<UserStateType>(
            'NEW', 'KYC_PENDING', 'KYC_VERIFIED', 'VOICE_RECEIVED', 
            'IMAGE_PENDING', 'CONFIRMATION_PENDING'
          ),
          newState: fc.constantFrom<UserStateType>(
            'KYC_PENDING', 'KYC_VERIFIED', 'VOICE_RECEIVED', 
            'IMAGE_PENDING', 'CONFIRMATION_PENDING', 'ACTIVE'
          ),
          metadata: fc.record({
            missingFields: fc.array(fc.constantFrom('productName', 'price', 'quantity', 'unit'), { maxLength: 3 }),
            pendingCatalogItemId: fc.option(fc.uuid(), { nil: undefined }),
          }),
        }),
        async ({ phone, currentState, newState, metadata }) => {
          // Reset mock for each iteration
          dynamoMock.reset();

          const now = Date.now();
          
          // Mock GetCommand for getUserState (called by updateUserState)
          dynamoMock.on(GetCommand).resolves({
            Item: {
              PK: `USER#${phone}`,
              SK: 'STATE',
              phone,
              state: currentState,
              updatedAt: now - 1000,
              createdAt: now - 10000,
            },
          });
          
          // Mock UpdateCommand for state transition
          dynamoMock.on(UpdateCommand).resolves({
            Attributes: {
              PK: `USER#${phone}`,
              SK: 'STATE',
              phone,
              state: newState,
              updatedAt: now,
              metadata,
            },
          });

          // Execute state update
          await updateUserState(phone, newState, metadata);

          // Verify UpdateCommand was called
          const updateCalls = dynamoMock.commandCalls(UpdateCommand);
          expect(updateCalls.length).toBeGreaterThan(0);

          const lastCall = updateCalls[updateCalls.length - 1];
          const input = lastCall.args[0].input;

          // Verify state transition was persisted
          expect(input.Key).toEqual({
            PK: `USER#${phone}`,
            SK: 'STATE',
          });

          // Verify timestamp is included
          expect(input.ExpressionAttributeValues).toHaveProperty(':updatedAt');
          expect(input.ExpressionAttributeValues?.[':updatedAt']).toBeGreaterThan(0);

          // Verify new state is set
          expect(input.ExpressionAttributeValues).toHaveProperty(':state', newState);

          // Verify metadata is included if provided
          if (metadata && Object.keys(metadata).length > 0) {
            expect(input.ExpressionAttributeValues).toHaveProperty(':metadata', metadata);
          }

          // Verify TTL is set correctly based on state
          if (newState === 'ACTIVE') {
            // Active users should have TTL removed
            expect(input.UpdateExpression).toContain('REMOVE');
          } else {
            // Incomplete flows should have TTL set
            expect(input.ExpressionAttributeValues).toHaveProperty(':ttl');
            const ttl = input.ExpressionAttributeValues?.[':ttl'];
            expect(ttl).toBeGreaterThan(Math.floor(now / 1000));
          }
        }
      ),
      { numRuns: 5 }
    );
  }, 30000);

  it('should maintain state consistency across multiple transitions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
          transitions: fc.array(
            fc.record({
              state: fc.constantFrom<UserStateType>(
                'KYC_PENDING', 'KYC_VERIFIED', 'VOICE_RECEIVED', 
                'IMAGE_PENDING', 'CONFIRMATION_PENDING', 'ACTIVE'
              ),
              metadata: fc.option(
                fc.record({
                  missingFields: fc.array(fc.constantFrom('productName', 'price'), { maxLength: 2 }),
                }),
                { nil: undefined }
              ),
            }),
            { minLength: 1, maxLength: 5 }
          ),
        }),
        async ({ phone, transitions }) => {
          // Reset mock for each iteration
          dynamoMock.reset();

          let previousTimestamp = 0;
          let currentState: UserStateType = 'NEW';

          for (const transition of transitions) {
            const now = Date.now();
            
            // Mock GetCommand for getUserState (called by updateUserState)
            dynamoMock.on(GetCommand).resolves({
              Item: {
                PK: `USER#${phone}`,
                SK: 'STATE',
                phone,
                state: currentState,
                updatedAt: previousTimestamp || now - 1000,
                createdAt: now - 10000,
              },
            });
            
            // Mock UpdateCommand
            dynamoMock.on(UpdateCommand).resolves({
              Attributes: {
                PK: `USER#${phone}`,
                SK: 'STATE',
                phone,
                state: transition.state,
                updatedAt: now,
                metadata: transition.metadata,
              },
            });

            // Execute state update
            await updateUserState(phone, transition.state, transition.metadata);

            // Update current state for next iteration
            currentState = transition.state;

            // Verify timestamp is monotonically increasing
            const updateCalls = dynamoMock.commandCalls(UpdateCommand);
            const lastCall = updateCalls[updateCalls.length - 1];
            const timestamp = lastCall.args[0].input.ExpressionAttributeValues?.[':updatedAt'];
            
            expect(timestamp).toBeDefined();
            expect(timestamp).toBeGreaterThanOrEqual(previousTimestamp);
            previousTimestamp = timestamp as number;

            // Small delay to ensure timestamps differ
            await new Promise(resolve => setTimeout(resolve, 1));
          }
        }
      ),
      { numRuns: 3 }
    );
  }, 30000);
});

describe('Property 11: State Persistence and Recovery', () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
  });

  it('should initialize new users with NEW state and empty partial data', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
        async (phone) => {
          // Reset mock for each iteration
          dynamoMock.reset();

          const now = Date.now();
          
          // Mock PutCommand for new user initialization
          dynamoMock.on(PutCommand).resolves({});

          // Execute initialization
          const userState = await initializeNewUser(phone);

          // Verify user state is NEW
          expect(userState.state).toBe('NEW');
          expect(userState.phone).toBe(phone);
          expect(userState.createdAt).toBeGreaterThan(0);
          expect(userState.updatedAt).toBeGreaterThan(0);

          // Verify PutCommand was called with correct parameters
          const putCalls = dynamoMock.commandCalls(PutCommand);
          expect(putCalls.length).toBeGreaterThan(0);

          const lastCall = putCalls[putCalls.length - 1];
          const input = lastCall.args[0].input;

          // Verify state record structure
          expect(input.Item).toBeDefined();
          expect(input.Item).toMatchObject({
            PK: `USER#${phone}`,
            SK: 'STATE',
            phone,
            state: 'NEW',
            entityType: 'USER_STATE',
          });

          // Verify TTL is set (7 days from now)
          expect(input.Item?.TTL).toBeGreaterThan(Math.floor(now / 1000));
          expect(input.Item?.TTL).toBeLessThanOrEqual(Math.floor(now / 1000) + (7 * 24 * 60 * 60) + 1);

          // Verify conditional expression prevents duplicate initialization
          expect(input.ConditionExpression).toBe('attribute_not_exists(PK)');
        }
      ),
      { numRuns: 5 }
    );
  }, 30000);

  it('should retrieve existing user state correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
          state: fc.constantFrom<UserStateType>(
            'NEW', 'KYC_PENDING', 'KYC_VERIFIED', 'VOICE_RECEIVED',
            'IMAGE_PENDING', 'CONFIRMATION_PENDING', 'ACTIVE'
          ),
          language: fc.constantFrom<'hi-IN' | 'mr-IN' | 'en-IN'>('hi-IN', 'mr-IN', 'en-IN'),
          sellerId: fc.option(fc.uuid(), { nil: undefined }),
          metadata: fc.option(
            fc.record({
              missingFields: fc.array(fc.constantFrom('productName', 'price', 'quantity', 'unit'), { maxLength: 4 }),
            }),
            { nil: undefined }
          ),
        }),
        async ({ phone, state, language, sellerId, metadata }) => {
          // Reset mock for each iteration
          dynamoMock.reset();

          const now = Date.now();
          
          // Mock GetCommand to return existing state
          dynamoMock.on(GetCommand).resolves({
            Item: {
              PK: `USER#${phone}`,
              SK: 'STATE',
              phone,
              state,
              language,
              sellerId,
              metadata,
              entityType: 'USER_STATE',
              createdAt: now - 10000,
              updatedAt: now,
            },
          });

          // Execute state retrieval
          const userState = await getUserState(phone);

          // Verify state was retrieved correctly
          expect(userState).not.toBeNull();
          expect(userState?.phone).toBe(phone);
          expect(userState?.state).toBe(state);
          expect(userState?.language).toBe(language);
          expect(userState?.sellerId).toBe(sellerId);
          expect(userState?.metadata).toEqual(metadata);
          expect(userState?.createdAt).toBe(now - 10000);
          expect(userState?.updatedAt).toBe(now);

          // Verify GetCommand was called with correct key
          const getCalls = dynamoMock.commandCalls(GetCommand);
          expect(getCalls.length).toBeGreaterThan(0);

          const lastCall = getCalls[getCalls.length - 1];
          expect(lastCall.args[0].input.Key).toEqual({
            PK: `USER#${phone}`,
            SK: 'STATE',
          });
        }
      ),
      { numRuns: 5 }
    );
  }, 30000);

  it('should return null for non-existent users', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
        async (phone) => {
          // Reset mock for each iteration
          dynamoMock.reset();

          // Mock GetCommand to return no item
          dynamoMock.on(GetCommand).resolves({});

          // Execute state retrieval
          const userState = await getUserState(phone);

          // Verify null is returned for non-existent user
          expect(userState).toBeNull();
        }
      ),
      { numRuns: 5 }
    );
  }, 30000);

  it('should correctly store and retrieve partial catalog data', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
          productName: fc.option(fc.string({ minLength: 3, maxLength: 50 }), { nil: undefined }),
          price: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: undefined }),
          quantity: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
          unit: fc.option(fc.constantFrom('kg', 'liter', 'piece', 'dozen'), { nil: undefined }),
          category: fc.option(fc.constantFrom('food', 'clothing', 'electronics'), { nil: undefined }),
          description: fc.option(fc.string({ minLength: 10, maxLength: 200 }), { nil: undefined }),
        }),
        async ({ phone, productName, price, quantity, unit, category, description }) => {
          // Reset mock for each iteration
          dynamoMock.reset();

          const now = Date.now();
          const partialData = {
            productName,
            price,
            quantity,
            unit,
            category,
            description,
            source: 'voice' as const,
          };

          // Calculate expected missing fields
          const requiredFields = ['productName', 'price', 'quantity', 'unit'];
          const expectedMissingFields = requiredFields.filter(
            field => !partialData[field as keyof typeof partialData]
          );

          // Mock PutCommand for saving partial data
          dynamoMock.on(PutCommand).resolves({});

          // Execute save
          const saved = await savePartialData(phone, partialData);

          // Verify partial data structure
          expect(saved.phone).toBe(phone);
          expect(saved.productName).toBe(productName);
          expect(saved.price).toBe(price);
          expect(saved.quantity).toBe(quantity);
          expect(saved.unit).toBe(unit);
          expect(saved.category).toBe(category);
          expect(saved.description).toBe(description);
          expect(saved.source).toBe('voice');
          expect(saved.missingFields).toEqual(expectedMissingFields);
          expect(saved.createdAt).toBeGreaterThan(0);
          expect(saved.updatedAt).toBeGreaterThan(0);

          // Verify PutCommand was called
          const putCalls = dynamoMock.commandCalls(PutCommand);
          expect(putCalls.length).toBeGreaterThan(0);

          const lastCall = putCalls[putCalls.length - 1];
          const input = lastCall.args[0].input;

          // Verify record structure
          expect(input.Item).toBeDefined();
          expect(input.Item?.PK).toBe(`USER#${phone}`);
          expect(input.Item?.SK).toMatch(/^PARTIAL#\d+$/);
          expect(input.Item?.entityType).toBe('PARTIAL_CATALOG');
          expect(input.Item?.TTL).toBeGreaterThan(Math.floor(now / 1000));
        }
      ),
      { numRuns: 5 }
    );
  }, 30000);

  it('should merge partial data correctly preserving existing values', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
          existingData: fc.record({
            productName: fc.option(fc.string({ minLength: 3, maxLength: 50 }), { nil: undefined }),
            price: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: undefined }),
          }),
          newData: fc.record({
            quantity: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
            unit: fc.option(fc.constantFrom('kg', 'liter', 'piece'), { nil: undefined }),
          }),
        }),
        async ({ phone, existingData, newData }) => {
          // Reset mock for each iteration
          dynamoMock.reset();

          const now = Date.now();

          // Mock GetCommand to return existing data
          const existingPartialData: PartialCatalogItem = {
            phone,
            ...existingData,
            missingFields: ['quantity', 'unit'],
            source: 'voice',
            createdAt: now - 10000,
            updatedAt: now - 5000,
          };

          dynamoMock.on(GetCommand).resolves({
            Item: {
              PK: `USER#${phone}`,
              SK: 'PARTIAL',
              ...existingPartialData,
              entityType: 'PARTIAL_CATALOG',
            },
          });

          // Mock UpdateCommand for merge
          const mergedData = {
            ...existingPartialData,
            ...newData,
            updatedAt: now,
          };

          // Calculate new missing fields
          const requiredFields = ['productName', 'price', 'quantity', 'unit'];
          const newMissingFields = requiredFields.filter(
            field => !mergedData[field as keyof typeof mergedData]
          );

          dynamoMock.on(UpdateCommand).resolves({
            Attributes: {
              ...mergedData,
              missingFields: newMissingFields,
            },
          });

          // Execute merge
          const merged = await mergePartialData(phone, newData);

          // Verify existing values are preserved
          expect(merged.productName).toBe(existingData.productName);
          expect(merged.price).toBe(existingData.price);

          // Verify new values are added
          expect(merged.quantity).toBe(newData.quantity);
          expect(merged.unit).toBe(newData.unit);

          // Verify missing fields are recalculated
          expect(merged.missingFields).toEqual(newMissingFields);

          // Verify UpdateCommand was called
          const updateCalls = dynamoMock.commandCalls(UpdateCommand);
          expect(updateCalls.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 5 }
    );
  }, 30000);

  it('should handle concurrent state and partial data retrieval', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.replace(/\D/g, '').slice(0, 10)}`),
          state: fc.constantFrom<UserStateType>('VOICE_RECEIVED', 'IMAGE_PENDING'),
          partialData: fc.record({
            productName: fc.string({ minLength: 3, maxLength: 50 }),
            price: fc.integer({ min: 1, max: 100000 }),
          }),
        }),
        async ({ phone, state, partialData }) => {
          // Reset mock for each iteration
          dynamoMock.reset();

          const now = Date.now();

          // Mock GetCommand for state
          dynamoMock.on(GetCommand, {
            Key: { PK: `USER#${phone}`, SK: 'STATE' },
          }).resolves({
            Item: {
              PK: `USER#${phone}`,
              SK: 'STATE',
              phone,
              state,
              createdAt: now - 10000,
              updatedAt: now,
            },
          });

          // Mock GetCommand for partial data
          dynamoMock.on(GetCommand, {
            Key: { PK: `USER#${phone}`, SK: 'PARTIAL' },
          }).resolves({
            Item: {
              PK: `USER#${phone}`,
              SK: 'PARTIAL',
              phone,
              ...partialData,
              missingFields: ['quantity', 'unit'],
              source: 'voice',
              createdAt: now - 10000,
              updatedAt: now,
            },
          });

          // Execute concurrent retrieval
          const [userState, partial] = await Promise.all([
            getUserState(phone),
            getPartialData(phone),
          ]);

          // Verify both were retrieved successfully
          expect(userState).not.toBeNull();
          expect(userState?.state).toBe(state);
          expect(partial).not.toBeNull();
          expect(partial?.productName).toBe(partialData.productName);
          expect(partial?.price).toBe(partialData.price);

          // Verify both GetCommands were called
          const getCalls = dynamoMock.commandCalls(GetCommand);
          expect(getCalls.length).toBeGreaterThanOrEqual(2);
        }
      ),
      { numRuns: 5 }
    );
  }, 30000);
});
