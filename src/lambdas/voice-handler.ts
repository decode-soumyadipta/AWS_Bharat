/**
 * Voice Handler Lambda
 * 
 * Orchestrates the complete voice message processing pipeline:
 * 1. Downloads audio from WhatsApp
 * 2. Uploads to S3 for transcription
 * 3. Calls voice-transcription Lambda
 * 4. Stores detected language in user profile
 * 5. Passes transcribed text to intent-classification Lambda
 * 6. Passes to entity-extraction Lambda
 * 7. Merges entities with partial data
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
 */

import { InvokeCommand } from '@aws-sdk/client-lambda';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { lambdaClient, eventBridgeClient } from '../config/aws-clients';
import { downloadAudio } from '../services/media-download';
import { getUserState, updateUserState } from '../services/state-manager';
import { getPartialData, mergePartialData, isPartialDataComplete } from '../services/partial-data-store';
import { storeLanguagePreference, detectLanguage } from '../services/language-manager';
import { EVENT_SOURCES, INTERNAL_EVENT_TYPES } from '../config/event-patterns';
import { 
  addConversationMessage, 
  getConversationContext, 
  generateContextualGreeting,
  generateContextualResponse,
  updateUserPreferences
} from '../services/conversation-memory';

/**
 * Voice handler event from WhatsApp webhook
 */
interface VoiceHandlerEvent {
  phone: string;
  messageId: string;
  mediaId: string;
  state?: {
    state: string;
    language?: 'hi-IN' | 'mr-IN' | 'en-IN';
  };
}

/**
 * Voice handler response
 */
interface VoiceHandlerResponse {
  success: boolean;
  transcription?: string;
  detectedLanguage?: string;
  entities?: Record<string, any>;
  missingFields?: string[];
  nextAction?: 'REQUEST_INFO' | 'REQUEST_IMAGE' | 'ERROR';
  error?: string;
}

/**
 * Lambda handler for voice message processing
 */
