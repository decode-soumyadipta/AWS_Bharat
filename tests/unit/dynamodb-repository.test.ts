/**
 * Unit Tests for DynamoDB Repository
 * 
 * Tests CRUD operations for sellers, catalog items, and orders
 * including optimistic locking behavior.
 * 
 * Validates: Requirements 1.7, 2.9, 5.6
 */

import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import {
  createSellerProfile,
  getSellerById,
  getSellerByPhone,
  updateSellerProfile,
  createCatalogItem,
  getCatalogItem,
  getCatalogItemsBySeller,
  getCatalogItemsByCategory,
  updateCatalogItem,
  deleteCatalogItem,
  createOrder,
  getOrderById,
  getOrdersBySeller,
  getOrdersBySellerAndStatus,
  updateOrderStatus,
  updateOrder,
  OptimisticLockError,
} from '../../src/services/dynamodb-repository';
import { SellerProfile } from '../../src/models/seller';
import { CatalogItem } from '../../src/models/catalog';
import { Order, OrderStatus } from '../../src/models/order';

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('DynamoDB Repository - Seller Operations', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  describe('createSellerProfile', () => {
    it('should create a new seller profile', async () => {
      const mockProfile: SellerProfile = {
        PK: 'SELLER#seller-123',
        SK: 'PROFILE',
        GSI1PK: '+919876543210',
        GSI1SK: 'PROFILE',
        entityType: 'SELLER_PROFILE',
        sellerId: 'seller-123',
        phone: '+919876543210',
        name: 'Sunita Devi',
        language: 'hi',
        kyc: {
          panNumber: 'ABCDE1234F',
          aadharNumber: 'encrypted-aadhar',
          documentUrls: ['s3://bucket/pan.jpg'],
          verifiedAt: Date.now(),
          status: 'VERIFIED',
        },
        ondc: {
          subscriberId: 'vyapar-vaani.ondc.in',
          subscriberUrl: 'https://api.vyapar-vaani.ondc.in',
          signingPublicKey: 'public-key',
          encryptionPublicKey: 'encryption-key',
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      ddbMock.on(PutCommand).resolves({});

      const result = await createSellerProfile(mockProfile);

      expect(result).toEqual(mockProfile);
      expect(ddbMock.calls()).toHaveLength(1);
    });

    it('should throw error if seller already exists', async () => {
      const mockProfile: SellerProfile = {
        PK: 'SELLER#seller-123',
        SK: 'PROFILE',
        GSI1PK: '+919876543210',
        GSI1SK: 'PROFILE',
        entityType: 'SELLER_PROFILE',
        sellerId: 'seller-123',
        phone: '+919876543210',
        name: 'Sunita Devi',
        language: 'hi',
        kyc: {
          panNumber: 'ABCDE1234F',
          aadharNumber: 'encrypted-aadhar',
          documentUrls: [],
          verifiedAt: Date.now(),
          status: 'VERIFIED',
        },
        ondc: {
          subscriberId: 'vyapar-vaani.ondc.in',
          subscriberUrl: 'https://api.vyapar-vaani.ondc.in',
          signingPublicKey: 'public-key',
          encryptionPublicKey: 'encryption-key',
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(PutCommand).rejects(error);

      await expect(createSellerProfile(mockProfile)).rejects.toThrow('Seller profile already exists');
    });
  });

  describe('getSellerById', () => {
    it('should retrieve seller by ID', async () => {
      const mockProfile: SellerProfile = {
        PK: 'SELLER#seller-123',
        SK: 'PROFILE',
        GSI1PK: '+919876543210',
        GSI1SK: 'PROFILE',
        entityType: 'SELLER_PROFILE',
        sellerId: 'seller-123',
        phone: '+919876543210',
        name: 'Sunita Devi',
        language: 'hi',
        kyc: {
          panNumber: 'ABCDE1234F',
          aadharNumber: 'encrypted-aadhar',
          documentUrls: [],
          verifiedAt: Date.now(),
          status: 'VERIFIED',
        },
        ondc: {
          subscriberId: 'vyapar-vaani.ondc.in',
          subscriberUrl: 'https://api.vyapar-vaani.ondc.in',
          signingPublicKey: 'public-key',
          encryptionPublicKey: 'encryption-key',
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      ddbMock.on(GetCommand).resolves({ Item: mockProfile });

      const result = await getSellerById('seller-123');

      expect(result).toEqual(mockProfile);
      expect(ddbMock.calls()).toHaveLength(1);
    });

    it('should return null if seller not found', async () => {
      ddbMock.on(GetCommand).resolves({});

      const result = await getSellerById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getSellerByPhone', () => {
    it('should retrieve seller by phone number using GSI1', async () => {
      const mockProfile: SellerProfile = {
        PK: 'SELLER#seller-123',
        SK: 'PROFILE',
        GSI1PK: '+919876543210',
        GSI1SK: 'PROFILE',
        entityType: 'SELLER_PROFILE',
        sellerId: 'seller-123',
        phone: '+919876543210',
        name: 'Sunita Devi',
        language: 'hi',
        kyc: {
          panNumber: 'ABCDE1234F',
          aadharNumber: 'encrypted-aadhar',
          documentUrls: [],
          verifiedAt: Date.now(),
          status: 'VERIFIED',
        },
        ondc: {
          subscriberId: 'vyapar-vaani.ondc.in',
          subscriberUrl: 'https://api.vyapar-vaani.ondc.in',
          signingPublicKey: 'public-key',
          encryptionPublicKey: 'encryption-key',
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      ddbMock.on(QueryCommand).resolves({ Items: [mockProfile] });

      const result = await getSellerByPhone('+919876543210');

      expect(result).toEqual(mockProfile);
    });

    it('should return null if phone not found', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const result = await getSellerByPhone('+919999999999');

      expect(result).toBeNull();
    });
  });

  describe('updateSellerProfile', () => {
    it('should update seller profile fields', async () => {
      const updatedProfile: SellerProfile = {
        PK: 'SELLER#seller-123',
        SK: 'PROFILE',
        GSI1PK: '+919876543210',
        GSI1SK: 'PROFILE',
        entityType: 'SELLER_PROFILE',
        sellerId: 'seller-123',
        phone: '+919876543210',
        name: 'Sunita Devi Updated',
        language: 'mr',
        kyc: {
          panNumber: 'ABCDE1234F',
          aadharNumber: 'encrypted-aadhar',
          documentUrls: [],
          verifiedAt: Date.now(),
          status: 'VERIFIED',
        },
        ondc: {
          subscriberId: 'vyapar-vaani.ondc.in',
          subscriberUrl: 'https://api.vyapar-vaani.ondc.in',
          signingPublicKey: 'public-key',
          encryptionPublicKey: 'encryption-key',
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      ddbMock.on(UpdateCommand).resolves({ Attributes: updatedProfile });

      const result = await updateSellerProfile('seller-123', {
        name: 'Sunita Devi Updated',
        language: 'mr',
      });

      expect(result.name).toBe('Sunita Devi Updated');
      expect(result.language).toBe('mr');
    });
  });
});

describe('DynamoDB Repository - Catalog Operations', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  describe('createCatalogItem', () => {
    it('should create a new catalog item', async () => {
      const mockItem: CatalogItem = {
        PK: 'SELLER#seller-123',
        SK: 'ITEM#item-456',
        GSI3PK: 'CATEGORY#food',
        GSI3SK: 'ITEM#item-456',
        entityType: 'CATALOG_ITEM',
        itemId: 'item-456',
        sellerId: 'seller-123',
        becknItem: {
          id: 'item-456',
          descriptor: {
            name: 'Mango Pickle',
            short_desc: 'Homemade mango pickle',
            long_desc: 'Traditional Maharashtrian mango pickle',
            images: ['https://s3.amazonaws.com/image.jpg'],
          },
          price: {
            currency: 'INR',
            value: '200.00',
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
        },
        images: {
          raw: 's3://bucket/raw.jpg',
          enhanced: 's3://bucket/enhanced.jpg',
        },
        status: 'ACTIVE',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1,
      };

      ddbMock.on(PutCommand).resolves({});

      const result = await createCatalogItem(mockItem);

      expect(result).toEqual(mockItem);
    });
  });

  describe('getCatalogItem', () => {
    it('should retrieve catalog item by seller and item ID', async () => {
      const mockItem: CatalogItem = {
        PK: 'SELLER#seller-123',
        SK: 'ITEM#item-456',
        GSI3PK: 'CATEGORY#food',
        GSI3SK: 'ITEM#item-456',
        entityType: 'CATALOG_ITEM',
        itemId: 'item-456',
        sellerId: 'seller-123',
        becknItem: {
          id: 'item-456',
          descriptor: {
            name: 'Mango Pickle',
            short_desc: 'Homemade',
            long_desc: 'Traditional',
            images: [],
          },
          price: { currency: 'INR', value: '200.00' },
          quantity: {
            available: { count: 50 },
            maximum: { count: 10 },
          },
          category_id: 'Grocery',
          fulfillment_id: 'F1',
          location_id: 'L1',
          time: { label: 'enable', timestamp: new Date().toISOString() },
          tags: [],
        },
        images: { raw: 's3://raw.jpg', enhanced: 's3://enhanced.jpg' },
        status: 'ACTIVE',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1,
      };

      ddbMock.on(GetCommand).resolves({ Item: mockItem });

      const result = await getCatalogItem('seller-123', 'item-456');

      expect(result).toEqual(mockItem);
    });

    it('should return null if catalog item not found', async () => {
      ddbMock.on(GetCommand).resolves({});

      const result = await getCatalogItem('seller-123', 'non-existent-item');

      expect(result).toBeNull();
    });
  });

  describe('getCatalogItemsBySeller', () => {
    it('should retrieve all items for a seller', async () => {
      const mockItems: CatalogItem[] = [
        {
          PK: 'SELLER#seller-123',
          SK: 'ITEM#item-1',
          GSI3PK: 'CATEGORY#food',
          GSI3SK: 'ITEM#item-1',
          entityType: 'CATALOG_ITEM',
          itemId: 'item-1',
          sellerId: 'seller-123',
          becknItem: {} as any,
          images: { raw: '', enhanced: '' },
          status: 'ACTIVE',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: 1,
        },
        {
          PK: 'SELLER#seller-123',
          SK: 'ITEM#item-2',
          GSI3PK: 'CATEGORY#grocery',
          GSI3SK: 'ITEM#item-2',
          entityType: 'CATALOG_ITEM',
          itemId: 'item-2',
          sellerId: 'seller-123',
          becknItem: {} as any,
          images: { raw: '', enhanced: '' },
          status: 'ACTIVE',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: 1,
        },
      ];

      ddbMock.on(QueryCommand).resolves({ Items: mockItems });

      const result = await getCatalogItemsBySeller('seller-123');

      expect(result).toHaveLength(2);
      expect(result[0].itemId).toBe('item-1');
      expect(result[1].itemId).toBe('item-2');
    });

    it('should return empty array if seller has no items', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const result = await getCatalogItemsBySeller('seller-with-no-items');

      expect(result).toEqual([]);
    });
  });

  describe('getCatalogItemsByCategory', () => {
    it('should retrieve items by category using GSI3', async () => {
      const mockItems: CatalogItem[] = [
        {
          PK: 'SELLER#seller-123',
          SK: 'ITEM#item-1',
          GSI3PK: 'CATEGORY#food',
          GSI3SK: 'ITEM#item-1',
          entityType: 'CATALOG_ITEM',
          itemId: 'item-1',
          sellerId: 'seller-123',
          becknItem: {} as any,
          images: { raw: '', enhanced: '' },
          status: 'ACTIVE',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: 1,
        },
      ];

      ddbMock.on(QueryCommand).resolves({ Items: mockItems });

      const result = await getCatalogItemsByCategory('food');

      expect(result).toHaveLength(1);
      expect(result[0].GSI3PK).toBe('CATEGORY#food');
    });

    it('should return empty array if category has no items', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const result = await getCatalogItemsByCategory('empty-category');

      expect(result).toEqual([]);
    });

    it('should retrieve multiple items from same category', async () => {
      const mockItems: CatalogItem[] = [
        {
          PK: 'SELLER#seller-123',
          SK: 'ITEM#item-1',
          GSI3PK: 'CATEGORY#grocery',
          GSI3SK: 'ITEM#item-1',
          entityType: 'CATALOG_ITEM',
          itemId: 'item-1',
          sellerId: 'seller-123',
          becknItem: {} as any,
          images: { raw: '', enhanced: '' },
          status: 'ACTIVE',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: 1,
        },
        {
          PK: 'SELLER#seller-456',
          SK: 'ITEM#item-2',
          GSI3PK: 'CATEGORY#grocery',
          GSI3SK: 'ITEM#item-2',
          entityType: 'CATALOG_ITEM',
          itemId: 'item-2',
          sellerId: 'seller-456',
          becknItem: {} as any,
          images: { raw: '', enhanced: '' },
          status: 'ACTIVE',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: 1,
        },
      ];

      ddbMock.on(QueryCommand).resolves({ Items: mockItems });

      const result = await getCatalogItemsByCategory('grocery');

      expect(result).toHaveLength(2);
      expect(result[0].GSI3PK).toBe('CATEGORY#grocery');
      expect(result[1].GSI3PK).toBe('CATEGORY#grocery');
    });
  });

  describe('updateCatalogItem', () => {
    it('should update catalog item with optimistic locking', async () => {
      const updatedItem: CatalogItem = {
        PK: 'SELLER#seller-123',
        SK: 'ITEM#item-456',
        GSI3PK: 'CATEGORY#food',
        GSI3SK: 'ITEM#item-456',
        entityType: 'CATALOG_ITEM',
        itemId: 'item-456',
        sellerId: 'seller-123',
        becknItem: {} as any,
        images: { raw: '', enhanced: '' },
        status: 'OUT_OF_STOCK',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 2,
      };

      ddbMock.on(UpdateCommand).resolves({ Attributes: updatedItem });

      const result = await updateCatalogItem('seller-123', 'item-456', { status: 'OUT_OF_STOCK' }, 1);

      expect(result.status).toBe('OUT_OF_STOCK');
      expect(result.version).toBe(2);
    });

    it('should throw OptimisticLockError on version mismatch', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(UpdateCommand).rejects(error);

      await expect(
        updateCatalogItem('seller-123', 'item-456', { status: 'OUT_OF_STOCK' }, 1)
      ).rejects.toThrow(OptimisticLockError);
    });
  });

  describe('deleteCatalogItem', () => {
    it('should delete catalog item', async () => {
      ddbMock.on(DeleteCommand).resolves({});

      await deleteCatalogItem('seller-123', 'item-456');

      expect(ddbMock.calls()).toHaveLength(1);
    });
  });
});

describe('DynamoDB Repository - Order Operations', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  describe('createOrder', () => {
    it('should create a new order', async () => {
      const mockOrder: Order = {
        PK: 'ORDER#order-789',
        SK: 'METADATA',
        GSI2PK: 'SELLER#seller-123',
        GSI2SK: 'STATUS#PENDING#1234567890',
        entityType: 'ORDER',
        orderId: 'order-789',
        sellerId: 'seller-123',
        buyerAppId: 'buyer-app-1',
        transactionId: 'txn-123',
        items: [
          { itemId: 'item-456', quantity: 2, price: 200 },
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
          contact: { phone: '+919876543210' },
        },
        payment: {
          type: 'ON-ORDER',
          status: 'PAID',
          amount: 400,
        },
        status: 'PENDING',
        timeline: [
          { status: 'PENDING', timestamp: Date.now(), actor: 'SYSTEM' },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      ddbMock.on(PutCommand).resolves({});

      const result = await createOrder(mockOrder);

      expect(result).toEqual(mockOrder);
    });

    it('should throw error if order already exists', async () => {
      const mockOrder: Order = {
        PK: 'ORDER#order-789',
        SK: 'METADATA',
        GSI2PK: 'SELLER#seller-123',
        GSI2SK: 'STATUS#PENDING#1234567890',
        entityType: 'ORDER',
        orderId: 'order-789',
        sellerId: 'seller-123',
        buyerAppId: 'buyer-app-1',
        transactionId: 'txn-123',
        items: [],
        fulfillment: { type: 'Delivery', contact: { phone: '+919876543210' } },
        payment: { type: 'ON-ORDER', status: 'PAID', amount: 400 },
        status: 'PENDING',
        timeline: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(PutCommand).rejects(error);

      await expect(createOrder(mockOrder)).rejects.toThrow('Order already exists');
    });
  });

  describe('getOrderById', () => {
    it('should retrieve order by ID', async () => {
      const mockOrder: Order = {
        PK: 'ORDER#order-789',
        SK: 'METADATA',
        GSI2PK: 'SELLER#seller-123',
        GSI2SK: 'STATUS#PENDING#1234567890',
        entityType: 'ORDER',
        orderId: 'order-789',
        sellerId: 'seller-123',
        buyerAppId: 'buyer-app-1',
        transactionId: 'txn-123',
        items: [],
        fulfillment: {
          type: 'Delivery',
          contact: { phone: '+919876543210' },
        },
        payment: {
          type: 'ON-ORDER',
          status: 'PAID',
          amount: 400,
        },
        status: 'PENDING',
        timeline: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      ddbMock.on(GetCommand).resolves({ Item: mockOrder });

      const result = await getOrderById('order-789');

      expect(result).toEqual(mockOrder);
    });

    it('should return null if order not found', async () => {
      ddbMock.on(GetCommand).resolves({});

      const result = await getOrderById('non-existent-order');

      expect(result).toBeNull();
    });
  });

  describe('getOrdersBySeller', () => {
    it('should retrieve all orders for a seller using GSI2', async () => {
      const mockOrders: Order[] = [
        {
          PK: 'ORDER#order-1',
          SK: 'METADATA',
          GSI2PK: 'SELLER#seller-123',
          GSI2SK: 'STATUS#PENDING#1234567890',
          entityType: 'ORDER',
          orderId: 'order-1',
          sellerId: 'seller-123',
          buyerAppId: 'buyer-app-1',
          transactionId: 'txn-1',
          items: [],
          fulfillment: { type: 'Delivery', contact: { phone: '+919876543210' } },
          payment: { type: 'ON-ORDER', status: 'PAID', amount: 400 },
          status: 'PENDING',
          timeline: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];

      ddbMock.on(QueryCommand).resolves({ Items: mockOrders });

      const result = await getOrdersBySeller('seller-123');

      expect(result).toHaveLength(1);
      expect(result[0].sellerId).toBe('seller-123');
    });

    it('should return empty array if seller has no orders', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const result = await getOrdersBySeller('seller-with-no-orders');

      expect(result).toEqual([]);
    });
  });

  describe('getOrdersBySellerAndStatus', () => {
    it('should retrieve orders by seller and status using GSI2', async () => {
      const mockOrders: Order[] = [
        {
          PK: 'ORDER#order-1',
          SK: 'METADATA',
          GSI2PK: 'SELLER#seller-123',
          GSI2SK: 'STATUS#ACCEPTED#1234567890',
          entityType: 'ORDER',
          orderId: 'order-1',
          sellerId: 'seller-123',
          buyerAppId: 'buyer-app-1',
          transactionId: 'txn-1',
          items: [],
          fulfillment: { type: 'Delivery', contact: { phone: '+919876543210' } },
          payment: { type: 'ON-ORDER', status: 'PAID', amount: 400 },
          status: 'ACCEPTED',
          timeline: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];

      ddbMock.on(QueryCommand).resolves({ Items: mockOrders });

      const result = await getOrdersBySellerAndStatus('seller-123', 'ACCEPTED');

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('ACCEPTED');
    });

    it('should return empty array if no orders match status', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const result = await getOrdersBySellerAndStatus('seller-123', 'DELIVERED');

      expect(result).toEqual([]);
    });

    it('should handle multiple orders with same status', async () => {
      const mockOrders: Order[] = [
        {
          PK: 'ORDER#order-1',
          SK: 'METADATA',
          GSI2PK: 'SELLER#seller-123',
          GSI2SK: 'STATUS#PENDING#1234567890',
          entityType: 'ORDER',
          orderId: 'order-1',
          sellerId: 'seller-123',
          buyerAppId: 'buyer-app-1',
          transactionId: 'txn-1',
          items: [],
          fulfillment: { type: 'Delivery', contact: { phone: '+919876543210' } },
          payment: { type: 'ON-ORDER', status: 'PAID', amount: 400 },
          status: 'PENDING',
          timeline: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          PK: 'ORDER#order-2',
          SK: 'METADATA',
          GSI2PK: 'SELLER#seller-123',
          GSI2SK: 'STATUS#PENDING#1234567891',
          entityType: 'ORDER',
          orderId: 'order-2',
          sellerId: 'seller-123',
          buyerAppId: 'buyer-app-2',
          transactionId: 'txn-2',
          items: [],
          fulfillment: { type: 'Delivery', contact: { phone: '+919876543211' } },
          payment: { type: 'ON-ORDER', status: 'PAID', amount: 500 },
          status: 'PENDING',
          timeline: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];

      ddbMock.on(QueryCommand).resolves({ Items: mockOrders });

      const result = await getOrdersBySellerAndStatus('seller-123', 'PENDING');

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('PENDING');
      expect(result[1].status).toBe('PENDING');
    });
  });

  describe('updateOrderStatus', () => {
    it('should update order status and add timeline entry', async () => {
      const updatedOrder: Order = {
        PK: 'ORDER#order-789',
        SK: 'METADATA',
        GSI2PK: 'SELLER#seller-123',
        GSI2SK: 'STATUS#ACCEPTED#1234567890',
        entityType: 'ORDER',
        orderId: 'order-789',
        sellerId: 'seller-123',
        buyerAppId: 'buyer-app-1',
        transactionId: 'txn-123',
        items: [],
        fulfillment: { type: 'Delivery', contact: { phone: '+919876543210' } },
        payment: { type: 'ON-ORDER', status: 'PAID', amount: 400 },
        status: 'ACCEPTED',
        timeline: [
          { status: 'PENDING', timestamp: 1234567890, actor: 'SYSTEM' },
          { status: 'ACCEPTED', timestamp: Date.now(), actor: 'SELLER' },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      ddbMock.on(UpdateCommand).resolves({ Attributes: updatedOrder });

      const result = await updateOrderStatus('order-789', 'seller-123', 'ACCEPTED', {
        status: 'ACCEPTED',
        timestamp: Date.now(),
        actor: 'SELLER',
      });

      expect(result.status).toBe('ACCEPTED');
      expect(result.timeline).toHaveLength(2);
    });

    it('should update GSI2SK when status changes', async () => {
      const timestamp = Date.now();
      const updatedOrder: Order = {
        PK: 'ORDER#order-789',
        SK: 'METADATA',
        GSI2PK: 'SELLER#seller-123',
        GSI2SK: `STATUS#PACKED#${timestamp}`,
        entityType: 'ORDER',
        orderId: 'order-789',
        sellerId: 'seller-123',
        buyerAppId: 'buyer-app-1',
        transactionId: 'txn-123',
        items: [],
        fulfillment: { type: 'Delivery', contact: { phone: '+919876543210' } },
        payment: { type: 'ON-ORDER', status: 'PAID', amount: 400 },
        status: 'PACKED',
        timeline: [
          { status: 'PENDING', timestamp: 1234567890, actor: 'SYSTEM' },
          { status: 'ACCEPTED', timestamp: 1234567891, actor: 'SELLER' },
          { status: 'PACKED', timestamp, actor: 'SELLER' },
        ],
        createdAt: Date.now(),
        updatedAt: timestamp,
      };

      ddbMock.on(UpdateCommand).resolves({ Attributes: updatedOrder });

      const result = await updateOrderStatus('order-789', 'seller-123', 'PACKED', {
        status: 'PACKED',
        timestamp,
        actor: 'SELLER',
      });

      expect(result.status).toBe('PACKED');
      expect(result.GSI2SK).toBe(`STATUS#PACKED#${timestamp}`);
      expect(result.timeline).toHaveLength(3);
    });

    it('should add notes to timeline entry when provided', async () => {
      const updatedOrder: Order = {
        PK: 'ORDER#order-789',
        SK: 'METADATA',
        GSI2PK: 'SELLER#seller-123',
        GSI2SK: 'STATUS#REJECTED#1234567890',
        entityType: 'ORDER',
        orderId: 'order-789',
        sellerId: 'seller-123',
        buyerAppId: 'buyer-app-1',
        transactionId: 'txn-123',
        items: [],
        fulfillment: { type: 'Delivery', contact: { phone: '+919876543210' } },
        payment: { type: 'ON-ORDER', status: 'PAID', amount: 400 },
        status: 'REJECTED',
        timeline: [
          { status: 'PENDING', timestamp: 1234567890, actor: 'SYSTEM' },
          { status: 'REJECTED', timestamp: Date.now(), actor: 'SELLER', notes: 'Out of stock' },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      ddbMock.on(UpdateCommand).resolves({ Attributes: updatedOrder });

      const result = await updateOrderStatus('order-789', 'seller-123', 'REJECTED', {
        status: 'REJECTED',
        timestamp: Date.now(),
        actor: 'SELLER',
        notes: 'Out of stock',
      });

      expect(result.status).toBe('REJECTED');
      expect(result.timeline[1].notes).toBe('Out of stock');
    });
  });

  describe('updateOrder', () => {
    it('should update order with optimistic locking', async () => {
      const updatedOrder: Order = {
        PK: 'ORDER#order-789',
        SK: 'METADATA',
        GSI2PK: 'SELLER#seller-123',
        GSI2SK: 'STATUS#ACCEPTED#1234567890',
        entityType: 'ORDER',
        orderId: 'order-789',
        sellerId: 'seller-123',
        buyerAppId: 'buyer-app-1',
        transactionId: 'txn-123',
        items: [],
        fulfillment: { type: 'Delivery', contact: { phone: '+919876543210' } },
        payment: { type: 'ON-ORDER', status: 'PAID', amount: 400 },
        status: 'ACCEPTED',
        timeline: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      ddbMock.on(UpdateCommand).resolves({ Attributes: updatedOrder });

      const result = await updateOrder('order-789', { status: 'ACCEPTED' }, 1234567890);

      expect(result.status).toBe('ACCEPTED');
    });

    it('should throw OptimisticLockError on timestamp mismatch', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(UpdateCommand).rejects(error);

      await expect(
        updateOrder('order-789', { status: 'ACCEPTED' }, 1234567890)
      ).rejects.toThrow(OptimisticLockError);
    });
  });
});
