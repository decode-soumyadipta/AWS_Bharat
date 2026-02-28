/**
 * Agent Handler Lambda
 * 
 * Unified handler that routes ALL messages through the personal AI agent.
 * No more separate voice/image/confirmation handlers - everything goes through the agent.
 * 
 * The agent:
 * - Maintains full conversation memory
 * - Generates all responses dynamically
 * - Asks clarifying questions
 * - Handles dilemmas interactively
 * - Operates in real-time
 */

import { processWithEnhancedAgent, sendEnhancedAgentMessage } from '../services/enhanced-agent';
import { getUserState, updateUserState } from '../services/state-manager';
import { getPartialData, mergePartialData, deletePartialData } from '../services/partial-data-store';
import { getConversationContext, trackSuccessfulCatalog } from '../services/conversation-memory';
import { sendImageMessage, sendInteractiveMessage } from './whatsapp-message-sender';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { eventBridgeClient } from '../config/aws-clients';
import { EVENT_SOURCES, INTERNAL_EVENT_TYPES } from '../config/event-patterns';

/**
 * Agent handler event
 */
interface AgentHandlerEvent {
  phone: string;
  messageId: string;
  messageType: 'text' | 'voice' | 'image' | 'button_reply';
  content: {
    text?: string;
    mediaUrl?: string;
    buttonPayload?: string;
  };
  language?: 'hi-IN' | 'mr-IN' | 'en-IN';
}

/**
 * Main agent handler
 */
