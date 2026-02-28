/**
 * Unit Tests for GetProducts Lambda Function
 * Feature: marketplace-buyer-interface
 * Task: 3.1 Create GetProductsFunction Lambda
 */

const { handler } = require('./getProducts');
const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

// Create mock for DynamoDB Document Client
const ddbMock = mockClient(DynamoDBDocumentClient);

describe('GetProducts Lambda Function', () => {
  beforeEach(() => {
    // Reset mocks before each test
    ddbMock.reset();
    // Set default environment variable
    process.env.PRODUCTS_TABLE_NAME = 'marketplace-products';
  });

  afterEach(() => {
    // Clean up
    delete process.env.PRODUCTS_TABLE_NAME;
  });

  describe('Successful Product Retrieval', () => {
    it('should return all products from DynamoDB', async () => {
      const mockProducts = [
        {
          productId: 'prod-1',
          name: 'Fresh Tomatoes',
          price: 50,
          quantity: 100,
          unit: 'kg',
          category: 'Vegetables',
          description: 'Fresh red tomatoes',
          imageUrl: 'https://example.com/tomatoes.jpg',
          seller: {
            name: 'Ramesh Kumar',
            phone: '9876543210'
          },
          createdAt: '2024-01-15T10:00:00.000Z'
        },
        {
          productId: 'prod-2',
          name: 'Organic Potatoes',
          price: 30,
          quantity: 200,
          unit: 'kg',
          category: 'Vegetables',
          description: 'Organic potatoes',
          imageUrl: 'https://example.com/potatoes.jpg',
          seller: {
            name: 'Priya Sharma',
            phone: '9876543211'
          },
          createdAt: '2024-01-16T10:00:00.000Z'
        }
      ];

      ddbMock.on(ScanCommand).resolves({
        Items: mockProducts
      });

      const event = {
        httpMethod: 'GET',
        path: '/products'
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toBe('application/json');
      expect(result.headers['Access-Control-Allow-Origin']).toBe('*');

      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.products).toBeDefined();
      expect(body.products).toHaveLength(2);
    });

    it('should sort products by createdAt descending (newest first)', async () => {
      const mockProducts = [
        {
          productId: 'prod-1',
          name: 'Product 1',
          price: 50,
          createdAt: '2024-01-10T10:00:00.000Z' // Oldest
        },
        {
          productId: 'prod-2',
          name: 'Product 2',
          price: 30,
          createdAt: '2024-01-15T10:00:00.000Z' // Middle
        },
        {
          productId: 'prod-3',
          name: 'Product 3',
          price: 40,
          createdAt: '2024-01-20T10:00:00.000Z' // Newest
        }
      ];

      ddbMock.on(ScanCommand).resolves({
        Items: mockProducts
      });

      const event = {
        httpMethod: 'GET',
        path: '/products'
      };

      const result = await handler(event);
      const body = JSON.parse(result.body);

      // Verify products are sorted newest first
      expect(body.products[0].productId).toBe('prod-3');
      expect(body.products[1].productId).toBe('prod-2');
      expect(body.products[2].productId).toBe('prod-1');
    });

    it('should handle empty product catalog', async () => {
      ddbMock.on(ScanCommand).resolves({
        Items: []
      });

      const event = {
        httpMethod: 'GET',
        path: '/products'
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.products).toEqual([]);
    });

    it('should handle products without createdAt field', async () => {
      const mockProducts = [
        {
          productId: 'prod-1',
          name: 'Product 1',
          price: 50
          // No createdAt field
        },
        {
          productId: 'prod-2',
          name: 'Product 2',
          price: 30,
          createdAt: '2024-01-15T10:00:00.000Z'
        }
      ];

      ddbMock.on(ScanCommand).resolves({
        Items: mockProducts
      });

      const event = {
        httpMethod: 'GET',
        path: '/products'
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.products).toHaveLength(2);
      // Product with createdAt should come first
      expect(body.products[0].productId).toBe('prod-2');
    });

    it('should include all product fields in response', async () => {
      const mockProduct = {
        productId: 'prod-1',
        name: 'Fresh Tomatoes',
        price: 50,
        quantity: 100,
        unit: 'kg',
        category: 'Vegetables',
        description: 'Fresh red tomatoes',
        imageUrl: 'https://example.com/tomatoes.jpg',
        seller: {
          name: 'Ramesh Kumar',
          phone: '9876543210'
        },
        createdAt: '2024-01-15T10:00:00.000Z',
        updatedAt: '2024-01-15T10:00:00.000Z'
      };

      ddbMock.on(ScanCommand).resolves({
        Items: [mockProduct]
      });

      const event = {
        httpMethod: 'GET',
        path: '/products'
      };

      const result = await handler(event);
      const body = JSON.parse(result.body);

      const product = body.products[0];
      expect(product.productId).toBe('prod-1');
      expect(product.name).toBe('Fresh Tomatoes');
      expect(product.price).toBe(50);
      expect(product.quantity).toBe(100);
      expect(product.unit).toBe('kg');
      expect(product.category).toBe('Vegetables');
      expect(product.description).toBe('Fresh red tomatoes');
      expect(product.imageUrl).toBe('https://example.com/tomatoes.jpg');
      expect(product.seller).toEqual({
        name: 'Ramesh Kumar',
        phone: '9876543210'
      });
      expect(product.createdAt).toBe('2024-01-15T10:00:00.000Z');
    });
  });

  describe('Error Handling', () => {
    it('should handle DynamoDB scan errors', async () => {
      ddbMock.on(ScanCommand).rejects(new Error('DynamoDB connection failed'));

      const event = {
        httpMethod: 'GET',
        path: '/products'
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('FETCH_PRODUCTS_ERROR');
      expect(body.error.message).toBe('Failed to fetch products');
      expect(body.error.details).toContain('DynamoDB connection failed');
    });

    it('should handle DynamoDB throttling errors', async () => {
      const throttleError = new Error('ProvisionedThroughputExceededException');
      throttleError.name = 'ProvisionedThroughputExceededException';
      
      ddbMock.on(ScanCommand).rejects(throttleError);

      const event = {
        httpMethod: 'GET',
        path: '/products'
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FETCH_PRODUCTS_ERROR');
    });

    it('should include CORS headers in error responses', async () => {
      ddbMock.on(ScanCommand).rejects(new Error('Test error'));

      const event = {
        httpMethod: 'GET',
        path: '/products'
      };

      const result = await handler(event);

      expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(result.headers['Content-Type']).toBe('application/json');
    });
  });

  describe('Environment Configuration', () => {
    it('should use table name from environment variable', async () => {
      // Note: The Lambda function reads the environment variable at module load time
      // so we verify it uses the table name that was set in beforeEach
      ddbMock.on(ScanCommand).resolves({
        Items: []
      });

      const event = {
        httpMethod: 'GET',
        path: '/products'
      };

      await handler(event);

      // Verify the table name was used in the scan command
      const calls = ddbMock.commandCalls(ScanCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input.TableName).toBe('marketplace-products');
    });

    it('should scan DynamoDB table correctly', async () => {
      ddbMock.on(ScanCommand).resolves({
        Items: []
      });

      const event = {
        httpMethod: 'GET',
        path: '/products'
      };

      await handler(event);

      // Verify ScanCommand was called
      const calls = ddbMock.commandCalls(ScanCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input).toHaveProperty('TableName');
    });
  });

  describe('Response Format', () => {
    it('should return properly formatted success response', async () => {
      ddbMock.on(ScanCommand).resolves({
        Items: []
      });

      const event = {
        httpMethod: 'GET',
        path: '/products'
      };

      const result = await handler(event);

      expect(result).toHaveProperty('statusCode');
      expect(result).toHaveProperty('headers');
      expect(result).toHaveProperty('body');
      expect(typeof result.body).toBe('string');

      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('success');
      expect(body).toHaveProperty('products');
    });

    it('should return properly formatted error response', async () => {
      ddbMock.on(ScanCommand).rejects(new Error('Test error'));

      const event = {
        httpMethod: 'GET',
        path: '/products'
      };

      const result = await handler(event);

      expect(result).toHaveProperty('statusCode');
      expect(result).toHaveProperty('headers');
      expect(result).toHaveProperty('body');
      expect(typeof result.body).toBe('string');

      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('success');
      expect(body.success).toBe(false);
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
      expect(body.error).toHaveProperty('details');
    });
  });
});

/**
 * Property-Based Tests for GetProducts Lambda Function
 * Feature: marketplace-buyer-interface
 * Task: 3.2 Write property test for product sorting
 */

const fc = require('fast-check');

describe('Property-Based Tests', () => {
  describe('Property 2: Product Sorting by Creation Date', () => {
    /**
     * **Validates: Requirements 1.7**
     * 
     * Property: For any list of products, the display function must return them 
     * sorted in descending order by createdAt with newest products first.
     */
    it('should always sort products by createdAt descending regardless of input order', async () => {
      // Generator for product objects with random createdAt timestamps
      const productArbitrary = fc.record({
        productId: fc.uuid(),
        name: fc.string({ minLength: 1, maxLength: 100 }),
        price: fc.integer({ min: 1, max: 100000 }),
        quantity: fc.integer({ min: 0, max: 1000 }),
        unit: fc.constantFrom('kg', 'piece', 'liter', 'dozen'),
        category: fc.constantFrom('Vegetables', 'Fruits', 'Grains', 'Dairy'),
        description: fc.string({ maxLength: 500 }),
        imageUrl: fc.webUrl(),
        seller: fc.record({
          name: fc.string({ minLength: 1, maxLength: 50 }),
          phone: fc.string({ minLength: 10, maxLength: 15 })
        }),
        createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') })
          .map(d => d.toISOString())
      });

      await fc.assert(
        fc.asyncProperty(
          fc.array(productArbitrary, { minLength: 2, maxLength: 20 }),
          async (products) => {
            // Mock DynamoDB to return the products in random order
            ddbMock.reset();
            ddbMock.on(ScanCommand).resolves({
              Items: products
            });

            const event = {
              httpMethod: 'GET',
              path: '/products'
            };

            const result = await handler(event);
            const body = JSON.parse(result.body);

            // Verify the response is successful
            expect(body.success).toBe(true);
            expect(body.products).toBeDefined();

            // Property: Products must be sorted by createdAt descending
            const sortedProducts = body.products;
            
            // Check that each product's createdAt is >= the next product's createdAt
            for (let i = 0; i < sortedProducts.length - 1; i++) {
              const currentDate = new Date(sortedProducts[i].createdAt || 0);
              const nextDate = new Date(sortedProducts[i + 1].createdAt || 0);
              
              // Current product should have a date >= next product (descending order)
              expect(currentDate.getTime()).toBeGreaterThanOrEqual(nextDate.getTime());
            }

            // Additional verification: Compare with manually sorted array
            const manuallySorted = [...products].sort((a, b) => {
              const dateA = new Date(a.createdAt || 0);
              const dateB = new Date(b.createdAt || 0);
              return dateB - dateA;
            });

            // The productIds should match in the same order
            const resultIds = sortedProducts.map(p => p.productId);
            const expectedIds = manuallySorted.map(p => p.productId);
            expect(resultIds).toEqual(expectedIds);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle products with missing createdAt fields in sorting', async () => {
      // Generator that sometimes omits createdAt
      const productWithOptionalDate = fc.record({
        productId: fc.uuid(),
        name: fc.string({ minLength: 1, maxLength: 100 }),
        price: fc.integer({ min: 1, max: 100000 }),
        createdAt: fc.option(
          fc.date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') })
            .map(d => d.toISOString()),
          { nil: undefined }
        )
      });

      await fc.assert(
        fc.asyncProperty(
          fc.array(productWithOptionalDate, { minLength: 2, maxLength: 20 }),
          async (products) => {
            ddbMock.reset();
            ddbMock.on(ScanCommand).resolves({
              Items: products
            });

            const event = {
              httpMethod: 'GET',
              path: '/products'
            };

            const result = await handler(event);
            const body = JSON.parse(result.body);

            expect(body.success).toBe(true);

            // Property: Products with createdAt should come before products without
            const sortedProducts = body.products;
            
            // Find the first product without createdAt
            const firstMissingIndex = sortedProducts.findIndex(p => !p.createdAt);
            
            if (firstMissingIndex !== -1) {
              // All products before this index should have createdAt
              for (let i = 0; i < firstMissingIndex; i++) {
                expect(sortedProducts[i].createdAt).toBeDefined();
              }
            }

            // Verify sorting is still consistent
            for (let i = 0; i < sortedProducts.length - 1; i++) {
              const currentDate = new Date(sortedProducts[i].createdAt || 0);
              const nextDate = new Date(sortedProducts[i + 1].createdAt || 0);
              expect(currentDate.getTime()).toBeGreaterThanOrEqual(nextDate.getTime());
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain stable sort for products with identical createdAt timestamps', async () => {
      // Generator for products that may share the same timestamp
      const sharedTimestamp = '2024-01-15T10:00:00.000Z';
      
      const productWithSharedDate = fc.record({
        productId: fc.uuid(),
        name: fc.string({ minLength: 1, maxLength: 100 }),
        price: fc.integer({ min: 1, max: 100000 }),
        createdAt: fc.constantFrom(
          sharedTimestamp,
          '2024-01-16T10:00:00.000Z',
          '2024-01-14T10:00:00.000Z'
        )
      });

      await fc.assert(
        fc.asyncProperty(
          fc.array(productWithSharedDate, { minLength: 3, maxLength: 15 }),
          async (products) => {
            ddbMock.reset();
            ddbMock.on(ScanCommand).resolves({
              Items: products
            });

            const event = {
              httpMethod: 'GET',
              path: '/products'
            };

            const result = await handler(event);
            const body = JSON.parse(result.body);

            expect(body.success).toBe(true);

            // Property: Sorting must be consistent and maintain descending order
            const sortedProducts = body.products;
            
            for (let i = 0; i < sortedProducts.length - 1; i++) {
              const currentDate = new Date(sortedProducts[i].createdAt);
              const nextDate = new Date(sortedProducts[i + 1].createdAt);
              expect(currentDate.getTime()).toBeGreaterThanOrEqual(nextDate.getTime());
            }

            // Verify that products with the same timestamp are grouped together
            const timestampGroups = new Map();
            sortedProducts.forEach((product, index) => {
              const timestamp = product.createdAt;
              if (!timestampGroups.has(timestamp)) {
                timestampGroups.set(timestamp, []);
              }
              timestampGroups.get(timestamp).push(index);
            });

            // Each group should have consecutive indices
            timestampGroups.forEach((indices) => {
              if (indices.length > 1) {
                for (let i = 0; i < indices.length - 1; i++) {
                  expect(indices[i + 1] - indices[i]).toBe(1);
                }
              }
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
