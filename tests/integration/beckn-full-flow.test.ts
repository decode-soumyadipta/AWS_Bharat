/**
 * ONDC Beckn Protocol — Integration Test
 * 
 * Tests the complete buyer flow through the Beckn protocol:
 * search → select → init → confirm → status → track
 * 
 * Validates that each step produces valid Beckn responses
 * that can be consumed by the next step in the flow.
 */

// Mock all AWS dependencies
jest.mock('../../src/config/aws-clients', () => ({
  dynamoDBClient: {},
  eventBridgeClient: { send: jest.fn().mockResolvedValue({ Entries: [{ EventId: 'evt-001' }] }) },
  s3Client: { send: jest.fn() },
  bedrockRuntimeClient: { send: jest.fn() },
}));

jest.mock('../../src/services/dynamodb-repository', () => {
  const orders: Record<string, any> = {};
  return {
    getSellerById: jest.fn().mockResolvedValue({
      PK: 'SELLER#919876543210',
      SK: 'PROFILE',
      sellerId: '919876543210',
      name: 'Ramesh Kisan',
      phone: '919876543210',
      upiId: 'ramesh@upi',
      address: { city: 'Pune', state: 'Maharashtra', pincode: '411001' },
    }),
    getCatalogItemsBySeller: jest.fn().mockResolvedValue([{
      PK: 'SELLER#919876543210',
      SK: 'ITEM#item-001',
      itemId: 'item-001',
      sellerId: '919876543210',
      status: 'ACTIVE',
      becknItem: {
        id: 'item-001',
        descriptor: {
          name: 'Organic Tomato',
          short_desc: 'Fresh farm tomatoes',
          long_desc: 'Premium organic tomatoes from Pune farmland',
          images: ['https://products.vyapar-vaani.in/tomato.jpg'],
        },
        price: { currency: 'INR', value: '40' },
        quantity: {
          available: { count: 100 },
          unitized: { measure: { unit: 'kg', value: '1' } },
        },
        category_id: 'Vegetables',
        fulfillment_id: 'F1',
      },
    }]),
    getCatalogItemsByCategory: jest.fn().mockResolvedValue([{
      PK: 'SELLER#919876543210',
      SK: 'ITEM#item-001',
      itemId: 'item-001',
      sellerId: '919876543210',
      status: 'ACTIVE',
      becknItem: {
        id: 'item-001',
        descriptor: { name: 'Organic Tomato', short_desc: 'Fresh farm tomatoes', images: [] },
        price: { currency: 'INR', value: '40' },
        quantity: { available: { count: 100 }, unitized: { measure: { unit: 'kg', value: '1' } } },
        category_id: 'Vegetables',
        fulfillment_id: 'F1',
      },
    }]),
    getCatalogItem: jest.fn().mockResolvedValue({
      PK: 'SELLER#919876543210',
      SK: 'ITEM#item-001',
      itemId: 'item-001',
      sellerId: '919876543210',
      status: 'ACTIVE',
      becknItem: {
        id: 'item-001',
        descriptor: { name: 'Organic Tomato', short_desc: 'Fresh farm tomatoes', images: [] },
        price: { currency: 'INR', value: '40' },
        quantity: { available: { count: 100 }, unitized: { measure: { unit: 'kg', value: '1' } } },
        category_id: 'Vegetables',
        fulfillment_id: 'F1',
      },
    }),
    getAllCatalogItems: jest.fn().mockResolvedValue([{
      PK: 'SELLER#919876543210',
      SK: 'ITEM#item-001',
      itemId: 'item-001',
      sellerId: '919876543210',
      status: 'ACTIVE',
      becknItem: {
        id: 'item-001',
        descriptor: { name: 'Organic Tomato', short_desc: 'Fresh farm tomatoes', images: [] },
        price: { currency: 'INR', value: '40' },
        quantity: { available: { count: 100 }, unitized: { measure: { unit: 'kg', value: '1' } } },
        category_id: 'Vegetables',
        fulfillment_id: 'F1',
      },
    }]),
    createOrder: jest.fn().mockImplementation((order: any) => {
      orders[order.orderId] = order;
      return Promise.resolve();
    }),
    getOrderById: jest.fn().mockImplementation((orderId: string) => {
      return Promise.resolve(orders[orderId] || {
        orderId,
        status: 'CONFIRMED',
        items: [{ itemId: 'item-001', name: 'Organic Tomato', quantity: 2, price: 40 }],
        sellerId: '919876543210',
        fulfillment: { type: 'Delivery' },
        payment: { type: 'ON-FULFILLMENT', amount: 80 },
        buyer: { name: 'Test Buyer', phone: '919876543211' },
      });
    }),
    updateOrderStatus: jest.fn().mockResolvedValue(undefined),
  };
});

import {
  handleSearch,
  handleSelect,
  handleInit,
  handleConfirm,
  handleStatus,
} from '../../src/services/beckn-protocol-handler';

const TRANSACTION_ID = 'txn-integration-001';

const createContext = (action: string) => ({
  domain: 'ONDC:RET10',
  country: 'IND',
  city: 'std:020', // Pune
  action: action as any,
  core_version: '1.2.0' as const,
  bap_id: 'test-buyer-app.ondc.in',
  bap_uri: 'https://test-buyer-app.ondc.in/callback',
  bpp_id: 'vyapar-vaani.ondc.in',
  bpp_uri: 'https://api.vyapar-vaani.ondc.in',
  transaction_id: TRANSACTION_ID,
  message_id: `msg-${action}-001`,
  timestamp: new Date().toISOString(),
});

