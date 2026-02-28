/**
 * Integration tests for WhatsApp Webhook Routing
 * 
 * Tests the complete routing flow including:
 * - Routing for all state/message combinations
 * - New user initialization
 * - Error guidance messages
 * 
 * Requirements: 3.1, 3.6, 3.7
 */

import { handler } from '../../src/lambdas/whatsapp-webhook-handler';
import { eventBridgeClient } from '../../src/config/aws-clients';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import * as stateManager from '../../src/services/state-manager';
import * as stateRouter from '../../src/services/state-router';
import * as whatsappSender from '../../src/lambdas/whatsapp-message-sender';
import crypto from 'crypto';
import { UserStateType } from '../../src/services/state-manager';
import { MessageType, HandlerType } from '../../src/services/state-router';

// Mock AWS SDK clients
jest.mock('../../src/config/aws-clients', () => ({
  eventBridgeClient: {
    send: jest.fn(),
  },
  EVENT_BUS_NAME: 'test-event-bus',
}));

// Mock state manager
jest.mock('../../src/services/state-manager');

// Mock WhatsApp sender
jest.mock('../../src/lambdas/whatsapp-message-sender');

// Import the actual state router (not mocked) for integration testing
jest.unmock('../../src/services/state-router');
const actualStateRouter = jest.requireActual('../../src/services/state-router');

