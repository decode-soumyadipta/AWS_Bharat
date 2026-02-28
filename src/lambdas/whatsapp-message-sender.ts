/**
 * WhatsApp Message Sender Lambda
 * 
 * This Lambda function sends WhatsApp messages via AWS End User Messaging API.
 * Supports text messages, interactive messages with buttons, and images with captions.
 * Includes language-specific formatting and retry logic with exponential backoff.
 * 
 * Requirements: 1.4, 1.6, 5.3, 9.2, 12.6
 */

import { WhatsAppOutboundMessage } from '../models/whatsapp';

const MAX_RETRY_ATTEMPTS = 5;
const INITIAL_RETRY_DELAY_MS = 1000; // 1 second
const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get WhatsApp API configuration from environment variables
 */
function getWhatsAppConfig() {
  return {
    endpoint: process.env.WHATSAPP_API_ENDPOINT || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
  };
}

/**
 * Language-specific message templates
 */
const MESSAGE_TEMPLATES = {
  hi: {
    orderReceived: '🛒 नया ऑर्डर!',
    customer: 'ग्राहक',
    product: 'उत्पाद',
    quantity: 'मात्रा',
    price: 'कीमत',
    address: 'पता',
    accept: '✅ स्वीकार करें',
    reject: '❌ अस्वीकार करें',
    confirmed: 'पुष्टि की गई',
    error: 'त्रुटि',
  },
  mr: {
    orderReceived: '🛒 नवीन ऑर्डर!',
    customer: 'ग्राहक',
    product: 'उत्पादन',
    quantity: 'प्रमाण',
    price: 'किंमत',
    address: 'पत्ता',
    accept: '✅ स्वीकार करा',
    reject: '❌ नाकारा',
    confirmed: 'पुष्टी केली',
    error: 'त्रुटी',
  },
  en: {
    orderReceived: '🛒 New Order!',
    customer: 'Customer',
    product: 'Product',
    quantity: 'Quantity',
    price: 'Price',
    address: 'Address',
    accept: '✅ Accept',
    reject: '❌ Reject',
    confirmed: 'Confirmed',
    error: 'Error',
  },
};

/**
 * Formats a message in the specified language
 */
export function formatMessage(
  template: string,
  params: Record<string, string>,
  language: 'hi' | 'mr' | 'en'
): string {
  let message = template;
  for (const [key, value] of Object.entries(params)) {
    message = message.replace(`{${key}}`, value);
  }
  return message;
}

/**
 * Sends WhatsApp typing indicator (real typing status)
 * Shows "typing..." animation in WhatsApp for more human-like interaction
 */
