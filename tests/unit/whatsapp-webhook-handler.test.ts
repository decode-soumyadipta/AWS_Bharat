/**
 * Unit tests for WhatsApp Webhook Handler Lambda
 * 
 * Tests webhook signature validation, message parsing, and EventBridge publishing.
 */

import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../src/lambdas/whatsapp-webhook-handler';
import { eventBridgeClient } from '../../src/config/aws-clients';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import crypto from 'crypto';

// Mock AWS SDK clients
jest.mock('../../src/config/aws-clients', () => ({
  eventBridgeClient: {
    send: jest.fn(),
  },
  EVENT_BUS_NAME: 'test-event-bus',
}));

describe('WhatsApp Webhook Handler', () => {
  const mockWebhookSecret = 'test-webhook-secret';
  const mockVerifyToken = 'test-verify-token';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WEBHOOK_SECRET = mockWebhookSecret;
    process.env.WEBHOOK_VERIFY_TOKEN = mockVerifyToken;
    
    // Mock successful EventBridge response
    (eventBridgeClient.send as jest.Mock).mockResolvedValue({
      FailedEntryCount: 0,
      Entries: [{ EventId: 'test-event-id' }],
    });
  });

  afterEach(() => {
    delete process.env.WEBHOOK_SECRET;
    delete process.env.WEBHOOK_VERIFY_TOKEN;
  });

  describe('Webhook Verification (GET)', () => {
    it('should verify webhook with correct token and return challenge', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        queryStringParameters: {
          'hub.verify_token': mockVerifyToken,
          'hub.challenge': 'test-challenge-123',
        },
        headers: {},
        body: null,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('test-challenge-123');
    });

    it('should reject webhook verification with incorrect token', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        queryStringParameters: {
          'hub.verify_token': 'wrong-token',
          'hub.challenge': 'test-challenge-123',
        },
        headers: {},
        body: null,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body)).toEqual({ error: 'Verification failed' });
    });
  });

  describe('Message Processing (POST)', () => {
    function createSignature(payload: string, secret: string): string {
      return crypto.createHmac('sha256', secret).update(payload).digest('hex');
    }

    it('should process text message and publish to EventBridge', async () => {
      const messageBody = {
        message: {
          id: 'msg-123',
          from: '+919876543210',
          timestamp: 1705315200000,
          type: 'text',
          text: {
            body: 'Hello, I want to register',
          },
          profile: {
            name: 'Sunita',
          },
        },
      };

      const bodyString = JSON.stringify(messageBody);
      const signature = createSignature(bodyString, mockWebhookSecret);

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        headers: {
          'x-hub-signature-256': signature,
        },
        body: bodyString,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({
        success: true,
        messageId: 'msg-123',
      });

      expect(eventBridgeClient.send).toHaveBeenCalledWith(
        expect.any(PutEventsCommand)
      );

      const sentCommand = (eventBridgeClient.send as jest.Mock).mock.calls[0][0];
      const entries = sentCommand.input.Entries;
      
      expect(entries).toHaveLength(1);
      expect(entries[0].Source).toBe('vyapar.vaani.whatsapp');
      expect(entries[0].DetailType).toBe('message.received.text');
      
      const detail = JSON.parse(entries[0].Detail);
      expect(detail.messageId).toBe('msg-123');
      expect(detail.phone).toBe('+919876543210');
      expect(detail.content.text).toBe('Hello, I want to register');
    });

    it('should process audio message and publish with correct detail-type', async () => {
      const messageBody = {
        message: {
          id: 'msg-456',
          from: '+919876543210',
          timestamp: 1705315200000,
          type: 'audio',
          audio: {
            url: 'https://s3.amazonaws.com/audio/voice-note.ogg',
            mime_type: 'audio/ogg',
          },
          profile: {
            name: 'Sunita',
            language: 'hi',
          },
        },
      };

      const bodyString = JSON.stringify(messageBody);
      const signature = createSignature(bodyString, mockWebhookSecret);

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        headers: {
          'x-hub-signature-256': signature,
        },
        body: bodyString,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);

      const sentCommand = (eventBridgeClient.send as jest.Mock).mock.calls[0][0];
      const entries = sentCommand.input.Entries;
      
      expect(entries[0].DetailType).toBe('message.received.voice');
      
      const detail = JSON.parse(entries[0].Detail);
      expect(detail.messageType).toBe('audio');
      expect(detail.content.mediaUrl).toBe('https://s3.amazonaws.com/audio/voice-note.ogg');
      expect(detail.content.mimeType).toBe('audio/ogg');
      expect(detail.profile.language).toBe('hi');
    });

    it('should process image message and publish with correct detail-type', async () => {
      const messageBody = {
        message: {
          id: 'msg-789',
          from: '+919876543210',
          timestamp: 1705315200000,
          type: 'image',
          image: {
            url: 'https://s3.amazonaws.com/images/product.jpg',
            mime_type: 'image/jpeg',
          },
          profile: {
            name: 'Sunita',
          },
        },
      };

      const bodyString = JSON.stringify(messageBody);
      const signature = createSignature(bodyString, mockWebhookSecret);

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        headers: {
          'x-hub-signature-256': signature,
        },
        body: bodyString,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);

      const sentCommand = (eventBridgeClient.send as jest.Mock).mock.calls[0][0];
      const entries = sentCommand.input.Entries;
      
      expect(entries[0].DetailType).toBe('message.received.image');
      
      const detail = JSON.parse(entries[0].Detail);
      expect(detail.messageType).toBe('image');
      expect(detail.content.mediaUrl).toBe('https://s3.amazonaws.com/images/product.jpg');
    });

    it('should process button reply and publish with correct detail-type', async () => {
      const messageBody = {
        message: {
          id: 'msg-101',
          from: '+919876543210',
          timestamp: 1705315200000,
          type: 'button_reply',
          button: {
            payload: 'ACCEPT_ORDER_order-123',
          },
          profile: {
            name: 'Sunita',
          },
        },
      };

      const bodyString = JSON.stringify(messageBody);
      const signature = createSignature(bodyString, mockWebhookSecret);

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        headers: {
          'x-hub-signature-256': signature,
        },
        body: bodyString,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);

      const sentCommand = (eventBridgeClient.send as jest.Mock).mock.calls[0][0];
      const entries = sentCommand.input.Entries;
      
      expect(entries[0].DetailType).toBe('button.clicked');
      
      const detail = JSON.parse(entries[0].Detail);
      expect(detail.messageType).toBe('button_reply');
      expect(detail.content.buttonPayload).toBe('ACCEPT_ORDER_order-123');
    });

    it('should reject message with invalid signature', async () => {
      const messageBody = {
        message: {
          id: 'msg-123',
          from: '+919876543210',
          type: 'text',
          text: { body: 'Test' },
        },
      };

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        headers: {
          'x-hub-signature-256': 'invalid-signature',
        },
        body: JSON.stringify(messageBody),
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body)).toEqual({ error: 'Invalid signature' });
      expect(eventBridgeClient.send).not.toHaveBeenCalled();
    });

    it('should reject message with missing signature', async () => {
      const messageBody = {
        message: {
          id: 'msg-123',
          from: '+919876543210',
          type: 'text',
          text: { body: 'Test' },
        },
      };

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        headers: {},
        body: JSON.stringify(messageBody),
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(401);
      expect(eventBridgeClient.send).not.toHaveBeenCalled();
    });

    it('should handle EventBridge publish failure', async () => {
      (eventBridgeClient.send as jest.Mock).mockResolvedValue({
        FailedEntryCount: 1,
        Entries: [{ ErrorCode: 'InternalError' }],
      });

      const messageBody = {
        message: {
          id: 'msg-123',
          from: '+919876543210',
          type: 'text',
          text: { body: 'Test' },
        },
      };

      const bodyString = JSON.stringify(messageBody);
      const signature = createSignature(bodyString, mockWebhookSecret);

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        headers: {
          'x-hub-signature-256': signature,
        },
        body: bodyString,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toBe('Internal server error');
    });
  });

  describe('HTTP Method Handling', () => {
    it('should return 405 for unsupported HTTP methods', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'PUT',
        headers: {},
        body: null,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(405);
      expect(JSON.parse(result.body)).toEqual({ error: 'Method not allowed' });
    });
  });

  describe('Edge Cases and Error Scenarios', () => {
    function createSignature(payload: string, secret: string): string {
      return crypto.createHmac('sha256', secret).update(payload).digest('hex');
    }

    it('should handle malformed JSON in message body', async () => {
      const malformedBody = '{ invalid json }';
      const signature = createSignature(malformedBody, mockWebhookSecret);

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        headers: {
          'x-hub-signature-256': signature,
        },
        body: malformedBody,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toBe('Internal server error');
    });

    it('should handle missing message fields gracefully', async () => {
      const messageBody = {
        message: {
          // Missing id, from, timestamp
          type: 'text',
        },
      };

      const bodyString = JSON.stringify(messageBody);
      const signature = createSignature(bodyString, mockWebhookSecret);

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        headers: {
          'x-hub-signature-256': signature,
        },
        body: bodyString,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      
      const sentCommand = (eventBridgeClient.send as jest.Mock).mock.calls[0][0];
      const detail = JSON.parse(sentCommand.input.Entries[0].Detail);
      
      // Should generate UUID for missing messageId
      expect(detail.messageId).toBeDefined();
      expect(detail.messageId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should handle message with alternative field names', async () => {
      const messageBody = {
        messageId: 'alt-msg-123',
        sender: '+919876543210',
        content: {
          text: 'Alternative format',
        },
      };

      const bodyString = JSON.stringify(messageBody);
      const signature = createSignature(bodyString, mockWebhookSecret);

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        headers: {
          'x-hub-signature-256': signature,
        },
        body: bodyString,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      
      const sentCommand = (eventBridgeClient.send as jest.Mock).mock.calls[0][0];
      const detail = JSON.parse(sentCommand.input.Entries[0].Detail);
      
      expect(detail.messageId).toBe('alt-msg-123');
      expect(detail.phone).toBe('+919876543210');
      expect(detail.content.text).toBe('Alternative format');
    });

    it('should handle missing WEBHOOK_SECRET environment variable', async () => {
      delete process.env.WEBHOOK_SECRET;

      const messageBody = { message: { id: 'test', type: 'text' } };
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        headers: {},
        body: JSON.stringify(messageBody),
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toBe('Server configuration error');
    });

    it('should handle signature with different header case', async () => {
      const messageBody = {
        message: {
          id: 'msg-case-test',
          from: '+919876543210',
          type: 'text',
          text: { body: 'Test case sensitivity' },
        },
      };

      const bodyString = JSON.stringify(messageBody);
      const signature = createSignature(bodyString, mockWebhookSecret);

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        headers: {
          'X-Hub-Signature-256': signature, // Uppercase header
        },
        body: bodyString,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
    });

    it('should determine message type from content when type field is missing', async () => {
      const messageBody = {
        message: {
          id: 'msg-no-type',
          from: '+919876543210',
          audio: {
            url: 'https://example.com/audio.ogg',
            mime_type: 'audio/ogg',
          },
          // type field missing
        },
      };

      const bodyString = JSON.stringify(messageBody);
      const signature = createSignature(bodyString, mockWebhookSecret);

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        headers: {
          'x-hub-signature-256': signature,
        },
        body: bodyString,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      
      const sentCommand = (eventBridgeClient.send as jest.Mock).mock.calls[0][0];
      expect(sentCommand.input.Entries[0].DetailType).toBe('message.received.voice');
    });

    it('should handle empty message body', async () => {
      const bodyString = '{}';
      const signature = createSignature(bodyString, mockWebhookSecret);

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        headers: {
          'x-hub-signature-256': signature,
        },
        body: bodyString,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
    });

    it('should handle webhook verification with missing challenge', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        queryStringParameters: {
          'hub.verify_token': mockVerifyToken,
          // hub.challenge missing
        },
        headers: {},
        body: null,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(403);
    });

    it('should handle webhook verification with missing query parameters', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        queryStringParameters: null,
        headers: {},
        body: null,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(403);
    });
  });
});
