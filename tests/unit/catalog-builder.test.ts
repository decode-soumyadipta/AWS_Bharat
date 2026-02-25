/**
 * Unit Tests for Catalog Builder Lambda
 * 
 * Tests the construction of Beckn-compliant catalog objects from
 * extracted product entities.
 * 
 * Validates: Requirements 2.5, 2.6, 4.5
 */

import { handler, CatalogBuilderRequest } from '../../src/lambdas/catalog-builder';
import { CatalogEntities } from '../../src/models/intent';
import { SellerProfile } from '../../src/models/seller';

/**
 * Create a mock seller profile for testing
 */
function createMockSellerProfile(): SellerProfile {
  return {
    PK: 'SELLER#test-seller-123',
    SK: 'PROFILE',
    GSI1PK: '+919876543210',
    GSI1SK: 'PROFILE',
    entityType: 'SELLER_PROFILE',
    sellerId: 'test-seller-123',
    phone: '+919876543210',
    name: 'Test Seller',
    language: 'hi',
    kyc: {
      panNumber: 'ABCDE1234F',
      aadharNumber: 'encrypted-aadhar',
      documentUrls: ['s3://bucket/pan.jpg', 's3://bucket/aadhar.jpg'],
      verifiedAt: Date.now(),
      status: 'VERIFIED',
    },
    ondc: {
      subscriberId: 'vyapar-vaani.ondc.in',
      subscriberUrl: 'https://api.vyapar-vaani.ondc.in',
      signingPublicKey: 'test-public-key',
      encryptionPublicKey: 'test-encryption-key',
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Create mock catalog entities for testing
 */
function createMockCatalogEntities(): CatalogEntities {
  return {
    product_name: 'Mango Pickle',
    price: 200,
    quantity: 50,
    unit: 'kg',
    description: 'Homemade traditional mango pickle',
    category: 'food',
  };
}

describe('Catalog Builder Lambda', () => {
  describe('handler', () => {
    it('should construct valid Beckn catalog item from entities', async () => {
      const request: CatalogBuilderRequest = {
        entities: createMockCatalogEntities(),
        sellerProfile: createMockSellerProfile(),
        imageUrl: 'https://s3.amazonaws.com/bucket/product.jpg',
        messageId: 'test-message-123',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.catalogItem).toBeDefined();
      expect(response.itemId).toBeDefined();
      expect(response.validation).toBeDefined();
      expect(response.validation?.valid).toBe(true);
      expect(response.error).toBeUndefined();
    });

    it('should generate unique item ID (UUID)', async () => {
      const request: CatalogBuilderRequest = {
        entities: createMockCatalogEntities(),
        sellerProfile: createMockSellerProfile(),
      };

      const response = await handler(request);

      expect(response.itemId).toBeDefined();
      expect(response.itemId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('should set descriptor fields correctly', async () => {
      const entities = createMockCatalogEntities();
      const request: CatalogBuilderRequest = {
        entities,
        sellerProfile: createMockSellerProfile(),
        imageUrl: 'https://s3.amazonaws.com/bucket/product.jpg',
      };

      const response = await handler(request);

      expect(response.catalogItem?.descriptor.name).toBe(entities.product_name);
      expect(response.catalogItem?.descriptor.symbol).toBe(request.imageUrl);
      expect(response.catalogItem?.descriptor.short_desc).toContain(entities.product_name);
      expect(response.catalogItem?.descriptor.long_desc).toContain(entities.product_name);
      expect(response.catalogItem?.descriptor.images).toEqual([request.imageUrl]);
    });

    it('should set price fields with INR currency', async () => {
      const entities = createMockCatalogEntities();
      const request: CatalogBuilderRequest = {
        entities,
        sellerProfile: createMockSellerProfile(),
      };

      const response = await handler(request);

      expect(response.catalogItem?.price.currency).toBe('INR');
      expect(response.catalogItem?.price.value).toBe('200.00');
      expect(response.catalogItem?.price.maximum_value).toBe('200.00');
    });

    it('should format price as decimal string', async () => {
      const entities: CatalogEntities = {
        ...createMockCatalogEntities(),
        price: 150.5,
      };
      const request: CatalogBuilderRequest = {
        entities,
        sellerProfile: createMockSellerProfile(),
      };

      const response = await handler(request);

      expect(response.catalogItem?.price.value).toBe('150.50');
    });

    it('should set quantity fields correctly', async () => {
      const entities = createMockCatalogEntities();
      const request: CatalogBuilderRequest = {
        entities,
        sellerProfile: createMockSellerProfile(),
      };

      const response = await handler(request);

      expect(response.catalogItem?.quantity.available.count).toBe(50);
      expect(response.catalogItem?.quantity.maximum.count).toBe(10); // Max per order
    });

    it('should map food category to ONDC Grocery taxonomy', async () => {
      const entities: CatalogEntities = {
        ...createMockCatalogEntities(),
        category: 'food',
      };
      const request: CatalogBuilderRequest = {
        entities,
        sellerProfile: createMockSellerProfile(),
      };

      const response = await handler(request);

      expect(response.catalogItem?.category_id).toBe('Grocery');
    });

    it('should map handicraft category to ONDC Home & Decor taxonomy', async () => {
      const entities: CatalogEntities = {
        ...createMockCatalogEntities(),
        category: 'handicraft',
      };
      const request: CatalogBuilderRequest = {
        entities,
        sellerProfile: createMockSellerProfile(),
      };

      const response = await handler(request);

      expect(response.catalogItem?.category_id).toBe('Home & Decor');
    });

    it('should map textile category to ONDC Fashion taxonomy', async () => {
      const entities: CatalogEntities = {
        ...createMockCatalogEntities(),
        category: 'textile',
      };
      const request: CatalogBuilderRequest = {
        entities,
        sellerProfile: createMockSellerProfile(),
      };

      const response = await handler(request);

      expect(response.catalogItem?.category_id).toBe('Fashion');
    });

    it('should set fulfillment_id and location_id', async () => {
      const sellerProfile = createMockSellerProfile();
      const request: CatalogBuilderRequest = {
        entities: createMockCatalogEntities(),
        sellerProfile,
      };

      const response = await handler(request);

      expect(response.catalogItem?.fulfillment_id).toBe('F1');
      expect(response.catalogItem?.location_id).toBe(sellerProfile.sellerId);
    });

    it('should add ONDC-specific tags', async () => {
      const request: CatalogBuilderRequest = {
        entities: createMockCatalogEntities(),
        sellerProfile: createMockSellerProfile(),
      };

      const response = await handler(request);

      expect(response.catalogItem?.['@ondc/org/returnable']).toBe(false);
      expect(response.catalogItem?.['@ondc/org/cancellable']).toBe(true);
      expect(response.catalogItem?.['@ondc/org/return_window']).toBe('P0D');
      expect(response.catalogItem?.['@ondc/org/seller_pickup_return']).toBe(false);
      expect(response.catalogItem?.['@ondc/org/time_to_ship']).toBe('P2D');
      expect(response.catalogItem?.['@ondc/org/available_on_cod']).toBe(true);
    });

    it('should set contact details from seller profile', async () => {
      const sellerProfile = createMockSellerProfile();
      const request: CatalogBuilderRequest = {
        entities: createMockCatalogEntities(),
        sellerProfile,
      };

      const response = await handler(request);

      expect(response.catalogItem?.['@ondc/org/contact_details_consumer_care']).toContain(
        sellerProfile.phone
      );
      expect(response.catalogItem?.['@ondc/org/contact_details_consumer_care']).toContain(
        'support@vyapar-vaani.in'
      );
    });

    it('should handle missing image URL', async () => {
      const request: CatalogBuilderRequest = {
        entities: createMockCatalogEntities(),
        sellerProfile: createMockSellerProfile(),
        // No imageUrl provided
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.catalogItem?.descriptor.symbol).toBeUndefined();
      expect(response.catalogItem?.descriptor.images).toEqual([]);
    });

    it('should handle missing description', async () => {
      const entities: CatalogEntities = {
        ...createMockCatalogEntities(),
        description: null,
      };
      const request: CatalogBuilderRequest = {
        entities,
        sellerProfile: createMockSellerProfile(),
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.catalogItem?.descriptor.long_desc).toBeDefined();
      expect(response.catalogItem?.descriptor.long_desc).not.toContain('null');
    });

    it('should fail when product name is missing', async () => {
      const entities: CatalogEntities = {
        ...createMockCatalogEntities(),
        product_name: null,
      };
      const request: CatalogBuilderRequest = {
        entities,
        sellerProfile: createMockSellerProfile(),
      };

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('Product name is required');
    });

    it('should fail when price is missing', async () => {
      const entities: CatalogEntities = {
        ...createMockCatalogEntities(),
        price: null,
      };
      const request: CatalogBuilderRequest = {
        entities,
        sellerProfile: createMockSellerProfile(),
      };

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('Price is required');
    });

    it('should fail when quantity is missing', async () => {
      const entities: CatalogEntities = {
        ...createMockCatalogEntities(),
        quantity: null,
      };
      const request: CatalogBuilderRequest = {
        entities,
        sellerProfile: createMockSellerProfile(),
      };

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('Quantity is required');
    });

    it('should fail when unit is missing', async () => {
      const entities: CatalogEntities = {
        ...createMockCatalogEntities(),
        unit: null,
      };
      const request: CatalogBuilderRequest = {
        entities,
        sellerProfile: createMockSellerProfile(),
      };

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('Unit is required');
    });

    it('should fail when category is missing', async () => {
      const entities: CatalogEntities = {
        ...createMockCatalogEntities(),
        category: null,
      };
      const request: CatalogBuilderRequest = {
        entities,
        sellerProfile: createMockSellerProfile(),
      };

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('Category is required');
    });

    it('should preserve vernacular product names', async () => {
      const entities: CatalogEntities = {
        product_name: 'आम का अचार',
        price: 200,
        quantity: 50,
        unit: 'kg',
        description: 'घर का बना पारंपरिक आम का अचार',
        category: 'food',
      };
      const request: CatalogBuilderRequest = {
        entities,
        sellerProfile: createMockSellerProfile(),
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.catalogItem?.descriptor.name).toBe('आम का अचार');
      expect(response.catalogItem?.descriptor.long_desc).toContain('घर का बना');
    });

    it('should set time label to enable', async () => {
      const request: CatalogBuilderRequest = {
        entities: createMockCatalogEntities(),
        sellerProfile: createMockSellerProfile(),
      };

      const response = await handler(request);

      expect(response.catalogItem?.time.label).toBe('enable');
      expect(response.catalogItem?.time.timestamp).toBeDefined();
    });

    it('should set timestamp in ISO 8601 format', async () => {
      const request: CatalogBuilderRequest = {
        entities: createMockCatalogEntities(),
        sellerProfile: createMockSellerProfile(),
      };

      const response = await handler(request);

      const timestamp = response.catalogItem?.time.timestamp;
      expect(timestamp).toBeDefined();
      expect(() => new Date(timestamp!)).not.toThrow();
    });

    it('should validate catalog item against ONDC schema', async () => {
      const request: CatalogBuilderRequest = {
        entities: createMockCatalogEntities(),
        sellerProfile: createMockSellerProfile(),
      };

      const response = await handler(request);

      expect(response.validation).toBeDefined();
      expect(response.validation?.valid).toBe(true);
      expect(response.validation?.errors).toHaveLength(0);
    });

    it('should include validation result in response', async () => {
      const request: CatalogBuilderRequest = {
        entities: createMockCatalogEntities(),
        sellerProfile: createMockSellerProfile(),
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.validation).toBeDefined();
      expect(response.validation?.valid).toBe(true);
    });
  });
});
