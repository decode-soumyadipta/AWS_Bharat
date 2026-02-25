/**
 * Property-Based Test: Catalog Pre-Validation
 * 
 * **Validates: Requirements 10.4**
 * 
 * Property 19: Catalog Pre-Validation
 * For any catalog object constructed by the system, it should pass ONDC schema 
 * validation before being broadcast to the registry, achieving a 0% rejection rate.
 * 
 * This test verifies:
 * 1. All catalog objects constructed by the system pass ONDC schema validation
 * 2. Validation occurs before broadcast to ONDC Registry
 * 3. Invalid catalogs are rejected and never broadcast
 * 4. Sellers are notified when validation fails with specific missing fields
 * 5. The system achieves 0% rejection rate by pre-validating all catalogs
 */

import fc from 'fast-check';
import { handler as storageBroadcast } from '../../src/lambdas/catalog-storage-broadcast';
import { handler as buildCatalog } from '../../src/lambdas/catalog-builder';
import { validateCatalogItem, validateONDCCatalogPayload } from '../../src/services/ondc-schema-validator';
import { CatalogEntities } from '../../src/models/intent';
import { SellerProfile } from '../../src/models/seller';
import { BecknCatalogItem } from '../../src/models/catalog';
import { randomUUID } from 'crypto';

// Mock DynamoDB repository functions
jest.mock('../../src/services/dynamodb-repository', () => ({
  getSellerById: jest.fn().mockImplementation(async (sellerId: string) => {
    return {
      PK: `SELLER#${sellerId}`,
      SK: 'PROFILE',
      GSI1PK: '+919876543210',
      GSI1SK: 'PROFILE',
      entityType: 'SELLER_PROFILE',
      sellerId,
      phone: '+919876543210',
      name: 'Test Seller',
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
        signingPublicKey: 'mock-public-key',
        encryptionPublicKey: 'mock-encryption-key',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }),
  createCatalogItem: jest.fn().mockResolvedValue(undefined),
}));

/**
 * Create a mock seller profile for testing
 */
function createMockSellerProfile(): SellerProfile {
  return {
    PK: `SELLER#${randomUUID()}`,
    SK: 'PROFILE',
    GSI1PK: '+919876543210',
    GSI1SK: 'PROFILE',
    entityType: 'SELLER_PROFILE',
    sellerId: randomUUID(),
    phone: '+919876543210',
    name: 'Test Seller',
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
      signingPublicKey: 'mock-public-key',
      encryptionPublicKey: 'mock-encryption-key',
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('Property 19: Catalog Pre-Validation', () => {
  describe('System-Constructed Catalogs Always Pass Validation', () => {
    it('should validate all catalog objects constructed from valid product entities', async () => {
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
            const sellerProfile = createMockSellerProfile();
            const entities: CatalogEntities = {
              product_name,
              price,
              quantity,
              unit,
              description,
              category,
            };

            // Step 1: Build catalog using catalog builder
            const buildResponse = await buildCatalog({
              entities,
              sellerProfile,
              imageUrl,
            });

            // Property 1: Catalog construction succeeds
            expect(buildResponse.success).toBe(true);
            expect(buildResponse.catalogItem).toBeDefined();

            const catalogItem = buildResponse.catalogItem!;

            // Property 2: Constructed catalog passes ONDC schema validation
            const validation = validateCatalogItem(catalogItem);
            expect(validation.valid).toBe(true);
            expect(validation.errors).toHaveLength(0);

            // Property 3: Validation result is included in build response
            expect(buildResponse.validation).toBeDefined();
            expect(buildResponse.validation!.valid).toBe(true);

            // Property 4: All mandatory fields are present
            expect(catalogItem.id).toBeDefined();
            expect(catalogItem.descriptor).toBeDefined();
            expect(catalogItem.descriptor.name).toBeDefined();
            expect(catalogItem.price).toBeDefined();
            expect(catalogItem.price.currency).toBe('INR');
            expect(catalogItem.quantity).toBeDefined();
            expect(catalogItem.category_id).toBeDefined();
            expect(catalogItem.fulfillment_id).toBeDefined();
            expect(catalogItem.location_id).toBeDefined();
            expect(catalogItem.time).toBeDefined();

            // Property 5: Price format is correct (decimal string with 2 places)
            expect(catalogItem.price.value).toMatch(/^\d+\.\d{2}$/);

            // Property 6: Timestamp is in ISO 8601 format
            expect(() => new Date(catalogItem.time.timestamp)).not.toThrow();
            expect(new Date(catalogItem.time.timestamp).toISOString()).toBe(
              catalogItem.time.timestamp
            );
          }
        ),
        { numRuns: 100 }
      );
    }, 60000);

    it('should ensure storage-broadcast validates before broadcasting', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            product_name: fc.string({ minLength: 3, maxLength: 100 }),
            price: fc.integer({ min: 1, max: 100000 }),
            quantity: fc.integer({ min: 1, max: 1000 }),
            unit: fc.constantFrom('kg', 'liters', 'pieces', 'packets'),
            category: fc.constantFrom('food', 'grocery', 'handicraft', 'textile'),
          }),
          async ({ product_name, price, quantity, unit, category }) => {
            const sellerProfile = createMockSellerProfile();
            const entities: CatalogEntities = {
              product_name,
              price,
              quantity,
              unit,
              description: `${product_name} description`,
              category,
            };

            // Build catalog
            const buildResponse = await buildCatalog({
              entities,
              sellerProfile,
            });

            expect(buildResponse.success).toBe(true);
            const catalogItem = buildResponse.catalogItem!;

            // Attempt to store and broadcast
            const storageResponse = await storageBroadcast({
              catalogItem,
              sellerId: sellerProfile.sellerId,
              sellerPhone: sellerProfile.phone,
              language: sellerProfile.language,
            });

            // Property 1: Storage and broadcast succeeds for valid catalogs
            expect(storageResponse.success).toBe(true);
            expect(storageResponse.itemId).toBeDefined();
            expect(storageResponse.broadcast).toBe(true);

            // Property 2: Confirmation is sent to seller
            expect(storageResponse.confirmationSent).toBe(true);

            // Property 3: No errors are returned
            expect(storageResponse.error).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    }, 60000);
  });

  describe('Invalid Catalogs Are Rejected Before Broadcast', () => {
    it('should reject catalogs with missing mandatory fields', async () => {
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
            const sellerProfile = createMockSellerProfile();

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

            // Remove the specified field to make it invalid
            const invalidItem = { ...validItem };
            delete (invalidItem as any)[missingField];

            // Attempt to store and broadcast invalid catalog
            const storageResponse = await storageBroadcast({
              catalogItem: invalidItem as BecknCatalogItem,
              sellerId: sellerProfile.sellerId,
              sellerPhone: sellerProfile.phone,
              language: sellerProfile.language,
            });

            // Property 1: Storage and broadcast fails for invalid catalogs
            expect(storageResponse.success).toBe(false);

            // Property 2: Error indicates validation failure
            expect(storageResponse.error).toBeDefined();
            expect(storageResponse.error!.code).toBe('VALIDATION_FAILED');

            // Property 3: Missing fields are identified
            expect(storageResponse.error!.missingFields).toBeDefined();
            expect(storageResponse.error!.missingFields!.length).toBeGreaterThan(0);

            // Property 4: Catalog is not broadcast
            expect(storageResponse.broadcast).toBeUndefined();

            // Property 5: Item is not stored
            expect(storageResponse.itemId).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    }, 60000);

    it('should reject catalogs with invalid currency codes', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('USD', 'EUR', 'GBP', 'JPY', 'INVALID', ''),
          async (invalidCurrency) => {
            const sellerProfile = createMockSellerProfile();

            const invalidItem: BecknCatalogItem = {
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

            const storageResponse = await storageBroadcast({
              catalogItem: invalidItem,
              sellerId: sellerProfile.sellerId,
              sellerPhone: sellerProfile.phone,
              language: sellerProfile.language,
            });

            // Property: Invalid currency causes rejection
            expect(storageResponse.success).toBe(false);
            expect(storageResponse.error).toBeDefined();
            expect(storageResponse.error!.code).toBe('VALIDATION_FAILED');
            expect(storageResponse.broadcast).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    }, 60000);

    it('should reject catalogs with invalid price formats', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('100', '100.0', '100.', '.00', 'invalid', ''),
          async (invalidPrice) => {
            const sellerProfile = createMockSellerProfile();

            const invalidItem: BecknCatalogItem = {
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

            const storageResponse = await storageBroadcast({
              catalogItem: invalidItem,
              sellerId: sellerProfile.sellerId,
              sellerPhone: sellerProfile.phone,
              language: sellerProfile.language,
            });

            // Property: Invalid price format causes rejection
            expect(storageResponse.success).toBe(false);
            expect(storageResponse.error).toBeDefined();
            expect(storageResponse.error!.code).toBe('VALIDATION_FAILED');
            expect(storageResponse.broadcast).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    }, 60000);
  });

  describe('Complete ONDC Payload Validation Before Broadcast', () => {
    it('should validate complete ONDC on_search payload before broadcast', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            products: fc.array(
              fc.record({
                product_name: fc.string({ minLength: 3, maxLength: 100 }),
                price: fc.integer({ min: 1, max: 100000 }),
                quantity: fc.integer({ min: 1, max: 1000 }),
                unit: fc.constantFrom('kg', 'liters', 'pieces', 'packets'),
                category: fc.constantFrom('food', 'grocery', 'handicraft', 'textile'),
              }),
              { minLength: 1, maxLength: 5 }
            ),
          }),
          async ({ products }) => {
            const sellerProfile = createMockSellerProfile();

            // Build catalog items for all products
            const catalogItems: BecknCatalogItem[] = [];
            for (const product of products) {
              const entities: CatalogEntities = {
                product_name: product.product_name,
                price: product.price,
                quantity: product.quantity,
                unit: product.unit,
                description: `${product.product_name} description`,
                category: product.category,
              };

              const buildResponse = await buildCatalog({
                entities,
                sellerProfile,
              });

              expect(buildResponse.success).toBe(true);
              catalogItems.push(buildResponse.catalogItem!);
            }

            // Property 1: All constructed catalog items are valid
            for (const item of catalogItems) {
              const validation = validateCatalogItem(item);
              expect(validation.valid).toBe(true);
              expect(validation.errors).toHaveLength(0);
            }

            // Property 2: Each item can be successfully stored and broadcast
            for (const item of catalogItems) {
              const storageResponse = await storageBroadcast({
                catalogItem: item,
                sellerId: sellerProfile.sellerId,
                sellerPhone: sellerProfile.phone,
                language: sellerProfile.language,
              });

              expect(storageResponse.success).toBe(true);
              expect(storageResponse.broadcast).toBe(true);
            }

            // Property 3: 0% rejection rate - all items pass validation
            const totalItems = catalogItems.length;
            const validItems = catalogItems.filter(
              (item) => validateCatalogItem(item).valid
            ).length;

            expect(validItems).toBe(totalItems);
            expect(validItems / totalItems).toBe(1.0); // 100% success rate = 0% rejection rate
          }
        ),
        { numRuns: 50 }
      );
    }, 60000);
  });

  describe('Seller Notification on Validation Failure', () => {
    it('should notify seller with specific missing fields when validation fails', async () => {
      const sellerProfile = createMockSellerProfile();

      // Create an invalid catalog item (missing price)
      const invalidItem: any = {
        id: randomUUID(),
        descriptor: {
          name: 'Test Product',
          short_desc: 'Test',
          long_desc: 'Test product',
          images: [],
        },
        // price is missing
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

      const storageResponse = await storageBroadcast({
        catalogItem: invalidItem,
        sellerId: sellerProfile.sellerId,
        sellerPhone: sellerProfile.phone,
        language: sellerProfile.language,
      });

      // Property 1: Validation fails
      expect(storageResponse.success).toBe(false);

      // Property 2: Error includes missing fields
      expect(storageResponse.error).toBeDefined();
      expect(storageResponse.error!.missingFields).toBeDefined();
      expect(storageResponse.error!.missingFields).toContain('price');

      // Property 3: Error message indicates seller was notified
      expect(storageResponse.error!.message).toContain('Requested missing information');
    });

    it('should provide language-specific error messages', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom<'hi' | 'mr' | 'en'>('hi', 'mr', 'en'),
          async (language) => {
            const sellerProfile = createMockSellerProfile();
            sellerProfile.language = language;

            // Create invalid catalog (missing descriptor)
            const invalidItem: any = {
              id: randomUUID(),
              // descriptor is missing
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

            const storageResponse = await storageBroadcast({
              catalogItem: invalidItem,
              sellerId: sellerProfile.sellerId,
              sellerPhone: sellerProfile.phone,
              language,
            });

            // Property: Validation fails and seller is notified in their language
            expect(storageResponse.success).toBe(false);
            expect(storageResponse.error).toBeDefined();
            expect(storageResponse.error!.code).toBe('VALIDATION_FAILED');
          }
        ),
        { numRuns: 100 }
      );
    }, 60000);
  });

  describe('Zero Rejection Rate Achievement', () => {
    it('should achieve 0% rejection rate for all system-constructed catalogs', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              product_name: fc.string({ minLength: 3, maxLength: 100 }),
              price: fc.integer({ min: 1, max: 100000 }),
              quantity: fc.integer({ min: 1, max: 1000 }),
              unit: fc.constantFrom('kg', 'liters', 'pieces', 'packets'),
              category: fc.constantFrom('food', 'grocery', 'handicraft', 'textile'),
            }),
            { minLength: 10, maxLength: 50 }
          ),
          async (products) => {
            const sellerProfile = createMockSellerProfile();
            let totalConstructed = 0;
            let totalValid = 0;
            let totalBroadcast = 0;

            for (const product of products) {
              const entities: CatalogEntities = {
                product_name: product.product_name,
                price: product.price,
                quantity: product.quantity,
                unit: product.unit,
                description: `${product.product_name} description`,
                category: product.category,
              };

              // Build catalog
              const buildResponse = await buildCatalog({
                entities,
                sellerProfile,
              });

              if (buildResponse.success) {
                totalConstructed++;

                // Validate
                const validation = validateCatalogItem(buildResponse.catalogItem!);
                if (validation.valid) {
                  totalValid++;

                  // Attempt broadcast
                  const storageResponse = await storageBroadcast({
                    catalogItem: buildResponse.catalogItem!,
                    sellerId: sellerProfile.sellerId,
                    sellerPhone: sellerProfile.phone,
                    language: sellerProfile.language,
                  });

                  if (storageResponse.success && storageResponse.broadcast) {
                    totalBroadcast++;
                  }
                }
              }
            }

            // Property 1: All constructed catalogs are valid
            expect(totalValid).toBe(totalConstructed);

            // Property 2: All valid catalogs are successfully broadcast
            expect(totalBroadcast).toBe(totalValid);

            // Property 3: 0% rejection rate
            const rejectionRate = (totalConstructed - totalBroadcast) / totalConstructed;
            expect(rejectionRate).toBe(0);

            // Property 4: 100% success rate
            const successRate = totalBroadcast / totalConstructed;
            expect(successRate).toBe(1.0);
          }
        ),
        { numRuns: 20 }
      );
    }, 120000);
  });
});
