/**
 * Unit Tests for ONDC Schema Validator
 * 
 * Tests validation of catalog objects and ONDC payloads against
 * Beckn Protocol v1.2.0 specifications.
 * 
 * Validates: Requirements 2.7, 4.7, 8.2, 8.5, 8.6, 8.7
 */

import {
  validateCatalogItem,
  validateContext,
  validateGPSCoordinates,
  validateONDCCatalogPayload,
} from '../../src/services/ondc-schema-validator';
import { BecknCatalogItem, ONDCCatalogPayload } from '../../src/models/catalog';

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
 * Create a valid mock ONDC context for testing
 */
function createValidContext(): ONDCCatalogPayload['context'] {
  return {
    domain: 'nic2004:52110',
    country: 'IND',
    city: 'Mumbai',
    action: 'on_search',
    core_version: '1.2.0',
    bap_id: 'buyer-app.ondc.in',
    bap_uri: 'https://api.buyer-app.ondc.in',
    bpp_id: 'vyapar-vaani.ondc.in',
    bpp_uri: 'https://api.vyapar-vaani.ondc.in',
    transaction_id: '123e4567-e89b-12d3-a456-426614174000',
    message_id: '123e4567-e89b-12d3-a456-426614174001',
    timestamp: '2024-01-15T10:30:00.000Z',
  };
}

