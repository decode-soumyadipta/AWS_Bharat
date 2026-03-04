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
 * Marks a WhatsApp message as read.
 * POST /{PHONE_NUMBER_ID}/messages
 * { messaging_product: 'whatsapp', status: 'read', message_id: '...' }
 */
export async function markMessageAsRead(
  messageId: string,
  _showTypingIndicator: boolean = false
): Promise<{ success: boolean; data?: any; error?: string }> {
  const config = getWhatsAppConfig();
  
  if (!config.endpoint || !config.phoneNumberId || !config.accessToken) {
    console.warn('WhatsApp API configuration missing, skipping mark as read');
    return { success: false, error: 'Configuration missing' };
  }

  try {
    const url = `${config.endpoint}/${config.phoneNumberId}/messages`;
    
    const payload: any = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    };

    console.log('markMessageAsRead payload:', JSON.stringify(payload));
    console.log('markMessageAsRead URL:', url);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await response.text();
    console.log(`markMessageAsRead response: ${response.status} — ${responseBody}`);

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${responseBody}` };
    }

    let parsed;
    try { parsed = JSON.parse(responseBody); } catch { parsed = responseBody; }
    return { success: true, data: parsed };
  } catch (error) {
    console.warn('Error marking message as read:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Sends WhatsApp typing indicator using the dedicated Cloud API typing endpoint.
 * POST /{PHONE_NUMBER_ID}/messages with type: "typing" — shows the real "typing..."
 * bubble that persists for ~25 seconds or until a message is sent.
 */

// Cache the last message ID per phone so typing works even without explicit messageId
const lastMessageIdByPhone: Record<string, string> = {};

export function setLastMessageId(phone: string, messageId: string): void {
  lastMessageIdByPhone[phone] = messageId;
}

export async function sendTypingIndicator(
  to: string,
  messageId?: string
): Promise<{ success: boolean; error?: string }> {
  const config = getWhatsAppConfig();

  if (!config.endpoint || !config.phoneNumberId || !config.accessToken) {
    return { success: false, error: 'Configuration missing' };
  }

  // Use the dedicated typing endpoint (WhatsApp Cloud API v18+)
  // This shows the persistent "typing..." bubble in WhatsApp
  try {
    const url = `${config.endpoint}/${config.phoneNumberId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'typing',
      typing: { type: 'text' },
    };

    console.log('sendTypingIndicator payload:', JSON.stringify(payload));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await response.text();
    console.log(`sendTypingIndicator response: ${response.status} — ${responseBody}`);

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${responseBody}` };
    }

    return { success: true };
  } catch (err) {
    console.warn('Typing indicator exception:', err);
    return { success: true }; // Never fail on typing indicator
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
 * Sends an audio message via WhatsApp
 */
export async function sendAudioMessage(
  to: string,
  audioUrl: string,
  language: 'hi' | 'mr' | 'en' = 'en'
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const message: WhatsAppOutboundMessage = {
    to,
    type: 'audio',
    content: {
      audioUrl,
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

    case 'audio':
      return {
        ...basePayload,
        type: 'audio',
        audio: {
          link: message.content.audioUrl,
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

      case 'audio':
        if (!content?.audioUrl) {
          throw new Error('Audio URL is required for audio messages');
        }
        result = await sendAudioMessage(to, content.audioUrl, language);
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

/**
 * Clean text for voice synthesis and produce SSML output
 * - Remove emojis and special characters
 * - Use <prosody rate="slow"> for comfortable listening speed
 * - Use <say-as> for proper number/ID pronunciation
 * - Use <break> tags for natural pauses
 * - XML-escape text before wrapping in SSML
 */
function cleanTextForVoice(text: string): string {
  // Remove all emojis
  let cleaned = text.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F000}-\u{1F02F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2300}-\u{23FF}]|[\u{2B50}]|[\u{2B55}]|[\u{231A}]|[\u{231B}]|[\u{23E9}-\u{23EC}]|[\u{23F0}]|[\u{23F3}]|[\u{25FD}]|[\u{25FE}]|[\u{2614}]|[\u{2615}]|[\u{2648}-\u{2653}]|[\u{267F}]|[\u{2693}]|[\u{26A1}]|[\u{26AA}]|[\u{26AB}]|[\u{26BD}]|[\u{26BE}]|[\u{26C4}]|[\u{26C5}]|[\u{26CE}]|[\u{26D4}]|[\u{26EA}]|[\u{26F2}]|[\u{26F3}]|[\u{26F5}]|[\u{26FA}]|[\u{26FD}]|[\u{2705}]|[\u{270A}]|[\u{270B}]|[\u{2728}]|[\u{274C}]|[\u{274E}]|[\u{2753}-\u{2755}]|[\u{2757}]|[\u{2795}-\u{2797}]|[\u{27B0}]|[\u{27BF}]|[\u{2B1B}]|[\u{2B1C}]|[\u{3030}]|[\u{303D}]|[\u{3297}]|[\u{3299}]/gu, '');
  
  // Remove special symbols that sound weird when read aloud
  cleaned = cleaned.replace(/[✅❌💡💰📸📋✏️⚠️•\*#_~`|]/g, '');
  
  // Remove markdown formatting (bold, italic)
  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '$1');
  cleaned = cleaned.replace(/\*(.*?)\*/g, '$1');
  
  // Remove dashes used as list separators
  cleaned = cleaned.replace(/^[\s]*[-–—]+\s*/gm, '');
  cleaned = cleaned.replace(/\s[-–—]{2,}\s/g, ' ');
  
  // Replace currency symbols with spoken words
  cleaned = cleaned.replace(/₹\s*/g, 'रुपये ');
  cleaned = cleaned.replace(/\$/g, 'dollars ');
  
  // Replace colons and newlines with pause markers (will become <break> later)
  cleaned = cleaned.replace(/:\s*/g, '। ');
  cleaned = cleaned.replace(/\n\n+/g, '। ');
  cleaned = cleaned.replace(/\n/g, '। ');
  
  // Clean up multiple spaces and periods
  cleaned = cleaned.replace(/।\s*।/g, '।');
  cleaned = cleaned.replace(/\s+/g, ' ');
  cleaned = cleaned.trim();
  
  if (!cleaned || cleaned.length < 2) {
    return '';
  }
  
  // XML-escape the text BEFORE adding SSML tags
  cleaned = cleaned
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  
  // Replace PAN-like IDs (e.g., ABCDE1234F) with character-by-character reading
  cleaned = cleaned.replace(/\b([A-Z]{5}\d{4}[A-Z])\b/g, '<say-as interpret-as="characters">$1</say-as>');
  
  // Replace phone numbers (10+ digit sequences) with digit-by-digit reading
  cleaned = cleaned.replace(/\b(\d{10,})\b/g, '<say-as interpret-as="digits">$1</say-as>');
  
  // Replace UPI IDs with character reading (e.g., name@upi)
  cleaned = cleaned.replace(/(\S+@\S+)/g, '<say-as interpret-as="characters">$1</say-as>');
  
  // Add natural pauses at sentence boundaries (।)
  cleaned = cleaned.replace(/।\s*/g, '<break time="500ms"/>');
  
  // Add small pause after commas
  cleaned = cleaned.replace(/,\s*/g, '<break time="300ms"/>');
  
  // Wrap in SSML with slow prosody for comfortable listening
  return `<speak><prosody rate="slow">${cleaned}</prosody></speak>`;
}