describe('Webhook Routing Integration Tests', () => {
  const mockWebhookSecret = 'test-webhook-secret';
  const testPhone = '+919876543210';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WEBHOOK_SECRET = mockWebhookSecret;
    
    // Mock successful EventBridge response
    (eventBridgeClient.send as jest.Mock).mockResolvedValue({
      FailedEntryCount: 0,
      Entries: [{ EventId: 'test-event-id' }],
    });

    // Mock WhatsApp sender
    (whatsappSender.sendTextMessage as jest.Mock).mockResolvedValue({
      success: true,
      messageId: 'sent-msg-123',
    });
  });

  afterEach(() => {
    delete process.env.WEBHOOK_SECRET;
  });

  function createSignature(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  function createWebhookEvent(messageType: MessageType, phone: string = testPhone) {
    const messageBody: any = {
      message: {
        id: `msg-${Date.now()}`,
        from: phone,
        timestamp: Date.now(),
        type: messageType,
      },
    };

    // Add type-specific content
    switch (messageType) {
      case 'text':
        messageBody.message.text = { body: 'Test message' };
        break;
      case 'audio':
        messageBody.message.audio = {
          url: 'https://example.com/audio.ogg',
          mime_type: 'audio/ogg',
        };
        break;
      case 'image':
        messageBody.message.image = {
          url: 'https://example.com/image.jpg',
          mime_type: 'image/jpeg',
        };
        break;
      case 'button_reply':
        messageBody.message.button = {
          payload: 'APPROVE_CATALOG',
        };
        break;
    }

    const bodyString = JSON.stringify(messageBody);
    const signature = createSignature(bodyString, mockWebhookSecret);

    return {
      httpMethod: 'POST',
      headers: {
        'x-hub-signature-256': signature,
      },
      body: bodyString,
    };
  }

  describe('Routing for All State/Message Combinations', () => {
    /**
     * Test matrix for all valid state/message combinations
     * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
     */
    const routingMatrix: Array<{
      state: UserStateType;
      messageType: MessageType;
      expectedHandler: HandlerType;
      shouldPublishEvent: boolean;
    }> = [
      // NEW state
      { state: 'NEW', messageType: 'image', expectedHandler: 'KYC', shouldPublishEvent: true },
      { state: 'NEW', messageType: 'text', expectedHandler: 'ERROR', shouldPublishEvent: false },
      { state: 'NEW', messageType: 'audio', expectedHandler: 'ERROR', shouldPublishEvent: false },
      { state: 'NEW', messageType: 'button_reply', expectedHandler: 'ERROR', shouldPublishEvent: false },

      // KYC_PENDING state
      { state: 'KYC_PENDING', messageType: 'image', expectedHandler: 'KYC', shouldPublishEvent: true },
      { state: 'KYC_PENDING', messageType: 'text', expectedHandler: 'ERROR', shouldPublishEvent: false },
      { state: 'KYC_PENDING', messageType: 'audio', expectedHandler: 'ERROR', shouldPublishEvent: false },
      { state: 'KYC_PENDING', messageType: 'button_reply', expectedHandler: 'ERROR', shouldPublishEvent: false },

      // KYC_VERIFIED state
      { state: 'KYC_VERIFIED', messageType: 'audio', expectedHandler: 'VOICE', shouldPublishEvent: true },
      { state: 'KYC_VERIFIED', messageType: 'text', expectedHandler: 'VOICE', shouldPublishEvent: true },
      { state: 'KYC_VERIFIED', messageType: 'image', expectedHandler: 'ERROR', shouldPublishEvent: false },
      { state: 'KYC_VERIFIED', messageType: 'button_reply', expectedHandler: 'ERROR', shouldPublishEvent: false },

      // VOICE_RECEIVED state
      { state: 'VOICE_RECEIVED', messageType: 'audio', expectedHandler: 'VOICE', shouldPublishEvent: true },
      { state: 'VOICE_RECEIVED', messageType: 'text', expectedHandler: 'VOICE', shouldPublishEvent: true },
      { state: 'VOICE_RECEIVED', messageType: 'image', expectedHandler: 'ERROR', shouldPublishEvent: false },
      { state: 'VOICE_RECEIVED', messageType: 'button_reply', expectedHandler: 'ERROR', shouldPublishEvent: false },

      // IMAGE_PENDING state
      { state: 'IMAGE_PENDING', messageType: 'image', expectedHandler: 'IMAGE', shouldPublishEvent: true },
      { state: 'IMAGE_PENDING', messageType: 'text', expectedHandler: 'ERROR', shouldPublishEvent: false },
      { state: 'IMAGE_PENDING', messageType: 'audio', expectedHandler: 'ERROR', shouldPublishEvent: false },
      { state: 'IMAGE_PENDING', messageType: 'button_reply', expectedHandler: 'ERROR', shouldPublishEvent: false },

      // CONFIRMATION_PENDING state
      { state: 'CONFIRMATION_PENDING', messageType: 'button_reply', expectedHandler: 'CONFIRMATION', shouldPublishEvent: true },
      { state: 'CONFIRMATION_PENDING', messageType: 'text', expectedHandler: 'ERROR', shouldPublishEvent: false },
      { state: 'CONFIRMATION_PENDING', messageType: 'audio', expectedHandler: 'ERROR', shouldPublishEvent: false },
      { state: 'CONFIRMATION_PENDING', messageType: 'image', expectedHandler: 'ERROR', shouldPublishEvent: false },

      // ACTIVE state
      { state: 'ACTIVE', messageType: 'audio', expectedHandler: 'VOICE', shouldPublishEvent: true },
      { state: 'ACTIVE', messageType: 'text', expectedHandler: 'VOICE', shouldPublishEvent: true },
      { state: 'ACTIVE', messageType: 'image', expectedHandler: 'IMAGE', shouldPublishEvent: true },
      { state: 'ACTIVE', messageType: 'button_reply', expectedHandler: 'ERROR', shouldPublishEvent: false },
    ];

    routingMatrix.forEach(({ state, messageType, expectedHandler, shouldPublishEvent }) => {
      it(`should route ${messageType} message in ${state} state to ${expectedHandler} handler`, async () => {
        // Setup user state
        (stateManager.getUserState as jest.Mock).mockResolvedValue({
          phone: testPhone,
          state,
          language: 'hi-IN',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Create webhook event
        const event = createWebhookEvent(messageType);

        // Execute handler
        const result = await handler(event as any);

        // Verify response
        expect(result.statusCode).toBe(200);
        const responseBody = JSON.parse(result.body);

        if (shouldPublishEvent) {
          // Should publish to EventBridge
          expect(responseBody.success).toBe(true);
          expect(responseBody.handler).toBe(expectedHandler);
          expect(eventBridgeClient.send).toHaveBeenCalledWith(
            expect.any(PutEventsCommand)
          );

          // Verify EventBridge event contains correct handler
          const sentCommand = (eventBridgeClient.send as jest.Mock).mock.calls[0][0];
          const detail = JSON.parse(sentCommand.input.Entries[0].Detail);
          expect(detail.handler).toBe(expectedHandler);
          expect(detail.state).toBe(state);
        } else {
          // Should send guidance message
          expect(responseBody.action).toBe('guidance_sent');
          expect(whatsappSender.sendTextMessage).toHaveBeenCalledWith(
            testPhone,
            expect.any(String)
          );
          expect(eventBridgeClient.send).not.toHaveBeenCalled();
        }
      });
    });
  });

  describe('New User Initialization', () => {
    /**
     * Test new user initialization flow
     * Requirements: 3.7
     */
    it('should initialize new user with NEW state when no state exists', async () => {
      const newUserPhone = '+919999999999';
      
      // Mock no existing state
      (stateManager.getUserState as jest.Mock).mockResolvedValue(null);
      
      // Mock initialization
      (stateManager.initializeNewUser as jest.Mock).mockResolvedValue({
        phone: newUserPhone,
        state: 'NEW',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Create webhook event
      const event = createWebhookEvent('image', newUserPhone);

      // Execute handler
      const result = await handler(event as any);

      // Verify initialization was called
      expect(stateManager.getUserState).toHaveBeenCalledWith(newUserPhone);
      expect(stateManager.initializeNewUser).toHaveBeenCalledWith(newUserPhone);

      // Verify response
      expect(result.statusCode).toBe(200);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.success).toBe(true);
      expect(responseBody.handler).toBe('KYC');
    });

    it('should route new user image message to KYC handler', async () => {
      const newUserPhone = '+919999999999';
      
      // Mock no existing state
      (stateManager.getUserState as jest.Mock).mockResolvedValue(null);
      
      // Mock initialization
      (stateManager.initializeNewUser as jest.Mock).mockResolvedValue({
        phone: newUserPhone,
        state: 'NEW',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Create webhook event with image
      const event = createWebhookEvent('image', newUserPhone);

      // Execute handler
      const result = await handler(event as any);

      // Verify EventBridge event
      expect(eventBridgeClient.send).toHaveBeenCalled();
      const sentCommand = (eventBridgeClient.send as jest.Mock).mock.calls[0][0];
      const detail = JSON.parse(sentCommand.input.Entries[0].Detail);
      
      expect(detail.handler).toBe('KYC');
      expect(detail.state).toBe('NEW');
      expect(detail.phone).toBe(newUserPhone);
    });

    it('should send guidance message when new user sends wrong message type', async () => {
      const newUserPhone = '+919999999999';
      
      // Mock no existing state
      (stateManager.getUserState as jest.Mock).mockResolvedValue(null);
      
      // Mock initialization
      (stateManager.initializeNewUser as jest.Mock).mockResolvedValue({
        phone: newUserPhone,
        state: 'NEW',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Create webhook event with audio (wrong type for NEW state)
      const event = createWebhookEvent('audio', newUserPhone);

      // Execute handler
      const result = await handler(event as any);

      // Verify guidance message was sent
      expect(whatsappSender.sendTextMessage).toHaveBeenCalledWith(
        newUserPhone,
        expect.stringContaining('पैन कार्ड') // Should ask for PAN card
      );

      // Should not publish to EventBridge
      expect(eventBridgeClient.send).not.toHaveBeenCalled();

      // Verify response
      expect(result.statusCode).toBe(200);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.action).toBe('guidance_sent');
    });
  });

  describe('Error Guidance Messages', () => {
    /**
     * Test error guidance messages for invalid state/message combinations
     * Requirements: 3.6
     */
    const guidanceTestCases: Array<{
      state: UserStateType;
      messageType: MessageType;
      expectedGuidanceKeyword: string;
      description: string;
    }> = [
      {
        state: 'NEW',
        messageType: 'audio',
        expectedGuidanceKeyword: 'पैन कार्ड',
        description: 'should ask for PAN card when NEW user sends audio',
      },
      {
        state: 'KYC_PENDING',
        messageType: 'text',
        expectedGuidanceKeyword: 'पैन कार्ड',
        description: 'should ask for PAN card when KYC_PENDING user sends text',
      },
      {
        state: 'KYC_VERIFIED',
        messageType: 'image',
        expectedGuidanceKeyword: 'वॉइस मैसेज',
        description: 'should ask for voice message when KYC_VERIFIED user sends image',
      },
      {
        state: 'VOICE_RECEIVED',
        messageType: 'button_reply',
        expectedGuidanceKeyword: 'वॉइस मैसेज',
        description: 'should ask for voice message when VOICE_RECEIVED user sends button',
      },
      {
        state: 'IMAGE_PENDING',
        messageType: 'audio',
        expectedGuidanceKeyword: 'फोटो',
        description: 'should ask for photo when IMAGE_PENDING user sends audio',
      },
      {
        state: 'CONFIRMATION_PENDING',
        messageType: 'text',
        expectedGuidanceKeyword: 'बटन',
        description: 'should ask to press button when CONFIRMATION_PENDING user sends text',
      },
      {
        state: 'ACTIVE',
        messageType: 'button_reply',
        expectedGuidanceKeyword: 'वॉइस मैसेज',
        description: 'should ask for voice message when ACTIVE user sends button',
      },
    ];

    guidanceTestCases.forEach(({ state, messageType, expectedGuidanceKeyword, description }) => {
      it(description, async () => {
        // Setup user state
        (stateManager.getUserState as jest.Mock).mockResolvedValue({
          phone: testPhone,
          state,
          language: 'hi-IN',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Create webhook event
        const event = createWebhookEvent(messageType);

        // Execute handler
        const result = await handler(event as any);

        // Verify guidance message was sent
        expect(whatsappSender.sendTextMessage).toHaveBeenCalledWith(
          testPhone,
          expect.stringContaining(expectedGuidanceKeyword)
        );

        // Should not publish to EventBridge
        expect(eventBridgeClient.send).not.toHaveBeenCalled();

        // Verify response
        expect(result.statusCode).toBe(200);
        const responseBody = JSON.parse(result.body);
        expect(responseBody.action).toBe('guidance_sent');
      });
    });

    it('should send guidance message in user preferred language', async () => {
      // Test with Marathi language preference
      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: testPhone,
        state: 'NEW',
        language: 'mr-IN',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const event = createWebhookEvent('audio');
      await handler(event as any);

      // Should contain Marathi text
      expect(whatsappSender.sendTextMessage).toHaveBeenCalledWith(
        testPhone,
        expect.stringContaining('पॅन कार्ड') // Marathi for PAN card
      );
    });

    it('should send guidance message in English when language is en-IN', async () => {
      // Test with English language preference
      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: testPhone,
        state: 'NEW',
        language: 'en-IN',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const event = createWebhookEvent('audio');
      await handler(event as any);

      // Should contain English text
      expect(whatsappSender.sendTextMessage).toHaveBeenCalledWith(
        testPhone,
        expect.stringContaining('PAN card')
      );
    });

    it('should default to Hindi when no language preference exists', async () => {
      // Test with no language preference
      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: testPhone,
        state: 'NEW',
        // language field missing
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const event = createWebhookEvent('audio');
      await handler(event as any);

      // Should contain Hindi text (default)
      expect(whatsappSender.sendTextMessage).toHaveBeenCalledWith(
        testPhone,
        expect.stringContaining('पैन कार्ड') // Hindi for PAN card
      );
    });
  });

  describe('EventBridge Event Publishing', () => {
    /**
     * Test EventBridge event structure and content
     * Requirements: 3.1
     */
    it('should include state and handler information in EventBridge event', async () => {
      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: testPhone,
        state: 'KYC_VERIFIED',
        language: 'hi-IN',
        sellerId: 'seller-123',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const event = createWebhookEvent('audio');
      await handler(event as any);

      expect(eventBridgeClient.send).toHaveBeenCalled();
      const sentCommand = (eventBridgeClient.send as jest.Mock).mock.calls[0][0];
      const detail = JSON.parse(sentCommand.input.Entries[0].Detail);

      // Verify state information is included
      expect(detail.state).toBe('KYC_VERIFIED');
      expect(detail.handler).toBe('VOICE');
      expect(detail.language).toBe('hi-IN');
      expect(detail.phone).toBe(testPhone);
      expect(detail.messageType).toBe('audio');
    });

    it('should publish correct detail-type for each message type', async () => {
      const messageTypeToDetailType: Record<MessageType, string> = {
        text: 'message.received.text',
        audio: 'message.received.voice',
        image: 'message.received.image',
        button_reply: 'button.clicked',
      };

      for (const [messageType, expectedDetailType] of Object.entries(messageTypeToDetailType)) {
        jest.clearAllMocks();
        
        // Setup state that allows this message type
        (stateManager.getUserState as jest.Mock).mockResolvedValue({
          phone: testPhone,
          state: 'ACTIVE',
          language: 'hi-IN',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Mock EventBridge response
        (eventBridgeClient.send as jest.Mock).mockResolvedValue({
          FailedEntryCount: 0,
          Entries: [{ EventId: 'test-event-id' }],
        });
        
        const event = createWebhookEvent(messageType as MessageType);
        await handler(event as any);

        // Only check for message types that should publish events in ACTIVE state
        if (messageType !== 'button_reply') {
          expect(eventBridgeClient.send).toHaveBeenCalled();
          const sentCommand = (eventBridgeClient.send as jest.Mock).mock.calls[0][0];
          expect(sentCommand.input.Entries[0].DetailType).toBe(expectedDetailType);
        }
      }
    });
  });

  describe('Error Handling', () => {
    /**
     * Test error handling in routing flow
     */
    it('should handle state retrieval errors', async () => {
      (stateManager.getUserState as jest.Mock).mockRejectedValue(
        new Error('DynamoDB connection error')
      );

      const event = createWebhookEvent('audio');
      const result = await handler(event as any);

      expect(result.statusCode).toBe(500);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Internal server error');
    });

    it('should handle EventBridge publish failures', async () => {
      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: testPhone,
        state: 'KYC_VERIFIED',
        language: 'hi-IN',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      (eventBridgeClient.send as jest.Mock).mockResolvedValue({
        FailedEntryCount: 1,
        Entries: [{ ErrorCode: 'InternalError' }],
      });

      const event = createWebhookEvent('audio');
      const result = await handler(event as any);

      expect(result.statusCode).toBe(500);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Internal server error');
    });

    it('should handle guidance message send failures gracefully', async () => {
      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: testPhone,
        state: 'NEW',
        language: 'hi-IN',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      (whatsappSender.sendTextMessage as jest.Mock).mockResolvedValue({
        success: false,
        error: 'WhatsApp API error',
      });

      const event = createWebhookEvent('audio');
      const result = await handler(event as any);

      // Should still return 200 even if guidance message fails
      expect(result.statusCode).toBe(200);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.action).toBe('guidance_sent');
    });
  });
});