describe('ONDC Schema Validator', () => {
  describe('validateCatalogItem', () => {
    it('should validate a valid catalog item', () => {
      const item = createValidCatalogItem();
      const result = validateCatalogItem(item);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when item ID is missing', () => {
      const item = createValidCatalogItem();
      delete (item as any).id;

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'id',
          message: 'Item ID is required',
        })
      );
    });

    it('should fail when descriptor is missing', () => {
      const item = createValidCatalogItem();
      delete (item as any).descriptor;

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'descriptor',
          message: 'Descriptor is required',
        })
      );
    });

    it('should fail when product name is missing', () => {
      const item = createValidCatalogItem();
      delete (item.descriptor as any).name;

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'descriptor.name',
          message: 'Product name is required',
        })
      );
    });

    it('should fail when short description is missing', () => {
      const item = createValidCatalogItem();
      delete (item.descriptor as any).short_desc;

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'descriptor.short_desc',
          message: 'Short description is required',
        })
      );
    });

    it('should fail when long description is missing', () => {
      const item = createValidCatalogItem();
      delete (item.descriptor as any).long_desc;

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'descriptor.long_desc',
          message: 'Long description is required',
        })
      );
    });

    it('should fail when images is not an array', () => {
      const item = createValidCatalogItem();
      (item.descriptor as any).images = 'not-an-array';

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'descriptor.images',
          message: 'Images must be an array',
        })
      );
    });

    it('should fail when price is missing', () => {
      const item = createValidCatalogItem();
      delete (item as any).price;

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'price',
          message: 'Price is required',
        })
      );
    });

    it('should fail when currency code is missing', () => {
      const item = createValidCatalogItem();
      delete (item.price as any).currency;

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'price.currency',
          message: 'Currency code is required',
        })
      );
    });

    it('should fail when currency code is not INR', () => {
      const item = createValidCatalogItem();
      (item.price as any).currency = 'USD';

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'price.currency',
          message: expect.stringContaining('Invalid currency code'),
          value: 'USD',
        })
      );
    });

    it('should fail when price value is missing', () => {
      const item = createValidCatalogItem();
      delete (item.price as any).value;

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'price.value',
          message: 'Price value is required',
        })
      );
    });

    it('should fail when price value is not in decimal format', () => {
      const item = createValidCatalogItem();
      item.price.value = '200'; // Missing decimal places

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'price.value',
          message: expect.stringContaining('decimal string with 2 decimal places'),
          value: '200',
        })
      );
    });

    it('should accept valid decimal price format', () => {
      const item = createValidCatalogItem();
      item.price.value = '150.50';

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(true);
    });

    it('should fail when quantity is missing', () => {
      const item = createValidCatalogItem();
      delete (item as any).quantity;

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'quantity',
          message: 'Quantity is required',
        })
      );
    });

    it('should fail when available quantity is missing', () => {
      const item = createValidCatalogItem();
      delete (item.quantity as any).available;

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'quantity.available',
          message: 'Available quantity is required',
        })
      );
    });

    it('should fail when available count is not a number', () => {
      const item = createValidCatalogItem();
      (item.quantity.available as any).count = '50'; // String instead of number

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'quantity.available.count',
          message: 'Available count must be a number',
        })
      );
    });

    it('should fail when maximum quantity is missing', () => {
      const item = createValidCatalogItem();
      delete (item.quantity as any).maximum;

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'quantity.maximum',
          message: 'Maximum quantity is required',
        })
      );
    });

    it('should fail when category_id is missing', () => {
      const item = createValidCatalogItem();
      delete (item as any).category_id;

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'category_id',
          message: 'Category ID is required',
        })
      );
    });

    it('should fail when fulfillment_id is missing', () => {
      const item = createValidCatalogItem();
      delete (item as any).fulfillment_id;

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'fulfillment_id',
          message: 'Fulfillment ID is required',
        })
      );
    });

    it('should fail when location_id is missing', () => {
      const item = createValidCatalogItem();
      delete (item as any).location_id;

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'location_id',
          message: 'Location ID is required',
        })
      );
    });

    it('should fail when time is missing', () => {
      const item = createValidCatalogItem();
      delete (item as any).time;

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'time',
          message: 'Time is required',
        })
      );
    });

    it('should fail when time label is invalid', () => {
      const item = createValidCatalogItem();
      (item.time as any).label = 'invalid';

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'time.label',
          message: 'Time label must be "enable" or "disable"',
        })
      );
    });

    it('should fail when timestamp is not in ISO 8601 format', () => {
      const item = createValidCatalogItem();
      item.time.timestamp = 'invalid-timestamp';

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'time.timestamp',
          message: 'Time timestamp must be in ISO 8601 format',
        })
      );
    });

    it('should fail when tags is not an array', () => {
      const item = createValidCatalogItem();
      (item as any).tags = 'not-an-array';

      const result = validateCatalogItem(item);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'tags',
          message: 'Tags must be an array',
        })
      );
    });
  });

  describe('validateContext', () => {
    it('should validate a valid context', () => {
      const context = createValidContext();
      const result = validateContext(context);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when domain is missing', () => {
      const context = createValidContext();
      delete (context as any).domain;

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'context.domain',
          message: 'Domain is required',
        })
      );
    });

    it('should fail when domain is invalid', () => {
      const context = createValidContext();
      context.domain = 'invalid-domain';

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'context.domain',
          message: expect.stringContaining('Invalid domain'),
        })
      );
    });

    it('should accept valid ONDC domain codes', () => {
      const validDomains = [
        'nic2004:52110',
        'nic2004:52220',
        'ONDC:RET10',
        'ONDC:RET11',
        'ONDC:RET12',
      ];

      validDomains.forEach((domain) => {
        const context = createValidContext();
        context.domain = domain;
        const result = validateContext(context);
        expect(result.valid).toBe(true);
      });
    });

    it('should fail when country is missing', () => {
      const context = createValidContext();
      delete (context as any).country;

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'context.country',
          message: 'Country is required',
        })
      );
    });

    it('should fail when country is not IND', () => {
      const context = createValidContext();
      (context as any).country = 'USA';

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'context.country',
          message: expect.stringContaining('Invalid country code'),
        })
      );
    });

    it('should fail when city is missing', () => {
      const context = createValidContext();
      delete (context as any).city;

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'context.city',
          message: 'City is required',
        })
      );
    });

    it('should fail when action is missing', () => {
      const context = createValidContext();
      delete (context as any).action;

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'context.action',
          message: 'Action is required',
        })
      );
    });

    it('should fail when action is not on_search', () => {
      const context = createValidContext();
      (context as any).action = 'invalid_action';

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'context.action',
          message: expect.stringContaining('Invalid action'),
        })
      );
    });

    it('should fail when core_version is missing', () => {
      const context = createValidContext();
      delete (context as any).core_version;

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'context.core_version',
          message: 'Core version is required',
        })
      );
    });

    it('should fail when core_version is not 1.2.0', () => {
      const context = createValidContext();
      (context as any).core_version = '1.0.0';

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'context.core_version',
          message: expect.stringContaining('Invalid core version'),
        })
      );
    });

    it('should fail when transaction_id is not a valid UUID', () => {
      const context = createValidContext();
      context.transaction_id = 'invalid-uuid';

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'context.transaction_id',
          message: 'Transaction ID must be a valid UUID',
        })
      );
    });

    it('should fail when message_id is not a valid UUID', () => {
      const context = createValidContext();
      context.message_id = 'invalid-uuid';

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'context.message_id',
          message: 'Message ID must be a valid UUID',
        })
      );
    });

    it('should fail when timestamp is not in ISO 8601 format', () => {
      const context = createValidContext();
      context.timestamp = 'invalid-timestamp';

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'context.timestamp',
          message: 'Timestamp must be in ISO 8601 format',
        })
      );
    });
  });

  describe('validateGPSCoordinates', () => {
    it('should validate valid GPS coordinates', () => {
      const result = validateGPSCoordinates('28.6139,77.2090');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate negative coordinates', () => {
      const result = validateGPSCoordinates('-33.8688,151.2093');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when GPS coordinates are missing', () => {
      const result = validateGPSCoordinates('');

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'gps',
          message: 'GPS coordinates are required',
        })
      );
    });

    it('should fail when GPS format is invalid', () => {
      const result = validateGPSCoordinates('invalid-gps');

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'gps',
          message: expect.stringContaining('GPS coordinates must be in format'),
        })
      );
    });

    it('should fail when latitude is out of range', () => {
      const result = validateGPSCoordinates('91.0,77.2090');

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'gps.latitude',
          message: 'Latitude must be between -90 and 90',
        })
      );
    });

    it('should fail when longitude is out of range', () => {
      const result = validateGPSCoordinates('28.6139,181.0');

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'gps.longitude',
          message: 'Longitude must be between -180 and 180',
        })
      );
    });
  });

  describe('validateONDCCatalogPayload', () => {
    it('should validate a complete valid ONDC catalog payload', () => {
      const payload: ONDCCatalogPayload = {
        context: createValidContext(),
        message: {
          catalog: {
            'bpp/descriptor': {
              name: 'Vyapar Vaani',
              symbol: 'https://vyapar-vaani.in/logo.png',
              short_desc: 'Rural Merchant Network',
              long_desc: 'Empowering rural merchants through voice-first commerce',
              images: ['https://vyapar-vaani.in/banner.png'],
            },
            'bpp/providers': [
              {
                id: 'test-seller-123',
                descriptor: {
                  name: 'Test Seller',
                  short_desc: 'Rural merchant',
                  long_desc: 'Rural merchant selling homemade products',
                  images: [],
                },
                locations: [
                  {
                    id: 'location-123',
                    gps: '28.6139,77.2090',
                    address: {
                      locality: 'Test Locality',
                      street: 'Test Street',
                      city: 'Mumbai',
                      state: 'Maharashtra',
                      country: 'IND',
                      area_code: '400001',
                    },
                  },
                ],
                items: [createValidCatalogItem()],
              },
            ],
          },
        },
      };

      const result = validateONDCCatalogPayload(payload);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when message is missing', () => {
      const payload: any = {
        context: createValidContext(),
      };

      const result = validateONDCCatalogPayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'message',
          message: 'Message is required',
        })
      );
    });

    it('should fail when catalog is missing', () => {
      const payload: any = {
        context: createValidContext(),
        message: {},
      };

      const result = validateONDCCatalogPayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'message.catalog',
          message: 'Catalog is required',
        })
      );
    });

    it('should fail when bpp/descriptor is missing', () => {
      const payload: any = {
        context: createValidContext(),
        message: {
          catalog: {
            'bpp/providers': [],
          },
        },
      };

      const result = validateONDCCatalogPayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'message.catalog.bpp/descriptor',
          message: 'BPP descriptor is required',
        })
      );
    });

    it('should fail when bpp/providers is missing', () => {
      const payload: any = {
        context: createValidContext(),
        message: {
          catalog: {
            'bpp/descriptor': {
              name: 'Test',
              short_desc: 'Test',
              long_desc: 'Test',
              images: [],
            },
          },
        },
      };

      const result = validateONDCCatalogPayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'message.catalog.bpp/providers',
          message: 'BPP providers are required',
        })
      );
    });

    it('should validate GPS coordinates in provider locations', () => {
      const payload: ONDCCatalogPayload = {
        context: createValidContext(),
        message: {
          catalog: {
            'bpp/descriptor': {
              name: 'Test',
              symbol: 'test',
              short_desc: 'Test',
              long_desc: 'Test',
              images: [],
            },
            'bpp/providers': [
              {
                id: 'test-seller',
                descriptor: {
                  name: 'Test',
                  short_desc: 'Test',
                  long_desc: 'Test',
                  images: [],
                },
                locations: [
                  {
                    id: 'location-1',
                    gps: 'invalid-gps',
                    address: {
                      locality: 'Test',
                      street: 'Test',
                      city: 'Test',
                      state: 'Test',
                      country: 'IND',
                      area_code: '400001',
                    },
                  },
                ],
                items: [],
              },
            ],
          },
        },
      };

      const result = validateONDCCatalogPayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes('gps'))).toBe(true);
    });

    it('should validate all items in provider', () => {
      const invalidItem = createValidCatalogItem();
      delete (invalidItem as any).price;

      const payload: ONDCCatalogPayload = {
        context: createValidContext(),
        message: {
          catalog: {
            'bpp/descriptor': {
              name: 'Test',
              symbol: 'test',
              short_desc: 'Test',
              long_desc: 'Test',
              images: [],
            },
            'bpp/providers': [
              {
                id: 'test-seller',
                descriptor: {
                  name: 'Test',
                  short_desc: 'Test',
                  long_desc: 'Test',
                  images: [],
                },
                locations: [
                  {
                    id: 'location-1',
                    gps: '28.6139,77.2090',
                    address: {
                      locality: 'Test',
                      street: 'Test',
                      city: 'Test',
                      state: 'Test',
                      country: 'IND',
                      area_code: '400001',
                    },
                  },
                ],
                items: [invalidItem],
              },
            ],
          },
        },
      };

      const result = validateONDCCatalogPayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes('price'))).toBe(true);
    });
  });
});