/**
 * Send text message with voice response
 * Sends both text and voice audio for better accessibility
 */
export async function sendTextWithVoice(
  to: string,
  text: string,
  language: 'hi' | 'mr' | 'en' = 'hi'
): Promise<{ success: boolean; error?: string }> {
  try {
    // Send text message first
    const textResult = await sendTextMessage(to, text, language);
    
    if (!textResult.success) {
      return textResult;
    }

    // Generate and send voice
    await generateAndSendVoice(to, text, language);
    
    return { success: true };
  } catch (error) {
    console.error('Error in sendTextWithVoice:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send voice-only message (no text) - keeps WhatsApp chat clean
 * Used for most agent responses. Text is only sent for visual confirmations.
 */
export async function sendVoiceOnly(
  to: string,
  text: string,
  language: 'hi' | 'mr' | 'en' = 'hi'
): Promise<{ success: boolean; error?: string }> {
  try {
    const sent = await generateAndSendVoice(to, text, language);
    if (!sent) {
      // Fallback to text if voice generation fails
      console.warn('Voice generation failed, falling back to text');
      await sendTextMessage(to, text, language);
    }
    return { success: true };
  } catch (error) {
    console.error('Error in sendVoiceOnly:', error);
    // Always fallback to text on error so user gets something
    try {
      await sendTextMessage(to, text, language);
      return { success: true };
    } catch (fallbackError) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

/**
 * Internal: Generate Polly audio and send as WhatsApp audio message
 */
async function generateAndSendVoice(
  to: string,
  text: string,
  language: 'hi' | 'mr' | 'en'
): Promise<boolean> {
  try {
    const { PollyClient, SynthesizeSpeechCommand } = await import('@aws-sdk/client-polly');
    const { PutObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    
    const pollyClient = new PollyClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const voiceId = language === 'mr' ? 'Aditi' : language === 'hi' ? 'Kajal' : 'Joanna';
    const languageCode = language === 'mr' ? 'hi-IN' : language === 'hi' ? 'hi-IN' : 'en-IN';
    
    // Clean text for voice synthesis
    const cleanedText = cleanTextForVoice(text);
    
    if (!cleanedText || cleanedText.length < 2) {
      return false;
    }
    
    const command = new SynthesizeSpeechCommand({
      Text: cleanedText,
      OutputFormat: 'mp3',
      VoiceId: voiceId,
      Engine: 'neural',
      LanguageCode: languageCode,
      TextType: 'ssml',
    });
    
    const response = await pollyClient.send(command);
    if (response.AudioStream) {
      const chunks: Uint8Array[] = [];
      const stream = response.AudioStream as AsyncIterable<Uint8Array>;
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const audioBuffer = Buffer.concat(chunks);
      
      // Upload to S3
      const { s3Client } = await import('../config/aws-clients');
      const bucketName = process.env.PRODUCTS_BUCKET_NAME;
      if (!bucketName) {
        console.warn('PRODUCTS_BUCKET_NAME not configured, skipping voice');
        return false;
      }
      
      const key = `voice-responses/${Date.now()}-${Math.random().toString(36).substring(7)}.mp3`;
      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: audioBuffer,
        ContentType: 'audio/mpeg',
      }));
      
      // Generate presigned URL
      const getObjectCommand = new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      });
      const voiceUrl = await getSignedUrl(s3Client, getObjectCommand, { expiresIn: 3600 });
      
      // Send voice message
      await sendAudioMessage(to, voiceUrl, language);
      return true;
    }
    return false;
  } catch (voiceError) {
    console.warn('Failed to generate/send voice:', voiceError);
    return false;
  }
}