export const handler = async (event: any): Promise<any> => {
  console.log('🤖 Agent handler invoked:', JSON.stringify(event, null, 2));

  try {
    const eventDetail = event.detail || event;
    const { phone, messageType, content, language = 'hi-IN' } = eventDetail;

    if (!phone) {
      throw new Error('Phone number is required');
    }

    // Get user state and context
    const userState = await getUserState(phone);
    const conversationContext = await getConversationContext(phone);
    const partialData = await getPartialData(phone);

    console.log('📊 Current state:', {
      state: userState?.state,
      hasPartialData: !!partialData,
      conversationLength: conversationContext?.messages.length || 0,
    });

    // Handle different message types
    let userMessage = '';
    let shouldProcessWithAgent = true;

    switch (messageType) {
      case 'voice':
        // Voice messages need transcription first
        userMessage = await handleVoiceMessage(eventDetail);
        break;

      case 'image':
        // Image messages
        userMessage = await handleImageMessage(eventDetail, phone, language);
        break;

      case 'button_reply':
        // Button clicks
        userMessage = await handleButtonClick(eventDetail, phone, language);
        shouldProcessWithAgent = content.buttonPayload !== 'approve'; // Skip agent for approve
        break;

      case 'text':
        // Text messages
        userMessage = content.text || '';
        break;

      default:
        throw new Error(`Unknown message type: ${messageType}`);
    }

    if (!userMessage) {
      console.log('⚠️ No user message to process');
      return { success: true };
    }

    // Process with agent
    if (shouldProcessWithAgent) {
      const agentResponse = await processWithEnhancedAgent(
        phone,
        userMessage,
        messageType,
        language
      );

      console.log('🤖 Agent response:', agentResponse);

      // Send agent message
      await sendEnhancedAgentMessage(phone, agentResponse.message, language);

      // Execute agent actions
      if (agentResponse.actions && agentResponse.actions.length > 0) {
        await executeAgentActions(phone, agentResponse.actions, language);
      }
    }

    return {
      success: true,
      message: 'Agent processed successfully',
    };
  } catch (error: any) {
    console.error('❌ Agent handler error:', error);
    
    // Send error message to user
    try {
      const phone = event.detail?.phone || event.phone;
      if (phone) {
        await sendEnhancedAgentMessage(
          phone,
          '😔 माफ़ करें, मुझे कुछ समस्या हो रही है। कृपया फिर से कोशिश करें।',
          'hi-IN'
        );
      }
    } catch (sendError) {
      console.error('Failed to send error message:', sendError);
    }

    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Handle voice message
 */
async function handleVoiceMessage(eventDetail: any): Promise<string> {
  // Import voice transcription
  const { handler: transcriptionHandler } = await import('./voice-transcription');
  
  const transcriptionResult = await transcriptionHandler({
    audioUrl: eventDetail.content.mediaUrl,
    messageId: eventDetail.messageId,
    languageCode: eventDetail.language,
  });

  if (!transcriptionResult.success || !transcriptionResult.transcription) {
    throw new Error('Voice transcription failed');
  }

  return transcriptionResult.transcription;
}

/**
 * Handle image message
 */
async function handleImageMessage(
  eventDetail: any,
  phone: string,
  language: string
): Promise<string> {
  const partialData = await getPartialData(phone);

  if (!partialData) {
    return 'मैंने फोटो भेजी है';
  }

  // Download and enhance image
  const { downloadImage } = await import('../services/media-download');
  const { handler: enhancementHandler } = await import('./image-enhancement');

  const bucketName = process.env.PRODUCTS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('PRODUCTS_BUCKET_NAME not configured');
  }

  // Download image
  const downloadResult = await downloadImage(eventDetail.content.mediaUrl, bucketName);
  if (!downloadResult.success || !downloadResult.s3Url) {
    throw new Error('Image download failed');
  }

  // Store original image URL
  await mergePartialData(phone, {
    originalImageUrl: downloadResult.s3Url,
  });

  // Enhance image (background removal)
  try {
    const enhancementResult = await enhancementHandler({
      rawImageUrl: downloadResult.s3Url,
      productName: partialData.productName || 'Product',
      productCategory: partialData.category,
      itemId: `${phone}-${Date.now()}`,
      sellerId: phone,
    });

    if (enhancementResult.success && enhancementResult.enhancedImageUrl) {
      await mergePartialData(phone, {
        enhancedImageUrl: enhancementResult.enhancedImageUrl,
      });
    }
  } catch (error) {
    console.error('Image enhancement failed, using original:', error);
  }

  return 'मैंने उत्पाद की फोटो भेजी है';
}

/**
 * Handle button click
 */
async function handleButtonClick(
  eventDetail: any,
  phone: string,
  language: string
): Promise<string> {
  const buttonPayload = eventDetail.content.buttonPayload;

  // Convert button clicks to natural language messages for enhanced agent processing
  let userMessage = '';
  
  switch (buttonPayload) {
    case 'approve':
      userMessage = 'I want to approve and create the catalog';
      // Create catalog directly
      await createCatalog(phone, language);
      break;

    case 'edit_quantity':
      userMessage = 'I want to edit the quantity';
      break;

    case 'view_products':
      userMessage = 'I want to view my products';
      break;

    default:
      userMessage = `Button clicked: ${buttonPayload}`;
  }

  // Process button click through enhanced agent for consistent experience
  const agentResponse = await processWithEnhancedAgent(phone, userMessage, 'text', language as any);
  return agentResponse.message;
}

/**
 * Execute agent actions
 */
async function executeAgentActions(
  phone: string,
  actions: any[],
  language: string
): Promise<void> {
  for (const action of actions) {
    console.log('🎬 Executing action:', action.type);

    switch (action.type) {
      case 'REQUEST_IMAGE':
        await updateUserState(phone, 'IMAGE_PENDING');
        break;

      case 'CREATE_CATALOG':
        await createCatalog(phone, language);
        break;

      case 'STORE_DATA':
        if (action.data) {
          await mergePartialData(phone, action.data);
        }
        break;

      default:
        console.log('⚠️ Unknown action type:', action.type);
    }
  }
}

/**
 * Create catalog
 */
async function createCatalog(phone: string, language: string): Promise<void> {
  const partialData = await getPartialData(phone);

  if (!partialData) {
    throw new Error('No partial data found');
  }

  // Publish catalog build event
  const catalogBuilderEvent = {
    Source: EVENT_SOURCES.INTERNAL,
    DetailType: INTERNAL_EVENT_TYPES.CATALOG_BUILD_REQUESTED,
    Detail: JSON.stringify({
      entities: {
        product_name: partialData.productName,
        price: partialData.price,
        quantity: partialData.quantity,
        unit: partialData.unit,
        category: partialData.category || 'other',
        description: partialData.description,
      },
      phone,
      language,
      imageUrl: partialData.enhancedImageUrl || partialData.originalImageUrl,
    }),
    EventBusName: process.env.EVENT_BUS_NAME,
  };

  await eventBridgeClient.send(
    new PutEventsCommand({
      Entries: [catalogBuilderEvent],
    })
  );

  console.log('✅ Published catalog build event');

  // Update state and clean up
  await updateUserState(phone, 'ACTIVE');
  await deletePartialData(phone);
  await trackSuccessfulCatalog(phone);

  // Send success message via agent
  const lang = language.split('-')[0] as 'hi' | 'mr' | 'en';
  const successMsg = lang === 'hi'
    ? '🎉 बहुत बढ़िया! आपका उत्पाद सफलतापूर्वक जोड़ा गया है। अब यह ऑनलाइन बिक्री के लिए तैयार है!'
    : lang === 'mr'
    ? '🎉 खूप छान! तुमचे उत्पादन यशस्वीरित्या जोडले गेले आहे. आता ते ऑनलाइन विक्रीसाठी तयार आहे!'
    : '🎉 Excellent! Your product has been successfully added. It\'s now ready for online sale!';

  await sendEnhancedAgentMessage(phone, successMsg, language as any);
}