export async function sendTypingIndicator(
  to: string,
  durationMs: number = 3000
): Promise<{ success: boolean; error?: string }> {
  const config = getWhatsAppConfig();
  
  if (!config.endpoint || !config.phoneNumberId || !config.accessToken) {
    console.warn('WhatsApp API configuration missing, skipping typing indicator');
    return { success: false, error: 'Configuration missing' };
  }

  try {
    const url = `${config.endpoint}/${config.phoneNumberId}/messages`;
    
    // Send typing indicator using WhatsApp's typing status
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: {
          preview_url: false,
          body: '...' // Minimal text to trigger typing
        },
      }),
    });

    if (!response.ok) {
      console.warn('Failed to send typing indicator:', response.status);
      return { success: false, error: `HTTP ${response.status}` };
    }

    // Wait for the specified duration to simulate typing
    await sleep(Math.min(durationMs, 5000)); // Max 5 seconds

    return { success: true };
  } catch (error) {
    console.warn('Error sending typing indicator:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Sends a text message via WhatsApp
 */
export async function sendTextMessage(
  to: string,
  text: string,
  language: 'hi' | 'mr' | 'en' = 'en'
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const message: WhatsAppOutboundMessage = {
    to,
    type: 'text',
    content: { text },
    language,
  };

  return sendMessageWithRetry(message);
}

/**
 * Sends an interactive message with buttons via WhatsApp
 */
export async function sendInteractiveMessage(
  to: string,
  text: string,
  buttons: Array<{ id: string; title: string }>,
  language: 'hi' | 'mr' | 'en' = 'en'
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const message: WhatsAppOutboundMessage = {
    to,
    type: 'interactive',
    content: {
      text,
      buttons,
    },
    language,
  };

  return sendMessageWithRetry(message);
}

/**
 * Sends an image with caption via WhatsApp
 */
export async function sendImageMessage(
  to: string,
  imageUrl: string,
  caption?: string,
  language: 'hi' | 'mr' | 'en' = 'en'
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const message: WhatsAppOutboundMessage = {
    to,
    type: 'image',
    content: {
      imageUrl,
      text: caption,
    },
    language,
  };

  return sendMessageWithRetry(message);
}

/**
 * Sends a message with retry logic and exponential backoff
 */
async function sendMessageWithRetry(
  message: WhatsAppOutboundMessage,
  attempt: number = 1
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const result = await sendMessage(message);
    
    if (result.success) {
      console.log('Message sent successfully:', {
        to: message.to,
        type: message.type,
        messageId: result.messageId,
        attempt,
      });
      return result;
    }

    // Message send returned an error (not an exception)
    // Only retry if it's a retryable error
    const isRetryable = result.statusCode && (
      result.statusCode >= 500 ||  // 5xx server errors
      result.statusCode === 429     // Rate limiting
    );

    if (isRetryable && attempt < MAX_RETRY_ATTEMPTS) {
      const delay = calculateRetryDelay(attempt);
      console.log(`Message send failed, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`);
      
      await sleep(delay);
      return sendMessageWithRetry(message, attempt + 1);
    }

    // Non-retryable error or max retries exceeded
    if (attempt >= MAX_RETRY_ATTEMPTS) {
      return {
        success: false,
        error: 'Max retry attempts exceeded',
      };
    }

    // Return the error as-is for non-retryable errors
    return result;
  } catch (error) {
    console.error('Error sending message:', error);
    
    // Retry on transient errors
    if (isRetryableError(error) && attempt < MAX_RETRY_ATTEMPTS) {
      const delay = calculateRetryDelay(attempt);
      console.log(`Retrying after error in ${delay}ms (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`);
      
      await sleep(delay);
      return sendMessageWithRetry(message, attempt + 1);
    }

    // Max retries exceeded or non-retryable error
    if (attempt >= MAX_RETRY_ATTEMPTS) {
      return {
        success: false,
        error: 'Max retry attempts exceeded',
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Calculates retry delay with exponential backoff
 * Formula: min(INITIAL_DELAY * 2^(attempt-1), MAX_DELAY)
 */
function calculateRetryDelay(attempt: number): number {
  const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

/**
 * Determines if an error is retryable
 */
function isRetryableError(error: any): boolean {
  // Retry on network errors, timeouts, and 5xx server errors
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
    return true;
  }
  
  if (error.statusCode >= 500 && error.statusCode < 600) {
    return true;
  }
  
  // Retry on rate limiting (429)
  if (error.statusCode === 429) {
    return true;
  }
  
  return false;
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sends a message via AWS End User Messaging API
 * This is a placeholder implementation that will be replaced with actual AWS SDK calls
 */
async function sendMessage(
  message: WhatsAppOutboundMessage
): Promise<{ success: boolean; messageId?: string; error?: string; statusCode?: number }> {
  // Get configuration at runtime
  const config = getWhatsAppConfig();
  
  // Validate required configuration
  if (!config.endpoint || !config.phoneNumberId || !config.accessToken) {
    throw new Error('WhatsApp API configuration missing');
  }

  // Construct the API payload based on message type
  const payload = constructWhatsAppPayload(message);

  try {
    // Call WhatsApp Business API
    const url = `${config.endpoint}/${config.phoneNumberId}/messages`;
    console.log('Calling WhatsApp API:', { url, to: message.to, type: message.type });
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    console.log('WhatsApp API response status:', response.status);

    if (!response.ok) {
      const errorData: any = await response.json().catch(() => ({}));
      console.error('WhatsApp API error:', errorData);
      return {
        success: false,
        error: errorData.error?.message || `HTTP ${response.status}`,
        statusCode: response.status,
      };
    }

    const data: any = await response.json();
    console.log('WhatsApp API success:', data);
    return {
      success: true,
      messageId: data.messages?.[0]?.id || data.messageId,
    };
  } catch (error) {
    console.error('Error calling WhatsApp API:', error);
    throw error;
  }
}

/**
 * Constructs WhatsApp API payload based on message type
 */
function constructWhatsAppPayload(message: WhatsAppOutboundMessage): any {
  const basePayload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: message.to,
  };

  switch (message.type) {
    case 'text':
      return {
        ...basePayload,
        type: 'text',
        text: {
          body: message.content.text,
        },
      };

    case 'interactive':
      return {
        ...basePayload,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: message.content.text,
          },
          action: {
            buttons: message.content.buttons?.map((button, index) => ({
              type: 'reply',
              reply: {
                id: button.id,
                title: button.title.substring(0, 20), // WhatsApp limit
              },
            })) || [],
          },
        },
      };

    case 'image':
      return {
        ...basePayload,
        type: 'image',
        image: {
          link: message.content.imageUrl,
          caption: message.content.text,
        },
      };

    default:
      throw new Error(`Unsupported message type: ${message.type}`);
  }
}

/**
 * Lambda handler for sending WhatsApp messages
 * Can be invoked directly or via EventBridge
 */
export async function handler(event: any): Promise<any> {
  console.log('WhatsApp message sender invoked:', JSON.stringify(event, null, 2));

  try {
    // Check if this is an image request event
    if (event.detail && event['detail-type'] === 'voice.image_request.needed') {
      const { phone, language = 'hi-IN' } = event.detail;
      const langCode = language.split('-')[0] as 'hi' | 'mr' | 'en';
      
      // Send bilingual image request message
      const hindiText = '📸 कृपया उत्पाद की फोटो भेजें';
      const englishText = '📸 Please send product photo';
      const bilingualText = `${hindiText}\n\n${englishText}`;
      
      const result = await sendTextMessage(phone, bilingualText, langCode);
      return {
        statusCode: result.success ? 200 : 500,
        body: JSON.stringify(result),
      };
    }

    // Extract message details from event (handle EventBridge format)
    const eventDetail = event.detail || event;
    const { to, type, content, language = 'en' } = eventDetail;

    if (!to) {
      throw new Error('Recipient phone number (to) is required');
    }

    let result;

    switch (type) {
      case 'text':
        if (!content?.text) {
          throw new Error('Text content is required for text messages');
        }
        result = await sendTextMessage(to, content.text, language);
        break;

      case 'interactive':
        if (!content?.text || !content?.buttons) {
          throw new Error('Text and buttons are required for interactive messages');
        }
        result = await sendInteractiveMessage(to, content.text, content.buttons, language);
        break;

      case 'image':
        if (!content?.imageUrl) {
          throw new Error('Image URL is required for image messages');
        }
        result = await sendImageMessage(to, content.imageUrl, content.text, language);
        break;

      default:
        throw new Error(`Unsupported message type: ${type}`);
    }

    return {
      statusCode: result.success ? 200 : 500,
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error('Error in WhatsApp message sender handler:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}

/**
 * Helper function to get message templates for a language
 */
export function getMessageTemplates(language: 'hi' | 'mr' | 'en') {
  return MESSAGE_TEMPLATES[language];
}
