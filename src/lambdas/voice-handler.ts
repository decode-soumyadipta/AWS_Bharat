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
  nextAction?: 'REQUEST_INFO' | 'REQUEST_IMAGE' | 'ERROR' | 'ORDER_CANCELED';
  error?: string;
  intent?: string;
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

    // IMMEDIATELY mark as read and show typing indicator
    const { markMessageAsRead, sendTypingIndicator } = await import('./whatsapp-message-sender');
    await Promise.all([
      markMessageAsRead(messageId),
      sendTypingIndicator(phone)
    ]);
    console.log('Message marked as read and typing indicator sent');

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
    const transcriptionStartTime = Date.now();
    console.log('Invoking voice-transcription Lambda...');
    
    // Show typing indicator during transcription
    await sendTypingIndicator(phone);
    
    const transcriptionResult = await invokeVoiceTranscription({
      audioUrl: downloadResult.s3Url,
      messageId,
      languageCode: state?.language,
    });
    const transcriptionEndTime = Date.now();
    const transcriptionDuration = transcriptionEndTime - transcriptionStartTime;
    console.log(`Transcription completed in ${transcriptionDuration}ms`);

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
    const intentStartTime = Date.now();
    console.log('Invoking intent-classification Lambda...');
    
    const intentResult = await invokeIntentClassification({
      transcribedText: transcription,
      phoneNumber: phone,
      messageId,
    });
    
    const intentEndTime = Date.now();
    const intentDuration = intentEndTime - intentStartTime;
    console.log(`Intent classification completed in ${intentDuration}ms`);

    if (!intentResult.success || !intentResult.intent) {
      throw new Error(intentResult.error?.message || 'Intent classification failed');
    }

    const { intent, confidence } = intentResult;
    console.log('Intent classified:', { intent, confidence });

    // Step 5: Call entity-extraction Lambda with the classified intent
    const entityStartTime = Date.now();
    console.log('Invoking entity-extraction Lambda...');
    
    const entityResult = await invokeEntityExtraction({
      transcribedText: transcription,
      intent: intent,
      phoneNumber: phone,
      messageId,
      language: detectedLanguage?.split('-')[0] || 'en',
    });
    
    const entityEndTime = Date.now();
    const entityDuration = entityEndTime - entityStartTime;
    console.log(`Entity extraction completed in ${entityDuration}ms`);

    if (!entityResult.success) {
      throw new Error(entityResult.error?.message || 'Entity extraction failed');
    }

    const { entities, missingFields } = entityResult;
    console.log('Entities extracted:', { entities, missingFields });

    // Check if user is trying to start a completely new product during confirmation
    if (currentState && currentState.state === 'CONFIRMATION_PENDING') {
      // Get existing partial data to compare product names
      const existingData = await getPartialData(phone);
      const existingProductName = existingData?.productName?.toLowerCase();
      const newProductName = entities.product_name?.toLowerCase();
      
      // Check if user mentioned a DIFFERENT product name
      const isDifferentProduct = newProductName && existingProductName && newProductName !== existingProductName;
      
      // Only ask for clarification if user mentions a DIFFERENT product name
      if (isDifferentProduct) {
        console.log('Different product name detected, asking for clarification:', {
          existing: existingProductName,
          new: newProductName
        });
        
        const clarificationMsg = detectedLanguage === 'hi-IN'
          ? 'क्या आप नया ऑर्डर शुरू करना चाहते हैं या मौजूदा ऑर्डर में बदलाव करना चाहते हैं? कृपया बताएं।'
          : detectedLanguage === 'mr-IN'
          ? 'तुम्हाला नवीन ऑर्डर सुरू करायची आहे की सध्याच्या ऑर्डरमध्ये बदल करायचा आहे? कृपया सांगा.'
          : 'Do you want to start a new order or modify the current order? Please clarify.';
        
        const { sendTextMessage, sendTypingIndicator, markMessageAsRead, sendTextWithVoice } = await import('./whatsapp-message-sender');
        
        // Show typing indicator immediately (includes mark as read)
        await sendTypingIndicator(phone, messageId);
        
        await sendTextWithVoice(phone, clarificationMsg, detectedLanguage?.split('-')[0] as 'hi' | 'mr' | 'en' || 'hi');
        
        const totalResponseTime = Date.now() - transcriptionStartTime;
        console.log(`Total response time: ${totalResponseTime}ms`);
        
        return {
          success: true,
          transcription,
          detectedLanguage,
          entities: {},
          nextAction: 'REQUEST_INFO',
        };
      }
      
      // If same product or no product name mentioned, allow updates without asking
      console.log('Same product or update without product name - allowing update');
    }

    // Handle state transitions based on intent
    if (currentState && currentState.state === 'CONFIRMATION_PENDING') {
      if (intent === 'UPDATE_PRICE' || intent === 'UPDATE_QUANTITY') {
        console.log(`${intent} requested in CONFIRMATION_PENDING state`);
        // Keep state as CONFIRMATION_PENDING
      } else if (intent === 'CANCEL_ORDER') {
        console.log('CANCEL_ORDER requested in CONFIRMATION_PENDING state - canceling order');
        // User wants to cancel - reset state and delete partial data
        await updateUserState(phone, 'ACTIVE');
        const { deletePartialData } = await import('../services/partial-data-store');
        await deletePartialData(phone);
        
        // Send cancellation confirmation with voice
        const { sendTypingIndicator, sendTextWithVoice } = await import('./whatsapp-message-sender');
        await sendTypingIndicator(phone, messageId);
        
        const cancelMsg = detectedLanguage === 'hi-IN'
          ? '❌ ठीक है, आपका ऑर्डर रद्द कर दिया गया है। नया ऑर्डर शुरू करने के लिए उत्पाद की जानकारी भेजें।'
          : detectedLanguage === 'mr-IN'
          ? '❌ ठीक आहे, तुमचा ऑर्डर रद्द केला आहे. नवीन ऑर्डर सुरू करण्यासाठी उत्पादनाची माहिती पाठवा.'
          : '❌ Okay, your order has been canceled. Send product information to start a new order.';
        
        await sendTextWithVoice(phone, cancelMsg, detectedLanguage?.split('-')[0] as 'hi' | 'mr' | 'en' || 'hi');
        
        return {
          success: true,
          transcription,
          detectedLanguage,
          intent,
          entities: {},
          nextAction: 'ORDER_CANCELED',
        };
      } else if (intent === 'CONFIRM_CATALOG') {
        console.log('CONFIRM_CATALOG in CONFIRMATION_PENDING - user confirming via voice (button likely already clicked)');
        // User is confirming via voice - this is redundant if button was clicked
        // Just acknowledge and don't process again
        const { sendTypingIndicator, sendTextWithVoice } = await import('./whatsapp-message-sender');
        await sendTypingIndicator(phone, messageId);
        
        const ackMsg = detectedLanguage === 'hi-IN'
          ? '✅ धन्यवाद! आपका ऑर्डर पहले ही कन्फर्म हो चुका है।'
          : detectedLanguage === 'mr-IN'
          ? '✅ धन्यवाद! तुमचा ऑर्डर आधीच कन्फर्म झाला आहे.'
          : '✅ Thank you! Your order is already confirmed.';
        
        await sendTextWithVoice(phone, ackMsg, detectedLanguage?.split('-')[0] as 'hi' | 'mr' | 'en' || 'hi');
        
        return {
          success: true,
          transcription,
          detectedLanguage,
          intent,
          entities: {},
          nextAction: 'REQUEST_INFO',
        };
      } else if (intent === 'CREATE_CATALOG') {
        console.log('New order requested in CONFIRMATION_PENDING state - resetting');
        // User wants to start new order - reset state
        await updateUserState(phone, 'ACTIVE');
        const { deletePartialData } = await import('../services/partial-data-store');
        await deletePartialData(phone);
      }
    } else if (currentState && currentState.state === 'ACTIVE' && intent === 'CONFIRM_CATALOG') {
      console.log('CONFIRM_CATALOG in ACTIVE state - user likely just confirmed via button, voice is redundant');
      // User said "confirm" in voice but state is already ACTIVE (button was clicked first)
      // Just acknowledge politely and don't ask about updating
      const { sendTypingIndicator, sendTextWithVoice } = await import('./whatsapp-message-sender');
      await sendTypingIndicator(phone, messageId);
      
      const ackMsg = detectedLanguage === 'hi-IN'
        ? '✅ बहुत अच्छा! नया उत्पाद जोड़ने के लिए उत्पाद की जानकारी भेजें।'
        : detectedLanguage === 'mr-IN'
        ? '✅ खूप छान! नवीन उत्पादन जोडण्यासाठी उत्पादनाची माहिती पाठवा.'
        : '✅ Great! Send product information to add a new product.';
      
      await sendTextWithVoice(phone, ackMsg, detectedLanguage?.split('-')[0] as 'hi' | 'mr' | 'en' || 'hi');
      
      return {
        success: true,
        transcription,
        detectedLanguage,
        intent,
        entities: {},
        nextAction: 'REQUEST_INFO',
      };
    }

    // Track assistant understanding in conversation
    await addConversationMessage(phone, {
      timestamp: Date.now(),
      role: 'assistant',
      content: `Understood: ${intent}`,
      messageType: 'text',
      metadata: { intent, entities },
    });

    // Check if user is filling missing fields for existing order
    const existingPartialData = await getPartialData(phone);
    const isFillingMissingFields = existingPartialData && existingPartialData.missingFields.length > 0;

    // Contextual response generation is now handled by enhanced agent
    const contextualResponse = '';

    // Update user preferences based on current interaction
    if (entities.category) {
      // Preferences are now tracked in conversation metadata
      await addConversationMessage(phone, {
        timestamp: Date.now(),
        role: 'system',
        content: `Category preference: ${entities.category}`,
        messageType: 'text',
        metadata: { category: entities.category },
      });
    }

    if (entities.price) {
      // Price range is now tracked in conversation metadata
      await addConversationMessage(phone, {
        timestamp: Date.now(),
        role: 'system',
        content: `Price recorded: ${entities.price}`,
        messageType: 'text',
        metadata: { price: entities.price },
      });
    }

    // Step 6: Handle different intents
    if (intent === 'CREATE_CATALOG' || intent === 'CONFIRM_CATALOG') {
      console.log('Merging entities with partial data...');
      
      // Check if user is mentioning a different product during an ongoing order
      const existingData = await getPartialData(phone);
      if (existingData && existingData.productName && entities.product_name && 
          existingData.productName.toLowerCase() !== entities.product_name.toLowerCase()) {
        console.log('Different product detected during order:', {
          existing: existingData.productName,
          new: entities.product_name
        });
        
        // Ask user if they want to continue with current order or start new one
        const { sendInteractiveMessage, sendTypingIndicator } = await import('./whatsapp-message-sender');
        await sendTypingIndicator(phone, messageId);
        
        const questionMsg = detectedLanguage === 'hi-IN'
          ? `आप ${existingData.productName} का ऑर्डर बना रहे हैं, लेकिन अब ${entities.product_name} का जिक्र किया। क्या करना चाहेंगे?`
          : detectedLanguage === 'mr-IN'
          ? `तुम्ही ${existingData.productName} चा ऑर्डर बनवत आहात, पण आता ${entities.product_name} चा उल्लेख केला. काय करायचं आहे?`
          : `You're creating an order for ${existingData.productName}, but now mentioned ${entities.product_name}. What would you like to do?`;
        
        const continueBtn = detectedLanguage === 'hi-IN'
          ? 'जारी रखें'
          : detectedLanguage === 'mr-IN'
          ? 'सुरू ठेवा'
          : 'Continue';
        
        const newOrderBtn = detectedLanguage === 'hi-IN'
          ? 'नया ऑर्डर'
          : detectedLanguage === 'mr-IN'
          ? 'नवीन ऑर्डर'
          : 'New Order';
        
        await sendInteractiveMessage(
          phone,
          questionMsg,
          [
            { id: 'continue_current', title: continueBtn },
            { id: 'start_new', title: newOrderBtn }
          ],
          detectedLanguage?.split('-')[0] as 'hi' | 'mr' | 'en' || 'hi'
        );
        
        // Store the new product name temporarily for later use
        await mergePartialData(phone, {
          description: `pending_product_switch:${entities.product_name}`,
          source: 'voice',
        });
        
        return {
          success: true,
          transcription,
          detectedLanguage,
          entities: {},
          nextAction: 'REQUEST_INFO',
        };
      }
      
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
        hasAllRequiredFields: !mergedData.missingFields.length,
        productName: mergedData.productName,
        price: mergedData.price,
        quantity: mergedData.quantity,
        unit: mergedData.unit,
      });

      // Step 7: Determine next action
      let nextAction: 'REQUEST_INFO' | 'REQUEST_IMAGE' | 'ERROR';

      if (mergedData.missingFields.length > 0) {
        // Still missing required fields - ask conversationally via AI agent
        nextAction = 'REQUEST_INFO';
        await updateUserState(phone, 'VOICE_RECEIVED', {
          missingFields: mergedData.missingFields,
        });

        // Use AI agent to generate a natural, conversational request for missing info
        await sendTypingIndicator(phone, messageId);
        
        try {
          const { processWithEnhancedAgent, sendEnhancedAgentMessage } = await import('../services/enhanced-agent');
          
          // Tell agent what we have and what we need
          const contextMsg = `User is adding product "${mergedData.productName || 'unknown'}". ` +
            `We have: ${mergedData.productName ? 'product name' : ''} ${mergedData.price ? 'price=₹' + mergedData.price : ''} ${mergedData.quantity ? 'quantity=' + mergedData.quantity : ''} ${mergedData.unit ? 'unit=' + mergedData.unit : ''}. ` +
            `Still missing: ${mergedData.missingFields.join(', ')}. ` +
            `Ask the user conversationally for the missing info. Be friendly and brief.`;
          
          const agentResponse = await processWithEnhancedAgent(
            phone,
            contextMsg,
            'voice',
            (detectedLanguage as any) || 'hi-IN'
          );
          
          await sendEnhancedAgentMessage(
            phone,
            agentResponse.message,
            (detectedLanguage as any) || 'hi-IN',
            'voice'  // Always voice for conversational flow
          );
          
          console.log('Sent LLM-generated missing fields request:', agentResponse.message.substring(0, 100));
        } catch (agentError) {
          console.error('Agent missing fields prompt failed, using fallback:', agentError);
          // Fallback to template-based prompt
          const { generateMissingFieldsPrompt } = await import('../services/language-manager');
          const missingPrompt = generateMissingFieldsPrompt(
            mergedData.missingFields,
            detectedLanguage as 'hi-IN' | 'mr-IN' | 'en-IN'
          );
          const { sendVoiceOnly } = await import('./whatsapp-message-sender');
          await sendVoiceOnly(phone, missingPrompt, detectedLanguage?.split('-')[0] as 'hi' | 'mr' | 'en' || 'hi');
        }
      } else {
        // All required fields present - request product image
        nextAction = 'REQUEST_IMAGE';
        await updateUserState(phone, 'IMAGE_PENDING');

        // Send image request message with voice
        const { sendTextWithVoice, sendTypingIndicator } = await import('./whatsapp-message-sender');
        
        // Show typing indicator before response
        await sendTypingIndicator(phone, messageId);
        
        const imageRequestMsg = detectedLanguage === 'hi-IN'
          ? '📸 बहुत अच्छा! अब कृपया उत्पाद की फोटो भेजें।'
          : detectedLanguage === 'mr-IN'
          ? '📸 खूप छान! आता कृपया उत्पादाचा फोटो पाठवा.'
          : '📸 Great! Now please send the product photo.';
        
        await sendTextWithVoice(
          phone,
          imageRequestMsg,
          detectedLanguage?.split('-')[0] as 'hi' | 'mr' | 'en' || 'hi'
        );
        
        console.log('Sent image request message with voice');
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

      const totalResponseTime = Date.now() - transcriptionStartTime;
      console.log(`Total response time: ${totalResponseTime}ms`);

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

      const totalResponseTime = Date.now() - transcriptionStartTime;
      console.log(`Total response time: ${totalResponseTime}ms`);

      return {
        success: true,
        transcription,
        detectedLanguage,
        entities,
        nextAction: 'REQUEST_INFO', // Stay in confirmation flow
      };
    }

    // For non-catalog intents, route through the AI agent for conversational handling
    console.log(`Non-catalog intent "${intent}" - routing to AI agent for conversational response`);
    
    try {
      const { processWithEnhancedAgent, sendEnhancedAgentMessage } = await import('../services/enhanced-agent');
      
      // Send typing indicator while agent processes
      await sendTypingIndicator(phone);
      
      const agentResponse = await processWithEnhancedAgent(
        phone,
        transcription,
        'voice',
        (detectedLanguage as any) || 'hi-IN'
      );
      
      console.log('Agent response for non-catalog intent:', agentResponse.message.substring(0, 100));
      
      // Send response as voice (agent default)
      await sendEnhancedAgentMessage(
        phone,
        agentResponse.message,
        (detectedLanguage as any) || 'hi-IN',
        agentResponse.responseMode || 'voice'
      );
    } catch (agentError) {
      console.error('Agent fallback failed:', agentError);
      // Send a friendly fallback message via voice
      const { sendVoiceOnly } = await import('./whatsapp-message-sender');
      const fallbackMsg = detectedLanguage === 'hi-IN'
        ? 'माफ़ करें दोस्त, समझ नहीं आया। कृपया फिर से बताइए।'
        : detectedLanguage === 'mr-IN'
        ? 'माफ करा मित्रा, समजले नाही. कृपया पुन्हा सांगा.'
        : 'Sorry, I didn\'t understand. Please try again.';
      await sendVoiceOnly(phone, fallbackMsg, detectedLanguage?.split('-')[0] as 'hi' | 'mr' | 'en' || 'hi');
    }

    const totalResponseTime = Date.now() - transcriptionStartTime;
    console.log(`Total response time: ${totalResponseTime}ms`);
    
    return {
      success: true,
      transcription,
      detectedLanguage,
      entities,
      nextAction: 'REQUEST_INFO',
    };
  } catch (error: any) {
    console.error('Voice handler failed:', error);
    
    // Try to send a friendly error message
    try {
      const { phone } = parseEvent(event);
      const { sendVoiceOnly } = await import('./whatsapp-message-sender');
      await sendVoiceOnly(phone, 'माफ़ करें, कुछ समस्या हो गई। कृपया फिर से बोलें।', 'hi');
    } catch (sendErr) {
      console.error('Failed to send error voice message:', sendErr);
    }

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
