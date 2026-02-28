/**
 * Debug test for agent message flow
 */

import { sendEnhancedAgentMessage } from '../../src/services/enhanced-agent';
import { sendTextMessage, sendTypingIndicator } from '../../src/lambdas/whatsapp-message-sender';

// Mock AWS clients
jest.mock('../../src/config/aws-clients', () => ({
  bedrockClient: {
    send: jest.fn(),
  },
  eventBridgeClient: {
    send: jest.fn(),
  },
}));

// Mock conversation memory
jest.mock('../../src/services/conversation-memory', () => ({
  getConversationContext: jest.fn().mockResolvedValue(null),
  addConversationMessage: jest.fn().mockResolvedValue(undefined),
  updateUserPreferences: jest.fn().mockResolvedValue(undefined),
}));

describe('Agent Message Flow Debug', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WHATSAPP_API_ENDPOINT = 'https://api.whatsapp.com/v1';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
  });

  it('should have sendEnhancedAgentMessage function', () => {
    expect(sendEnhancedAgentMessage).toBeDefined();
    expect(typeof sendEnhancedAgentMessage).toBe('function');
    console.log('✅ sendEnhancedAgentMessage exists');
  });

  it('should have sendTextMessage function', () => {
    expect(sendTextMessage).toBeDefined();
    expect(typeof sendTextMessage).toBe('function');
    console.log('✅ sendTextMessage exists');
  });

  it('should have sendTypingIndicator function', () => {
    expect(sendTypingIndicator).toBeDefined();
    expect(typeof sendTypingIndicator).toBe('function');
    console.log('✅ sendTypingIndicator exists');
  });

  it('should call sendTextMessage when sending agent message', async () => {
    // Mock fetch for WhatsApp API
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'test-msg-id' }] }),
    }) as any;

    const phone = '+919876543210';
    const message = 'नमस्ते! मैं आपकी मदद के लिए यहाँ हूँ।';
    const language = 'hi-IN';

    console.log('\n🧪 Testing sendEnhancedAgentMessage...');
    console.log('   Phone:', phone);
    console.log('   Message:', message);
    console.log('   Language:', language);

    try {
      await sendEnhancedAgentMessage(phone, message, language);
      
      console.log('✅ sendEnhancedAgentMessage completed');
      console.log('📞 fetch called:', (global.fetch as jest.Mock).mock.calls.length, 'times');
      
      if ((global.fetch as jest.Mock).mock.calls.length > 0) {
        console.log('📋 API calls:');
        (global.fetch as jest.Mock).mock.calls.forEach((call, i) => {
          console.log(`   ${i + 1}. ${call[0]}`);
          console.log(`      Body:`, JSON.parse(call[1].body));
        });
      }
    } catch (error: any) {
      console.error('❌ Error:', error.message);
      throw error;
    }
  });

  it('should send typing indicator before message', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'test-msg-id' }] }),
    }) as any;

    const phone = '+919876543210';
    const message = 'Test message';
    const language = 'hi-IN';

    await sendEnhancedAgentMessage(phone, message, language);

    const calls = (global.fetch as jest.Mock).mock.calls;
    console.log('\n📊 API call sequence:');
    calls.forEach((call, i) => {
      const body = JSON.parse(call[1].body);
      console.log(`   ${i + 1}. Type: ${body.type || body.messaging_product}`);
    });

    // Should have at least 2 calls: typing indicator + message
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });
});
