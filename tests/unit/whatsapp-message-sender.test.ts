/**
 * Unit tests for WhatsApp Message Sender Lambda
 * 
 * Tests text messages, interactive messages, images, language formatting,
 * and retry logic with exponential backoff.
 * 
 * Requirements: 1.4, 1.6, 5.3, 9.2, 12.6
 */

import {
  sendTextMessage,
  sendInteractiveMessage,
  sendImageMessage,
  formatMessage,
  getMessageTemplates,
  handler,
} from '../../src/lambdas/whatsapp-message-sender';

// Mock fetch globally
global.fetch = jest.fn();

describe('WhatsApp Message Sender', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Set required environment variables
    process.env.WHATSAPP_API_ENDPOINT = 'https://api.whatsapp.test';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
  });

  afterEach(() => {
    // Restore environment variables after each test
    process.env = { ...originalEnv };
    process.env.WHATSAPP_API_ENDPOINT = 'https://api.whatsapp.test';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
  });

  describe('sendTextMessage', () => {
    it('should send a text message successfully', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-123' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await sendTextMessage('+919876543210', 'Hello, this is a test message', 'en');

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-123');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.whatsapp.test/messages',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'Invalid phone number' } }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await sendTextMessage('+91invalid', 'Test message', 'en');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid phone number');
    });

    it('should support Hindi language', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-456' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await sendTextMessage('+919876543210', 'नमस्ते', 'hi');

      expect(result.success).toBe(true);
      const callPayload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callPayload.text.body).toBe('नमस्ते');
    });

    it('should support Marathi language', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-789' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await sendTextMessage('+919876543210', 'नमस्कार', 'mr');

      expect(result.success).toBe(true);
      const callPayload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callPayload.text.body).toBe('नमस्कार');
    });
  });

  describe('sendInteractiveMessage', () => {
    it('should send an interactive message with buttons', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-interactive-123' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const buttons = [
        { id: 'ACCEPT_ORDER', title: '✅ Accept' },
        { id: 'REJECT_ORDER', title: '❌ Reject' },
      ];

      const result = await sendInteractiveMessage(
        '+919876543210',
        'New order received!',
        buttons,
        'en'
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-interactive-123');

      const callPayload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callPayload.type).toBe('interactive');
      expect(callPayload.interactive.type).toBe('button');
      expect(callPayload.interactive.body.text).toBe('New order received!');
      expect(callPayload.interactive.action.buttons).toHaveLength(2);
      expect(callPayload.interactive.action.buttons[0].reply.id).toBe('ACCEPT_ORDER');
    });

    it('should truncate button titles to 20 characters', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-truncate' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const buttons = [
        { id: 'LONG_BUTTON', title: 'This is a very long button title that exceeds limit' },
      ];

      await sendInteractiveMessage('+919876543210', 'Test', buttons, 'en');

      const callPayload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callPayload.interactive.action.buttons[0].reply.title.length).toBeLessThanOrEqual(20);
    });

    it('should support Hindi buttons', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-hindi-btn' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const buttons = [
        { id: 'ACCEPT', title: '✅ स्वीकार करें' },
        { id: 'REJECT', title: '❌ अस्वीकार करें' },
      ];

      const result = await sendInteractiveMessage(
        '+919876543210',
        '🛒 नया ऑर्डर!',
        buttons,
        'hi'
      );

      expect(result.success).toBe(true);
      const callPayload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callPayload.interactive.body.text).toBe('🛒 नया ऑर्डर!');
    });
  });

  describe('sendImageMessage', () => {
    it('should send an image with caption', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-image-123' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await sendImageMessage(
        '+919876543210',
        'https://example.com/product.jpg',
        'Product image',
        'en'
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-image-123');

      const callPayload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callPayload.type).toBe('image');
      expect(callPayload.image.link).toBe('https://example.com/product.jpg');
      expect(callPayload.image.caption).toBe('Product image');
    });

    it('should send an image without caption', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-image-no-caption' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await sendImageMessage(
        '+919876543210',
        'https://example.com/product.jpg',
        undefined,
        'en'
      );

      expect(result.success).toBe(true);
      const callPayload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callPayload.image.caption).toBeUndefined();
    });
  });

  describe('Retry logic with exponential backoff', () => {
    it('should retry on network errors with exponential backoff', async () => {
      // First 2 attempts fail, 3rd succeeds
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce({ code: 'ECONNRESET' })
        .mockRejectedValueOnce({ code: 'ETIMEDOUT' })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [{ id: 'msg-retry-success' }] }),
        });

      // Mock setTimeout to execute immediately for testing
      jest.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
        callback();
        return {} as NodeJS.Timeout;
      });

      const result = await sendTextMessage('+919876543210', 'Test retry', 'en');

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-retry-success');
      expect(global.fetch).toHaveBeenCalledTimes(3);

      jest.restoreAllMocks();
    });

    it('should retry on 5xx server errors', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: async () => ({ error: { message: 'Service unavailable' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [{ id: 'msg-after-503' }] }),
        });

      jest.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
        callback();
        return {} as NodeJS.Timeout;
      });

      const result = await sendTextMessage('+919876543210', 'Test 503', 'en');

      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(2);

      jest.restoreAllMocks();
    });

    it('should retry on rate limiting (429)', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: async () => ({ error: { message: 'Rate limited' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [{ id: 'msg-after-429' }] }),
        });

      jest.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
        callback();
        return {} as NodeJS.Timeout;
      });

      const result = await sendTextMessage('+919876543210', 'Test rate limit', 'en');

      expect(result.success).toBe(true);

      jest.restoreAllMocks();
    });

    it('should give up after max retry attempts', async () => {
      (global.fetch as jest.Mock).mockRejectedValue({ code: 'ECONNRESET' });

      jest.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
        callback();
        return {} as NodeJS.Timeout;
      });

      const result = await sendTextMessage('+919876543210', 'Test max retries', 'en');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Max retry attempts exceeded');
      expect(global.fetch).toHaveBeenCalledTimes(5);

      jest.restoreAllMocks();
    });

    it('should not retry on 4xx client errors (except 429)', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'Bad request' } }),
      });

      const result = await sendTextMessage('+919876543210', 'Test 400', 'en');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Bad request');
      expect(global.fetch).toHaveBeenCalledTimes(1); // No retries
    });
  });

  describe('Language-specific message formatting', () => {
    it('should format messages in Hindi', () => {
      const templates = getMessageTemplates('hi');
      expect(templates.orderReceived).toBe('🛒 नया ऑर्डर!');
      expect(templates.customer).toBe('ग्राहक');
      expect(templates.accept).toBe('✅ स्वीकार करें');
    });

    it('should format messages in Marathi', () => {
      const templates = getMessageTemplates('mr');
      expect(templates.orderReceived).toBe('🛒 नवीन ऑर्डर!');
      expect(templates.customer).toBe('ग्राहक');
      expect(templates.accept).toBe('✅ स्वीकार करा');
    });

    it('should format messages in English', () => {
      const templates = getMessageTemplates('en');
      expect(templates.orderReceived).toBe('🛒 New Order!');
      expect(templates.customer).toBe('Customer');
      expect(templates.accept).toBe('✅ Accept');
    });

    it('should replace template parameters', () => {
      const template = 'Hello {name}, your order {orderId} is confirmed';
      const params = { name: 'Sunita', orderId: 'ORD-123' };
      const result = formatMessage(template, params, 'en');
      expect(result).toBe('Hello Sunita, your order ORD-123 is confirmed');
    });
  });

  describe('Lambda handler', () => {
    it('should handle text message requests', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-handler-text' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const event = {
        to: '+919876543210',
        type: 'text',
        content: { text: 'Handler test message' },
        language: 'en',
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.messageId).toBe('msg-handler-text');
    });

    it('should handle interactive message requests', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-handler-interactive' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const event = {
        to: '+919876543210',
        type: 'interactive',
        content: {
          text: 'Choose an option',
          buttons: [
            { id: 'YES', title: 'Yes' },
            { id: 'NO', title: 'No' },
          ],
        },
        language: 'en',
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
    });

    it('should handle image message requests', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-handler-image' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const event = {
        to: '+919876543210',
        type: 'image',
        content: {
          imageUrl: 'https://example.com/image.jpg',
          text: 'Product photo',
        },
        language: 'en',
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
    });

    it('should return error for missing recipient', async () => {
      const event = {
        type: 'text',
        content: { text: 'Test' },
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('Recipient phone number');
    });

    it('should return error for unsupported message type', async () => {
      const event = {
        to: '+919876543210',
        type: 'unsupported',
        content: {},
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('Unsupported message type');
    });

    it('should default to English language if not specified', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-default-lang' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const event = {
        to: '+919876543210',
        type: 'text',
        content: { text: 'Test default language' },
        // language not specified
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
    });
  });

  describe('Error handling', () => {
    it('should handle missing API configuration', async () => {
      delete process.env.WHATSAPP_API_ENDPOINT;

      const result = await sendTextMessage('+919876543210', 'Test', 'en');

      expect(result.success).toBe(false);
      expect(result.error).toContain('configuration missing');
    });

    it('should handle network errors gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const result = await sendTextMessage('+919876543210', 'Test', 'en');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Interactive message edge cases', () => {
    it('should handle button title with exactly 20 characters', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-exact-20' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const buttons = [
        { id: 'BTN1', title: '12345678901234567890' }, // Exactly 20 chars
      ];

      await sendInteractiveMessage('+919876543210', 'Test', buttons, 'en');

      const callPayload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callPayload.interactive.action.buttons[0].reply.title).toBe('12345678901234567890');
      expect(callPayload.interactive.action.buttons[0].reply.title.length).toBe(20);
    });

    it('should handle button title with unicode characters', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-unicode' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const buttons = [
        { id: 'EMOJI', title: '✅ स्वीकार करें 🎉' },
      ];

      await sendInteractiveMessage('+919876543210', 'Test', buttons, 'hi');

      const callPayload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callPayload.interactive.action.buttons[0].reply.title.length).toBeLessThanOrEqual(20);
    });

    it('should handle multiple buttons (up to 3)', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-multi-btn' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const buttons = [
        { id: 'BTN1', title: 'Option 1' },
        { id: 'BTN2', title: 'Option 2' },
        { id: 'BTN3', title: 'Option 3' },
      ];

      await sendInteractiveMessage('+919876543210', 'Choose', buttons, 'en');

      const callPayload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callPayload.interactive.action.buttons).toHaveLength(3);
    });

    it('should handle empty button array', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-no-btn' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const buttons: Array<{ id: string; title: string }> = [];

      await sendInteractiveMessage('+919876543210', 'No buttons', buttons, 'en');

      const callPayload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callPayload.interactive.action.buttons).toHaveLength(0);
    });

    it('should handle very long message body text', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-long-text' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const longText = 'A'.repeat(1000); // Very long text
      const buttons = [{ id: 'OK', title: 'OK' }];

      await sendInteractiveMessage('+919876543210', longText, buttons, 'en');

      const callPayload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callPayload.interactive.body.text).toBe(longText);
    });
  });

  describe('Message payload construction', () => {
    it('should construct correct payload for text message', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-payload-text' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await sendTextMessage('+919876543210', 'Test message', 'en');

      const callPayload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callPayload.messaging_product).toBe('whatsapp');
      expect(callPayload.recipient_type).toBe('individual');
      expect(callPayload.to).toBe('+919876543210');
      expect(callPayload.type).toBe('text');
      expect(callPayload.text.body).toBe('Test message');
    });

    it('should construct correct payload for interactive message', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-payload-interactive' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const buttons = [{ id: 'YES', title: 'Yes' }];
      await sendInteractiveMessage('+919876543210', 'Question?', buttons, 'en');

      const callPayload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callPayload.type).toBe('interactive');
      expect(callPayload.interactive.type).toBe('button');
      expect(callPayload.interactive.body.text).toBe('Question?');
      expect(callPayload.interactive.action.buttons[0].type).toBe('reply');
      expect(callPayload.interactive.action.buttons[0].reply.id).toBe('YES');
    });

    it('should construct correct payload for image message with caption', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-payload-image' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await sendImageMessage('+919876543210', 'https://example.com/img.jpg', 'Caption', 'en');

      const callPayload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callPayload.type).toBe('image');
      expect(callPayload.image.link).toBe('https://example.com/img.jpg');
      expect(callPayload.image.caption).toBe('Caption');
    });

    it('should handle image message without caption', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-no-caption' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await sendImageMessage('+919876543210', 'https://example.com/img.jpg', undefined, 'en');

      const callPayload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callPayload.image.caption).toBeUndefined();
    });
  });

  describe('Template parameter replacement', () => {
    it('should replace single parameter', () => {
      const result = formatMessage('Hello {name}', { name: 'Sunita' }, 'en');
      expect(result).toBe('Hello Sunita');
    });

    it('should replace multiple parameters', () => {
      const result = formatMessage(
        '{greeting} {name}, order {orderId}',
        { greeting: 'Hello', name: 'Sunita', orderId: 'ORD-123' },
        'en'
      );
      expect(result).toBe('Hello Sunita, order ORD-123');
    });

    it('should handle missing parameters gracefully', () => {
      const result = formatMessage('Hello {name}, {missing}', { name: 'Sunita' }, 'en');
      expect(result).toBe('Hello Sunita, {missing}');
    });

    it('should handle empty parameters object', () => {
      const result = formatMessage('Static message', {}, 'en');
      expect(result).toBe('Static message');
    });

    it('should handle unicode in parameters', () => {
      const result = formatMessage('नमस्ते {name}', { name: 'सुनीता' }, 'hi');
      expect(result).toBe('नमस्ते सुनीता');
    });
  });

  describe('Content validation', () => {
    it('should handle empty text message', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-empty' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await sendTextMessage('+919876543210', '', 'en');

      expect(result.success).toBe(true);
    });

    it('should handle special characters in text', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-special' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const specialText = 'Test <>&"\'\\n\\t';
      const result = await sendTextMessage('+919876543210', specialText, 'en');

      expect(result.success).toBe(true);
      const callPayload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callPayload.text.body).toBe(specialText);
    });

    it('should handle phone number in E.164 format', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messages: [{ id: 'msg-e164' }] }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await sendTextMessage('+919876543210', 'Test', 'en');

      const callPayload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(callPayload.to).toBe('+919876543210');
    });
  });

  describe('API response handling', () => {
    it('should handle response with messageId in different location', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ messageId: 'direct-msg-id' }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await sendTextMessage('+919876543210', 'Test', 'en');

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('direct-msg-id');
    });

    it('should handle response without messageId', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({}),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await sendTextMessage('+919876543210', 'Test', 'en');

      expect(result.success).toBe(true);
      expect(result.messageId).toBeUndefined();
    });

    it('should handle malformed JSON response', async () => {
      const mockResponse = {
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await sendTextMessage('+919876543210', 'Test', 'en');

      expect(result.success).toBe(false);
    });
  });
});