export const handler = async (
  event: any
): Promise<VoiceHandlerResponse> => {
  console.log('Voice handler request:', JSON.stringify(event, null, 2));

  try {
    // Parse event (handle both direct invocation and EventBridge formats)
    const { phone, messageId, mediaId, state } = parseEvent(event);

    console.log('Processing voice message:', { phone, messageId, mediaId });

    // Check if user is in CONFIRMATION_PENDING state
    const currentState = await getUserState(phone);
    
    // If in CONFIRMATION_PENDING, don't reset - allow price updates
    if (currentState && currentState.state === 'CONFIRMATION_PENDING') {
      console.log('User in CONFIRMATION_PENDING - checking if this is a price update or new order');
      // Don't reset state yet - let intent classification determine if it's UPDATE_PRICE or CREATE_CATALOG
    } else if (currentState && currentState.state === 'ACTIVE') {
      // User starting new order from ACTIVE state - this is fine
      console.log('User in ACTIVE state, starting new order');
    }

    // Step 1: Download audio from WhatsApp
    const bucketName = process.env.PRODUCTS_BUCKET_NAME;
    if (!bucketName) {
      throw new Error('PRODUCTS_BUCKET_NAME not configured');
    }

    console.log('Downloading audio from WhatsApp...');
    const downloadResult = await downloadAudio(mediaId, bucketName);

    if (!downloadResult.success || !downloadResult.s3Url) {
      throw new Error(downloadResult.error || 'Failed to download audio');
    }

    console.log('Audio downloaded successfully:', downloadResult.s3Url);

    // Step 2: Call voice-transcription Lambda
    console.log('Invoking voice-transcription Lambda...');
    const transcriptionResult = await invokeVoiceTranscription({
      audioUrl: downloadResult.s3Url,
      messageId,
      languageCode: state?.language,
    });

    if (!transcriptionResult.success || !transcriptionResult.transcription) {
      throw new Error(transcriptionResult.error?.message || 'Transcription failed');
    }

    const { transcription, detectedLanguage } = transcriptionResult;
    console.log('Transcription successful:', {
      text: transcription.substring(0, 100),
      detectedLanguage,
    });

    // Track user message in conversation history
    await addConversationMessage(phone, {
      timestamp: Date.now(),
      role: 'user',
      content: transcription,
      messageType: 'voice',
    });

    // Get conversation context for personalized responses
    const conversationContext = await getConversationContext(phone);

    // Step 3: Store detected language in user profile
    if (detectedLanguage) {
      console.log('Storing language preference:', detectedLanguage);
      await storeLanguagePreference(phone, detectedLanguage as 'hi-IN' | 'mr-IN' | 'en-IN');
    }

    // Step 4: Call intent-classification Lambda
    console.log('Invoking intent-classification Lambda...');
    const intentResult = await invokeIntentClassification({
      transcribedText: transcription,
      phoneNumber: phone,
      messageId,
    });

    if (!intentResult.success || !intentResult.intent) {
      throw new Error(intentResult.error?.message || 'Intent classification failed');
    }

    const { intent, confidence } = intentResult;
    console.log('Intent classified:', { intent, confidence });

    // Check if user is trying to update multiple things or start new order during confirmation
    if (currentState && currentState.state === 'CONFIRMATION_PENDING') {
      // Check if transcription contains multiple intents (price AND quantity, or new product)
      const lowerText = transcription.toLowerCase();
      const hasPrice = lowerText.includes('price') || lowerText.includes('कीमत') || lowerText.includes('किंमत') || /\d+\s*(rupee|रुपये|रुपया)/.test(lowerText);
      const hasQuantity = lowerText.includes('quantity') || lowerText.includes('मात्रा') || lowerText.includes('प्रमाण');
      const hasNewProduct = lowerText.includes('new') || lowerText.includes('नया') || lowerText.includes('नवीन') || lowerText.includes('add') || lowerText.includes('जोड़');
      
      // If multiple updates or new product mentioned, ask for clarification
      if ((hasPrice && hasQuantity) || (hasNewProduct && (intent === 'UPDATE_PRICE' || intent === 'UPDATE_QUANTITY'))) {
        console.log('Multiple intents detected, asking for clarification');
        
        const clarificationMsg = detectedLanguage === 'hi-IN'
          ? 'क्या आप नया ऑर्डर शुरू करना चाहते हैं या मौजूदा ऑर्डर में बदलाव करना चाहते हैं? कृपया बताएं।'
          : detectedLanguage === 'mr-IN'
          ? 'तुम्हाला नवीन ऑर्डर सुरू करायची आहे की सध्याच्या ऑर्डरमध्ये बदल करायचा आहे? कृपया सांगा.'
          : 'Do you want to start a new order or modify the current order? Please clarify.';
        
        const { sendTextMessage } = await import('./whatsapp-message-sender');
        await sendTextMessage(phone, clarificationMsg, detectedLanguage?.split('-')[0] as 'hi' | 'mr' | 'en' || 'hi');
        
        return {
          success: true,
          transcription,
          detectedLanguage,
          entities: {},
          nextAction: 'REQUEST_INFO',
        };
      }
    }

    // Handle state transitions based on intent
    if (currentState && currentState.state === 'CONFIRMATION_PENDING') {
      if (intent === 'UPDATE_PRICE' || intent === 'UPDATE_QUANTITY') {
        console.log(`${intent} requested in CONFIRMATION_PENDING state`);
        // Keep state as CONFIRMATION_PENDING
      } else if (intent === 'CREATE_CATALOG') {
        console.log('New order requested in CONFIRMATION_PENDING state - resetting');
        // User wants to start new order - reset state
        await updateUserState(phone, 'ACTIVE');
        const { deletePartialData } = await import('../services/partial-data-store');
        await deletePartialData(phone);
      }
    }

    // Step 5: Call entity-extraction Lambda
    console.log('Invoking entity-extraction Lambda...');
    const entityResult = await invokeEntityExtraction({
      transcribedText: transcription,
      intent,
      phoneNumber: phone,
      messageId,
      language: detectedLanguage?.split('-')[0] || 'en',
    });

    if (!entityResult.success) {
      throw new Error(entityResult.error?.message || 'Entity extraction failed');
    }

    const { entities, missingFields } = entityResult;
    console.log('Entities extracted:', { entities, missingFields });

    // Track assistant understanding in conversation
    await addConversationMessage(phone, {
      timestamp: Date.now(),
      role: 'assistant',
      content: `Understood: ${intent}`,
      intent,
      entities,
      messageType: 'text',
    });

    // Generate contextual response based on conversation history
    const contextualResponse = generateContextualResponse(
      conversationContext,
      intent,
      entities,
      detectedLanguage || 'hi-IN'
    );

    // Update user preferences based on current interaction
    if (entities.category) {
      const existingCategories = conversationContext?.preferences.preferredCategories || [];
      if (!existingCategories.includes(entities.category)) {
        await updateUserPreferences(phone, {
          preferredCategories: [...existingCategories, entities.category],
        });
      }
    }

    if (entities.price) {
      const existingRange = conversationContext?.preferences.typicalPriceRange;
      const newMin = existingRange ? Math.min(existingRange.min, entities.price) : entities.price;
      const newMax = existingRange ? Math.max(existingRange.max, entities.price) : entities.price;
      await updateUserPreferences(phone, {
        typicalPriceRange: { min: newMin, max: newMax },
      });
    }

    // Step 6: Handle different intents
    if (intent === 'CREATE_CATALOG') {
      console.log('Merging entities with partial data...');
      const mergedData = await mergePartialData(phone, {
        productName: entities.product_name,
        price: entities.price,
        quantity: entities.quantity,
        unit: entities.unit,
        category: entities.category,
        description: entities.description,
        source: 'voice',
      });

      console.log('Merged data:', {
        missingFields: mergedData.missingFields,
        complete: isPartialDataComplete(mergedData),
      });

      // Step 7: Determine next action
      let nextAction: 'REQUEST_INFO' | 'REQUEST_IMAGE' | 'ERROR';

      if (mergedData.missingFields.length > 0) {
        // Still missing required fields - request more info conversationally
        nextAction = 'REQUEST_INFO';
        await updateUserState(phone, 'VOICE_RECEIVED', {
          missingFields: mergedData.missingFields,
        });

        // Generate conversational missing info prompt
        const { generateMissingFieldsPrompt } = await import('../services/language-manager');
        const missingPrompt = generateMissingFieldsPrompt(
          mergedData.missingFields,
          detectedLanguage as 'hi-IN' | 'mr-IN' | 'en-IN'
        );
        
        // Add contextual response if available
        const finalPrompt = contextualResponse 
          ? `${contextualResponse}\n\n${missingPrompt}`
          : missingPrompt;
        
        // Send the prompt immediately
        const { sendTextMessage } = await import('./whatsapp-message-sender');
        await sendTextMessage(
          phone,
          finalPrompt,
          detectedLanguage?.split('-')[0] as 'hi' | 'mr' | 'en' || 'hi'
        );
        
        console.log('Sent missing fields prompt:', finalPrompt);
      } else {
        // All required fields present - request product image
        nextAction = 'REQUEST_IMAGE';
        await updateUserState(phone, 'IMAGE_PENDING');

        // Send image request message immediately
        const { sendTextMessage } = await import('./whatsapp-message-sender');
        const imageRequestMsg = detectedLanguage === 'hi-IN'
          ? '📸 बहुत अच्छा! अब कृपया उत्पाद की फोटो भेजें।'
          : detectedLanguage === 'mr-IN'
          ? '📸 खूप छान! आता कृपया उत्पादाचा फोटो पाठवा.'
          : '📸 Great! Now please send the product photo.';
        
        await sendTextMessage(
          phone,
          imageRequestMsg,
          detectedLanguage?.split('-')[0] as 'hi' | 'mr' | 'en' || 'hi'
        );
        
        console.log('Sent image request message');
      }

      return {
        success: true,
        transcription,
        detectedLanguage,
        entities,
        missingFields: mergedData.missingFields,
        nextAction,
      };
    } else if (intent === 'UPDATE_PRICE') {
      // Handle price update during CONFIRMATION_PENDING state
      console.log('Handling price update...');
      
      // Get current partial data
      const partialData = await getPartialData(phone);
      if (!partialData) {
        throw new Error('No partial data found for price update');
      }

      // Update price in partial data
      await mergePartialData(phone, {
        price: entities.new_price,
        source: 'voice',
      });

      console.log('Price updated:', { oldPrice: partialData.price, newPrice: entities.new_price });

      // Re-generate confirmation with updated price
      const { InvokeCommand } = await import('@aws-sdk/client-lambda');
      const confirmationFunctionName = process.env.CONFIRMATION_HANDLER_FUNCTION_NAME || 'vyapar-vaani-confirmation-handler';
      
      const confirmCommand = new InvokeCommand({
        FunctionName: confirmationFunctionName,
        Payload: JSON.stringify({
          detail: {
            phone,
            action: 'generate',
          },
        }),
      });

      await lambdaClient.send(confirmCommand);
      console.log('Re-generated confirmation with updated price');

      return {
        success: true,
        transcription,
        detectedLanguage,
        entities,
        nextAction: 'REQUEST_INFO', // Stay in confirmation flow
      };
    } else if (intent === 'UPDATE_QUANTITY') {
      // Handle quantity update during CONFIRMATION_PENDING state
      console.log('Handling quantity update...');
      
      // Get current partial data
      const partialData = await getPartialData(phone);
      if (!partialData) {
        throw new Error('No partial data found for quantity update');
      }

      // Update quantity in partial data
      await mergePartialData(phone, {
        quantity: entities.new_quantity,
        source: 'voice',
      });

      console.log('Quantity updated:', { oldQuantity: partialData.quantity, newQuantity: entities.new_quantity });

      // Re-generate confirmation with updated quantity
      const { InvokeCommand } = await import('@aws-sdk/client-lambda');
      const confirmationFunctionName = process.env.CONFIRMATION_HANDLER_FUNCTION_NAME || 'vyapar-vaani-confirmation-handler';
      
      const confirmCommand = new InvokeCommand({
        FunctionName: confirmationFunctionName,
        Payload: JSON.stringify({
          detail: {
            phone,
            action: 'generate',
          },
        }),
      });

      await lambdaClient.send(confirmCommand);
      console.log('Re-generated confirmation with updated quantity');

      return {
        success: true,
        transcription,
        detectedLanguage,
        entities,
        nextAction: 'REQUEST_INFO', // Stay in confirmation flow
      };
    }

    // For non-catalog intents, just return success
    return {
      success: true,
      transcription,
      detectedLanguage,
      entities,
      nextAction: 'ERROR', // Other intents not yet implemented
    };
  } catch (error: any) {
    console.error('Voice handler failed:', error);

    return {
      success: false,
      error: error.message || 'Failed to process voice message',
    };
  }
};

