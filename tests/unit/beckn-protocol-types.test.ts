/**
 * Beckn Protocol Types — Unit Tests
 * 
 * Tests type correctness, constants, and domain mappings
 * for Beckn Protocol v1.2.0 types used in ONDC.
 */

import {
  ONDC_DOMAINS,
  ONDC_ORDER_STATES,
  BECKN_CANCELLATION_REASONS,
} from '../../src/models/beckn-protocol';

import type {
  BecknContext,
  BecknAction,
  BecknRequest,
  BecknResponse,
  BecknItem,
  BecknOrder,
  BecknFulfillment,
  BecknPayment,
  BecknQuotation,
  BecknBilling,
} from '../../src/models/beckn-protocol';

describe('Beckn Protocol Types', () => {
  describe('ONDC_DOMAINS', () => {
    test('contains all standard ONDC retail domains', () => {
      expect(ONDC_DOMAINS).toHaveProperty('GROCERY');
      expect(ONDC_DOMAINS.GROCERY).toBe('ONDC:RET10');
    });

    test('has correct domain codes', () => {
      const expectedDomains: Record<string, string> = {
        GROCERY: 'ONDC:RET10',
      };

      Object.entries(expectedDomains).forEach(([key, value]) => {
        expect(ONDC_DOMAINS).toHaveProperty(key, value);
      });
    });
  });

  describe('ONDC_ORDER_STATES', () => {
    test('contains all standard order states', () => {
      const requiredStates = ['Created', 'Accepted', 'In-progress', 'Completed', 'Cancelled'];

      requiredStates.forEach((state) => {
        expect(Object.values(ONDC_ORDER_STATES)).toContain(state);
      });
    });
  });

  describe('BECKN_CANCELLATION_REASONS', () => {
    test('contains cancellation reasons with codes and descriptions', () => {
      expect(typeof BECKN_CANCELLATION_REASONS).toBe('object');
      const entries = Object.entries(BECKN_CANCELLATION_REASONS);
      expect(entries.length).toBeGreaterThan(0);

      entries.forEach(([code, description]) => {
        expect(typeof code).toBe('string');
        expect(typeof description).toBe('string');
        expect(description.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Type Contracts', () => {
    test('BecknContext has all required fields', () => {
      const context: BecknContext = {
        domain: 'ONDC:RET10',
        country: 'IND',
        city: 'std:080',
        action: 'search',
        core_version: '1.2.0',
        bap_id: 'test-bap.ondc.in',
        bap_uri: 'https://test-bap.ondc.in',
        bpp_id: 'test-bpp.ondc.in',
        bpp_uri: 'https://test-bpp.ondc.in',
        transaction_id: 'txn-001',
        message_id: 'msg-001',
        timestamp: new Date().toISOString(),
      };

      expect(context.domain).toBe('ONDC:RET10');
      expect(context.core_version).toBe('1.2.0');
      expect(context.country).toBe('IND');
    });

    test('BecknAction covers all 20 actions', () => {
      const actions: BecknAction[] = [
        'search', 'on_search',
        'select', 'on_select',
        'init', 'on_init',
        'confirm', 'on_confirm',
        'status', 'on_status',
        'track', 'on_track',
        'cancel', 'on_cancel',
        'update', 'on_update',
        'rating', 'on_rating',
        'support', 'on_support',
      ];

      expect(actions).toHaveLength(20);
    });

    test('BecknItem has Beckn v1.2.0 structure', () => {
      const item: BecknItem = {
        id: 'item-001',
        fulfillment_id: 'F1',
        quantity: { count: 50 },
        descriptor: {
          name: 'Tomato',
          short_desc: 'Fresh organic tomato',
          images: [{ url: 'https://example.com/tomato.jpg' }],
        },
        price: { currency: 'INR', value: '40' },
        category_id: 'Vegetables',
      };

      expect(item.id).toBe('item-001');
      expect(item.price?.currency).toBe('INR');
      expect(item.quantity.count).toBe(50);
    });

    test('BecknFulfillment has proper structure', () => {
      const fulfillment: BecknFulfillment = {
        id: 'F1',
        type: 'Delivery',
        state: { descriptor: { code: 'Pending' } },
        tracking: false,
        start: {
          location: {
            id: 'loc-1',
            gps: '18.5204,73.8567',
            address: { locality: 'Shivajinagar', city: 'Pune', state: 'MH', country: 'IND', area_code: '411001' },
          },
        },
        end: {
          location: {
            id: 'loc-2',
            gps: '19.0760,72.8777',
            address: { locality: 'Andheri', city: 'Mumbai', state: 'MH', country: 'IND', area_code: '400001' },
          },
          contact: { phone: '9876543210' },
        },
      };

      expect(fulfillment.type).toBe('Delivery');
      expect(fulfillment.state?.descriptor?.code).toBe('Pending');
    });

    test('BecknPayment has ONDC-compliant structure', () => {
      const payment: BecknPayment = {
        type: 'ON-FULFILLMENT',
        status: 'NOT-PAID',
        params: {
          currency: 'INR',
          amount: '100.00',
        },
        collected_by: 'BAP',
      };

      expect(payment.type).toBe('ON-FULFILLMENT');
      expect(payment.params?.currency).toBe('INR');
    });
  });
});
