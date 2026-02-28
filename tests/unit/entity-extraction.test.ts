/**
 * Unit tests for Entity Extraction Lambda
 * 
 * Tests entity extraction for different intents:
 * - CREATE_CATALOG: product entities
 * - UPDATE_INVENTORY: inventory update entities
 * - Order intents: order action entities
 * 
 * Validates: Requirements 2.3, 4.4, 6.2
 */

import { handler } from '../../src/lambdas/entity-extraction';
import { EntityExtractionRequest } from '../../src/models/intent';
import { bedrockClient } from '../../src/config/aws-clients';

// Mock AWS SDK
jest.mock('../../src/config/aws-clients', () => ({
  bedrockClient: {
    send: jest.fn(),
  },
}));

describe('Entity Extraction Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('CREATE_CATALOG intent', () => {
    it('should extract product entities from Hindi voice note', async () => {
      // Mock Nova response (Converse API format)
      const mockNovaResponse = {
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  product_name: 'आम का अचार',
                  price: 200,
                  quantity: 5,
                  unit: 'kg',
                  description: 'घर का बना हुआ',
                  category: 'food',
                }),
              },
            ],
          },
        },
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockNovaResponse)),
      });

      const request: EntityExtractionRequest = {
        transcribedText: 'मैं 5 किलो आम का अचार 200 रुपये में बेचना चाहता हूं',
        intent: 'CREATE_CATALOG',
        language: 'hi',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.entities).toBeDefined();
      expect(response.entities?.product_name).toBe('आम का अचार');
      expect(response.entities?.price).toBe(200);
      expect(response.entities?.quantity).toBe(5);
      expect(response.entities?.unit).toBe('kg');
      expect(response.entities?.category).toBe('food');
      expect(response.needsClarification).toBe(false);
      expect(response.missingFields).toHaveLength(0);
    });

    it('should extract product entities from English voice note', async () => {
      const mockNovaResponse = {
        output: {
          message: {
        content: [
          {
            text: JSON.stringify({
              product_name: 'Mango Pickle',
              price: 200,
              quantity: 5,
              unit: 'kg',
              description: 'Homemade traditional pickle',
              category: 'food',
            }),
          },
        ],
          },
        },
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockNovaResponse)),
      });

      const request: EntityExtractionRequest = {
        transcribedText: 'I want to sell 5 kg of mango pickle for 200 rupees',
        intent: 'CREATE_CATALOG',
        language: 'en',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.entities?.product_name).toBe('Mango Pickle');
      expect(response.entities?.price).toBe(200);
      expect(response.entities?.quantity).toBe(5);
      expect(response.entities?.unit).toBe('kg');
    });

    it('should handle code-mixed input', async () => {
      const mockNovaResponse = {
        output: {
          message: {
        content: [
          {
            text: JSON.stringify({
              product_name: 'Mango pickle',
              price: 200,
              quantity: 5,
              unit: 'kg',
              description: null,
              category: 'food',
            }),
          },
        ],
          },
        },
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockNovaResponse)),
      });

      const request: EntityExtractionRequest = {
        transcribedText: 'Mango pickle 200 rupees 5 kg',
        intent: 'CREATE_CATALOG',
        language: 'en',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.entities?.product_name).toBe('Mango pickle');
      expect(response.entities?.price).toBe(200);
    });

    it('should identify missing required fields', async () => {
      const mockNovaResponse = {
        output: {
          message: {
        content: [
          {
            text: JSON.stringify({
              product_name: 'Mango Pickle',
              price: null,
              quantity: 5,
              unit: 'kg',
              description: null,
              category: 'food',
            }),
          },
        ],
          },
        },
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockNovaResponse)),
      });

      const request: EntityExtractionRequest = {
        transcribedText: 'I want to sell mango pickle',
        intent: 'CREATE_CATALOG',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.needsClarification).toBe(true);
      expect(response.missingFields).toContain('price');
    });

    it('should handle multiple missing fields', async () => {
      const mockNovaResponse = {
        output: {
          message: {
        content: [
          {
            text: JSON.stringify({
              product_name: null,
              price: null,
              quantity: null,
              unit: null,
              description: null,
              category: null,
            }),
          },
        ],
          },
        },
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockNovaResponse)),
      });

      const request: EntityExtractionRequest = {
        transcribedText: 'I want to add a product',
        intent: 'CREATE_CATALOG',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.needsClarification).toBe(true);
      expect(response.missingFields?.length).toBeGreaterThan(0);
      expect(response.missingFields).toContain('product_name');
      expect(response.missingFields).toContain('price');
      expect(response.missingFields).toContain('quantity');
    });
  });

  describe('UPDATE_INVENTORY intent', () => {
    it('should extract inventory update entities', async () => {
      const mockNovaResponse = {
        output: {
          message: {
        content: [
          {
            text: JSON.stringify({
              product_identifier: 'Mango Pickle',
              new_quantity: 50,
              operation: 'SET',
            }),
          },
        ],
          },
        },
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockNovaResponse)),
      });

      const request: EntityExtractionRequest = {
        transcribedText: 'Update mango pickle stock to 50 packets',
        intent: 'UPDATE_INVENTORY',
        language: 'en',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.entities?.product_identifier).toBe('Mango Pickle');
      expect(response.entities?.new_quantity).toBe(50);
      expect(response.entities?.operation).toBe('SET');
      expect(response.needsClarification).toBe(false);
    });

    it('should handle INCREMENT operation', async () => {
      const mockNovaResponse = {
        output: {
          message: {
        content: [
          {
            text: JSON.stringify({
              product_identifier: 'आम का अचार',
              new_quantity: 10,
              operation: 'INCREMENT',
            }),
          },
        ],
          },
        },
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockNovaResponse)),
      });

      const request: EntityExtractionRequest = {
        transcribedText: 'आम का अचार में 10 और जोड़ दो',
        intent: 'UPDATE_INVENTORY',
        language: 'hi',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.entities?.operation).toBe('INCREMENT');
      expect(response.entities?.new_quantity).toBe(10);
    });

    it('should handle DECREMENT operation', async () => {
      const mockNovaResponse = {
        output: {
          message: {
        content: [
          {
            text: JSON.stringify({
              product_identifier: 'Mango Pickle',
              new_quantity: 5,
              operation: 'DECREMENT',
            }),
          },
        ],
          },
        },
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockNovaResponse)),
      });

      const request: EntityExtractionRequest = {
        transcribedText: 'Remove 5 from mango pickle stock',
        intent: 'UPDATE_INVENTORY',
        language: 'en',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.entities?.operation).toBe('DECREMENT');
    });

    it('should identify missing product identifier', async () => {
      const mockNovaResponse = {
        output: {
          message: {
        content: [
          {
            text: JSON.stringify({
              product_identifier: null,
              new_quantity: 50,
              operation: 'SET',
            }),
          },
        ],
          },
        },
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockNovaResponse)),
      });

      const request: EntityExtractionRequest = {
        transcribedText: 'Update stock to 50',
        intent: 'UPDATE_INVENTORY',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.needsClarification).toBe(true);
      expect(response.missingFields).toContain('product_identifier');
    });
  });

  describe('Order intents', () => {
    it('should extract order acceptance entities', async () => {
      const mockNovaResponse = {
        output: {
          message: {
        content: [
          {
            text: JSON.stringify({
              order_id: 'ORD-12345',
              action: 'accept',
              reason: null,
            }),
          },
        ],
          },
        },
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockNovaResponse)),
      });

      const request: EntityExtractionRequest = {
        transcribedText: 'Accept order ORD-12345',
        intent: 'ACCEPT_ORDER',
        language: 'en',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.entities?.order_id).toBe('ORD-12345');
      expect(response.entities?.action).toBe('accept');
    });

    it('should extract order rejection entities with reason', async () => {
      const mockNovaResponse = {
        output: {
          message: {
        content: [
          {
            text: JSON.stringify({
              order_id: 'ORD-12345',
              action: 'reject',
              reason: 'Out of stock',
            }),
          },
        ],
          },
        },
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockNovaResponse)),
      });

      const request: EntityExtractionRequest = {
        transcribedText: 'Reject order ORD-12345 because out of stock',
        intent: 'REJECT_ORDER',
        language: 'en',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.entities?.action).toBe('reject');
      expect(response.entities?.reason).toBe('Out of stock');
    });

    it('should extract fulfillment update entities', async () => {
      const mockNovaResponse = {
        output: {
          message: {
        content: [
          {
            text: JSON.stringify({
              order_id: 'ORD-12345',
              action: 'shipped',
              reason: null,
            }),
          },
        ],
          },
        },
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockNovaResponse)),
      });

      const request: EntityExtractionRequest = {
        transcribedText: 'Order ORD-12345 has been shipped',
        intent: 'UPDATE_FULFILLMENT',
        language: 'en',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.entities?.action).toBe('shipped');
    });
  });

  describe('Error handling', () => {
    it('should handle empty transcribed text', async () => {
      const request: EntityExtractionRequest = {
        transcribedText: '',
        intent: 'CREATE_CATALOG',
      };

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('Transcribed text is required');
    });

    it('should handle missing intent', async () => {
      const request: EntityExtractionRequest = {
        transcribedText: 'Some text',
        intent: '' as any,
      };

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should handle Bedrock API errors', async () => {
      (bedrockClient.send as jest.Mock).mockRejectedValue(
        new Error('Bedrock API error')
      );

      const request: EntityExtractionRequest = {
        transcribedText: 'Test text',
        intent: 'CREATE_CATALOG',
      };

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should handle invalid JSON response from Claude', async () => {
      const mockNovaResponse = {
        output: {
          message: {
        content: [
          {
            text: 'This is not valid JSON',
          },
        ],
          },
        },
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockNovaResponse)),
      });

      const request: EntityExtractionRequest = {
        transcribedText: 'Test text',
        intent: 'CREATE_CATALOG',
      };

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error?.message).toContain('Invalid JSON');
    });

    it('should handle Claude response with markdown code blocks', async () => {
      const mockNovaResponse = {
        output: {
          message: {
        content: [
          {
            text: '```json\n{"product_name": "Test", "price": 100, "quantity": 1, "unit": "pieces", "category": "other"}\n```',
          },
        ],
          },
        },
      };

      (bedrockClient.send as jest.Mock).mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockNovaResponse)),
      });

      const request: EntityExtractionRequest = {
        transcribedText: 'Test product',
        intent: 'CREATE_CATALOG',
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.entities?.product_name).toBe('Test');
    });
  });
});
