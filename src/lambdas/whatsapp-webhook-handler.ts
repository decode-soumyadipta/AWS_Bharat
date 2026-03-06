
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { eventBridgeClient, EVENT_BUS_NAME } from '../config/aws-clients';
import { EVENT_SOURCES, WHATSAPP_EVENT_TYPES } from '../config/event-patterns';
import { WhatsAppInboundEvent, WhatsAppEventDetail } from '../models/whatsapp';
import { getUserState, initializeNewUser, UserState } from '../services/state-manager';
import { route, MessageType } from '../services/state-router';
import { sendTextMessage, sendTypingIndicator, markMessageAsRead, setLastMessageId } from './whatsapp-message-sender';
import crypto from 'crypto';

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

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    console.error('Error validating webhook signature:', error);
    return false;
  }
}

function parseWhatsAppMessage(body: any): WhatsAppInboundEvent {

  const entry = body.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  if (value?.statuses && !value?.messages) {
    throw new Error('Status update - not a message');
  }

  const message = value?.messages?.[0];
  const contact = value?.contacts?.[0];

  if (!message) {
    throw new Error('No message found in webhook payload');
  }

  return {
    messageId: message.id || crypto.randomUUID(),
    from: message.from,
    timestamp: parseInt(message.timestamp) * 1000 || Date.now(), 
    type: message.type || 'text',
    content: {
      text: message.text?.body,
      mediaUrl: message.image?.id || message.audio?.id || message.video?.id,
      mimeType: message.image?.mime_type || message.audio?.mime_type || message.video?.mime_type,
      buttonPayload: message.button?.payload || message.interactive?.button_reply?.id,
      buttonTitle: message.interactive?.button_reply?.title,
    },
    profile: {
      name: contact?.profile?.name || message.from,
      language: undefined, 
    },
  };
}

function determineMessageType(message: any): 'text' | 'audio' | 'image' | 'button_reply' {
  console.log('Determining message type for:', JSON.stringify(message, null, 2));

  if (message.type === 'interactive' || message.content?.buttonPayload) {
    console.log('Detected button_reply');
    return 'button_reply';
  }

  if (message.type === 'audio' || message.audio || (message.content?.mimeType && message.content.mimeType.startsWith('audio/'))) {
    console.log('Detected audio');
    return 'audio';
  }

  if (message.type === 'image' || message.image || (message.content?.mimeType && message.content.mimeType.startsWith('image/'))) {
    console.log('Detected image');
    return 'image';
  }

  console.log('Defaulting to text');
  return 'text';
}

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

async function publishToEventBridge(
  inboundEvent: WhatsAppInboundEvent,
  userState: UserState,
  routeDecision: { handler: string; action: string; metadata?: Record<string, any> }
): Promise<void> {
  const eventDetail: WhatsAppEventDetail = {
    messageId: inboundEvent.messageId,
    phone: inboundEvent.from,
    timestamp: inboundEvent.timestamp,
    messageType: inboundEvent.type,
    content: inboundEvent.content,
    profile: inboundEvent.profile,

    state: userState.state,
    handler: routeDecision.handler,
    language: userState.language,
  };

  const detailType = getEventDetailType(inboundEvent.type);

  console.log('Publishing event to EventBridge:', {
    messageId: inboundEvent.messageId,
    phone: inboundEvent.from,
    messageType: inboundEvent.type,
    state: userState.state,
    handler: routeDecision.handler,
    detailType: detailType,
    source: EVENT_SOURCES.WHATSAPP,
  });

  if (inboundEvent.type === 'button_reply') {
    console.log('🔘 BUTTON CLICK DETECTED:', {
      buttonPayload: inboundEvent.content.buttonPayload,
      buttonTitle: inboundEvent.content.buttonTitle,
      userState: userState.state,
      targetHandler: routeDecision.handler,
      willTriggerConfirmationHandler: routeDecision.handler === 'CONFIRMATION' && userState.state === 'CONFIRMATION_PENDING',
      eventPattern: {
        source: EVENT_SOURCES.WHATSAPP,
        detailType: detailType,
        'detail.messageType': inboundEvent.type,
        'detail.state': userState.state,
        'detail.handler': routeDecision.handler,
      },
    });
  }

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

    console.log('✅ Successfully published event to EventBridge:', {
      messageId: inboundEvent.messageId,
      detailType,
      phone: inboundEvent.from,
      state: userState.state,
      handler: routeDecision.handler,
    });

    if (inboundEvent.type === 'button_reply') {
      console.log('✅ Button click event published successfully - confirmation-handler should be invoked');
    }
  } catch (error) {
    console.error('❌ Error publishing to EventBridge:', error);

    if (inboundEvent.type === 'button_reply') {
      console.error('❌ CRITICAL: Button click event failed to publish - confirmation-handler will NOT be invoked');
    }

    throw error;
  }
}

