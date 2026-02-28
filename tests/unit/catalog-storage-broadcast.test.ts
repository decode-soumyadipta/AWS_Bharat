/**
 * Unit Tests for Catalog Storage and Broadcast Lambda
 * 
 * Tests the complete catalog lifecycle:
 * - Validation using schema validator
 * - Storage in DynamoDB
 * - ONDC payload construction
 * - Broadcasting to ONDC Registry
 * - Confirmation messages to seller
 * 
 * Validates: Requirements 2.7, 2.8, 2.9, 10.4
 */

import { handler, CatalogStorageBroadcastRequest } from '../../src/lambdas/catalog-storage-broadcast';
import { BecknCatalogItem } from '../../src/models/catalog';
import { SellerProfile } from '../../src/models/seller';
import * as validator from '../../src/services/ondc-schema-validator';
import * as repository from '../../src/services/dynamodb-repository';

// Mock dependencies
jest.mock('../../src/services/ondc-schema-validator');
jest.mock('../../src/services/dynamodb-repository');

const mockedValidator = validator as jest.Mocked<typeof validator>;
const mockedRepository = repository as jest.Mocked<typeof repository>;

/**
 * Create a valid mock catalog item for testing
 */
function createValidCatalogItem(): BecknCatalogItem {
  return {
    id: '123e4567-e89b-12d3-a456-426614174000',
    descriptor: {
      name: 'Mango Pickle',
      symbol: 'https://s3.amazonaws.com/bucket/product.jpg',
      short_desc: 'Mango Pickle - 50 kg',
      long_desc: 'Homemade traditional mango pickle. Available quantity: 50 kg.',
      images: ['https://s3.amazonaws.com/bucket/product.jpg'],
    },
    price: {
      currency: 'INR',
      value: '200.00',
      maximum_value: '200.00',
    },
    quantity: {
      available: {
        count: 50,
      },
      maximum: {
        count: 10,
      },
    },
    category_id: 'Grocery',
    fulfillment_id: 'F1',
    location_id: 'test-location-123',
    time: {
      label: 'enable',
      timestamp: '2024-01-15T10:30:00.000Z',
    },
    tags: [],
    '@ondc/org/returnable': false,
    '@ondc/org/cancellable': true,
    '@ondc/org/return_window': 'P0D',
    '@ondc/org/seller_pickup_return': false,
    '@ondc/org/time_to_ship': 'P2D',
    '@ondc/org/available_on_cod': true,
    '@ondc/org/contact_details_consumer_care': '+919876543210,support@vyapar-vaani.in',
  };
}

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
    onboardingState: 'ACTIVE' as const,
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

