
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

interface VoiceHandlerEvent {
  phone: string;
  messageId: string;
  mediaId: string;
  state?: {
    state: string;
    language?: 'hi-IN' | 'mr-IN' | 'en-IN';
  };
}

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

export const handler = async (
  event: any
): Promise<VoiceHandlerResponse> => {
  console.log('Voice handler request:', JSON.stringify(event, null, 2));

  try {

    const { phone, messageId, mediaId, state } = parseEvent(event);

    console.log('Processing voice message:', { phone, messageId, mediaId });

    const { markMessageAsRead, sendTypingIndicator, setLastMessageId } = await import('./whatsapp-message-sender');
    setLastMessageId(phone, messageId); 
    await markMessageAsRead(messageId, true);
    console.log('Message marked as read with typing indicator sent');

    const currentState = await getUserState(phone);

    if (currentState && currentState.state === 'CONFIRMATION_PENDING') {
      console.log('User in CONFIRMATION_PENDING - checking if this is a price update or new order');

    } else if (currentState && currentState.state === 'ACTIVE') {

      console.log('User in ACTIVE state, starting new order');
    }

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

    const transcriptionStartTime = Date.now();
    console.log('Invoking voice-transcription Lambda...');

    await sendTypingIndicator(phone, messageId);

    // Set up periodic typing indicator refresh during long transcription
    const typingRefreshInterval = setInterval(async () => {
      try { await sendTypingIndicator(phone, messageId); } catch (_) {}
    }, 4000);

    let transcriptionResult;
    try {
      transcriptionResult = await invokeVoiceTranscription({
        audioUrl: downloadResult.s3Url,
        messageId,
        languageCode: state?.language,
      });
    } finally {
      clearInterval(typingRefreshInterval);
    }
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

    await addConversationMessage(phone, {
      timestamp: Date.now(),
      role: 'user',
      content: transcription,
      messageType: 'voice',
    });

    const conversationContext = await getConversationContext(phone);

    if (detectedLanguage) {
      console.log('Storing language preference:', detectedLanguage);
      await storeLanguagePreference(phone, detectedLanguage as 'hi-IN' | 'mr-IN' | 'en-IN');
    }

    const intentStartTime = Date.now();
    console.log('Invoking intent-classification Lambda...');

    // Refresh typing indicator before intent classification
    await sendTypingIndicator(phone, messageId);

    // Pass state + recent messages for context-aware classification
    const recentMsgs = conversationContext?.messages?.slice(-2)?.map(m => `${m.role}: ${m.content}`) || [];
    const intentResult = await invokeIntentClassification({
      transcribedText: transcription,
      phoneNumber: phone,
      messageId,
      currentState: currentState?.state || 'UNKNOWN',
      recentMessages: recentMsgs,
    });

    const intentEndTime = Date.now();
    const intentDuration = intentEndTime - intentStartTime;
    console.log(`Intent classification completed in ${intentDuration}ms`);

    if (!intentResult.success || !intentResult.intent) {
      throw new Error(intentResult.error?.message || 'Intent classification failed');
    }

    const { intent, confidence } = intentResult;
    console.log('Intent classified:', { intent, confidence });

    const entityStartTime = Date.now();
    console.log('Invoking entity-extraction Lambda...');

    // Refresh typing indicator before entity extraction
    await sendTypingIndicator(phone, messageId);

    // Pass partial data context for multi-turn entity resolution
    const existingPartial = await getPartialData(phone);
    const entityResult = await invokeEntityExtraction({
      transcribedText: transcription,
      intent: intent,
      phoneNumber: phone,
      messageId,
      language: detectedLanguage?.split('-')[0] || 'en',
      currentState: currentState?.state || 'UNKNOWN',
      partialContext: existingPartial ? {
        productName: existingPartial.productName || null,
        price: existingPartial.price || null,
        quantity: existingPartial.quantity || null,
        unit: existingPartial.unit || null,
        missingFields: existingPartial.missingFields || [],
      } : null,
    });

    const entityEndTime = Date.now();
    const entityDuration = entityEndTime - entityStartTime;
    console.log(`Entity extraction completed in ${entityDuration}ms`);

    if (!entityResult.success) {
      throw new Error(entityResult.error?.message || 'Entity extraction failed');
    }

    const { entities, missingFields } = entityResult;
    console.log('Entities extracted:', { entities, missingFields });

    if (currentState && currentState.state === 'CONFIRMATION_PENDING') {

      const existingData = await getPartialData(phone);
      const existingProductName = existingData?.productName?.toLowerCase();
      const newProductName = entities.product_name?.toLowerCase();

      const isDifferentProduct = newProductName && existingProductName && newProductName !== existingProductName;

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

      console.log('Same product or update without product name - allowing update');
    }

    if (currentState && currentState.state === 'CONFIRMATION_PENDING') {
      if (intent === 'UPDATE_PRICE' || intent === 'UPDATE_QUANTITY') {
        console.log(`${intent} requested in CONFIRMATION_PENDING state`);

      } else if (intent === 'CANCEL_ORDER') {
        console.log('CANCEL_ORDER requested in CONFIRMATION_PENDING state - canceling order');

        await updateUserState(phone, 'ACTIVE');
        const { deletePartialData } = await import('../services/partial-data-store');
        await deletePartialData(phone);

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

        await updateUserState(phone, 'ACTIVE');
        const { deletePartialData } = await import('../services/partial-data-store');
        await deletePartialData(phone);
      }
    } else if (currentState && currentState.state === 'ACTIVE' && intent === 'CONFIRM_CATALOG') {
      console.log('CONFIRM_CATALOG in ACTIVE state - user likely just confirmed via button, voice is redundant');

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

    await addConversationMessage(phone, {
      timestamp: Date.now(),
      role: 'assistant',
      content: `Understood: ${intent}`,
      messageType: 'text',
      metadata: { intent, entities },
    });

    const existingPartialData = await getPartialData(phone);
    const isFillingMissingFields = existingPartialData && existingPartialData.missingFields.length > 0;

    const contextualResponse = '';

    if (entities.category) {

      await addConversationMessage(phone, {
        timestamp: Date.now(),
        role: 'system',
        content: `Category preference: ${entities.category}`,
        messageType: 'text',
        metadata: { category: entities.category },
      });
    }

    if (entities.price) {

      await addConversationMessage(phone, {
        timestamp: Date.now(),
        role: 'system',
        content: `Price recorded: ${entities.price}`,
        messageType: 'text',
        metadata: { price: entities.price },
      });
    }

    if (intent === 'CREATE_CATALOG' || intent === 'CONFIRM_CATALOG') {
      console.log('Merging entities with partial data...');

      const existingData = await getPartialData(phone);
      if (existingData && existingData.productName && entities.product_name && 
          existingData.productName.toLowerCase() !== entities.product_name.toLowerCase()) {
        console.log('Different product detected during order:', {
          existing: existingData.productName,
          new: entities.product_name
        });

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

      let nextAction: 'REQUEST_INFO' | 'REQUEST_IMAGE' | 'ERROR';

      if (mergedData.missingFields.length > 0) {

        nextAction = 'REQUEST_INFO';
        await updateUserState(phone, 'VOICE_RECEIVED', {
          missingFields: mergedData.missingFields,
        });

        await sendTypingIndicator(phone, messageId);

        try {
          const { processWithEnhancedAgent, sendEnhancedAgentMessage } = await import('../services/enhanced-agent');

          const contextMsg = `User is adding product "${mergedData.productName || 'unknown'}". ` +
            `We have: ${mergedData.productName ? 'product name' : ''} ${mergedData.price ? 'price=₹' + mergedData.price : ''} ${mergedData.quantity ? 'quantity=' + mergedData.quantity : ''} ${mergedData.unit ? 'unit=' + mergedData.unit : ''}. ` +
            `Still missing: ${mergedData.missingFields.join(', ')}. ` +
            `Ask the user conversationally for the missing info. Be friendly and brief.`;

          const agentResponse = await processWithEnhancedAgent(
            phone,
            contextMsg,
            'voice',
            (detectedLanguage as any) || 'hi-IN',
            messageId
          );

          await sendEnhancedAgentMessage(
            phone,
            agentResponse.message,
            (detectedLanguage as any) || 'hi-IN',
            'voice',  
            messageId
          );

          console.log('Sent LLM-generated missing fields request:', agentResponse.message.substring(0, 100));
        } catch (agentError) {
          console.error('Agent missing fields prompt failed, using fallback:', agentError);

          const { generateMissingFieldsPrompt } = await import('../services/language-manager');
          const missingPrompt = generateMissingFieldsPrompt(
            mergedData.missingFields,
            detectedLanguage as 'hi-IN' | 'mr-IN' | 'en-IN'
          );
          const { sendVoiceOnly } = await import('./whatsapp-message-sender');
          await sendVoiceOnly(phone, missingPrompt, detectedLanguage?.split('-')[0] as 'hi' | 'mr' | 'en' || 'hi');
        }
      } else {

        nextAction = 'REQUEST_IMAGE';
        await updateUserState(phone, 'IMAGE_PENDING');

        const { sendTextWithVoice, sendTypingIndicator } = await import('./whatsapp-message-sender');

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

      console.log('Handling price update...');

      const partialData = await getPartialData(phone);
      if (!partialData) {
        throw new Error('No partial data found for price update');
      }

      await mergePartialData(phone, {
        price: entities.new_price,
        source: 'voice',
      });

      console.log('Price updated:', { oldPrice: partialData.price, newPrice: entities.new_price });

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
        nextAction: 'REQUEST_INFO', 
      };
    } else if (intent === 'UPDATE_QUANTITY') {

      console.log('Handling quantity update...');

      const partialData = await getPartialData(phone);
      if (!partialData) {
        throw new Error('No partial data found for quantity update');
      }

      await mergePartialData(phone, {
        quantity: entities.new_quantity,
        source: 'voice',
      });

      console.log('Quantity updated:', { oldQuantity: partialData.quantity, newQuantity: entities.new_quantity });

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
        nextAction: 'REQUEST_INFO', 
      };
    }

    console.log(`Non-catalog intent "${intent}" - routing to AI agent for conversational response`);

    try {
      const { processWithEnhancedAgent, sendEnhancedAgentMessage } = await import('../services/enhanced-agent');

      await sendTypingIndicator(phone, messageId);

      const agentResponse = await processWithEnhancedAgent(
        phone,
        transcription,
        'voice',
        (detectedLanguage as any) || 'hi-IN',
        messageId
      );

      console.log('Agent response for non-catalog intent:', agentResponse.message.substring(0, 100));

      await sendEnhancedAgentMessage(
        phone,
        agentResponse.message,
        (detectedLanguage as any) || 'hi-IN',
        agentResponse.responseMode || 'voice',
        messageId
      );
    } catch (agentError) {
      console.error('Agent fallback failed:', agentError);

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

function parseEvent(event: any): VoiceHandlerEvent {

  if (event.detail) {
    return {
      phone: event.detail.phone,
      messageId: event.detail.messageId,
      mediaId: event.detail.content?.mediaUrl || event.detail.mediaId,
      state: event.detail.state,
    };
  }

  return {
    phone: event.phone,
    messageId: event.messageId,
    mediaId: event.mediaId,
    state: event.state,
  };
}

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

async function invokeIntentClassification(params: {
  transcribedText: string;
  phoneNumber: string;
  messageId: string;
  currentState?: string;
  recentMessages?: string[];
}): Promise<any> {
  const functionName = process.env.INTENT_CLASSIFICATION_FUNCTION_NAME || 'vyapar-vaani-intent-classification';

  const command = new InvokeCommand({
    FunctionName: functionName,
    Payload: JSON.stringify({
      transcribedText: params.transcribedText,
      phoneNumber: params.phoneNumber,
      messageId: params.messageId,
      currentState: params.currentState,
      recentMessages: params.recentMessages,
    }),
  });

  const response = await lambdaClient.send(command);

  if (!response.Payload) {
    throw new Error('Empty response from intent-classification Lambda');
  }

  const result = JSON.parse(new TextDecoder().decode(response.Payload));
  return result;
}

async function invokeEntityExtraction(params: {
  transcribedText: string;
  intent: string;
  phoneNumber: string;
  messageId: string;
  language: string;
  currentState?: string;
  partialContext?: { productName: string | null; price: number | null; quantity: number | null; unit: string | null; missingFields: string[] } | null;
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
      currentState: params.currentState,
      partialContext: params.partialContext,
    }),
  });

  const response = await lambdaClient.send(command);

  if (!response.Payload) {
    throw new Error('Empty response from entity-extraction Lambda');
  }

  const result = JSON.parse(new TextDecoder().decode(response.Payload));
  return result;
}
