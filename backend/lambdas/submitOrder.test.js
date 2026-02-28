/**
 * Unit Tests for SubmitOrder Lambda Function
 * Feature: marketplace-buyer-interface
 * Task: 3.4 Write unit tests for SubmitOrderFunction
 * Requirements: 6.3, 6.5, 6.7
 */

// Set environment variables BEFORE requiring the module
process.env.WHATSAPP_API_ENDPOINT = 'https://graph.facebook.com/v22.0';
process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id';

const axios = require('axios');
const { Order } = require('../lib/models');
const { handler } = require('./submitOrder');

// Mock axios
jest.mock('axios');

// Mock the Order model
jest.mock('../lib/models', () => {
  const actualModels = jest.requireActual('../lib/models');
  return {
    ...actualModels,
    Order: jest.fn().mockImplementation((data) => {
      const order = new actualModels.Order(data);
      return order;
    })
  };
});

describe('SubmitOrder Lambda Function', () => {
  // Set timeout for all tests in this suite (20 seconds to account for retry logic)
  jest.setTimeout(20000);
  
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
  });

  describe('Successful Order Submission', () => {
    it('should successfully submit order and send WhatsApp message', async () => {
      const orderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '9876543210',
          address: {
            name: 'Priya Sharma',
            phone: '9876543210',
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001'
          }
        },
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '9876543210'
            }
          }
        ],
        totalAmount: 250
      };

      // Mock successful WhatsApp API response
      axios.post.mockResolvedValue({
        data: {
          messaging_product: 'whatsapp',
          contacts: [{ input: '9876543210', wa_id: '9876543210' }],
          messages: [{ id: 'wamid.test123' }]
        }
      });

      const event = {
        body: JSON.stringify(orderData)
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toBe('application/json');
      expect(result.headers['Access-Control-Allow-Origin']).toBe('*');

      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.orderId).toBeDefined();
      expect(body.orderId).toMatch(/^ORD-\d+$/);
      expect(body.message).toBe('Order submitted successfully. Sellers will contact you soon.');
      expect(body.results).toHaveLength(1);
      expect(body.results[0].success).toBe(true);
      expect(body.results[0].seller).toBe('Ramesh Kumar');

      // Verify WhatsApp API was called
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(axios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v22.0/test-phone-id/messages',
        expect.objectContaining({
          messaging_product: 'whatsapp',
          to: '9876543210',
          type: 'text',
          text: expect.objectContaining({
            body: expect.stringContaining('🛒 NEW ORDER')
          })
        }),
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer test-access-token',
            'Content-Type': 'application/json'
          }
        })
      );
    });

    it('should handle multiple items for the same seller', async () => {
      const orderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '9876543210',
          address: {
            name: 'Priya Sharma',
            phone: '9876543210',
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001'
          }
        },
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '9876543210'
            }
          },
          {
            productId: 'prod-456',
            name: 'Organic Potatoes',
            quantity: 10,
            price: 30,
            seller: {
              name: 'Ramesh Kumar',
              phone: '9876543210'
            }
          }
        ],
        totalAmount: 550
      };

      axios.post.mockResolvedValue({
        data: { messages: [{ id: 'wamid.test123' }] }
      });

      const event = {
        body: JSON.stringify(orderData)
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);

      // Should only send one message to the seller (items grouped)
      expect(axios.post).toHaveBeenCalledTimes(1);
      
      // Verify the message contains both items
      const whatsappCall = axios.post.mock.calls[0];
      const messageBody = whatsappCall[1].text.body;
      expect(messageBody).toContain('Fresh Tomatoes');
      expect(messageBody).toContain('Organic Potatoes');
      expect(messageBody).toContain('₹550');
    });

    it('should handle orders with multiple sellers', async () => {
      const orderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '9876543210',
          address: {
            name: 'Priya Sharma',
            phone: '9876543210',
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001'
          }
        },
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '9876543210'
            }
          },
          {
            productId: 'prod-456',
            name: 'Fresh Milk',
            quantity: 2,
            price: 60,
            seller: {
              name: 'Priya Patel',
              phone: '9876543211'
            }
          }
        ],
        totalAmount: 370
      };

      axios.post.mockResolvedValue({
        data: { messages: [{ id: 'wamid.test123' }] }
      });

      const event = {
        body: JSON.stringify(orderData)
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.results).toHaveLength(2);

      // Should send two messages (one to each seller)
      expect(axios.post).toHaveBeenCalledTimes(2);
      
      // Verify each seller received their items
      const calls = axios.post.mock.calls;
      const phones = calls.map(call => call[1].to);
      expect(phones).toContain('9876543210');
      expect(phones).toContain('9876543211');
    });

    it('should include CORS headers in success response', async () => {
      const orderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '9876543210',
          address: {
            name: 'Priya Sharma',
            phone: '9876543210',
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001'
          }
        },
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '9876543210'
            }
          }
        ],
        totalAmount: 250
      };

      axios.post.mockResolvedValue({
        data: { messages: [{ id: 'wamid.test123' }] }
      });

      const event = {
        body: JSON.stringify(orderData)
      };

      const result = await handler(event);

      expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(result.headers['Access-Control-Allow-Headers']).toBe('Content-Type');
      expect(result.headers['Access-Control-Allow-Methods']).toBe('POST, OPTIONS');
    });
  });

  describe('WhatsApp API Failure Handling', () => {
    it('should handle WhatsApp API network errors', async () => {
      const orderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '9876543210',
          address: {
            name: 'Priya Sharma',
            phone: '9876543210',
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001'
          }
        },
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '9876543210'
            }
          }
        ],
        totalAmount: 250
      };

      // Mock WhatsApp API failure
      axios.post.mockRejectedValue(new Error('Network error'));

      const event = {
        body: JSON.stringify(orderData)
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(207); // Partial success
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
      expect(body.message).toBe('Order partially submitted. Some sellers could not be notified.');
      expect(body.results).toHaveLength(1);
      expect(body.results[0].success).toBe(false);
      expect(body.results[0].error).toBe('Network error');
    });

    it('should handle WhatsApp API authentication errors', async () => {
      const orderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '9876543210',
          address: {
            name: 'Priya Sharma',
            phone: '9876543210',
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001'
          }
        },
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '9876543210'
            }
          }
        ],
        totalAmount: 250
      };

      const authError = new Error('Authentication failed');
      authError.response = {
        data: {
          error: {
            message: 'Invalid access token',
            code: 190
          }
        }
      };
      axios.post.mockRejectedValue(authError);

      const event = {
        body: JSON.stringify(orderData)
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(207);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
      expect(body.results[0].success).toBe(false);
    });

    it('should handle partial failures with multiple sellers', async () => {
      const orderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '9876543210',
          address: {
            name: 'Priya Sharma',
            phone: '9876543210',
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001'
          }
        },
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '9876543210'
            }
          },
          {
            productId: 'prod-456',
            name: 'Fresh Milk',
            quantity: 2,
            price: 60,
            seller: {
              name: 'Priya Patel',
              phone: '9876543211'
            }
          }
        ],
        totalAmount: 370
      };

      // First seller succeeds, second fails
      axios.post
        .mockResolvedValueOnce({ data: { messages: [{ id: 'wamid.test123' }] } })
        .mockRejectedValueOnce(new Error('Network timeout'));

      const event = {
        body: JSON.stringify(orderData)
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(207);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
      expect(body.results).toHaveLength(2);
      expect(body.results[0].success).toBe(true);
      expect(body.results[1].success).toBe(false);
    });
  });

  describe('Retry Logic', () => {
    it('should retry WhatsApp API call on failure', async () => {
      const orderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '9876543210',
          address: {
            name: 'Priya Sharma',
            phone: '9876543210',
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001'
          }
        },
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '9876543210'
            }
          }
        ],
        totalAmount: 250
      };

      // Fail twice, succeed on third attempt
      axios.post
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce({ data: { messages: [{ id: 'wamid.test123' }] } });

      const event = {
        body: JSON.stringify(orderData)
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);

      // Should have been called 3 times (2 failures + 1 success)
      expect(axios.post).toHaveBeenCalledTimes(3);
    });

    it('should fail after maximum retry attempts', async () => {
      const orderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '9876543210',
          address: {
            name: 'Priya Sharma',
            phone: '9876543210',
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001'
          }
        },
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '9876543210'
            }
          }
        ],
        totalAmount: 250
      };

      // Fail all 3 attempts
      axios.post.mockRejectedValue(new Error('Persistent failure'));

      const event = {
        body: JSON.stringify(orderData)
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(207);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);

      // Should have been called exactly 3 times (max retries)
      expect(axios.post).toHaveBeenCalledTimes(3);
    });

    it('should use exponential backoff between retries', async () => {
      const orderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '9876543210',
          address: {
            name: 'Priya Sharma',
            phone: '9876543210',
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001'
          }
        },
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '9876543210'
            }
          }
        ],
        totalAmount: 250
      };

      const startTime = Date.now();
      
      // Fail twice, succeed on third
      axios.post
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce({ data: { messages: [{ id: 'wamid.test123' }] } });

      const event = {
        body: JSON.stringify(orderData)
      };

      await handler(event);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // With exponential backoff: 2^1 * 1000 + 2^2 * 1000 = 2000 + 4000 = 6000ms minimum
      // We verify it took at least 2 seconds (allowing for some timing variance)
      expect(duration).toBeGreaterThanOrEqual(2000);
      
      // Verify it retried 3 times
      expect(axios.post).toHaveBeenCalledTimes(3);
    });
  });

  describe('Order Validation', () => {
    it('should reject order with invalid data', async () => {
      const invalidOrderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '123', // Invalid phone
          address: {
            name: 'Priya Sharma',
            phone: '123',
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001'
          }
        },
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '9876543210'
            }
          }
        ],
        totalAmount: 250
      };

      const event = {
        body: JSON.stringify(invalidOrderData)
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_ORDER_DATA');
      expect(body.error.message).toBe('Order validation failed');
      expect(body.error.details).toBeDefined();

      // Should not call WhatsApp API
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should reject order with missing buyer information', async () => {
      const invalidOrderData = {
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '9876543210'
            }
          }
        ],
        totalAmount: 250
      };

      const event = {
        body: JSON.stringify(invalidOrderData)
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_ORDER_DATA');
    });

    it('should reject order with empty items array', async () => {
      const invalidOrderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '9876543210',
          address: {
            name: 'Priya Sharma',
            phone: '9876543210',
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001'
          }
        },
        items: [],
        totalAmount: 0
      };

      const event = {
        body: JSON.stringify(invalidOrderData)
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
    });

    it('should reject order with invalid postal code', async () => {
      const invalidOrderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '9876543210',
          address: {
            name: 'Priya Sharma',
            phone: '9876543210',
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '12345' // Only 5 digits
          }
        },
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '9876543210'
            }
          }
        ],
        totalAmount: 250
      };

      const event = {
        body: JSON.stringify(invalidOrderData)
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON in request body', async () => {
      const event = {
        body: 'invalid json {'
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('ORDER_SUBMISSION_ERROR');
      expect(body.error.message).toBe('Failed to submit order');
    });

    it('should include CORS headers in error responses', async () => {
      const event = {
        body: 'invalid json'
      };

      const result = await handler(event);

      expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(result.headers['Content-Type']).toBe('application/json');
    });

    it('should handle unexpected errors gracefully', async () => {
      const orderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '9876543210',
          address: {
            name: 'Priya Sharma',
            phone: '9876543210',
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001'
          }
        },
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '9876543210'
            }
          }
        ],
        totalAmount: 250
      };

      // Mock an unexpected error
      axios.post.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const event = {
        body: JSON.stringify(orderData)
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(207);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
    });
  });

  describe('Response Format', () => {
    it('should return properly formatted success response', async () => {
      const orderData = {
        buyer: {
          name: 'Priya Sharma',
          phone: '9876543210',
          address: {
            name: 'Priya Sharma',
            phone: '9876543210',
            street: '123 MG Road',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001'
          }
        },
        items: [
          {
            productId: 'prod-123',
            name: 'Fresh Tomatoes',
            quantity: 5,
            price: 50,
            seller: {
              name: 'Ramesh Kumar',
              phone: '9876543210'
            }
          }
        ],
        totalAmount: 250
      };

      axios.post.mockResolvedValue({
        data: { messages: [{ id: 'wamid.test123' }] }
      });

      const event = {
        body: JSON.stringify(orderData)
      };

      const result = await handler(event);

      expect(result).toHaveProperty('statusCode');
      expect(result).toHaveProperty('headers');
      expect(result).toHaveProperty('body');
      expect(typeof result.body).toBe('string');

      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('success');
      expect(body).toHaveProperty('orderId');
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('results');
      expect(Array.isArray(body.results)).toBe(true);
    });

    it('should return properly formatted error response', async () => {
      const event = {
        body: 'invalid json'
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