describe('Catalog Storage and Broadcast Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handler', () => {
    it('should successfully store and broadcast valid catalog', async () => {
      const catalogItem = createValidCatalogItem();
      const sellerProfile = createMockSellerProfile();

      const request: CatalogStorageBroadcastRequest = {
        catalogItem,
        sellerId: 'test-seller-123',
        sellerPhone: '+919876543210',
        language: 'hi',
        images: {
          raw: 'https://s3.amazonaws.com/bucket/raw.jpg',
          enhanced: 'https://s3.amazonaws.com/bucket/enhanced.jpg',
        },
        messageId: 'test-message-123',
      };

      // Mock validation success
      mockedValidator.validateCatalogItem.mockReturnValue({
        valid: true,
        errors: [],
      });

      mockedValidator.validateONDCCatalogPayload.mockReturnValue({
        valid: true,
        errors: [],
      });

      // Mock seller profile retrieval
      mockedRepository.getSellerById.mockResolvedValue(sellerProfile);

      // Mock catalog item creation
      mockedRepository.createCatalogItem.mockResolvedValue({
        PK: `SELLER#${request.sellerId}`,
        SK: `ITEM#${catalogItem.id}`,
        GSI3PK: `CATEGORY#${catalogItem.category_id}`,
        GSI3SK: `ITEM#${catalogItem.id}`,
        entityType: 'CATALOG_ITEM',
        itemId: catalogItem.id,
        sellerId: request.sellerId,
        becknItem: catalogItem,
        images: request.images!,
        status: 'ACTIVE',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1,
      });

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.itemId).toBe(catalogItem.id);
      expect(response.broadcast).toBe(true);
      expect(response.confirmationSent).toBe(true);
      expect(response.error).toBeUndefined();

      // Verify validation was called
      expect(mockedValidator.validateCatalogItem).toHaveBeenCalledWith(catalogItem);

      // Verify seller profile was fetched
      expect(mockedRepository.getSellerById).toHaveBeenCalledWith(request.sellerId);

      // Verify catalog item was created
      expect(mockedRepository.createCatalogItem).toHaveBeenCalled();

      // Verify ONDC payload validation was called
      expect(mockedValidator.validateONDCCatalogPayload).toHaveBeenCalled();
    });

    it('should fail when catalog validation fails', async () => {
      const catalogItem = createValidCatalogItem();
      delete (catalogItem as any).price; // Make it invalid

      const request: CatalogStorageBroadcastRequest = {
        catalogItem,
        sellerId: 'test-seller-123',
        sellerPhone: '+919876543210',
        language: 'hi',
      };

      // Mock validation failure
      mockedValidator.validateCatalogItem.mockReturnValue({
        valid: false,
        errors: [
          {
            field: 'price',
            message: 'Price is required',
          },
        ],
      });

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe('VALIDATION_FAILED');
      expect(response.error?.missingFields).toContain('price');

      // Verify validation was called
      expect(mockedValidator.validateCatalogItem).toHaveBeenCalledWith(catalogItem);

      // Verify no storage operations were performed
      expect(mockedRepository.createCatalogItem).not.toHaveBeenCalled();
    });

    it('should request missing information when validation fails', async () => {
      const catalogItem = createValidCatalogItem();
      delete (catalogItem as any).descriptor.name;
      delete (catalogItem as any).price;

      const request: CatalogStorageBroadcastRequest = {
        catalogItem,
        sellerId: 'test-seller-123',
        sellerPhone: '+919876543210',
        language: 'hi',
      };

      // Mock validation failure with multiple errors
      mockedValidator.validateCatalogItem.mockReturnValue({
        valid: false,
        errors: [
          {
            field: 'descriptor.name',
            message: 'Product name is required',
          },
          {
            field: 'price',
            message: 'Price is required',
          },
        ],
      });

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error?.missingFields).toEqual(['descriptor.name', 'price']);
    });

    it('should fail when seller profile is not found', async () => {
      const catalogItem = createValidCatalogItem();

      const request: CatalogStorageBroadcastRequest = {
        catalogItem,
        sellerId: 'non-existent-seller',
        sellerPhone: '+919876543210',
        language: 'hi',
      };

      // Mock validation success
      mockedValidator.validateCatalogItem.mockReturnValue({
        valid: true,
        errors: [],
      });

      // Mock seller profile not found
      mockedRepository.getSellerById.mockResolvedValue(null);

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('Seller profile not found');
    });

    it('should store catalog item with correct DynamoDB keys', async () => {
      const catalogItem = createValidCatalogItem();
      const sellerProfile = createMockSellerProfile();

      const request: CatalogStorageBroadcastRequest = {
        catalogItem,
        sellerId: 'test-seller-123',
        sellerPhone: '+919876543210',
        language: 'hi',
      };

      // Mock validation success
      mockedValidator.validateCatalogItem.mockReturnValue({
        valid: true,
        errors: [],
      });

      mockedValidator.validateONDCCatalogPayload.mockReturnValue({
        valid: true,
        errors: [],
      });

      // Mock seller profile retrieval
      mockedRepository.getSellerById.mockResolvedValue(sellerProfile);

      // Mock catalog item creation
      mockedRepository.createCatalogItem.mockImplementation(async (item) => item);

      await handler(request);

      // Verify catalog item was created with correct keys
      expect(mockedRepository.createCatalogItem).toHaveBeenCalledWith(
        expect.objectContaining({
          PK: `SELLER#${request.sellerId}`,
          SK: `ITEM#${catalogItem.id}`,
          GSI3PK: `CATEGORY#${catalogItem.category_id}`,
          GSI3SK: `ITEM#${catalogItem.id}`,
          entityType: 'CATALOG_ITEM',
          itemId: catalogItem.id,
          sellerId: request.sellerId,
          status: 'ACTIVE',
        })
      );
    });

    it('should construct valid ONDC on_search payload', async () => {
      const catalogItem = createValidCatalogItem();
      const sellerProfile = createMockSellerProfile();

      const request: CatalogStorageBroadcastRequest = {
        catalogItem,
        sellerId: 'test-seller-123',
        sellerPhone: '+919876543210',
        language: 'hi',
      };

      // Mock validation success
      mockedValidator.validateCatalogItem.mockReturnValue({
        valid: true,
        errors: [],
      });

      mockedValidator.validateONDCCatalogPayload.mockReturnValue({
        valid: true,
        errors: [],
      });

      // Mock seller profile retrieval
      mockedRepository.getSellerById.mockResolvedValue(sellerProfile);

      // Mock catalog item creation
      mockedRepository.createCatalogItem.mockImplementation(async (item) => item);

      await handler(request);

      // Verify ONDC payload validation was called with correct structure
      expect(mockedValidator.validateONDCCatalogPayload).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            domain: 'nic2004:52110',
            country: 'IND',
            action: 'on_search',
            core_version: '1.2.0',
            bpp_id: sellerProfile.ondc.subscriberId,
            bpp_uri: sellerProfile.ondc.subscriberUrl,
          }),
          message: expect.objectContaining({
            catalog: expect.objectContaining({
              'bpp/descriptor': expect.any(Object),
              'bpp/providers': expect.arrayContaining([
                expect.objectContaining({
                  id: sellerProfile.sellerId,
                  descriptor: expect.objectContaining({
                    name: sellerProfile.name,
                  }),
                  items: expect.arrayContaining([catalogItem]),
                }),
              ]),
            }),
          }),
        })
      );
    });

    it('should fail when ONDC payload validation fails', async () => {
      const catalogItem = createValidCatalogItem();
      const sellerProfile = createMockSellerProfile();

      const request: CatalogStorageBroadcastRequest = {
        catalogItem,
        sellerId: 'test-seller-123',
        sellerPhone: '+919876543210',
        language: 'hi',
      };

      // Mock catalog validation success
      mockedValidator.validateCatalogItem.mockReturnValue({
        valid: true,
        errors: [],
      });

      // Mock ONDC payload validation failure
      mockedValidator.validateONDCCatalogPayload.mockReturnValue({
        valid: false,
        errors: [
          {
            field: 'context.domain',
            message: 'Invalid domain',
          },
        ],
      });

      // Mock seller profile retrieval
      mockedRepository.getSellerById.mockResolvedValue(sellerProfile);

      // Mock catalog item creation
      mockedRepository.createCatalogItem.mockImplementation(async (item) => item);

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('ONDC payload validation failed');
    });

    it('should handle images correctly', async () => {
      const catalogItem = createValidCatalogItem();
      const sellerProfile = createMockSellerProfile();

      const request: CatalogStorageBroadcastRequest = {
        catalogItem,
        sellerId: 'test-seller-123',
        sellerPhone: '+919876543210',
        language: 'hi',
        images: {
          raw: 'https://s3.amazonaws.com/bucket/raw.jpg',
          enhanced: 'https://s3.amazonaws.com/bucket/enhanced.jpg',
        },
      };

      // Mock validation success
      mockedValidator.validateCatalogItem.mockReturnValue({
        valid: true,
        errors: [],
      });

      mockedValidator.validateONDCCatalogPayload.mockReturnValue({
        valid: true,
        errors: [],
      });

      // Mock seller profile retrieval
      mockedRepository.getSellerById.mockResolvedValue(sellerProfile);

      // Mock catalog item creation
      mockedRepository.createCatalogItem.mockImplementation(async (item) => item);

      await handler(request);

      // Verify images were stored correctly
      expect(mockedRepository.createCatalogItem).toHaveBeenCalledWith(
        expect.objectContaining({
          images: {
            raw: request.images!.raw,
            enhanced: request.images!.enhanced,
          },
        })
      );
    });

    it('should use default images when not provided', async () => {
      const catalogItem = createValidCatalogItem();
      const sellerProfile = createMockSellerProfile();

      const request: CatalogStorageBroadcastRequest = {
        catalogItem,
        sellerId: 'test-seller-123',
        sellerPhone: '+919876543210',
        language: 'hi',
        // No images provided
      };

      // Mock validation success
      mockedValidator.validateCatalogItem.mockReturnValue({
        valid: true,
        errors: [],
      });

      mockedValidator.validateONDCCatalogPayload.mockReturnValue({
        valid: true,
        errors: [],
      });

      // Mock seller profile retrieval
      mockedRepository.getSellerById.mockResolvedValue(sellerProfile);

      // Mock catalog item creation
      mockedRepository.createCatalogItem.mockImplementation(async (item) => item);

      await handler(request);

      // Verify default images were used
      expect(mockedRepository.createCatalogItem).toHaveBeenCalledWith(
        expect.objectContaining({
          images: {
            raw: catalogItem.descriptor.symbol || '',
            enhanced: catalogItem.descriptor.symbol || '',
          },
        })
      );
    });

    it('should support Hindi language for messages', async () => {
      const catalogItem = createValidCatalogItem();
      const sellerProfile = createMockSellerProfile();

      const request: CatalogStorageBroadcastRequest = {
        catalogItem,
        sellerId: 'test-seller-123',
        sellerPhone: '+919876543210',
        language: 'hi',
      };

      // Mock validation success
      mockedValidator.validateCatalogItem.mockReturnValue({
        valid: true,
        errors: [],
      });

      mockedValidator.validateONDCCatalogPayload.mockReturnValue({
        valid: true,
        errors: [],
      });

      // Mock seller profile retrieval
      mockedRepository.getSellerById.mockResolvedValue(sellerProfile);

      // Mock catalog item creation
      mockedRepository.createCatalogItem.mockImplementation(async (item) => item);

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.confirmationSent).toBe(true);
    });

    it('should support Marathi language for messages', async () => {
      const catalogItem = createValidCatalogItem();
      const sellerProfile = createMockSellerProfile();

      const request: CatalogStorageBroadcastRequest = {
        catalogItem,
        sellerId: 'test-seller-123',
        sellerPhone: '+919876543210',
        language: 'mr',
      };

      // Mock validation success
      mockedValidator.validateCatalogItem.mockReturnValue({
        valid: true,
        errors: [],
      });

      mockedValidator.validateONDCCatalogPayload.mockReturnValue({
        valid: true,
        errors: [],
      });

      // Mock seller profile retrieval
      mockedRepository.getSellerById.mockResolvedValue(sellerProfile);

      // Mock catalog item creation
      mockedRepository.createCatalogItem.mockImplementation(async (item) => item);

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.confirmationSent).toBe(true);
    });

    it('should support English language for messages', async () => {
      const catalogItem = createValidCatalogItem();
      const sellerProfile = createMockSellerProfile();

      const request: CatalogStorageBroadcastRequest = {
        catalogItem,
        sellerId: 'test-seller-123',
        sellerPhone: '+919876543210',
        language: 'en',
      };

      // Mock validation success
      mockedValidator.validateCatalogItem.mockReturnValue({
        valid: true,
        errors: [],
      });

      mockedValidator.validateONDCCatalogPayload.mockReturnValue({
        valid: true,
        errors: [],
      });

      // Mock seller profile retrieval
      mockedRepository.getSellerById.mockResolvedValue(sellerProfile);

      // Mock catalog item creation
      mockedRepository.createCatalogItem.mockImplementation(async (item) => item);

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.confirmationSent).toBe(true);
    });

    it('should handle DynamoDB errors gracefully', async () => {
      const catalogItem = createValidCatalogItem();
      const sellerProfile = createMockSellerProfile();

      const request: CatalogStorageBroadcastRequest = {
        catalogItem,
        sellerId: 'test-seller-123',
        sellerPhone: '+919876543210',
        language: 'hi',
      };

      // Mock validation success
      mockedValidator.validateCatalogItem.mockReturnValue({
        valid: true,
        errors: [],
      });

      // Mock seller profile retrieval
      mockedRepository.getSellerById.mockResolvedValue(sellerProfile);

      // Mock DynamoDB error
      mockedRepository.createCatalogItem.mockRejectedValue(
        new Error('DynamoDB connection failed')
      );

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('DynamoDB connection failed');
    });

    it('should set catalog status to ACTIVE', async () => {
      const catalogItem = createValidCatalogItem();
      const sellerProfile = createMockSellerProfile();

      const request: CatalogStorageBroadcastRequest = {
        catalogItem,
        sellerId: 'test-seller-123',
        sellerPhone: '+919876543210',
        language: 'hi',
      };

      // Mock validation success
      mockedValidator.validateCatalogItem.mockReturnValue({
        valid: true,
        errors: [],
      });

      mockedValidator.validateONDCCatalogPayload.mockReturnValue({
        valid: true,
        errors: [],
      });

      // Mock seller profile retrieval
      mockedRepository.getSellerById.mockResolvedValue(sellerProfile);

      // Mock catalog item creation
      mockedRepository.createCatalogItem.mockImplementation(async (item) => item);

      await handler(request);

      // Verify status is ACTIVE
      expect(mockedRepository.createCatalogItem).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ACTIVE',
        })
      );
    });

    it('should initialize version to 1', async () => {
      const catalogItem = createValidCatalogItem();
      const sellerProfile = createMockSellerProfile();

      const request: CatalogStorageBroadcastRequest = {
        catalogItem,
        sellerId: 'test-seller-123',
        sellerPhone: '+919876543210',
        language: 'hi',
      };

      // Mock validation success
      mockedValidator.validateCatalogItem.mockReturnValue({
        valid: true,
        errors: [],
      });

      mockedValidator.validateONDCCatalogPayload.mockReturnValue({
        valid: true,
        errors: [],
      });

      // Mock seller profile retrieval
      mockedRepository.getSellerById.mockResolvedValue(sellerProfile);

      // Mock catalog item creation
      mockedRepository.createCatalogItem.mockImplementation(async (item) => item);

      await handler(request);

      // Verify version is 1
      expect(mockedRepository.createCatalogItem).toHaveBeenCalledWith(
        expect.objectContaining({
          version: 1,
        })
      );
    });
  });
});
