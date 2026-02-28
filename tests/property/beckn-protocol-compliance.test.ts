/**
 * Property-Based Test: Beckn Protocol Compliance
 * 
 * **Validates: Requirements 2.5, 2.6, 2.7, 4.5, 4.6, 4.7, 8.2, 8.5, 8.6, 8.7**
 * 
 * Property 7: Beckn Protocol Compliance
 * For any extracted product entities or order data, the constructed Beckn Protocol 
 * JSON payload should conform to ONDC v1.2.0 schema validation, include all mandatory 
 * fields (context, message, required domain-specific fields), and pass JSON schema validation.
 * 
 * This test verifies:
 * 1. Catalog objects constructed from product entities pass ONDC schema validation
 * 2. All mandatory Beckn Protocol fields are present (context, message, etc.)
 * 3. Currency codes conform to ISO 4217 (INR)
 * 4. GPS coordinates conform to "lat,long" format
 * 5. Context fields include correct domain, country, action, and core_version
 * 6. Price values are formatted as decimal strings with 2 decimal places
 * 7. Timestamps are in ISO 8601 format
 * 8. UUIDs are properly formatted for transaction_id and message_id
 * 9. Complete ONDC on_search payloads pass full schema validation
 */

import fc from 'fast-check';
import { handler as buildCatalog } from '../../src/lambdas/catalog-builder';
import {
  validateCatalogItem,
  validateContext,
  validateGPSCoordinates,
  validateONDCCatalogPayload,
} from '../../src/services/ondc-schema-validator';
import { CatalogEntities } from '../../src/models/intent';
import { SellerProfile } from '../../src/models/seller';
import { ONDCCatalogPayload, BecknCatalogItem } from '../../src/models/catalog';
import { randomUUID } from 'crypto';

