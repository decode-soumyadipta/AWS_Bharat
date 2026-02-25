/**
 * Property-Based Test: Entity Extraction from Voice
 * 
 * **Validates: Requirements 2.3, 4.4**
 * 
 * Property 6: Entity Extraction from Voice
 * For any voice note classified as catalog creation intent, the system should 
 * extract product entities (name, price, quantity, unit) and return structured 
 * data where all required fields are either populated or explicitly marked as null.
 * 
 * This test verifies:
 * 1. Entity extraction succeeds for catalog creation intent
 * 2. All required fields (product_name, price, quantity, unit, category) are present
 * 3. Each field is either populated with valid data or explicitly null
 * 4. Numeric fields (price, quantity) are numbers when populated
 * 5. String fields (product_name, unit, category) are strings when populated
 * 6. Missing fields are correctly identified in missingFields array
 * 7. needsClarification flag is set when required fields are missing
 * 8. Extraction works for all supported intents (CREATE_CATALOG, UPDATE_INVENTORY, order intents)
 */

import fc from 'fast-check';
import { handler as extractEntities } from '../../src/lambdas/entity-extraction';
import { mockClient } from 'aws-sdk-client-mock';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import {
  EntityExtractionRequest,
  IntentType,
  CatalogEntities,
  InventoryEntities,
  OrderEntities,
} from '../../src/models/intent';

const bedrockMock = mockClient(BedrockRuntimeClient);

// Mock environment variables
process.env.AWS_REGION = 'ap-south-1';