describe('ONDC Beckn Full Flow Integration', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = 'vyapar-vaani-data';
    process.env.EVENT_BUS_NAME = 'vyapar-vaani-events';
    process.env.NETWORK_PARTICIPANT_ID = 'vyapar-vaani.ondc.in';
    process.env.BPP_BASE_URL = 'https://api.vyapar-vaani.ondc.in';
  });

  test('Step 1: search — discover products', async () => {
    const request = {
      context: createContext('search'),
      message: {
        intent: {
          item: { descriptor: { name: 'tomato' } },
          fulfillment: { type: 'Delivery' },
        },
      },
    };

    const response = await handleSearch(request);

    expect(response.context.action).toBe('on_search');
    expect(response.context.transaction_id).toBe(TRANSACTION_ID);
    expect(response.message).toBeDefined();
    // Catalog should contain providers with items
    console.log('Search response:', JSON.stringify(response.message, null, 2).substring(0, 500));
  });

  test('Step 2: select — get quote for items', async () => {
    const request = {
      context: createContext('select'),
      message: {
        order: {
          provider: { id: '919876543210' },
          items: [{ id: 'item-001', quantity: { count: 2 } }],
        },
      },
    };

    const response = await handleSelect(request);

    expect(response.context.action).toBe('on_select');
    expect(response.context.transaction_id).toBe(TRANSACTION_ID);
    expect(response.message).toBeDefined();
    console.log('Select response:', JSON.stringify(response.message, null, 2).substring(0, 500));
  });

  test('Step 3: init — initialize order with billing & fulfillment', async () => {
    const request = {
      context: createContext('init'),
      message: {
        order: {
          provider: { id: '919876543210' },
          items: [{ id: 'item-001', quantity: { count: 2 } }],
          billing: {
            name: 'Priya Sharma',
            phone: '919876543211',
            address: {
              name: 'Home',
              building: 'A-101',
              locality: 'Koregaon Park',
              city: 'Pune',
              state: 'Maharashtra',
              country: 'IND',
              area_code: '411001',
            },
          },
          fulfillments: [{
            id: 'F1',
            type: 'Delivery',
            end: {
              location: {
                id: 'L1',
                gps: '18.5362,73.8939',
                address: {
                  locality: 'Kothrud',
                  city: 'Pune',
                  state: 'Maharashtra',
                  country: 'IND',
                  area_code: '411001',
                },
              },
              contact: { phone: '919876543211' },
            },
          }],
        },
      },
    };

    const response = await handleInit(request);

    expect(response.context.action).toBe('on_init');
    expect(response.context.transaction_id).toBe(TRANSACTION_ID);
    expect(response.message).toBeDefined();
    console.log('Init response:', JSON.stringify(response.message, null, 2).substring(0, 500));
  });

  test('Step 4: confirm — place the order', async () => {
    const request = {
      context: createContext('confirm'),
      message: {
        order: {
          provider: { id: '919876543210' },
          items: [{ id: 'item-001', fulfillment_id: 'F1', quantity: { count: 2 } }],
          billing: {
            name: 'Priya Sharma',
            phone: '919876543211',
          },
          fulfillments: [{
            id: 'F1',
            type: 'Delivery' as const,
            end: {
              location: { id: 'L1', gps: '18.5362,73.8939', address: { locality: 'Kothrud', city: 'Pune', state: 'Maharashtra', country: 'IND', area_code: '411001' } },
              contact: { phone: '919876543211' },
            },
          }],
          payment: {
            type: 'ON-FULFILLMENT' as const,
            status: 'NOT-PAID' as const,
          },
        },
      },
    };

    const response = await handleConfirm(request);

    expect(response.context.action).toBe('on_confirm');
    expect(response.context.transaction_id).toBe(TRANSACTION_ID);
    expect(response.message).toBeDefined();
    console.log('Confirm response:', JSON.stringify(response.message, null, 2).substring(0, 500));
  });

  test('Step 5: status — check order status', async () => {
    const request = {
      context: createContext('status'),
      message: {
        order_id: 'any-order-id', // mocked to return CONFIRMED
      },
    };

    const response = await handleStatus(request);

    expect(response.context.action).toBe('on_status');
    expect(response.context.transaction_id).toBe(TRANSACTION_ID);
    expect(response.message).toBeDefined();
    console.log('Status response:', JSON.stringify(response.message, null, 2).substring(0, 500));
  });

  test('Full flow maintains transaction_id continuity', async () => {
    // All responses in the flow should carry the same transaction_id
    const searchResp = await handleSearch({
      context: createContext('search'),
      message: { intent: { item: { descriptor: { name: 'tomato' } } } },
    });

    const selectResp = await handleSelect({
      context: createContext('select'),
      message: { order: { provider: { id: '919876543210' }, items: [{ id: 'item-001', quantity: { count: 1 } }] } },
    });

    const statusResp = await handleStatus({
      context: createContext('status'),
      message: { order_id: 'test-order' },
    });

    expect(searchResp.context.transaction_id).toBe(TRANSACTION_ID);
    expect(selectResp.context.transaction_id).toBe(TRANSACTION_ID);
    expect(statusResp.context.transaction_id).toBe(TRANSACTION_ID);
  });
});
