/**
 * BPP Adapter Lambda — Unit Tests
 * 
 * Tests the Beckn Protocol API gateway routing, validation,
 * ACK/NACK responses, and async callback mechanism.
 */

import { test, describe, beforeEach, expect } from '@jest/globals';
import { handler } from '../../src/lambdas/bpp-adapter';

// Mock beckn-protocol-handler
jest.mock('../../src/services/beckn-protocol-handler', () => ({
  handleSearch: jest.fn().mockResolvedValue({ context: {}, message: { catalog: {} } }),
  handleSelect: jest.fn().mockResolvedValue({ context: {}, message: { order: {} } }),
  handleInit: jest.fn().mockResolvedValue({ context: {}, message: { order: {} } }),
  handleConfirm: jest.fn().mockResolvedValue({ context: {}, message: { order: {} } }),
  handleStatus: jest.fn().mockResolvedValue({ context: {}, message: { order: {} } }),
  handleCancel: jest.fn().mockResolvedValue({ context: {}, message: { order: {} } }),
  handleUpdate: jest.fn().mockResolvedValue({ context: {}, message: { order: {} } }),
  handleTrack: jest.fn().mockResolvedValue({ context: {}, message: { order: {} } }),
  handleRating: jest.fn().mockResolvedValue({ context: {}, message: {} }),
  handleSupport: jest.fn().mockResolvedValue({ context: {}, message: {} }),
}));

// Mock beckn-auth
jest.mock('../../src/services/beckn-auth', () => ({
  createAuthorizationHeader: jest.fn().mockResolvedValue('Signature ...'),
  verifyAuthorizationHeader: jest.fn().mockResolvedValue(true),
  lookupPublicKey: jest.fn().mockResolvedValue('mock-public-key'),
}));

// Mock fetch/https for callback
const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
global.fetch = mockFetch as any;

const validBecknContext = {
  domain: 'ONDC:RET10',
  country: 'IND',
  city: 'std:080',
  action: 'search',
  core_version: '1.2.0',
  bap_id: 'test-bap.ondc.in',
  bap_uri: 'https://test-bap.ondc.in/callback',
  bpp_id: 'vyapar-vaani.ondc.in',
  bpp_uri: 'https://api.vyapar-vaani.ondc.in',
  transaction_id: '550e8400-e29b-41d4-a716-446655440000',
  message_id: '660e8400-e29b-41d4-a716-446655440001',
  timestamp: new Date().toISOString(),
};

const createEvent = (action: string, message: any = {}, pathOverride?: string) => ({
  requestContext: {
    http: { method: 'POST', path: pathOverride || `/beckn/${action}` },
  },
  pathParameters: { action },
  body: JSON.stringify({
    context: { ...validBecknContext, action },
    message,
  }),
  headers: {},
});

describe('BPP Adapter Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VERIFY_BECKN_SIGNATURES = 'false';
    process.env.NETWORK_PARTICIPANT_ID = 'vyapar-vaani.ondc.in';
    process.env.BPP_BASE_URL = 'https://api.vyapar-vaani.ondc.in';
  });

  describe('Action Routing', () => {
    const actions = [
      'search', 'select', 'init', 'confirm', 'status',
      'cancel', 'update', 'track', 'rating', 'support',
    ];

    test.each(actions)('routes %s action correctly', async (action) => {
      const event = createEvent(action);
      const result = await handler(event);
      const body = JSON.parse(result.body);
      
      expect(result.statusCode).toBe(200);
      expect(body.message?.ack?.status).toBe('ACK');
    });

    test('returns NACK for unknown action', async () => {
      const event = createEvent('unknown_action');
      const result = await handler(event);
      const body = JSON.parse(result.body);
      
      expect(body.message?.ack?.status).toBe('NACK');
    });
  });

  describe('Context Validation', () => {
    test('rejects request without context', async () => {
      const event = {
        requestContext: { http: { method: 'POST', path: '/beckn/search' } },
        pathParameters: { action: 'search' },
        body: JSON.stringify({ message: {} }),
        headers: {},
      };
      const result = await handler(event);
      const body = JSON.parse(result.body);
      
      expect(body.message?.ack?.status).toBe('NACK');
    });

    test('rejects request without body', async () => {
      const event = {
        requestContext: { http: { method: 'POST', path: '/beckn/search' } },
        pathParameters: { action: 'search' },
        body: null,
        headers: {},
      };
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
    });

    test('rejects request with missing required context fields', async () => {
      const event = {
        requestContext: { http: { method: 'POST', path: '/beckn/search' } },
        pathParameters: { action: 'search' },
        body: JSON.stringify({
          context: { domain: 'ONDC:RET10' }, // missing most fields
          message: {},
        }),
        headers: {},
      };
      const result = await handler(event);
      const body = JSON.parse(result.body);
      
      expect(body.message?.ack?.status).toBe('NACK');
    });
  });

  describe('Search Flow', () => {
    test('handles search with intent', async () => {
      const event = createEvent('search', {
        intent: {
          item: { descriptor: { name: 'tomato' } },
          category: { id: 'Vegetables' },
          fulfillment: { type: 'Delivery' },
        },
      });
      
      const result = await handler(event);
      const body = JSON.parse(result.body);
      
      expect(result.statusCode).toBe(200);
      expect(body.message.ack.status).toBe('ACK');
    });
  });

  describe('Confirm Flow', () => {
    test('handles confirm with order details', async () => {
      const event = createEvent('confirm', {
        order: {
          provider: { id: 'seller-123' },
          items: [{ id: 'item-1', quantity: { count: 2 } }],
          billing: { name: 'Test Buyer', phone: '9876543210' },
          fulfillment: {
            type: 'Delivery',
            end: {
              location: { address: { city: 'Mumbai', area_code: '400001' } },
              contact: { phone: '9876543210' },
            },
          },
          payment: { type: 'ON-FULFILLMENT' },
        },
      });
      
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });
  });

  describe('CORS Headers', () => {
    test('includes CORS headers in response', async () => {
      const event = createEvent('search');
      const result = await handler(event);
      
      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin', '*');
      expect(result.headers).toHaveProperty('Content-Type', 'application/json');
    });
  });

  describe('Error Handling', () => {
    test('handles malformed JSON body gracefully', async () => {
      const event = {
        requestContext: { http: { method: 'POST', path: '/beckn/search' } },
        pathParameters: { action: 'search' },
        body: 'not-json',
        headers: {},
      };
      const result = await handler(event);
      
      expect(result.statusCode).toBeGreaterThanOrEqual(400);
    });
  });
});