/**
 * Parse event from different sources
 */
function parseEvent(event: any): VoiceHandlerEvent {
  // EventBridge format
  if (event.detail) {
    return {
      phone: event.detail.phone,
      messageId: event.detail.messageId,
      mediaId: event.detail.content?.mediaUrl || event.detail.mediaId,
      state: event.detail.state,
    };
  }

  // Direct invocation format
  return {
    phone: event.phone,
    messageId: event.messageId,
    mediaId: event.mediaId,
    state: event.state,
  };
}

/**
 * Invoke voice-transcription Lambda
 */
async function invokeVoiceTranscription(params: {
  audioUrl: string;
  messageId: string;
  languageCode?: string;
}): Promise<any> {
  const functionName = process.env.VOICE_TRANSCRIPTION_FUNCTION_NAME || 'vyapar-vaani-voice-transcription';

  const command = new InvokeCommand({
    FunctionName: functionName,
    Payload: JSON.stringify({
      audioUrl: params.audioUrl,
      messageId: params.messageId,
      languageCode: params.languageCode,
    }),
  });

  const response = await lambdaClient.send(command);

  if (!response.Payload) {
    throw new Error('Empty response from voice-transcription Lambda');
  }

  const result = JSON.parse(new TextDecoder().decode(response.Payload));
  return result;
}