describe('Property 6: Entity Extraction from Voice', () => {
  beforeEach(() => {
    bedrockMock.reset();
    jest.clearAllMocks();
  });

  it('should extract catalog entities with all fields either populated or explicitly null', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          product_name: fc.option(fc.string({ minLength: 3, maxLength: 100 }), { nil: null }),
          price: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: null }),
          quantity: fc.option(fc.integer({ min: 0, max: 10000 }), { nil: null }),
          unit: fc.option(
            fc.constantFrom('kg', 'liters', 'pieces', 'packets', 'grams', 'ml'),
            { nil: null }
          ),
          description: fc.option(fc.string({ minLength: 5, maxLength: 200 }), { nil: null }),
          category: fc.option(
            fc.constantFrom('food', 'grocery', 'handicraft', 'textile', 'other'),
            { nil: null }
          ),
          transcribedText: fc.string({ minLength: 10, maxLength: 200 })
            .filter(s => s.trim().length >= 10),
          messageId: fc.uuid(),
          sellerId: fc.uuid(),
        }),
        async ({ product_name, price, quantity, unit, description, category, transcribedText, messageId, sellerId }) => {
          bedrockMock.reset();

          // Create mock entities response
          const mockEntities: CatalogEntities = {
            product_name,
            price,
            quantity,
            unit,
            description,
            category,
          };

          const mockClaudeResponse = {
            content: [{ text: JSON.stringify(mockEntities) }],
          };

          bedrockMock.on(InvokeModelCommand).resolves({
            body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)) as any,
          });

          const request: EntityExtractionRequest = {
            transcribedText,
            intent: 'CREATE_CATALOG',
            messageId,
            sellerId,
          };

          const response = await extractEntities(request);

          // Property 1: Extraction succeeds
          expect(response.success).toBe(true);

          // Property 2: Entities are returned
          expect(response.entities).toBeDefined();

          // Property 3: All required fields are present (either populated or null)
          const entities = response.entities as CatalogEntities;
          expect(entities).toHaveProperty('product_name');
          expect(entities).toHaveProperty('price');
          expect(entities).toHaveProperty('quantity');
          expect(entities).toHaveProperty('unit');
          expect(entities).toHaveProperty('category');

          // Property 4: Fields match expected values
          expect(entities.product_name).toBe(product_name);
          expect(entities.price).toBe(price);
          expect(entities.quantity).toBe(quantity);
          expect(entities.unit).toBe(unit);
          expect(entities.category).toBe(category);

          // Property 5: Numeric fields are numbers when populated
          if (entities.price !== null) {
            expect(typeof entities.price).toBe('number');
          }
          if (entities.quantity !== null) {
            expect(typeof entities.quantity).toBe('number');
          }

          // Property 6: String fields are strings when populated
          if (entities.product_name !== null) {
            expect(typeof entities.product_name).toBe('string');
          }
          if (entities.unit !== null) {
            expect(typeof entities.unit).toBe('string');
          }
          if (entities.category !== null) {
            expect(typeof entities.category).toBe('string');
          }

          // Property 7: Missing fields are identified
          expect(response.missingFields).toBeDefined();
          const expectedMissingFields: string[] = [];
          if (!product_name) expectedMissingFields.push('product_name');
          if (price === null || price === undefined) expectedMissingFields.push('price');
          if (quantity === null || quantity === undefined) expectedMissingFields.push('quantity');
          if (!unit) expectedMissingFields.push('unit');
          if (!category) expectedMissingFields.push('category');

          expect(response.missingFields).toEqual(expectedMissingFields);

          // Property 8: needsClarification is set correctly
          expect(response.needsClarification).toBe(expectedMissingFields.length > 0);

          // Property 9: No error is present
          expect(response.error).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should extract inventory update entities with all fields either populated or explicitly null', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          product_identifier: fc.option(fc.string({ minLength: 3, maxLength: 100 }), { nil: null }),
          new_quantity: fc.option(fc.integer({ min: 0, max: 10000 }), { nil: null }),
          operation: fc.option(
            fc.constantFrom<'SET' | 'INCREMENT' | 'DECREMENT'>('SET', 'INCREMENT', 'DECREMENT'),
            { nil: null }
          ),
          transcribedText: fc.string({ minLength: 10, maxLength: 200 })
            .filter(s => s.trim().length >= 10),
          messageId: fc.uuid(),
        }),
        async ({ product_identifier, new_quantity, operation, transcribedText, messageId }) => {
          bedrockMock.reset();

          // Create mock entities response
          const mockEntities: InventoryEntities = {
            product_identifier,
            new_quantity,
            operation,
          };

          const mockClaudeResponse = {
            content: [{ text: JSON.stringify(mockEntities) }],
          };

          bedrockMock.on(InvokeModelCommand).resolves({
            body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)) as any,
          });

          const request: EntityExtractionRequest = {
            transcribedText,
            intent: 'UPDATE_INVENTORY',
            messageId,
          };

          const response = await extractEntities(request);

          // Verify extraction succeeded
          expect(response.success).toBe(true);
          expect(response.entities).toBeDefined();

          // Verify all fields are present
          const entities = response.entities as InventoryEntities;
          expect(entities).toHaveProperty('product_identifier');
          expect(entities).toHaveProperty('new_quantity');
          expect(entities).toHaveProperty('operation');

          // Verify field values
          expect(entities.product_identifier).toBe(product_identifier);
          expect(entities.new_quantity).toBe(new_quantity);
          expect(entities.operation).toBe(operation);

          // Verify data types
          if (entities.product_identifier !== null) {
            expect(typeof entities.product_identifier).toBe('string');
          }
          if (entities.new_quantity !== null) {
            expect(typeof entities.new_quantity).toBe('number');
          }
          if (entities.operation !== null) {
            expect(['SET', 'INCREMENT', 'DECREMENT']).toContain(entities.operation);
          }

          // Verify missing fields detection
          expect(response.missingFields).toBeDefined();
          const expectedMissingFields: string[] = [];
          if (!product_identifier) expectedMissingFields.push('product_identifier');
          if (new_quantity === null || new_quantity === undefined) expectedMissingFields.push('new_quantity');

          expect(response.missingFields).toEqual(expectedMissingFields);
          expect(response.needsClarification).toBe(expectedMissingFields.length > 0);
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should extract order entities with all fields either populated or explicitly null', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          intent: fc.constantFrom<IntentType>(
            'ACCEPT_ORDER',
            'REJECT_ORDER',
            'UPDATE_FULFILLMENT',
            'QUERY_STATUS'
          ),
          order_id: fc.option(fc.uuid(), { nil: null }),
          action: fc.option(
            fc.constantFrom('accept', 'reject', 'packed', 'shipped', 'delivered', 'query'),
            { nil: null }
          ),
          reason: fc.option(fc.string({ minLength: 5, maxLength: 100 }), { nil: null }),
          transcribedText: fc.string({ minLength: 10, maxLength: 200 })
            .filter(s => s.trim().length >= 10),
          messageId: fc.uuid(),
        }),
        async ({ intent, order_id, action, reason, transcribedText, messageId }) => {
          bedrockMock.reset();

          // Create mock entities response
          const mockEntities: OrderEntities = {
            order_id,
            action,
            reason,
          };

          const mockClaudeResponse = {
            content: [{ text: JSON.stringify(mockEntities) }],
          };

          bedrockMock.on(InvokeModelCommand).resolves({
            body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)) as any,
          });

          const request: EntityExtractionRequest = {
            transcribedText,
            intent,
            messageId,
          };

          const response = await extractEntities(request);

          // Verify extraction succeeded
          expect(response.success).toBe(true);
          expect(response.entities).toBeDefined();

          // Verify all fields are present
          const entities = response.entities as OrderEntities;
          expect(entities).toHaveProperty('order_id');
          expect(entities).toHaveProperty('action');

          // Verify field values
          expect(entities.order_id).toBe(order_id);
          expect(entities.action).toBe(action);
          expect(entities.reason).toBe(reason);

          // Verify data types
          if (entities.order_id !== null) {
            expect(typeof entities.order_id).toBe('string');
          }
          if (entities.action !== null) {
            expect(typeof entities.action).toBe('string');
          }
          if (entities.reason !== null) {
            expect(typeof entities.reason).toBe('string');
          }

          // Verify missing fields detection
          expect(response.missingFields).toBeDefined();
          const expectedMissingFields: string[] = [];
          if (!action) expectedMissingFields.push('action');

          expect(response.missingFields).toEqual(expectedMissingFields);
          expect(response.needsClarification).toBe(expectedMissingFields.length > 0);
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should handle complete catalog entities without missing fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          product_name: fc.string({ minLength: 3, maxLength: 100 }),
          price: fc.integer({ min: 1, max: 100000 }),
          quantity: fc.integer({ min: 1, max: 10000 }),
          unit: fc.constantFrom('kg', 'liters', 'pieces', 'packets', 'grams', 'ml'),
          description: fc.string({ minLength: 5, maxLength: 200 }),
          category: fc.constantFrom('food', 'grocery', 'handicraft', 'textile', 'other'),
          transcribedText: fc.string({ minLength: 10, maxLength: 200 })
            .filter(s => s.trim().length >= 10),
        }),
        async ({ product_name, price, quantity, unit, description, category, transcribedText }) => {
          bedrockMock.reset();

          const mockEntities: CatalogEntities = {
            product_name,
            price,
            quantity,
            unit,
            description,
            category,
          };

          const mockClaudeResponse = {
            content: [{ text: JSON.stringify(mockEntities) }],
          };

          bedrockMock.on(InvokeModelCommand).resolves({
            body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)) as any,
          });

          const request: EntityExtractionRequest = {
            transcribedText,
            intent: 'CREATE_CATALOG',
          };

          const response = await extractEntities(request);

          // Verify extraction succeeded
          expect(response.success).toBe(true);
          expect(response.entities).toBeDefined();

          // Verify no missing fields
          expect(response.missingFields).toEqual([]);
          expect(response.needsClarification).toBe(false);

          // Verify all fields are populated
          const entities = response.entities as CatalogEntities;
          expect(entities.product_name).toBe(product_name);
          expect(entities.price).toBe(price);
          expect(entities.quantity).toBe(quantity);
          expect(entities.unit).toBe(unit);
          expect(entities.description).toBe(description);
          expect(entities.category).toBe(category);
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should return error for empty or invalid transcribed text', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('', '   ', '\n\n', '\t\t'),
        async (invalidText) => {
          const request: EntityExtractionRequest = {
            transcribedText: invalidText,
            intent: 'CREATE_CATALOG',
          };

          const response = await extractEntities(request);

          expect(response.success).toBe(false);
          expect(response.error).toBeDefined();
          expect(response.error?.message).toContain('required');
          expect(response.entities).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should return error when intent is missing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 10, maxLength: 200 }).filter(s => s.trim().length >= 10),
        async (transcribedText) => {
          const request = {
            transcribedText,
          } as EntityExtractionRequest;

          const response = await extractEntities(request);

          expect(response.success).toBe(false);
          expect(response.error).toBeDefined();
          expect(response.error?.message).toContain('Intent is required');
          expect(response.entities).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  it('should handle Claude response with markdown code blocks', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          product_name: fc.string({ minLength: 3, maxLength: 100 }),
          price: fc.integer({ min: 1, max: 100000 }),
          quantity: fc.integer({ min: 1, max: 10000 }),
          unit: fc.constantFrom('kg', 'liters', 'pieces', 'packets'),
          category: fc.constantFrom('food', 'grocery', 'handicraft', 'textile'),
          transcribedText: fc.string({ minLength: 10, maxLength: 200 })
            .filter(s => s.trim().length >= 10),
          useMarkdown: fc.boolean(),
        }),
        async ({ product_name, price, quantity, unit, category, transcribedText, useMarkdown }) => {
          bedrockMock.reset();

          const mockEntities: CatalogEntities = {
            product_name,
            price,
            quantity,
            unit,
            description: null,
            category,
          };

          // Wrap JSON in markdown code blocks if useMarkdown is true
          const jsonString = JSON.stringify(mockEntities);
          const responseText = useMarkdown ? `\`\`\`json\n${jsonString}\n\`\`\`` : jsonString;

          const mockClaudeResponse = {
            content: [{ text: responseText }],
          };

          bedrockMock.on(InvokeModelCommand).resolves({
            body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)) as any,
          });

          const request: EntityExtractionRequest = {
            transcribedText,
            intent: 'CREATE_CATALOG',
          };

          const response = await extractEntities(request);

          // Verify extraction succeeded regardless of markdown formatting
          expect(response.success).toBe(true);
          expect(response.entities).toBeDefined();

          const entities = response.entities as CatalogEntities;
          expect(entities.product_name).toBe(product_name);
          expect(entities.price).toBe(price);
          expect(entities.quantity).toBe(quantity);
          expect(entities.unit).toBe(unit);
          expect(entities.category).toBe(category);
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);
});
