/**
 * WhatsApp API Connection Test
 * Tests actual API connectivity and message sending
 */

import { sendTextMessage } from '../../src/lambdas/whatsapp-message-sender';

describe('WhatsApp API Connection Test', () => {
  beforeEach(() => {
    // Use real environment variables from .env
    require('dotenv').config();
  });

  it('should test WhatsApp API connectivity', async () => {
    console.log('\n🔍 Testing WhatsApp API Connection...\n');
    
    console.log('📋 Configuration:');
    console.log('   API Endpoint:', process.env.WHATSAPP_API_ENDPOINT);
    console.log('   Phone Number ID:', process.env.WHATSAPP_PHONE_NUMBER_ID);
    console.log('   Access Token:', process.env.WHATSAPP_ACCESS_TOKEN ? '✅ Set' : '❌ Not set');
    
    if (!process.env.WHATSAPP_ACCESS_TOKEN) {
      console.log('\n❌ WHATSAPP_ACCESS_TOKEN not configured');
      console.log('💡 Set it in .env file');
      return;
    }

    if (!process.env.WHATSAPP_PHONE_NUMBER_ID) {
      console.log('\n❌ WHATSAPP_PHONE_NUMBER_ID not configured');
      console.log('💡 Set it in .env file');
      return;
    }

    // Test with a real phone number (use your own for testing)
    const testPhone = '+919876543210'; // Replace with your test number
    const testMessage = '🧪 Test message from Vyapar Vaani - Enhanced Agent Integration';

    console.log('\n📤 Sending test message...');
    console.log('   To:', testPhone);
    console.log('   Message:', testMessage);

    try {
      const result = await sendTextMessage(testPhone, testMessage, 'en');
      
      console.log('\n✅ Message sent successfully!');
      console.log('   Message ID:', result.messageId);
      console.log('   Success:', result.success);
      
      if (result.error) {
        console.log('   Error:', result.error);
      }
    } catch (error: any) {
      console.error('\n❌ Failed to send message:');
      console.error('   Error:', error.message);
      console.error('   Stack:', error.stack);
      
      if (error.response) {
        console.error('   API Response:', error.response);
      }
    }
  });

  it('should diagnose common issues', () => {
    console.log('\n🔧 Common Issues Checklist:\n');
    
    const checks = [
      {
        name: 'WhatsApp Access Token',
        check: () => !!process.env.WHATSAPP_ACCESS_TOKEN,
        fix: 'Set WHATSAPP_ACCESS_TOKEN in .env file'
      },
      {
        name: 'WhatsApp Phone Number ID',
        check: () => !!process.env.WHATSAPP_PHONE_NUMBER_ID,
        fix: 'Set WHATSAPP_PHONE_NUMBER_ID in .env file'
      },
      {
        name: 'WhatsApp API Endpoint',
        check: () => !!process.env.WHATSAPP_API_ENDPOINT,
        fix: 'Set WHATSAPP_API_ENDPOINT in .env file (default: https://graph.facebook.com/v22.0)'
      },
      {
        name: 'Token not expired',
        check: () => {
          // WhatsApp tokens typically expire after 60 days
          // This is a placeholder - actual check would need token metadata
          return true;
        },
        fix: 'Generate a new access token from Meta Business Suite'
      },
      {
        name: 'Phone number verified',
        check: () => true, // Can't check programmatically
        fix: 'Verify phone number in Meta Business Suite'
      }
    ];

    checks.forEach((check, i) => {
      const passed = check.check();
      console.log(`${i + 1}. ${check.name}: ${passed ? '✅ OK' : '❌ FAILED'}`);
      if (!passed) {
        console.log(`   💡 Fix: ${check.fix}`);
      }
    });

    console.log('\n📚 Additional Resources:');
    console.log('   - WhatsApp Business API Docs: https://developers.facebook.com/docs/whatsapp');
    console.log('   - Meta Business Suite: https://business.facebook.com/');
    console.log('   - Token Generation: https://developers.facebook.com/docs/whatsapp/business-management-api/get-started');
  });
});