/**
 * Invoke intent-classification Lambda
 */
async function invokeIntentClassification(params: {
  transcribedText: string;
  phoneNumber: string;
  messageId: string;
}): Promise<any> {
  const functionName = process.env.INTENT_CLASSIFICATION_FUNCTION_NAME || 'vyapar-vaani-intent-classification';

  const command = new InvokeCommand({
    FunctionName: functionName,
    Payload: JSON.stringify({
      transcribedText: params.transcribedText,
      phoneNumber: params.phoneNumber,
      messageId: params.messageId,
    }),
  });

  const response = await lambdaClient.send(command);

  if (!response.Payload) {
    throw new Error('Empty response from intent-classification Lambda');
  }

  const result = JSON.parse(new TextDecoder().decode(response.Payload));
  return result;
}

/**
 * Invoke entity-extraction Lambda
 */
async function invokeEntityExtraction(params: {
  transcribedText: string;
  intent: string;
  phoneNumber: string;
  messageId: string;
  language: string;
}): Promise<any> {
  const functionName = process.env.ENTITY_EXTRACTION_FUNCTION_NAME || 'vyapar-vaani-entity-extraction';

  const command = new InvokeCommand({
    FunctionName: functionName,
    Payload: JSON.stringify({
      transcribedText: params.transcribedText,
      intent: params.intent,
      phoneNumber: params.phoneNumber,
      messageId: params.messageId,
      language: params.language,
    }),
  });

  const response = await lambdaClient.send(command);

  if (!response.Payload) {
    throw new Error('Empty response from entity-extraction Lambda');
  }

  const result = JSON.parse(new TextDecoder().decode(response.Payload));
  return result;
}

