/**
 * WhatsApp Webhook Handler Lambda
 * 
 * This Lambda function receives incoming WhatsApp messages from AWS End User Messaging (Social),
 * validates webhook signatures, parses message content, and publishes events to EventBridge.
 * 
 * Requirements: 2.1, 5.3
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { eventBridgeClient, EVENT_BUS_NAME } from '../config/aws-clients';
import { EVENT_SOURCES, WHATSAPP_EVENT_TYPES } from '../config/event-patterns';
import { WhatsAppInboundEvent, WhatsAppEventDetail } from '../models/whatsapp';
import crypto from 'crypto';

/**
 * Validates the webhook signature from AWS End User Messaging
 * 
 * @param payload - The raw request body
 * @param signature - The signature from the request headers
 * @param secret - The webhook secret configured in AWS End User Messaging
 * @returns true if signature is valid, false otherwise
 */
function validateWebhookSignature(
  payload: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) {
    console.warn('No signature provided in webhook request');
    return false;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    console.error('Error validating webhook signature:', error);
    return false;
  }
}

/**
 * Parses incoming WhatsApp message and extracts relevant metadata
 * 
 * @param body - The parsed request body
 * @returns Parsed WhatsApp inbound event
 */
function parseWhatsAppMessage(body: any): WhatsAppInboundEvent {
  // Extract message details from AWS End User Messaging webhook payload
  const message = body.message || body;
  
  return {
    messageId: message.id || message.messageId || crypto.randomUUID(),
    from: message.from || message.sender,
    timestamp: message.timestamp || Date.now(),
    type: message.type || determineMessageType(message),
    content: {
      text: message.text?.body || message.content?.text,
      mediaUrl: message.image?.url || message.audio?.url || message.content?.mediaUrl,
      mimeType: message.image?.mime_type || message.audio?.mime_type || message.content?.mimeType,
      buttonPayload: message.button?.payload || message.content?.buttonPayload,
    },
    profile: {
      name: message.profile?.name || message.from,
      language: message.profile?.language,
    },
  };
}

/**
 * Determines message type from message content
 */
function determineMessageType(message: any): 'text' | 'audio' | 'image' | 'button_reply' {
  if (message.button || message.content?.buttonPayload) {
    return 'button_reply';
  }
  if (message.audio || (message.content?.mimeType && message.content.mimeType.startsWith('audio/'))) {
    return 'audio';
  }
  if (message.image || (message.content?.mimeType && message.content.mimeType.startsWith('image/'))) {
    return 'image';
  }
  return 'text';
}

/**
 * Maps message type to EventBridge detail-type
 */
function getEventDetailType(messageType: string): string {
  switch (messageType) {
    case 'audio':
      return WHATSAPP_EVENT_TYPES.MESSAGE_RECEIVED_VOICE;
    case 'image':
      return WHATSAPP_EVENT_TYPES.MESSAGE_RECEIVED_IMAGE;
    case 'button_reply':
      return WHATSAPP_EVENT_TYPES.BUTTON_CLICKED;
    case 'text':
    default:
      return WHATSAPP_EVENT_TYPES.MESSAGE_RECEIVED_TEXT;
  }
}

/**
 * Publishes WhatsApp message event to EventBridge
 * 
 * @param inboundEvent - The parsed WhatsApp message
 */
async function publishToEventBridge(inboundEvent: WhatsAppInboundEvent): Promise<void> {
  const eventDetail: WhatsAppEventDetail = {
    messageId: inboundEvent.messageId,
    phone: inboundEvent.from,
    timestamp: inboundEvent.timestamp,
    messageType: inboundEvent.type,
    content: inboundEvent.content,
    profile: inboundEvent.profile,
  };

  const detailType = getEventDetailType(inboundEvent.type);

  const command = new PutEventsCommand({
    Entries: [
      {
        Source: EVENT_SOURCES.WHATSAPP,
        DetailType: detailType,
        Detail: JSON.stringify(eventDetail),
        EventBusName: EVENT_BUS_NAME,
        Time: new Date(inboundEvent.timestamp),
      },
    ],
  });

  try {
    const response = await eventBridgeClient.send(command);
    
    if (response.FailedEntryCount && response.FailedEntryCount > 0) {
      console.error('Failed to publish event to EventBridge:', response.Entries);
      throw new Error('Failed to publish event to EventBridge');
    }

    console.log('Successfully published event to EventBridge:', {
      messageId: inboundEvent.messageId,
      detailType,
      phone: inboundEvent.from,
    });
  } catch (error) {
    console.error('Error publishing to EventBridge:', error);
    throw error;
  }
}

/**
 * Lambda handler for WhatsApp webhook
 */
export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log('Received WhatsApp webhook:', JSON.stringify(event, null, 2));

  try {
    // Handle webhook verification (GET request)
    if (event.httpMethod === 'GET') {
      const verifyToken = event.queryStringParameters?.['hub.verify_token'];
      const challenge = event.queryStringParameters?.['hub.challenge'];
      const expectedToken = process.env.WEBHOOK_VERIFY_TOKEN;

      if (verifyToken === expectedToken && challenge) {
        console.log('Webhook verification successful');
        return {
          statusCode: 200,
          body: challenge,
        };
      } else {
        console.warn('Webhook verification failed');
        return {
          statusCode: 403,
          body: JSON.stringify({ error: 'Verification failed' }),
        };
      }
    }

    // Handle incoming messages (POST request)
    if (event.httpMethod === 'POST') {
      const webhookSecret = process.env.WEBHOOK_SECRET;
      
      if (!webhookSecret) {
        console.error('WEBHOOK_SECRET environment variable not set');
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Server configuration error' }),
        };
      }

      // Validate webhook signature
      const signature = event.headers['x-hub-signature-256'] || event.headers['X-Hub-Signature-256'];
      const isValid = validateWebhookSignature(event.body || '', signature, webhookSecret);

      if (!isValid) {
        console.warn('Invalid webhook signature');
        return {
          statusCode: 401,
          body: JSON.stringify({ error: 'Invalid signature' }),
        };
      }

      // Parse the message
      const body = JSON.parse(event.body || '{}');
      const inboundEvent = parseWhatsAppMessage(body);

      console.log('Parsed WhatsApp message:', {
        messageId: inboundEvent.messageId,
        from: inboundEvent.from,
        type: inboundEvent.type,
      });

      // Publish to EventBridge
      await publishToEventBridge(inboundEvent);

      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, messageId: inboundEvent.messageId }),
      };
    }

    // Unsupported HTTP method
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  } catch (error) {
    console.error('Error processing WhatsApp webhook:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}