async function sendGuidanceMessage(phone: string, guidanceMessage: string): Promise<void> {
  try {

    const { sendTextWithVoice } = await import('./whatsapp-message-sender');

    await sendTextWithVoice(phone, guidanceMessage, 'hi');

    console.log('Sent guidance message with voice to user:', phone);
  } catch (error) {
    console.error('Error sending guidance message:', error);

  }
}

export async function handler(
  event: any
): Promise<APIGatewayProxyResult> {
  console.log('Received WhatsApp webhook:', JSON.stringify(event, null, 2));

  try {

    const httpMethod = event.requestContext?.http?.method || event.httpMethod;

    if (httpMethod === 'GET') {
      const verifyToken = event.queryStringParameters?.['hub.verify_token'];
      const challenge = event.queryStringParameters?.['hub.challenge'];
      const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

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

    if (httpMethod === 'POST') {
      const webhookSecret = process.env.WEBHOOK_SECRET;

      if (webhookSecret) {
        const signature = event.headers['x-hub-signature-256'] || event.headers['X-Hub-Signature-256'];
        const isValid = validateWebhookSignature(event.body || '', signature, webhookSecret);

        if (!isValid) {
          console.warn('Invalid webhook signature');
          return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Invalid signature' }),
          };
        }
      } else {
        console.warn('WEBHOOK_SECRET not configured - skipping signature validation');
      }

      const body = JSON.parse(event.body || '{}');

      let inboundEvent;
      try {
        inboundEvent = parseWhatsAppMessage(body);
      } catch (error: any) {

        if (error.message.includes('Status update')) {
          console.log('Received status update, ignoring');
          return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: 'Status update received' }),
          };
        }
        throw error; 
      }

      console.log('Parsed WhatsApp message:', {
        messageId: inboundEvent.messageId,
        from: inboundEvent.from,
        type: inboundEvent.type,
      });

      try {
        setLastMessageId(inboundEvent.from, inboundEvent.messageId);
        const typingResult = await markMessageAsRead(inboundEvent.messageId, true);
        console.log('✅ Typing indicator + mark-as-read result:', JSON.stringify(typingResult));
      } catch (typingErr) {
        console.warn('⚠️ Typing indicator failed (non-blocking):', typingErr);
      }

      const actualMessageType = determineMessageType(inboundEvent);
      console.log('Actual message type determined:', actualMessageType);

      inboundEvent.type = actualMessageType;

      let userState = await getUserState(inboundEvent.from);

      if (!userState) {
        console.log('New user detected, initializing state:', inboundEvent.from);
        const profileName = inboundEvent.profile?.name || undefined;
        userState = await initializeNewUser(inboundEvent.from, profileName);
      }

      console.log('User state:', {
        phone: userState.phone,
        state: userState.state,
        language: userState.language,
      });

      const routeDecision = route(inboundEvent.type as MessageType, userState);

      console.log('Route decision:', {
        handler: routeDecision.handler,
        action: routeDecision.action,
        metadata: routeDecision.metadata,
      });

      if (routeDecision.handler === 'ERROR') {
        const guidanceMessage = routeDecision.metadata?.guidanceMessage;

        if (guidanceMessage) {
          await sendGuidanceMessage(inboundEvent.from, guidanceMessage);
        }

        console.log('Sent error guidance to user:', {
          phone: inboundEvent.from,
          currentState: userState.state,
          receivedMessageType: inboundEvent.type,
        });

        return {
          statusCode: 200,
          body: JSON.stringify({ 
            success: true, 
            messageId: inboundEvent.messageId,
            action: 'guidance_sent',
          }),
        };
      }

      await publishToEventBridge(inboundEvent, userState, routeDecision);

      return {
        statusCode: 200,
        body: JSON.stringify({ 
          success: true, 
          messageId: inboundEvent.messageId,
          handler: routeDecision.handler,
        }),
      };
    }

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
