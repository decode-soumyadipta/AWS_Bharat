/**
 * Unit tests for data model interfaces
 * 
 * These tests verify that the TypeScript interfaces are properly defined
 * and can be used to create valid data structures.
 */

import {
  SellerProfile,
  KYCInfo,
  ONDCRegistration,
  CatalogItem,
  BecknCatalogItem,
  Order,
  OrderTimeline,
  OrderStatus,
  VALID_ORDER_TRANSITIONS,
} from '../../src/models';

describe('Data Model Interfaces', () => {
  describe('SellerProfile', () => {
    it('should create a valid seller profile', () => {
      const kycInfo: KYCInfo = {
        panNumber: 'ABCDE1234F',
        aadharNumber: '1234 5678 9012', // Would be encrypted in production
        documentUrls: ['s3://bucket/pan.jpg', 's3://bucket/aadhar.jpg'],
        verifiedAt: Date.now(),
        status: 'VERIFIED',
      };

      const ondcRegistration: ONDCRegistration = {
        subscriberId: 'vyapar-vaani.ondc.in',
        subscriberUrl: 'https://api.vyapar-vaani.ondc.in',
        signingPublicKey: 'ed25519-public-key',
        encryptionPublicKey: 'encryption-public-key',
      };

      const sellerProfile: SellerProfile = {
        PK: 'SELLER#123e4567-e89b-12d3-a456-426614174000',
        SK: 'PROFILE',
        GSI1PK: '+919876543210',
        GSI1SK: 'PROFILE',
        entityType: 'SELLER_PROFILE',
        sellerId: '123e4567-e89b-12d3-a456-426614174000',
        phone: '+919876543210',
        name: 'Sunita Devi',
        language: 'hi',
        onboardingState: 'ACTIVE',
        kyc: kycInfo,
        ondc: ondcRegistration,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      expect(sellerProfile.sellerId).toBe('123e4567-e89b-12d3-a456-426614174000');
      expect(sellerProfile.language).toBe('hi');
      expect(sellerProfile.kyc.status).toBe('VERIFIED');
      expect(sellerProfile.ondc.subscriberId).toBe('vyapar-vaani.ondc.in');
    });

    it('should support all language options', () => {
      const languages: Array<'hi' | 'mr' | 'en'> = ['hi', 'mr', 'en'];
      
      languages.forEach(lang => {
        const profile: Partial<SellerProfile> = {
          language: lang,
        };
        expect(['hi', 'mr', 'en']).toContain(profile.language);
      });
    });

    it('should support all KYC status values', () => {
      const statuses: Array<'PENDING' | 'VERIFIED' | 'REJECTED'> = [
        'PENDING',
        'VERIFIED',
        'REJECTED',
      ];

      statuses.forEach(status => {
        const kyc: Partial<KYCInfo> = {
          status,
        };
        expect(['PENDING', 'VERIFIED', 'REJECTED']).toContain(kyc.status);
      });
    });
  });

  describe('CatalogItem', () => {
    it('should create a valid catalog item with Beckn structure', () => {
      const becknItem: BecknCatalogItem = {
        id: 'item-123',
        descriptor: {
          name: 'आम का अचार',
          code: '10039990',
          symbol: 'https://s3.amazonaws.com/bucket/product.jpg',
          short_desc: 'Homemade mango pickle',
          long_desc: 'Traditional Maharashtrian mango pickle',
          images: ['https://s3.amazonaws.com/bucket/product.jpg'],
        },
        price: {
          currency: 'INR',
          value: '200.00',
          maximum_value: '200.00',
        },
        quantity: {
          available: { count: 50 },
          maximum: { count: 10 },
        },
        category_id: 'Grocery',
        fulfillment_id: 'F1',
        location_id: 'L1',
        time: {
          label: 'enable',
          timestamp: new Date().toISOString(),
        },
        tags: [],
        '@ondc/org/returnable': false,
        '@ondc/org/cancellable': true,
        '@ondc/org/return_window': 'P0D',
        '@ondc/org/seller_pickup_return': false,
        '@ondc/org/time_to_ship': 'P2D',
        '@ondc/org/available_on_cod': true,
        '@ondc/org/contact_details_consumer_care': '+919876543210,support@example.com',
      };

      const catalogItem: CatalogItem = {
        PK: 'SELLER#seller-123',
        SK: 'ITEM#item-123',
        GSI3PK: 'CATEGORY#Grocery',
        GSI3SK: 'ITEM#item-123',
        entityType: 'CATALOG_ITEM',
        itemId: 'item-123',
        sellerId: 'seller-123',
        becknItem,
        images: {
          raw: 's3://bucket/raw/product.jpg',
          enhanced: 's3://bucket/enhanced/product.jpg',
        },
        status: 'ACTIVE',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1,
      };

      expect(catalogItem.itemId).toBe('item-123');
      expect(catalogItem.becknItem.descriptor.name).toBe('आम का अचार');
      expect(catalogItem.becknItem.price.currency).toBe('INR');
      expect(catalogItem.status).toBe('ACTIVE');
    });

    it('should support all catalog item status values', () => {
      const statuses: Array<'DRAFT' | 'ACTIVE' | 'OUT_OF_STOCK' | 'ARCHIVED'> = [
        'DRAFT',
        'ACTIVE',
        'OUT_OF_STOCK',
        'ARCHIVED',
      ];

      statuses.forEach(status => {
        const item: Partial<CatalogItem> = {
          status,
        };
        expect(['DRAFT', 'ACTIVE', 'OUT_OF_STOCK', 'ARCHIVED']).toContain(item.status);
      });
    });
  });

  describe('Order', () => {
    it('should create a valid order', () => {
      const order: Order = {
        PK: 'ORDER#order-123',
        SK: 'METADATA',
        GSI2PK: 'SELLER#seller-123',
        GSI2SK: 'STATUS#PENDING#1705315200000',
        entityType: 'ORDER',
        orderId: 'order-123',
        sellerId: 'seller-123',
        buyerAppId: 'buyer-app-id',
        transactionId: 'txn-123',
        items: [
          {
            itemId: 'item-123',
            quantity: 2,
            price: 200,
          },
        ],
        fulfillment: {
          type: 'Delivery',
          address: {
            name: 'John Doe',
            building: 'Building 1',
            locality: 'Locality',
            city: 'Mumbai',
            state: 'Maharashtra',
            country: 'IND',
            area_code: '400001',
          },
          contact: {
            phone: '+919876543210',
            email: 'john@example.com',
          },
        },
        payment: {
          type: 'ON-ORDER',
          status: 'PAID',
          amount: 400,
        },
        status: 'PENDING',
        timeline: [
          {
            status: 'PENDING',
            timestamp: Date.now(),
            actor: 'SYSTEM',
            notes: 'Order created',
          },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      expect(order.orderId).toBe('order-123');
      expect(order.status).toBe('PENDING');
      expect(order.items).toHaveLength(1);
      expect(order.payment.amount).toBe(400);
    });

    it('should support all order status values', () => {
      const statuses: OrderStatus[] = [
        'PENDING',
        'ACCEPTED',
        'REJECTED',
        'PACKED',
        'SHIPPED',
        'DELIVERED',
        'CANCELLED',
      ];

      statuses.forEach(status => {
        const order: Partial<Order> = {
          status,
        };
        expect(statuses).toContain(order.status);
      });
    });

    it('should define valid order state transitions', () => {
      // Test valid transitions
      expect(VALID_ORDER_TRANSITIONS.PENDING).toContain('ACCEPTED');
      expect(VALID_ORDER_TRANSITIONS.PENDING).toContain('REJECTED');
      expect(VALID_ORDER_TRANSITIONS.ACCEPTED).toContain('PACKED');
      expect(VALID_ORDER_TRANSITIONS.PACKED).toContain('SHIPPED');
      expect(VALID_ORDER_TRANSITIONS.SHIPPED).toContain('DELIVERED');

      // Test terminal states
      expect(VALID_ORDER_TRANSITIONS.REJECTED).toHaveLength(0);
      expect(VALID_ORDER_TRANSITIONS.DELIVERED).toHaveLength(0);
      expect(VALID_ORDER_TRANSITIONS.CANCELLED).toHaveLength(0);
    });
  });

  describe('OrderTimeline', () => {
    it('should create a valid order timeline entry', () => {
      const timeline: OrderTimeline = {
        PK: 'ORDER#order-123',
        SK: 'TIMELINE#1705315200000',
        entityType: 'ORDER_TIMELINE',
        orderId: 'order-123',
        status: 'ACCEPTED',
        timestamp: 1705315200000,
        actor: 'SELLER',
        notes: 'Order accepted via WhatsApp',
      };

      expect(timeline.orderId).toBe('order-123');
      expect(timeline.status).toBe('ACCEPTED');
      expect(timeline.actor).toBe('SELLER');
    });

    it('should support all actor types', () => {
      const actors: Array<'SELLER' | 'BUYER' | 'SYSTEM'> = ['SELLER', 'BUYER', 'SYSTEM'];

      actors.forEach(actor => {
        const timeline: Partial<OrderTimeline> = {
          actor,
        };
        expect(['SELLER', 'BUYER', 'SYSTEM']).toContain(timeline.actor);
      });
    });
  });
});