/**
 * Publish missing info event to trigger prompt generation
 */
async function publishMissingInfoEvent(params: {
  phone: string;
  messageId: string;
  missingFields: string[];
  language: string;
}): Promise<void> {
  const eventBusName = process.env.EVENT_BUS_NAME;
  if (!eventBusName) {
    console.warn('EVENT_BUS_NAME not configured - skipping event publication');
    return;
  }

  const command = new PutEventsCommand({
    Entries: [
      {
        Source: EVENT_SOURCES.INTERNAL,
        DetailType: 'voice.missing_info.detected',
        Detail: JSON.stringify({
          phone: params.phone,
          messageId: params.messageId,
          missingFields: params.missingFields,
          language: params.language,
        }),
        EventBusName: eventBusName,
      },
    ],
  });

  const response = await eventBridgeClient.send(command);
  console.log('Published missing info event:', {
    phone: params.phone,
    eventId: response.Entries?.[0]?.EventId,
  });
}

/**
 * Publish image request event
 */
async function publishImageRequestEvent(params: {
  phone: string;
  messageId: string;
  language: string;
}): Promise<void> {
  const eventBusName = process.env.EVENT_BUS_NAME;
  if (!eventBusName) {
    console.warn('EVENT_BUS_NAME not configured - skipping event publication');
    return;
  }

  const command = new PutEventsCommand({
    Entries: [
      {
        Source: EVENT_SOURCES.INTERNAL,
        DetailType: 'voice.image_request.needed',
        Detail: JSON.stringify({
          phone: params.phone,
          messageId: params.messageId,
          language: params.language,
        }),
        EventBusName: eventBusName,
      },
    ],
  });

  const response = await eventBridgeClient.send(command);
  console.log('Published image request event:', {
    phone: params.phone,
    eventId: response.Entries?.[0]?.EventId,
  });
}
