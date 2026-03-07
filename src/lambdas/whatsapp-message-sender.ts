
import { WhatsAppOutboundMessage } from '../models/whatsapp';

const MAX_RETRY_ATTEMPTS = 5;
const INITIAL_RETRY_DELAY_MS = 1000; 
const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000; 

function getWhatsAppConfig() {
  return {
    endpoint: process.env.WHATSAPP_API_ENDPOINT || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
  };
}

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

export async function markMessageAsRead(
  messageId: string,
  showTypingIndicator: boolean = false
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

    if (showTypingIndicator) {
      payload.typing_indicator = { type: 'text' };
    }

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

    alreadyReadMessageIds.add(messageId);

    let parsed;
    try { parsed = JSON.parse(responseBody); } catch { parsed = responseBody; }
    return { success: true, data: parsed };
  } catch (error) {
    console.warn('Error marking message as read:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

const lastMessageIdByPhone: Record<string, string> = {};

const alreadyReadMessageIds: Set<string> = new Set();

export { alreadyReadMessageIds as _alreadyReadMessageIds };

export function setLastMessageId(phone: string, messageId: string): void {
  lastMessageIdByPhone[phone] = messageId;
}

/**
 * Send typing indicator via WhatsApp Cloud API.
 * WhatsApp requires typing_indicator to be bundled with the mark-as-read payload.
 * Re-sending mark-as-read on already-read messages is harmless and still triggers typing.
 */
export async function sendTypingIndicator(
  to: string,
  messageId?: string
): Promise<{ success: boolean; error?: string }> {
  const msgId = messageId || lastMessageIdByPhone[to];
  if (!msgId) {
    console.warn('⌨️ No message ID available for typing indicator, skipping');
    return { success: false, error: 'No message ID available' };
  }

  console.log('⌨️ Sending typing indicator to:', to, 'via mark-as-read with messageId:', msgId);
  const result = await markMessageAsRead(msgId, true);
  return { success: result.success, error: result.error };
}

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

export async function sendDocumentMessage(
  to: string,
  documentUrl: string,
  filename: string,
  caption?: string,
  language: 'hi' | 'mr' | 'en' = 'en'
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const message: WhatsAppOutboundMessage = {
    to,
    type: 'document',
    content: {
      documentUrl,
      documentFilename: filename,
      text: caption,
    },
    language,
  };

  return sendMessageWithRetry(message);
}

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

    const isRetryable = result.statusCode && (
      result.statusCode >= 500 ||  
      result.statusCode === 429     
    );

    if (isRetryable && attempt < MAX_RETRY_ATTEMPTS) {
      const delay = calculateRetryDelay(attempt);
      console.log(`Message send failed, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`);

      await sleep(delay);
      return sendMessageWithRetry(message, attempt + 1);
    }

    if (attempt >= MAX_RETRY_ATTEMPTS) {
      return {
        success: false,
        error: 'Max retry attempts exceeded',
      };
    }

    return result;
  } catch (error) {
    console.error('Error sending message:', error);

    if (isRetryableError(error) && attempt < MAX_RETRY_ATTEMPTS) {
      const delay = calculateRetryDelay(attempt);
      console.log(`Retrying after error in ${delay}ms (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`);

      await sleep(delay);
      return sendMessageWithRetry(message, attempt + 1);
    }

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

function calculateRetryDelay(attempt: number): number {
  const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

function isRetryableError(error: any): boolean {

  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
    return true;
  }

  if (error.statusCode >= 500 && error.statusCode < 600) {
    return true;
  }

  if (error.statusCode === 429) {
    return true;
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendMessage(
  message: WhatsAppOutboundMessage
): Promise<{ success: boolean; messageId?: string; error?: string; statusCode?: number }> {

  const config = getWhatsAppConfig();

  if (!config.endpoint || !config.phoneNumberId || !config.accessToken) {
    throw new Error('WhatsApp API configuration missing');
  }

  const payload = constructWhatsAppPayload(message);

  try {

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
                title: button.title.substring(0, 20), 
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

    case 'document':
      return {
        ...basePayload,
        type: 'document',
        document: {
          link: message.content.documentUrl,
          filename: message.content.documentFilename || 'report.pdf',
          caption: message.content.text,
        },
      };

    default:
      throw new Error(`Unsupported message type: ${message.type}`);
  }
}

export async function handler(event: any): Promise<any> {
  console.log('WhatsApp message sender invoked:', JSON.stringify(event, null, 2));

  try {

    if (event.detail && event['detail-type'] === 'voice.image_request.needed') {
      const { phone, language = 'hi-IN' } = event.detail;
      const langCode = language.split('-')[0] as 'hi' | 'mr' | 'en';

      const hindiText = '📸 कृपया उत्पाद की फोटो भेजें';
      const englishText = '📸 Please send product photo';
      const bilingualText = `${hindiText}\n\n${englishText}`;

      const result = await sendTextMessage(phone, bilingualText, langCode);
      return {
        statusCode: result.success ? 200 : 500,
        body: JSON.stringify(result),
      };
    }

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

      case 'document':
        if (!content?.documentUrl) {
          throw new Error('Document URL is required for document messages');
        }
        result = await sendDocumentMessage(to, content.documentUrl, content.documentFilename || 'report.pdf', content.text, language);
        break;

      case 'voice':

        if (!content?.text) {
          throw new Error('Text content is required for voice messages');
        }
        await sendVoiceOnly(to, content.text, language as 'hi' | 'mr' | 'en');
        result = { success: true };
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

export function getMessageTemplates(language: 'hi' | 'mr' | 'en') {
  return MESSAGE_TEMPLATES[language];
}

function cleanTextForVoice(text: string): string {

  let cleaned = text.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F000}-\u{1F02F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2300}-\u{23FF}]|[\u{2B50}]|[\u{2B55}]|[\u{231A}]|[\u{231B}]|[\u{23E9}-\u{23EC}]|[\u{23F0}]|[\u{23F3}]|[\u{25FD}]|[\u{25FE}]|[\u{2614}]|[\u{2615}]|[\u{2648}-\u{2653}]|[\u{267F}]|[\u{2693}]|[\u{26A1}]|[\u{26AA}]|[\u{26AB}]|[\u{26BD}]|[\u{26BE}]|[\u{26C4}]|[\u{26C5}]|[\u{26CE}]|[\u{26D4}]|[\u{26EA}]|[\u{26F2}]|[\u{26F3}]|[\u{26F5}]|[\u{26FA}]|[\u{26FD}]|[\u{2705}]|[\u{270A}]|[\u{270B}]|[\u{2728}]|[\u{274C}]|[\u{274E}]|[\u{2753}-\u{2755}]|[\u{2757}]|[\u{2795}-\u{2797}]|[\u{27B0}]|[\u{27BF}]|[\u{2B1B}]|[\u{2B1C}]|[\u{3030}]|[\u{303D}]|[\u{3297}]|[\u{3299}]/gu, '');

  cleaned = cleaned.replace(/[✅❌💡💰📸📋✏️⚠️•\*#_~`|]/g, '');

  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '$1');
  cleaned = cleaned.replace(/\*(.*?)\*/g, '$1');

  cleaned = cleaned.replace(/^[\s]*[-–—]+\s*/gm, '');
  cleaned = cleaned.replace(/\s[-–—]{2,}\s/g, ' ');

  cleaned = cleaned.replace(/₹\s*/g, 'रुपये ');
  cleaned = cleaned.replace(/\$/g, 'dollars ');

  cleaned = cleaned.replace(/:\s*/g, '। ');
  cleaned = cleaned.replace(/\n\n+/g, '। ');
  cleaned = cleaned.replace(/\n/g, '। ');

  cleaned = cleaned.replace(/।\s*।/g, '।');
  cleaned = cleaned.replace(/\s+/g, ' ');
  cleaned = cleaned.trim();

  if (!cleaned || cleaned.length < 2) {
    return '';
  }

  cleaned = cleaned
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  cleaned = cleaned.replace(/\b([A-Z]{5}\d{4}[A-Z])\b/g, '<say-as interpret-as="characters">$1</say-as>');

  cleaned = cleaned.replace(/\b(\d{10,})\b/g, '<say-as interpret-as="digits">$1</say-as>');

  cleaned = cleaned.replace(/(\S+@\S+)/g, '<say-as interpret-as="characters">$1</say-as>');

  cleaned = cleaned.replace(/।\s*/g, '<break time="500ms"/>');

  cleaned = cleaned.replace(/,\s*/g, '<break time="300ms"/>');

  return `<speak><prosody rate="slow">${cleaned}</prosody></speak>`;
}

export async function sendTextWithVoice(
  to: string,
  text: string,
  language: 'hi' | 'mr' | 'en' = 'hi'
): Promise<{ success: boolean; error?: string }> {
  try {

    const textResult = await sendTextMessage(to, text, language);

    if (!textResult.success) {
      return textResult;
    }

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

export async function sendVoiceOnly(
  to: string,
  text: string,
  language: 'hi' | 'mr' | 'en' = 'hi'
): Promise<{ success: boolean; error?: string }> {
  try {
    const sent = await generateAndSendVoice(to, text, language);
    if (!sent) {

      console.warn('Voice generation failed, falling back to text');
      await sendTextMessage(to, text, language);
    }
    return { success: true };
  } catch (error) {
    console.error('Error in sendVoiceOnly:', error);

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

async function generateAndSendVoice(
  to: string,
  text: string,
  language: 'hi' | 'mr' | 'en'
): Promise<boolean> {
  try {
    const { PollyClient, SynthesizeSpeechCommand } = await import('@aws-sdk/client-polly');
    const { PutObjectCommand, GetObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const { createHash } = await import('crypto');

    const pollyClient = new PollyClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const voiceId = language === 'mr' ? 'Aditi' : language === 'hi' ? 'Kajal' : 'Joanna';
    const languageCode = language === 'mr' ? 'hi-IN' : language === 'hi' ? 'hi-IN' : 'en-IN';

    const cleanedText = cleanTextForVoice(text);

    if (!cleanedText || cleanedText.length < 2) {
      return false;
    }

    const cacheDigest = createHash('sha256').update(`${cleanedText}|${voiceId}|${languageCode}`).digest('hex').substring(0, 32);
    const { s3Client } = await import('../config/aws-clients');
    const bucketName = process.env.PRODUCTS_BUCKET_NAME;
    if (!bucketName) {
      console.warn('PRODUCTS_BUCKET_NAME not configured, skipping voice');
      return false;
    }

    const cacheKey = `voice-responses/cache-${cacheDigest}.mp3`;

    let audioExists = false;
    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: cacheKey }));
      audioExists = true;
      console.log(`🔊 TTS cache hit: ${cacheKey}`);
    } catch {

      audioExists = false;
    }

    if (!audioExists) {
      const command = new SynthesizeSpeechCommand({
        Text: cleanedText,
        OutputFormat: 'mp3',
        VoiceId: voiceId,
        Engine: 'neural',
        LanguageCode: languageCode,
        TextType: 'ssml',
      });

      const response = await pollyClient.send(command);
      if (!response.AudioStream) return false;

      const chunks: Uint8Array[] = [];
      const stream = response.AudioStream as AsyncIterable<Uint8Array>;
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const audioBuffer = Buffer.concat(chunks);

      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: cacheKey,
        Body: audioBuffer,
        ContentType: 'audio/mpeg',
      }));
      console.log(`🔊 TTS cache miss — synthesized and stored: ${cacheKey}`);
    }

    const getObjectCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: cacheKey,
    });
    const voiceUrl = await getSignedUrl(s3Client, getObjectCommand, { expiresIn: 3600 });

    await sendAudioMessage(to, voiceUrl, language);
    return true;
  } catch (voiceError) {
    console.warn('Failed to generate/send voice:', voiceError);
    return false;
  }
}
