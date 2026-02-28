/**
 * Unit tests for DynamoDB schema updates
 * 
 * Tests GSI4 (state-based querying) and TTL configuration
 * Requirements: 7.1, 7.8
 */

import {
  getUserState,
  updateUserState,
  initializeNewUser,
  getUsersByState,
  type UserStateType,
} from '../../../src/services/state-manager';
import {
  savePartialData,
  getPartialData,
  mergePartialData,
} from '../../../src/services/partial-data-store';

// Mock AWS SDK
jest.mock('../../../src/config/aws-clients', () => ({
  docClient: {
    send: jest.fn(),
  },
  TABLE_NAME: 'test-table',
  s3Client: {},
  eventBridgeClient: {},
  transcribeClient: {},
  textractClient: {},
  bedrockClient: {},
  pollyClient: {},
  kmsClient: {},
}));

jest.mock('../../../src/utils/error-handler', () => ({
  retryWithBackoff: jest.fn((fn: any) => fn()),
  logStructured: jest.fn(),
}));

jest.mock('../../../src/utils/monitoring', () => ({
  publishStateTransitionMetric: jest.fn(),
}));

describe('DynamoDB Schema Updates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GSI4: State-Based Querying', () => {
    it('should include GSI4 attributes when initializing new user', async () => {
      const { docClient } = require('../../../src/config/aws-clients');
      const mockSend = docClient.send as jest.Mock;
      
      mockSend.mockResolvedValueOnce({}); // PutCommand

      await initializeNewUser('+919876543210');

      const putCall = mockSend.mock.calls[0][0];
      const item = putCall.input.Item;
      
      expect(item.GSI4PK).toBe('STATE#NEW');
      expect(item.GSI4SK).toMatch(/^\d+#\+919876543210$/);
    });

    it('should update GSI4 attributes when state changes', async () => {
      const { docClient } = require('../../../src/config/aws-clients');
      const mockSend = docClient.send as jest.Mock;
      
      // Mock getUserState
      mockSend.mockResolvedValueOnce({
        Item: {
          PK: 'USER#+919876543210',
          SK: 'STATE',
          phone: '+919876543210',
          state: 'NEW',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
      
      // Mock updateUserState
      mockSend.mockResolvedValueOnce({});

      await updateUserState('+919876543210', 'KYC_VERIFIED');

      const updateCall = mockSend.mock.calls[1][0];
      const values = updateCall.input.ExpressionAttributeValues;
      
      expect(values[':gsi4pk']).toBe('STATE#KYC_VERIFIED');
      expect(values[':gsi4sk']).toMatch(/^\d+#\+919876543210$/);
    });

    it('should query users by state using GSI4', async () => {
      const { docClient } = require('../../../src/config/aws-clients');
      const mockSend = docClient.send as jest.Mock;
      
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            phone: '+919876543210',
            state: 'KYC_VERIFIED',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          {
            phone: '+919876543211',
            state: 'KYC_VERIFIED',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      });

      const users = await getUsersByState('KYC_VERIFIED', 10);

      const queryCall = mockSend.mock.calls[0][0];
      
      expect(queryCall.input.IndexName).toBe('GSI4');
      expect(queryCall.input.KeyConditionExpression).toBe('#gsi4pk = :gsi4pk');
      expect(queryCall.input.ExpressionAttributeValues[':gsi4pk']).toBe('STATE#KYC_VERIFIED');
      expect(queryCall.input.Limit).toBe(10);
      expect(queryCall.input.ScanIndexForward).toBe(false);

      expect(users).toHaveLength(2);
      expect(users[0].state).toBe('KYC_VERIFIED');
    });

    it('should return empty array when no users in state', async () => {
      const { docClient } = require('../../../src/config/aws-clients');
      const mockSend = docClient.send as jest.Mock;
      
      mockSend.mockResolvedValueOnce({ Items: [] });

      const users = await getUsersByState('CONFIRMATION_PENDING');

      expect(users).toEqual([]);
    });

    it('should support all user states in GSI4', async () => {
      const states: UserStateType[] = [
        'NEW',
        'KYC_PENDING',
        'KYC_VERIFIED',
        'VOICE_RECEIVED',
        'IMAGE_PENDING',
        'CONFIRMATION_PENDING',
        'ACTIVE',
      ];

      const { docClient } = require('../../../src/config/aws-clients');
      const mockSend = docClient.send as jest.Mock;

      for (const state of states) {
        mockSend.mockResolvedValueOnce({ Items: [] });
        await getUsersByState(state);
        
        const queryCall = mockSend.mock.calls[mockSend.mock.calls.length - 1][0];
        expect(queryCall.input.ExpressionAttributeValues[':gsi4pk']).toBe(`STATE#${state}`);
      }
    });
  });

  describe('TTL: Automatic Cleanup', () => {
    it('should set TTL when initializing new user', async () => {
      const { docClient } = require('../../../src/config/aws-clients');
      const mockSend = docClient.send as jest.Mock;
      
      const beforeTime = Math.floor(Date.now() / 1000);
      mockSend.mockResolvedValueOnce({});

      await initializeNewUser('+919876543210');

      const putCall = mockSend.mock.calls[0][0];
      const item = putCall.input.Item;
      
      expect(item.TTL).toBeDefined();
      expect(item.TTL).toBeGreaterThan(beforeTime);
      // TTL should be approximately 7 days in the future (default)
      const expectedTTL = beforeTime + (7 * 24 * 60 * 60);
      expect(item.TTL).toBeGreaterThanOrEqual(expectedTTL - 10);
      expect(item.TTL).toBeLessThanOrEqual(expectedTTL + 10);
    });

    it('should update TTL when state changes (non-ACTIVE)', async () => {
      const { docClient } = require('../../../src/config/aws-clients');
      const mockSend = docClient.send as jest.Mock;
      
      // Mock getUserState
      mockSend.mockResolvedValueOnce({
        Item: {
          PK: 'USER#+919876543210',
          SK: 'STATE',
          phone: '+919876543210',
          state: 'NEW',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
      
      const beforeTime = Math.floor(Date.now() / 1000);
      mockSend.mockResolvedValueOnce({});

      await updateUserState('+919876543210', 'KYC_VERIFIED');

      const updateCall = mockSend.mock.calls[1][0];
      const values = updateCall.input.ExpressionAttributeValues;
      
      expect(values[':ttl']).toBeDefined();
      expect(values[':ttl']).toBeGreaterThan(beforeTime);
    });

    it('should remove TTL when user becomes ACTIVE', async () => {
      const { docClient } = require('../../../src/config/aws-clients');
      const mockSend = docClient.send as jest.Mock;
      
      // Mock getUserState
      mockSend.mockResolvedValueOnce({
        Item: {
          PK: 'USER#+919876543210',
          SK: 'STATE',
          phone: '+919876543210',
          state: 'CONFIRMATION_PENDING',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
      
      mockSend.mockResolvedValueOnce({});

      await updateUserState('+919876543210', 'ACTIVE');

      const updateCall = mockSend.mock.calls[1][0];
      const updateExpression = updateCall.input.UpdateExpression;
      
      // Should have REMOVE clause for TTL
      expect(updateExpression).toContain('REMOVE');
      expect(updateExpression).toContain('#ttl');
      expect(updateCall.input.ExpressionAttributeNames['#ttl']).toBe('TTL');
    });

    it('should set TTL on partial catalog data', async () => {
      const { docClient } = require('../../../src/config/aws-clients');
      const mockSend = docClient.send as jest.Mock;
      
      const beforeTime = Math.floor(Date.now() / 1000);
      mockSend.mockResolvedValueOnce({});

      await savePartialData('+919876543210', {
        productName: 'Test Product',
        source: 'voice',
      });

      const putCall = mockSend.mock.calls[0][0];
      const item = putCall.input.Item;
      
      expect(item.TTL).toBeDefined();
      expect(item.TTL).toBeGreaterThan(beforeTime);
    });

    it('should update TTL when merging partial data', async () => {
      const { docClient } = require('../../../src/config/aws-clients');
      const mockSend = docClient.send as jest.Mock;
      
      // Mock getPartialData
      mockSend.mockResolvedValueOnce({
        Item: {
          PK: 'USER#+919876543210',
          SK: 'PARTIAL',
          phone: '+919876543210',
          productName: 'Test Product',
          missingFields: ['price', 'quantity', 'unit'],
          source: 'voice',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
      
      const beforeTime = Math.floor(Date.now() / 1000);
      mockSend.mockResolvedValueOnce({
        Attributes: {
          phone: '+919876543210',
          productName: 'Test Product',
          price: 100,
          missingFields: ['quantity', 'unit'],
          source: 'voice',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });

      await mergePartialData('+919876543210', { price: 100 });

      const updateCall = mockSend.mock.calls[1][0];
      const values = updateCall.input.ExpressionAttributeValues;
      
      expect(values[':ttl']).toBeDefined();
      expect(values[':ttl']).toBeGreaterThan(beforeTime);
    });

    it('should respect STATE_TTL_DAYS environment variable', async () => {
      // Set custom TTL
      const originalTTL = process.env.STATE_TTL_DAYS;
      process.env.STATE_TTL_DAYS = '14';
      
      // Clear module cache to pick up new env var
      jest.resetModules();
      const { initializeNewUser: initNew } = require('../../../src/services/state-manager');
      const { docClient } = require('../../../src/config/aws-clients');
      const mockSend = docClient.send as jest.Mock;
      
      const beforeTime = Math.floor(Date.now() / 1000);
      mockSend.mockResolvedValueOnce({});

      await initNew('+919876543210');

      const putCall = mockSend.mock.calls[0][0];
      const item = putCall.input.Item;
      
      // TTL should be approximately 14 days in the future
      const expectedTTL = beforeTime + (14 * 24 * 60 * 60);
      expect(item.TTL).toBeGreaterThanOrEqual(expectedTTL - 10);
      expect(item.TTL).toBeLessThanOrEqual(expectedTTL + 10);
      
      // Reset
      if (originalTTL) {
        process.env.STATE_TTL_DAYS = originalTTL;
      } else {
        delete process.env.STATE_TTL_DAYS;
      }
      
      // Re-import modules to restore original state
      jest.resetModules();
    });
  });
});