describe('Property 7: Beckn Protocol Compliance', () => {
  describe('Catalog Item Construction and Validation', () => {
    it('should construct valid Beckn catalog items for any product entities', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            product_name: fc.string({ minLength: 3, maxLength: 100 }),
            price: fc.integer({ min: 1, max: 1000000 }),
            quantity: fc.integer({ min: 1, max: 10000 }),
            unit: fc.constantFrom('kg', 'liters', 'pieces', 'packets', 'grams', 'ml'),
            description: fc.option(fc.string({ minLength: 5, maxLength: 200 }), { nil: null }),
            category: fc.constantFrom('food', 'grocery', 'handicraft', 'textile', 'other'),
            imageUrl: fc.option(
              fc.webUrl({ validSchemes: ['https'] }),
              { nil: undefined }
            ),
          }),
          async ({ product_name, price, quantity, unit, description, category, imageUrl }) => {
            // Create mock seller profile
            const sellerProfile: SellerProfile = {
              PK: `SELLER#${randomUUID()}`,
              SK: 'PROFILE',
              GSI1PK: '+919876543210',
              GSI1SK: 'PROFILE',
              entityType: 'SELLER_PROFILE',
              sellerId: randomUUID(),
              phone: '+919876543210',
              name: 'Test Seller',
              language: 'hi',
            onboardingState: 'ACTIVE' as const,
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
                signingPublicKey: 'mock-public-key',
                encryptionPublicKey: 'mock-encryption-key',
              },
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };

            // Create catalog entities
            const entities: CatalogEntities = {
              product_name,
              price,
              quantity,
              unit,
              description,
              category,
            };

            // Build catalog item
            const response = await buildCatalog({
              entities,
              sellerProfile,
              imageUrl,
            });

            // Property 1: Construction succeeds
            expect(response.success).toBe(true);
            expect(response.catalogItem).toBeDefined();
            expect(response.itemId).toBeDefined();

            const catalogItem = response.catalogItem!;

            // Property 2: All mandatory fields are present
            expect(catalogItem.id).toBeDefined();
            expect(catalogItem.descriptor).toBeDefined();
            expect(catalogItem.descriptor.name).toBeDefined();
            expect(catalogItem.descriptor.short_desc).toBeDefined();
            expect(catalogItem.descriptor.long_desc).toBeDefined();
            expect(catalogItem.descriptor.images).toBeDefined();
            expect(catalogItem.price).toBeDefined();
            expect(catalogItem.quantity).toBeDefined();
            expect(catalogItem.category_id).toBeDefined();
            expect(catalogItem.fulfillment_id).toBeDefined();
            expect(catalogItem.location_id).toBeDefined();
            expect(catalogItem.time).toBeDefined();
            expect(catalogItem.tags).toBeDefined();

            // Property 3: Currency code conforms to ISO 4217
            expect(catalogItem.price.currency).toBe('INR');

            // Property 4: Price value is formatted as decimal string with 2 decimal places
            expect(catalogItem.price.value).toMatch(/^\d+\.\d{2}$/);
            expect(parseFloat(catalogItem.price.value)).toBe(price);

            // Property 5: Quantity fields are numbers
            expect(typeof catalogItem.quantity.available.count).toBe('number');
            expect(typeof catalogItem.quantity.maximum.count).toBe('number');
            expect(catalogItem.quantity.available.count).toBe(quantity);

            // Property 6: Time timestamp is in ISO 8601 format
            expect(() => new Date(catalogItem.time.timestamp)).not.toThrow();
            expect(new Date(catalogItem.time.timestamp).toISOString()).toBe(
              catalogItem.time.timestamp
            );

            // Property 7: Time label is valid
            expect(['enable', 'disable']).toContain(catalogItem.time.label);

            // Property 8: Tags is an array
            expect(Array.isArray(catalogItem.tags)).toBe(true);

            // Property 9: Product name matches input
            expect(catalogItem.descriptor.name).toBe(product_name);

            // Property 10: Image URL is included if provided
            if (imageUrl) {
              expect(catalogItem.descriptor.symbol).toBe(imageUrl);
              expect(catalogItem.descriptor.images).toContain(imageUrl);
            }

            // Property 11: ONDC schema validation passes
            const validation = validateCatalogItem(catalogItem);
            expect(validation.valid).toBe(true);
            expect(validation.errors).toHaveLength(0);

            // Property 12: Response includes validation result
            expect(response.validation).toBeDefined();
            expect(response.validation!.valid).toBe(true);
          }
        ),
        { numRuns: 5 }
      );
    }, 30000);

    it('should validate catalog items with all required fields present', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            id: fc.uuid(),
            name: fc.string({ minLength: 3, maxLength: 100 }),
            price: fc.integer({ min: 1, max: 1000000 }),
            quantity: fc.integer({ min: 1, max: 10000 }),
            category: fc.constantFrom('Grocery', 'Fashion', 'Home & Decor'),
            fulfillmentId: fc.string({ minLength: 1, maxLength: 10 }),
            locationId: fc.uuid(),
          }),
          async ({ id, name, price, quantity, category, fulfillmentId, locationId }) => {
            const catalogItem: BecknCatalogItem = {
              id,
              descriptor: {
                name,
                short_desc: `${name} - ${quantity} pieces`,
                long_desc: `${name}. Available quantity: ${quantity} pieces.`,
                images: [],
              },
              price: {
                currency: 'INR',
                value: price.toFixed(2),
                maximum_value: price.toFixed(2),
              },
              quantity: {
                available: { count: quantity },
                maximum: { count: Math.min(quantity, 10) },
              },
              category_id: category,
              fulfillment_id: fulfillmentId,
              location_id: locationId,
              time: {
                label: 'enable',
                timestamp: new Date().toISOString(),
              },
              tags: [],
            };

            const validation = validateCatalogItem(catalogItem);

            // Property: Valid catalog items pass validation
            expect(validation.valid).toBe(true);
            expect(validation.errors).toHaveLength(0);
          }
        ),
        { numRuns: 5 }
      );
    }, 30000);
  });

  describe('Context Field Validation', () => {
    it('should validate context with all mandatory fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            domain: fc.constantFrom(
              'nic2004:52110',
              'nic2004:52220',
              'ONDC:RET10',
              'ONDC:RET11',
              'ONDC:RET12'
            ),
            city: fc.string({ minLength: 2, maxLength: 50 }),
            bap_id: fc.domain(),
            bap_uri: fc.webUrl({ validSchemes: ['https'] }),
            bpp_id: fc.domain(),
            bpp_uri: fc.webUrl({ validSchemes: ['https'] }),
            transaction_id: fc.uuid(),
            message_id: fc.uuid(),
          }),
          async ({
            domain,
            city,
            bap_id,
            bap_uri,
            bpp_id,
            bpp_uri,
            transaction_id,
            message_id,
          }) => {
            const context: ONDCCatalogPayload['context'] = {
              domain,
              country: 'IND',
              city,
              action: 'on_search',
              core_version: '1.2.0',
              bap_id,
              bap_uri,
              bpp_id,
              bpp_uri,
              transaction_id,
              message_id,
              timestamp: new Date().toISOString(),
            };

            const validation = validateContext(context);

            // Property 1: Valid context passes validation
            expect(validation.valid).toBe(true);
            expect(validation.errors).toHaveLength(0);

            // Property 2: Country is always IND
            expect(context.country).toBe('IND');

            // Property 3: Action is on_search
            expect(context.action).toBe('on_search');

            // Property 4: Core version is 1.2.0
            expect(context.core_version).toBe('1.2.0');

            // Property 5: Transaction ID is valid UUID
            expect(transaction_id).toMatch(
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
            );

            // Property 6: Message ID is valid UUID
            expect(message_id).toMatch(
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
            );

            // Property 7: Timestamp is ISO 8601 format
            expect(() => new Date(context.timestamp)).not.toThrow();
            expect(new Date(context.timestamp).toISOString()).toBe(context.timestamp);
          }
        ),
        { numRuns: 5 }
      );
    }, 30000);
  });

  describe('GPS Coordinate Validation', () => {
    it('should validate GPS coordinates in lat,long format', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            latitude: fc.double({ min: -90, max: 90, noNaN: true }),
            longitude: fc.double({ min: -180, max: 180, noNaN: true }),
          }),
          async ({ latitude, longitude }) => {
            // Format GPS coordinates as "lat,long"
            const gps = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;

            const validation = validateGPSCoordinates(gps);

            // Property 1: Valid GPS coordinates pass validation
            expect(validation.valid).toBe(true);
            expect(validation.errors).toHaveLength(0);

            // Property 2: GPS format is "lat,long"
            expect(gps).toMatch(/^-?\d+\.\d+,-?\d+\.\d+$/);

            // Property 3: Latitude is within valid range
            const [lat] = gps.split(',').map(parseFloat);
            expect(lat).toBeGreaterThanOrEqual(-90);
            expect(lat).toBeLessThanOrEqual(90);

            // Property 4: Longitude is within valid range
            const [, long] = gps.split(',').map(parseFloat);
            expect(long).toBeGreaterThanOrEqual(-180);
            expect(long).toBeLessThanOrEqual(180);
          }
        ),
        { numRuns: 5 }
      );
    }, 30000);

    it('should reject invalid GPS coordinate formats', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            'invalid',
            '28.6139', // Missing longitude
            '28.6139,', // Missing longitude value
            ',77.2090', // Missing latitude
            '28.6139 77.2090', // Space instead of comma
            '28.6139;77.2090', // Semicolon instead of comma
            'lat,long', // Non-numeric values
            '100.0,77.2090', // Latitude out of range
            '28.6139,200.0' // Longitude out of range
          ),
          async (invalidGps) => {
            const validation = validateGPSCoordinates(invalidGps);

            // Property: Invalid GPS coordinates fail validation
            expect(validation.valid).toBe(false);
            expect(validation.errors.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 5 }
      );
    }, 30000);
  });

  describe('Complete ONDC Payload Validation', () => {
    it('should validate complete ONDC on_search payloads', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            sellerId: fc.uuid(),
            sellerName: fc.string({ minLength: 3, maxLength: 50 }),
            latitude: fc.double({ min: -90, max: 90, noNaN: true }),
            longitude: fc.double({ min: -180, max: 180, noNaN: true }),
            city: fc.string({ minLength: 2, maxLength: 50 }),
            state: fc.string({ minLength: 2, maxLength: 50 }),
            pincode: fc.integer({ min: 100000, max: 999999 }).map(String),
            products: fc.array(
              fc.record({
                name: fc.string({ minLength: 3, maxLength: 100 }),
                price: fc.integer({ min: 1, max: 100000 }),
                quantity: fc.integer({ min: 1, max: 1000 }),
              }),
              { minLength: 1, maxLength: 5 }
            ),
          }),
          async ({
            sellerId,
            sellerName,
            latitude,
            longitude,
            city,
            state,
            pincode,
            products,
          }) => {
            // Construct complete ONDC payload
            const payload: ONDCCatalogPayload = {
              context: {
                domain: 'ONDC:RET10',
                country: 'IND',
                city,
                action: 'on_search',
                core_version: '1.2.0',
                bap_id: 'buyer-app.ondc.in',
                bap_uri: 'https://buyer-app.ondc.in',
                bpp_id: 'vyapar-vaani.ondc.in',
                bpp_uri: 'https://api.vyapar-vaani.ondc.in',
                transaction_id: randomUUID(),
                message_id: randomUUID(),
                timestamp: new Date().toISOString(),
              },
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
                      id: sellerId,
                      descriptor: {
                        name: sellerName,
                        short_desc: `Products from ${sellerName}`,
                        long_desc: `Quality products from ${sellerName}`,
                        images: [],
                      },
                      locations: [
                        {
                          id: sellerId,
                          gps: `${latitude.toFixed(4)},${longitude.toFixed(4)}`,
                          address: {
                            locality: 'Test Locality',
                            street: 'Test Street',
                            city,
                            state,
                            country: 'IND',
                            area_code: pincode,
                          },
                        },
                      ],
                      items: products.map((product) => ({
                        id: randomUUID(),
                        descriptor: {
                          name: product.name,
                          short_desc: `${product.name} - ${product.quantity} pieces`,
                          long_desc: `${product.name}. Available quantity: ${product.quantity} pieces.`,
                          images: [],
                        },
                        price: {
                          currency: 'INR',
                          value: product.price.toFixed(2),
                          maximum_value: product.price.toFixed(2),
                        },
                        quantity: {
                          available: { count: product.quantity },
                          maximum: { count: Math.min(product.quantity, 10) },
                        },
                        category_id: 'Grocery',
                        fulfillment_id: 'F1',
                        location_id: sellerId,
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
                        '@ondc/org/contact_details_consumer_care':
                          '+919876543210,support@vyapar-vaani.in',
                      })),
                    },
                  ],
                },
              },
            };

            const validation = validateONDCCatalogPayload(payload);

            // Property 1: Complete payload passes validation
            expect(validation.valid).toBe(true);
            expect(validation.errors).toHaveLength(0);

            // Property 2: Context is valid
            expect(payload.context.domain).toBeDefined();
            expect(payload.context.country).toBe('IND');
            expect(payload.context.action).toBe('on_search');
            expect(payload.context.core_version).toBe('1.2.0');

            // Property 3: Message structure is valid
            expect(payload.message.catalog).toBeDefined();
            expect(payload.message.catalog['bpp/descriptor']).toBeDefined();
            expect(payload.message.catalog['bpp/providers']).toBeDefined();
            expect(Array.isArray(payload.message.catalog['bpp/providers'])).toBe(true);

            // Property 4: Provider has required fields
            const provider = payload.message.catalog['bpp/providers'][0];
            expect(provider.id).toBe(sellerId);
            expect(provider.descriptor).toBeDefined();
            expect(provider.locations).toBeDefined();
            expect(provider.items).toBeDefined();

            // Property 5: All items have valid structure
            provider.items.forEach((item) => {
              expect(item.id).toBeDefined();
              expect(item.descriptor.name).toBeDefined();
              expect(item.price.currency).toBe('INR');
              expect(item.price.value).toMatch(/^\d+\.\d{2}$/);
              expect(item.quantity.available.count).toBeGreaterThan(0);
              expect(item.category_id).toBeDefined();
              expect(item.fulfillment_id).toBeDefined();
              expect(item.location_id).toBeDefined();
            });

            // Property 6: GPS coordinates are valid
            const location = provider.locations[0];
            expect(location.gps).toMatch(/^-?\d+\.\d+,-?\d+\.\d+$/);

            // Property 7: All products are included
            expect(provider.items).toHaveLength(products.length);
          }
        ),
        { numRuns: 5 }
      );
    }, 30000);
  });

  describe('Schema Validation Error Detection', () => {
    it('should detect missing mandatory fields in catalog items', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom<keyof BecknCatalogItem>(
            'id',
            'descriptor',
            'price',
            'quantity',
            'category_id',
            'fulfillment_id',
            'location_id',
            'time'
          ),
          async (missingField) => {
            // Create a valid catalog item
            const validItem: BecknCatalogItem = {
              id: randomUUID(),
              descriptor: {
                name: 'Test Product',
                short_desc: 'Test product description',
                long_desc: 'Test product long description',
                images: [],
              },
              price: {
                currency: 'INR',
                value: '100.00',
              },
              quantity: {
                available: { count: 10 },
                maximum: { count: 5 },
              },
              category_id: 'Grocery',
              fulfillment_id: 'F1',
              location_id: randomUUID(),
              time: {
                label: 'enable',
                timestamp: new Date().toISOString(),
              },
              tags: [],
            };

            // Remove the specified field
            const invalidItem = { ...validItem };
            delete (invalidItem as any)[missingField];

            const validation = validateCatalogItem(invalidItem as BecknCatalogItem);

            // Property: Missing mandatory fields cause validation failure
            expect(validation.valid).toBe(false);
            expect(validation.errors.length).toBeGreaterThan(0);
            expect(validation.errors.some((e) => e.field.includes(missingField))).toBe(true);
          }
        ),
        { numRuns: 5 }
      );
    }, 30000);

    it('should detect invalid currency codes', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('USD', 'EUR', 'GBP', 'JPY', 'INVALID', ''),
          async (invalidCurrency) => {
            const catalogItem: BecknCatalogItem = {
              id: randomUUID(),
              descriptor: {
                name: 'Test Product',
                short_desc: 'Test',
                long_desc: 'Test product',
                images: [],
              },
              price: {
                currency: invalidCurrency as any,
                value: '100.00',
              },
              quantity: {
                available: { count: 10 },
                maximum: { count: 5 },
              },
              category_id: 'Grocery',
              fulfillment_id: 'F1',
              location_id: randomUUID(),
              time: {
                label: 'enable',
                timestamp: new Date().toISOString(),
              },
              tags: [],
            };

            const validation = validateCatalogItem(catalogItem);

            // Property: Invalid currency codes cause validation failure
            expect(validation.valid).toBe(false);
            expect(validation.errors.some((e) => e.field === 'price.currency')).toBe(true);
          }
        ),
        { numRuns: 5 }
      );
    }, 30000);

    it('should detect invalid price formats', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('100', '100.0', '100.', '.00', 'invalid', ''),
          async (invalidPrice) => {
            const catalogItem: BecknCatalogItem = {
              id: randomUUID(),
              descriptor: {
                name: 'Test Product',
                short_desc: 'Test',
                long_desc: 'Test product',
                images: [],
              },
              price: {
                currency: 'INR',
                value: invalidPrice,
              },
              quantity: {
                available: { count: 10 },
                maximum: { count: 5 },
              },
              category_id: 'Grocery',
              fulfillment_id: 'F1',
              location_id: randomUUID(),
              time: {
                label: 'enable',
                timestamp: new Date().toISOString(),
              },
              tags: [],
            };

            const validation = validateCatalogItem(catalogItem);

            // Property: Invalid price formats cause validation failure
            expect(validation.valid).toBe(false);
            expect(validation.errors.some((e) => e.field === 'price.value')).toBe(true);
          }
        ),
        { numRuns: 5 }
      );
    }, 30000);
  });
});
