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
import { 
  getConversationContext, 
  trackSuccessfulCatalog, 
  addConversationMessage,
} from '../services/conversation-memory';
import { sendImageMessage, sendInteractiveMessage } from './whatsapp-message-sender';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { eventBridgeClient, docClient, TABLE_NAME } from '../config/aws-clients';
import { EVENT_SOURCES, INTERNAL_EVENT_TYPES } from '../config/event-patterns';
import { getCatalogItemsBySeller, deleteCatalogItem, getSellerByPhone, updateSellerProfile } from '../services/dynamodb-repository';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const marketplaceDdbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Normalize Hindi/Hinglish number words to digits in transcribed text.
 * Handles common Transcribe outputs like "sau" (100), "hazaar" (1000), etc.
 */
function normalizeHindiNumbers(text: string): string {
  // Hindi number word mappings (romanized + Devanagari)
  const numberWords: Record<string, number> = {
    // Basic numbers
    'ek': 1, 'एक': 1,
    'do': 2, 'दो': 2,
    'teen': 3, 'तीन': 3,
    'char': 4, 'चार': 4,
    'panch': 5, 'पाँच': 5, 'paanch': 5,
    'cheh': 6, 'छह': 6, 'chhe': 6,
    'saat': 7, 'सात': 7,
    'aath': 8, 'आठ': 8,
    'nau': 9, 'नौ': 9,
    'das': 10, 'दस': 10,
    'gyarah': 11, 'ग्यारह': 11,
    'barah': 12, 'बारह': 12,
    'terah': 13, 'तेरह': 13,
    'chaudah': 14, 'चौदह': 14,
    'pandrah': 15, 'पंद्रह': 15,
    'solah': 16, 'सोलह': 16,
    'satrah': 17, 'सत्रह': 17,
    'atharah': 18, 'अठारह': 18,
    'unnis': 19, 'उन्नीस': 19,
    'bees': 20, 'बीस': 20,
    'pachees': 25, 'पच्चीस': 25,
    'tees': 30, 'तीस': 30,
    'paintees': 35, 'पैंतीस': 35,
    'chaalees': 40, 'चालीस': 40,
    'pachaas': 50, 'पचास': 50,
    'saath': 60, 'साठ': 60,
    'sattar': 70, 'सत्तर': 70,
    'assi': 80, 'अस्सी': 80,
    'nabbe': 90, 'नब्बे': 90,
    // Hundred variants
    'sau': 100, 'सौ': 100,
    // Thousand variants
    'hazaar': 1000, 'हज़ार': 1000, 'hazar': 1000, 'hajaar': 1000, 'हजार': 1000,
    // Lakh/Crore
    'lakh': 100000, 'लाख': 100000, 'lac': 100000,
    'crore': 10000000, 'करोड़': 10000000, 'karod': 10000000,
    // Common compound patterns
    'dedh sau': 150, 'डेढ़ सौ': 150,
    'dhai sau': 250, 'ढाई सौ': 250,
    'dedh': 1.5, 'डेढ़': 1.5,
    'dhai': 2.5, 'ढाई': 2.5,
    'sadhe': 0.5, 'साढ़े': 0.5,  // used as prefix: "sadhe teen sau" = 350
  };

  let result = text;

  // Handle compound patterns first (e.g., "do sau pachaas" → 250, "paanch hazaar" → 5000)
  // Pattern: <multiplier> sau/hazaar/lakh [additional]
  const compoundPattern = /\b(ek|do|teen|char|panch|paanch|cheh|chhe|saat|aath|nau|das|bees|tees|chaalees|pachaas|एक|दो|तीन|चार|पाँच|छह|सात|आठ|नौ|दस|बीस|तीस|चालीस|पचास)\s+(sau|hazaar|hazar|hajaar|lakh|lac|crore|सौ|हज़ार|हजार|लाख|करोड़|karod)\b/gi;
  
  result = result.replace(compoundPattern, (match, multiplierWord, unitWord) => {
    const multiplier = numberWords[multiplierWord.toLowerCase()] || numberWords[multiplierWord] || 1;
    const unit = numberWords[unitWord.toLowerCase()] || numberWords[unitWord] || 1;
    return String(multiplier * unit);
  });

  // Handle standalone number words (replace remaining uncompounded ones)
  // Sort by length descending so longer matches go first
  const sortedWords = Object.entries(numberWords)
    .filter(([_, v]) => v >= 10) // Only replace substantial numbers standalone
    .sort((a, b) => b[0].length - a[0].length);

  for (const [word, num] of sortedWords) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    result = result.replace(regex, String(num));
  }

  // Clean up "dedh sau", "dhai sau" patterns that may have been partially replaced
  result = result.replace(/\b1\.5\s+100\b/g, '150');
  result = result.replace(/\b2\.5\s+100\b/g, '250');
  result = result.replace(/\b1\.5\s+1000\b/g, '1500');
  result = result.replace(/\b2\.5\s+1000\b/g, '2500');

  // Handle "X rupaye" or "X kilo" where X contains spaces between number words
  // e.g., "100 50" → "150" when consecutive
  result = result.replace(/(\d+)\s+(\d+)(?=\s*(rupaye|rupee|kilo|kg|gram|रुपये|किलो|ग्राम|rupaiye))/gi, 
    (match, n1, n2) => String(parseInt(n1) + parseInt(n2))
  );

  console.log(`🔢 Number normalization: "${text}" → "${result}"`);
  return result;
}

/**
 * Agent handler event
 */
interface AgentHandlerEvent {
  phone: string;
  messageId: string;
  messageType: 'text' | 'voice' | 'audio' | 'image' | 'button_reply';
  content: {
    text?: string;
    mediaUrl?: string;
    buttonPayload?: string;
  };
  language?: 'hi-IN' | 'mr-IN' | 'en-IN';
}

/**
 * Main agent handler
 * Lambda timeout is 5 minutes — no artificial timeout wrapper needed.
 */
export const handler = async (event: any): Promise<any> => {
  console.log('🤖 Agent handler invoked:', JSON.stringify(event, null, 2));
  return processAgentEvent(event);
};

async function processAgentEvent(event: any): Promise<any> {
  try {
    const eventDetail = event.detail || event;
    const { phone, messageType, content, language = 'hi-IN' } = eventDetail;

    if (!phone) {
      throw new Error('Phone number is required');
    }

    // Send typing indicator IMMEDIATELY to show we're processing
    const { sendTypingIndicator, markMessageAsRead } = await import('./whatsapp-message-sender');
    await Promise.all([
      sendTypingIndicator(phone),
      eventDetail.messageId ? markMessageAsRead(eventDetail.messageId) : Promise.resolve(),
    ]);

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

    // Keep typing active during voice transcription
    switch (messageType) {
      case 'voice':
      case 'audio':
        await sendTypingIndicator(phone); // Refresh typing during transcription
        userMessage = await handleVoiceMessage(eventDetail);
        await sendTypingIndicator(phone); // Refresh typing after transcription
        break;

      case 'image':
        await sendTypingIndicator(phone);
        userMessage = await handleImageMessage(eventDetail, phone, language);
        if (userMessage === '__CONFIRMATION_TRIGGERED__' || userMessage === '__HANDLED__') {
          console.log('📸 Image handled directly, skipping agent processing');
          return { success: true, message: 'Image processed directly' };
        }
        await sendTypingIndicator(phone);
        break;

      case 'button_reply':
        userMessage = await handleButtonClick(eventDetail, phone, language);
        if (userMessage === '__HANDLED__') {
          console.log('🔘 Button handled directly (order accept/reject), skipping agent processing');
          return { success: true, message: 'Button handled directly' };
        }
        shouldProcessWithAgent = content.buttonPayload !== 'approve';
        break;

      case 'text':
        userMessage = content.text || '';
        break;

      default:
        // Never error out on unknown message types — respond helpfully
        console.warn('⚠️ Unknown message type:', messageType);
        userMessage = `[User sent a ${messageType || 'unknown'} message]`;
        break;
    }

    if (!userMessage) {
      console.log('⚠️ No user message to process, sending helpful response');
      // NEVER fail silently — always respond to the user
      const emptyMsgResponse: Record<string, string> = {
        'hi-IN': '🤔 मुझे आपका मैसेज समझ नहीं आया। कृपया दुबारा वॉइस मैसेज भेजें या टाइप करके बताएं की आपको क्या चाहिए 🙏',
        'mr-IN': '🤔 मला तुमचा मेसेज समजला नाही. कृपया पुन्हा  व्हॉइस मेसेज पाठवा 🙏',
        'en-IN': '🤔 I couldn\'t understand your message. Please send a voice message again or type what you need 🙏',
      };
      try {
        await sendEnhancedAgentMessage(phone, emptyMsgResponse[language] || emptyMsgResponse['hi-IN'], language, 'voice');
      } catch (e) {
        console.error('Failed to send empty message response:', e);
      }
      return { success: true };
    }

    // For CONFIRMATION_PENDING state, detect price/quantity updates and handle them
    if (userState?.state === 'CONFIRMATION_PENDING' && partialData) {
      const updateResult = await detectAndApplyUpdate(userMessage, phone, partialData, language);
      if (updateResult) {
        console.log('📝 Applied update in CONFIRMATION_PENDING:', updateResult);
        return { success: true, message: 'Update applied' };
      }
    }

    // Keep typing indicator active while agent processes
    await sendTypingIndicator(phone);

    // Process with agent
    if (shouldProcessWithAgent) {
      const agentResponse = await processWithEnhancedAgent(
        phone,
        userMessage,
        messageType,
        language
      );

      console.log('🤖 Agent response:', agentResponse);

      // Refresh typing before sending response
      await sendTypingIndicator(phone);

      // Send agent message with correct response mode
      await sendEnhancedAgentMessage(
        phone, 
        agentResponse.message, 
        language, 
        agentResponse.responseMode || 'voice'
      );

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
    
    // Send specific, helpful error message to user — NEVER fail silently
    try {
      const phone = event.detail?.phone || event.phone;
      const language = event.detail?.language || event.language || 'hi-IN';
      if (phone) {
        let errorMessage = '';
        const errMsg = error.message || '';
        
        if (errMsg.includes('transcription') || errMsg.includes('audio') || errMsg.includes('download')) {
          errorMessage = language === 'en-IN' 
            ? '🎙️ I couldn\'t catch that voice message clearly. Could you send it again, a bit louder? I\'m all ears! 😊' 
            : '🎙️ वॉइस मैसेज अच्छे से सुनाई नहीं दिया। क्या आप थोड़ा ज़ोर से दुबारा भेज सकते हैं? मैं सुन रहा हूँ! 😊';
        } else if (errMsg.includes('image') || errMsg.includes('Image')) {
          errorMessage = language === 'en-IN'
            ? '📷 That photo didn\'t come through properly. Could you send it once more? 😊'
            : '📷 फोटो ठीक से नहीं मिली। क्या आप दुबारा भेज सकते हैं? 😊';
        } else if (errMsg.includes('timeout') || errMsg.includes('Timeout')) {
          errorMessage = language === 'en-IN'
            ? '⏳ That took a bit long! I\'m ready now — what would you like to do? 😊'
            : '⏳ थोड़ी देर हो गई! अब मैं तैयार हूँ — बताइए क्या करना है? 😊';
        } else {
          errorMessage = language === 'en-IN'
            ? '🙏 Oops, let me try again! What were you saying? Send a voice message or type your question 😊'
            : '🙏 अरे, एक बार फिर बताइए! वॉइस मैसेज भेजें या टाइप करें — मैं यहाँ हूँ! 😊';
        }

        await sendEnhancedAgentMessage(phone, errorMessage, language, 'voice');
      }
    } catch (sendError) {
      console.error('Failed to send error message:', sendError);
    }

    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Detect and apply price/quantity updates from user message during CONFIRMATION_PENDING
 * Returns true if an update was detected and applied, false otherwise
 */
async function detectAndApplyUpdate(
  message: string,
  phone: string,
  partialData: any,
  language: string
): Promise<string | null> {
  const lower = message.toLowerCase();
  
  // Price update patterns (romanized Hindi, Devanagari, English)
  const pricePatterns = [
    /(?:keemat|kimat|price|daam|dam|rate)\s*(\d+)/i,
    /(\d+)\s*(?:rupees?|rs|₹|rupi?ye?|mein|me)\b/i,
    /कीमत\s*(?:₹)?(\d+)/,
    /(\d+)\s*(?:रुपये|में)\b/,
    /किंमत\s*(?:₹)?(\d+)/,
  ];
  
  // Quantity update patterns
  const quantityPatterns = [
    /(?:matra|quantity|qty|kitna)\s*(\d+)/i,
    /(\d+)\s*(?:kg|kilo|piece|pcs|dozen|liter|litre|packet|bag)\b/i,
    /मात्रा\s*(\d+)/,
    /(\d+)\s*(?:किलो|पीस|दर्जन|लीटर|पैकेट|बैग)\b/,
    /प्रमाण\s*(\d+)/,
  ];
  
  // Check for price update
  for (const pattern of pricePatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const newPrice = parseInt(match[1]);
      if (newPrice > 0 && newPrice < 100000) {
        console.log(`💰 Price update detected: ₹${newPrice}`);
        await mergePartialData(phone, { price: newPrice, source: 'text' });
        
        // Re-generate confirmation
        const confirmationFunctionName = process.env.CONFIRMATION_HANDLER_FUNCTION_NAME || 'vyapar-vaani-confirmation-handler';
        const { InvokeCommand } = await import('@aws-sdk/client-lambda');
        const { lambdaClient } = await import('../config/aws-clients');
        await lambdaClient.send(new InvokeCommand({
          FunctionName: confirmationFunctionName,
          Payload: JSON.stringify({ detail: { phone, action: 'generate' } }),
        }));
        
        return `price updated to ₹${newPrice}`;
      }
    }
  }
  
  // Check for quantity update
  for (const pattern of quantityPatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const newQty = parseInt(match[1]);
      if (newQty > 0 && newQty < 100000) {
        console.log(`📊 Quantity update detected: ${newQty}`);
        await mergePartialData(phone, { quantity: newQty, source: 'text' });
        
        // Re-generate confirmation  
        const confirmationFunctionName = process.env.CONFIRMATION_HANDLER_FUNCTION_NAME || 'vyapar-vaani-confirmation-handler';
        const { InvokeCommand } = await import('@aws-sdk/client-lambda');
        const { lambdaClient } = await import('../config/aws-clients');
        await lambdaClient.send(new InvokeCommand({
          FunctionName: confirmationFunctionName,
          Payload: JSON.stringify({ detail: { phone, action: 'generate' } }),
        }));
        
        return `quantity updated to ${newQty}`;
      }
    }
  }
  
  return null; // No update detected - let agent handle it
}
/**
 * Handle voice message
 */
async function handleVoiceMessage(eventDetail: any): Promise<string> {
  console.log('Handling voice message:', eventDetail.content.mediaUrl);
  
  // Download audio from WhatsApp first
  const { downloadAudio } = await import('../services/media-download');
  const bucketName = process.env.PRODUCTS_BUCKET_NAME;
  
  if (!bucketName) {
    console.error('PRODUCTS_BUCKET_NAME not configured for voice');
    return ''; // Will trigger the friendly "couldn\'t understand" response
  }
  
  console.log('Downloading audio from WhatsApp...');
  const downloadResult = await downloadAudio(eventDetail.content.mediaUrl, bucketName);
  
  if (!downloadResult.success || !downloadResult.s3Url) {
    console.error('Audio download failed:', downloadResult.error);
    return ''; // Will trigger the friendly "couldn\'t understand" response
  }
  
  console.log('Audio downloaded successfully:', downloadResult.s3Url);
  
  // Import voice transcription
  const { handler: transcriptionHandler } = await import('./voice-transcription');
  
  console.log('Voice transcription request:', {
    audioUrl: downloadResult.s3Url,
    messageId: eventDetail.messageId,
    languageCode: eventDetail.language,
  });
  
  const transcriptionResult = await transcriptionHandler({
    audioUrl: downloadResult.s3Url,
    messageId: eventDetail.messageId,
    languageCode: eventDetail.language,
  });

  if (!transcriptionResult.success || !transcriptionResult.transcription) {
    console.error('Voice transcription failed:', transcriptionResult.error);
    return ''; // Will trigger the friendly "couldn\'t understand" response
  }

  console.log('Transcription successful:', transcriptionResult.transcription);
  
  // Normalize Hindi number words to digits
  const normalizedText = normalizeHindiNumbers(transcriptionResult.transcription);
  return normalizedText;
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

  if (!partialData || !partialData.productName) {
    // No product context — send guidance directly and return skip flag
    const guidance: Record<string, string> = {
      'hi-IN': '📸 फोटो मिल गई! लेकिन पहले मुझे बताइए कि यह किस उत्पाद की फोटो है? कृपया वॉइस मैसेज से बताएं — जैसे "टमाटर 50 रुपये किलो"। फिर मैं यह फोटो उसमें जोड़ दूंगा! 😊',
      'mr-IN': '📸 फोटो मिळाला! पण आधी सांगा हे कोणत्या उत्पादाचे आहे? कृपया व्हॉइस मेसेज पाठवा — जसे "टोमॅटो 50 रुपये किलो". मग मी फोटो जोडतो! 😊',
      'en-IN': '📸 Got the photo! But first tell me which product this is for. Please send a voice message — like "tomato 50 rupees per kilo". Then I\'ll add this photo to it! 😊',
    };
    await sendEnhancedAgentMessage(phone, guidance[language] || guidance['hi-IN'], language as any, 'voice');
    return '__HANDLED__';
  }

  // Download and enhance image
  const { downloadImage } = await import('../services/media-download');
  const { handler: enhancementHandler } = await import('./image-enhancement');

  const bucketName = process.env.PRODUCTS_BUCKET_NAME;
  if (!bucketName) {
    console.error('PRODUCTS_BUCKET_NAME not configured for image');
    const errMsg: Record<string, string> = {
      'hi-IN': '📸 फोटो मिल गई, लेकिन प्रोसेस करने में दिक्कत हुई। कृपया दुबारा भेजें! 🙏',
      'mr-IN': '📸 फोटो मिळाला, पण प्रोसेस करताना अडचण आली. कृपया पुन्हा पाठवा! 🙏',
      'en-IN': '📸 Got the photo but had trouble processing it. Please send it again! 🙏',
    };
    await sendEnhancedAgentMessage(phone, errMsg[language] || errMsg['hi-IN'], language as any, 'voice');
    return '__HANDLED__';
  }

  // Download image
  const downloadResult = await downloadImage(eventDetail.content.mediaUrl, bucketName);
  if (!downloadResult.success || !downloadResult.s3Url) {
    console.error('Image download failed');
    const errMsg: Record<string, string> = {
      'hi-IN': '📸 फोटो डाउनलोड नहीं हो पाई। कृपया दुबारा भेजें! 🙏',
      'mr-IN': '📸 फोटो डाउनलोड झालं नाही. कृपया पुन्हा पाठवा! 🙏',
      'en-IN': '📸 Couldn\'t download the photo. Please send it again! 🙏',
    };
    await sendEnhancedAgentMessage(phone, errMsg[language] || errMsg['hi-IN'], language as any, 'voice');
    return '__HANDLED__';
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

  // Check if all required fields are present → trigger confirmation flow
  const updatedPartial = await getPartialData(phone);
  const hasMissingFields = updatedPartial?.missingFields && updatedPartial.missingFields.length > 0;
  
  if (updatedPartial && !hasMissingFields) {
    // All product data + image → trigger confirmation handler directly
    console.log('✅ All fields + image present, triggering confirmation flow');
    await updateUserState(phone, 'CONFIRMATION_PENDING');
    
    try {
      const confirmationFunctionName = process.env.CONFIRMATION_HANDLER_FUNCTION_NAME || 'vyapar-vaani-confirmation-handler';
      const { InvokeCommand } = await import('@aws-sdk/client-lambda');
      const { lambdaClient } = await import('../config/aws-clients');
      await lambdaClient.send(new InvokeCommand({
        FunctionName: confirmationFunctionName,
        Payload: JSON.stringify({ detail: { phone, action: 'generate' } }),
      }));
      console.log('✅ Confirmation handler invoked successfully');
    } catch (confErr) {
      console.error('⚠️ Confirmation handler invoke failed, sending manual confirmation:', confErr);
      // Fallback: send a text summary
      const summary = `📋 *${updatedPartial.productName}*\n💰 ₹${updatedPartial.price}/${updatedPartial.unit}\n📦 ${updatedPartial.quantity} ${updatedPartial.unit}\n\nक्या यह सही है? "हां" बोलें या बदलाव बताएं।`;
      await sendEnhancedAgentMessage(phone, summary, language as any, 'both');
    }
    return '__CONFIRMATION_TRIGGERED__';
  }

  // Image received but some product fields still missing → ask for them
  const missingStr = updatedPartial?.missingFields?.join(', ') || 'details';
  console.log('📸 Image received but missing fields:', missingStr);
  const askMissing: Record<string, string> = {
    'hi-IN': `📸 फोटो मिल गई! अब बस ${missingStr === 'price' ? 'कीमत' : missingStr === 'quantity' ? 'मात्रा' : missingStr === 'unit' ? 'इकाई (किलो/पीस)' : 'कुछ जानकारी'} बता दीजिए तो उत्पाद जोड़ देता हूँ! 😊`,
    'mr-IN': `📸 फोटो मिळाला! आता फक्त ${missingStr} सांगा म्हणजे उत्पादन जोडतो! 😊`,
    'en-IN': `📸 Got the photo! Just tell me the ${missingStr} and I'll add your product! 😊`,
  };
  await sendEnhancedAgentMessage(phone, askMissing[language] || askMissing['hi-IN'], language as any, 'voice');
  return '__HANDLED__';
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
  
  // Handle order accept/reject buttons (from marketplace orders)
  if (buttonPayload.startsWith('accept_order_')) {
    const orderId = buttonPayload.replace('accept_order_', '');
    await handleOrderAcceptReject(phone, orderId, 'ACCEPTED', language);
    return '__HANDLED__';
  }
  
  if (buttonPayload.startsWith('reject_order_')) {
    const orderId = buttonPayload.replace('reject_order_', '');
    await handleOrderAcceptReject(phone, orderId, 'REJECTED', language);
    return '__HANDLED__';
  }
  
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
 * Decrement product stock in marketplace-products table.
 * Called when order is CONFIRMED (either via seller accept or UPI auto-confirm).
 * Returns stock status for each item.
 */
async function decrementMarketplaceStock(
  items: Array<{ itemId?: string; productId?: string; name: string; quantity: number; unit?: string }>
): Promise<Array<{ name: string; remainingQty: number; orderedQty: number; unit: string; outOfStock: boolean }>> {
  const MARKETPLACE_TABLE = process.env.MARKETPLACE_PRODUCTS_TABLE;
  if (!MARKETPLACE_TABLE) {
    console.warn('MARKETPLACE_PRODUCTS_TABLE not set, skipping stock decrement');
    return [];
  }

  const stockResults: Array<{ name: string; remainingQty: number; orderedQty: number; unit: string; outOfStock: boolean }> = [];

  for (const item of items) {
    const productId = item.productId || item.itemId;
    if (!productId) {
      console.warn('Missing productId for stock decrement:', item.name);
      continue;
    }

    try {
      const result = await marketplaceDdbClient.send(new UpdateCommand({
        TableName: MARKETPLACE_TABLE,
        Key: { productId },
        UpdateExpression: 'SET quantity = quantity - :qty, updatedAt = :now',
        ConditionExpression: 'quantity >= :qty',
        ExpressionAttributeValues: {
          ':qty': item.quantity || 1,
          ':now': new Date().toISOString(),
        },
        ReturnValues: 'ALL_NEW',
      }));

      const remaining = result.Attributes?.quantity ?? 0;
      const unit = item.unit || result.Attributes?.unit || 'pcs';

      console.log(`📦 Stock decremented: ${item.name} → ${remaining} ${unit} remaining`);

      stockResults.push({
        name: item.name,
        remainingQty: remaining,
        orderedQty: item.quantity || 1,
        unit,
        outOfStock: remaining <= 0,
      });

      // Mark out of stock
      if (remaining <= 0) {
        try {
          await marketplaceDdbClient.send(new UpdateCommand({
            TableName: MARKETPLACE_TABLE,
            Key: { productId },
            UpdateExpression: 'SET #s = :status',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':status': 'OUT_OF_STOCK' },
          }));
          console.log(`⚠️ Product ${item.name} marked OUT_OF_STOCK`);
        } catch (e: any) {
          console.warn('Failed to mark out of stock:', e.message);
        }
      }
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        console.warn(`⚠️ Insufficient stock for ${item.name}`);
        stockResults.push({
          name: item.name,
          remainingQty: 0,
          orderedQty: item.quantity || 1,
          unit: item.unit || 'pcs',
          outOfStock: true,
        });
      } else {
        console.error(`Stock decrement failed for ${item.name}:`, error.message);
      }
    }
  }

  return stockResults;
}

/**
 * Build stock update voice message
 */
function buildStockVoiceMessage(
  stockResults: Array<{ name: string; remainingQty: number; orderedQty: number; unit: string; outOfStock: boolean }>,
  lang: string
): string {
  if (stockResults.length === 0) return '';

  const isHindi = lang === 'hi' || lang === 'hi-IN';
  const lines = stockResults.map(s => {
    if (s.outOfStock) {
      return isHindi
        ? `⚠️ *${s.name}*: स्टॉक खत्म! (${s.orderedQty} ${s.unit} बिक गए)`
        : `⚠️ *${s.name}*: Out of stock! (${s.orderedQty} ${s.unit} sold)`;
    }
    return isHindi
      ? `📦 *${s.name}*: ${s.remainingQty} ${s.unit} बाकी (${s.orderedQty} ${s.unit} बिके)`
      : `📦 *${s.name}*: ${s.remainingQty} ${s.unit} left (${s.orderedQty} ${s.unit} sold)`;
  });

  const header = isHindi ? '📊 *स्टॉक अपडेट:*' : '📊 *Stock Update:*';
  const warning = stockResults.some(s => s.outOfStock)
    ? (isHindi ? '\n\n⚠️ कुछ उत्पादों का स्टॉक खत्म। कृपया अपडेट करें।' : '\n\n⚠️ Some products are out of stock. Please restock.')
    : '';

  return `${header}\n\n${lines.join('\n')}${warning}`;
}

/**
 * Handle order accept/reject from seller.
 * Updates order status, notifies buyer via voice, and guides payment flow.
 */
async function handleOrderAcceptReject(
  sellerPhone: string,
  orderId: string,
  decision: 'ACCEPTED' | 'REJECTED',
  language: string
): Promise<void> {
  try {
    console.log(`📦 Order ${decision}: ${orderId} by seller ${sellerPhone}`);

    // Fetch the order record
    const orderResult = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ORDER#${orderId}`, SK: 'METADATA' },
    }));

    const order = orderResult.Item;
    if (!order) {
      console.error('Order not found:', orderId);
      const lang = language.split('-')[0] as 'hi' | 'mr' | 'en';
      const notFoundMsg = lang === 'hi'
        ? '⚠️ यह ऑर्डर नहीं मिला। शायद पहले से प्रोसेस हो चुका है।'
        : '⚠️ Order not found. It may have already been processed.';
      await sendEnhancedAgentMessage(sellerPhone, notFoundMsg, language as any, 'voice');
      return;
    }

    // If order is already CONFIRMED (e.g., auto-accepted UPI), inform the seller
    if (order.status === 'CONFIRMED' || order.status === 'CANCELLED') {
      console.log(`Order ${orderId} already ${order.status}, skipping accept/reject`);
      const lang = language.split('-')[0] as 'hi' | 'mr' | 'en';
      const alreadyMsg = order.status === 'CONFIRMED'
        ? (lang === 'hi'
          ? `✅ यह ऑर्डर पहले से कन्फ़र्म है (${order.payment?.method === 'UPI' ? 'UPI ऑटो-स्वीकार' : 'स्वीकृत'})। कृपया ऑर्डर पैक करें! 📦`
          : `✅ This order is already confirmed (${order.payment?.method === 'UPI' ? 'UPI auto-accepted' : 'accepted'}). Please pack the order! 📦`)
        : (lang === 'hi'
          ? '❌ यह ऑर्डर पहले से रद्द हो चुका है।'
          : '❌ This order has already been cancelled.');
      await sendEnhancedAgentMessage(sellerPhone, alreadyMsg, language as any, 'voice');
      return;
    }

    const now = Date.now();
    const newStatus = decision === 'ACCEPTED' ? 'CONFIRMED' : 'CANCELLED';
    const buyerPhone = order.buyer?.phone || order.fulfillment?.contact?.phone;

    // Update order status in DynamoDB (including GSI2SK for status queries)
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ORDER#${orderId}`, SK: 'METADATA' },
      UpdateExpression: 'SET #status = :status, #timeline = list_append(#timeline, :event), updatedAt = :now, GSI2SK = :gsi2sk',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#timeline': 'timeline',
      },
      ExpressionAttributeValues: {
        ':status': newStatus,
        ':gsi2sk': `STATUS#${newStatus}#${now}`,
        ':event': [{
          status: newStatus,
          timestamp: now,
          actor: 'SELLER',
          notes: decision === 'ACCEPTED' 
            ? `Order accepted by seller ${sellerPhone}`
            : `Order rejected by seller ${sellerPhone}`,
        }],
        ':now': now,
      },
    }));

    console.log(`✅ Order ${orderId} updated to ${newStatus}`);

    const lang = language.split('-')[0] as 'hi' | 'mr' | 'en';
    const items = order.items || [];
    const itemSummary = items.map((i: any) => `${i.name} x${i.quantity}`).join(', ');
    const totalAmount = order.payment?.amount || 0;
    const paymentMethod = order.payment?.method || 'COD';

    if (decision === 'ACCEPTED') {
      // -- Seller confirmation --
      const sellerMsg = lang === 'hi'
        ? `✅ ऑर्डर स्वीकार किया!\n\n📦 ${itemSummary}\n💰 ₹${totalAmount}\n💳 ${paymentMethod === 'UPI' ? 'UPI भुगतान' : 'कैश ऑन डिलीवरी'}\n\n${paymentMethod === 'UPI' ? '💡 UPI भुगतान आने का इंतजार करें। भुगतान मिलने पर आपको सूचना मिलेगी।' : '📦 कृपया ऑर्डर पैक करें और डिलीवरी की तैयारी करें!'}`
        : `✅ Order Accepted!\n\n📦 ${itemSummary}\n💰 ₹${totalAmount}\n💳 ${paymentMethod === 'UPI' ? 'UPI Payment' : 'Cash on Delivery'}\n\n${paymentMethod === 'UPI' ? '💡 Wait for UPI payment. You will be notified when payment is received.' : '📦 Please pack the order and prepare for delivery!'}`;
      await sendEnhancedAgentMessage(sellerPhone, sellerMsg, language as any, 'voice');

      // -- Buyer notification --
      if (buyerPhone) {
        const buyerMsg = lang === 'hi'
          ? `🎉 आपका ऑर्डर स्वीकार हो गया!\n\n📦 ${itemSummary}\n💰 ₹${totalAmount}\n\n${paymentMethod === 'UPI' ? '💳 कृपया UPI से ₹' + totalAmount + ' भुगतान करें। भुगतान के बाद स्क्रीनशॉट या रेफरेंस नंबर भेजें।' : '💵 कैश ऑन डिलीवरी - डिलीवरी के समय भुगतान करें।'}\n\n🚚 डिलीवरी जल्द होगी!`
          : `🎉 Your order has been accepted!\n\n📦 ${itemSummary}\n💰 ₹${totalAmount}\n\n${paymentMethod === 'UPI' ? '💳 Please pay ₹' + totalAmount + ' via UPI. Send screenshot or reference number after payment.' : '💵 Cash on Delivery - Pay when your order is delivered.'}\n\n🚚 Delivery coming soon!`;
        await sendEnhancedAgentMessage(buyerPhone, buyerMsg, language as any, 'both');
      }

      // -- Decrement stock after order confirmed --
      try {
        const stockResults = await decrementMarketplaceStock(items);
        if (stockResults.length > 0) {
          const stockMsg = buildStockVoiceMessage(stockResults, lang);
          if (stockMsg) {
            await sendEnhancedAgentMessage(sellerPhone, stockMsg, language as any, 'voice');
          }
        }
      } catch (stockErr: any) {
        console.error('Stock decrement error (non-fatal):', stockErr.message);
      }
    } else {
      // -- Seller rejection confirmation --
      const sellerMsg = lang === 'hi'
        ? `❌ ऑर्डर अस्वीकार किया गया। ग्राहक को सूचित कर दिया गया है।`
        : `❌ Order rejected. The buyer has been notified.`;
      await sendEnhancedAgentMessage(sellerPhone, sellerMsg, language as any, 'voice');

      // -- Buyer notification --
      if (buyerPhone) {
        const buyerMsg = lang === 'hi'
          ? `😔 माफ़ कीजिए, विक्रेता ने आपका ऑर्डर स्वीकार नहीं किया।\n📦 ${itemSummary}\n\nकृपया दूसरे विक्रेता से ऑर्डर करें।`
          : `😔 Sorry, the seller couldn't accept your order.\n📦 ${itemSummary}\n\nPlease try ordering from another seller.`;
        await sendEnhancedAgentMessage(buyerPhone, buyerMsg, language as any, 'both');
      }
    }
  } catch (error: any) {
    console.error('❌ Failed to handle order accept/reject:', error);
    try {
      const lang = language.split('-')[0] as 'hi' | 'mr' | 'en';
      const errMsg = lang === 'hi'
        ? '⚠️ ऑर्डर प्रोसेस करने में समस्या हुई। कृपया दुबारा कोशिश करें।'
        : '⚠️ There was an issue processing the order. Please try again.';
      await sendEnhancedAgentMessage(sellerPhone, errMsg, language as any, 'voice');
    } catch (e) {
      console.error('Failed to send error msg:', e);
    }
  }
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
    console.log('🎬 Executing action:', action.type, 'data:', JSON.stringify(action.data));

    try {
      switch (action.type) {
        case 'REQUEST_IMAGE':
          await updateUserState(phone, 'IMAGE_PENDING');
          break;

        case 'CREATE_CATALOG':
          await createCatalog(phone, language);
          break;

        case 'STORE_DATA':
          if (action.data) {
            const merged = await mergePartialData(phone, action.data);
            console.log('📦 STORE_DATA merged:', {
              productName: merged.productName,
              price: merged.price,
              quantity: merged.quantity,
              unit: merged.unit,
              missingFields: merged.missingFields,
              hasImage: !!(merged.originalImageUrl || merged.enhancedImageUrl),
            });

            // Drive the state machine based on data completeness
            const allFieldsPresent = !merged.missingFields || merged.missingFields.length === 0;
            const hasImage = !!(merged.originalImageUrl || merged.enhancedImageUrl);
            const currentState = (await getUserState(phone))?.state;

            if (allFieldsPresent && hasImage) {
              // All data + image → trigger confirmation
              console.log('✅ All fields + image complete, triggering confirmation');
              await updateUserState(phone, 'CONFIRMATION_PENDING');
              try {
                const confFn = process.env.CONFIRMATION_HANDLER_FUNCTION_NAME || 'vyapar-vaani-confirmation-handler';
                const { InvokeCommand } = await import('@aws-sdk/client-lambda');
                const { lambdaClient } = await import('../config/aws-clients');
                await lambdaClient.send(new InvokeCommand({
                  FunctionName: confFn,
                  Payload: JSON.stringify({ detail: { phone, action: 'generate' } }),
                }));
              } catch (e) {
                console.error('⚠️ Confirmation invoke failed:', e);
              }
            } else if (allFieldsPresent && !hasImage) {
              // All text data present, need image → IMAGE_PENDING
              console.log('📸 All fields present, moving to IMAGE_PENDING');
              await updateUserState(phone, 'IMAGE_PENDING');
            } else if (currentState === 'KYC_VERIFIED' || currentState === 'ACTIVE') {
              // Partial data, move to VOICE_RECEIVED so user can provide more info
              console.log('📝 Partial data, moving to VOICE_RECEIVED');
              await updateUserState(phone, 'VOICE_RECEIVED');
            }
          }
          break;

        case 'DELETE_PRODUCT':
          await deleteProduct(phone, action.data?.productName, language);
          break;

        case 'REGISTER_UPI':
          await registerUpi(phone, action.data?.upiId, language);
          break;

        default:
          console.log('⚠️ Unknown action type:', action.type);
      }
    } catch (actionError: any) {
      console.error(`❌ Action ${action.type} failed:`, actionError.message);
      // Don't let one failed action kill the whole handler
      // The agent's MESSAGE was already sent — just log and continue
    }
  }
}

/**
 * Create catalog
 */
async function createCatalog(phone: string, language: string): Promise<void> {
  const partialData = await getPartialData(phone);

  if (!partialData) {
    console.warn('⚠️ CREATE_CATALOG called but no partial data found');
    const lang = language.split('-')[0] as 'hi' | 'mr' | 'en';
    const msg = lang === 'hi'
      ? '⚠️ उत्पाद की जानकारी अभी पूरी नहीं है। कृपया पहले उत्पाद का नाम, कीमत और फोटो भेजें।'
      : '⚠️ Product information is incomplete. Please send product name, price, and photo first.';
    await sendEnhancedAgentMessage(phone, msg, language as any, 'voice');
    return;
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

  await sendEnhancedAgentMessage(phone, successMsg, language as any, 'both');
}

/**
 * Delete product from catalog and marketplace
 */
async function deleteProduct(phone: string, productName: string, language: string): Promise<void> {
  try {
    // Find the product in seller's catalog
    const catalogItems = await getCatalogItemsBySeller(phone);
    
    if (!catalogItems || catalogItems.length === 0) {
      console.log('❌ No catalog items found for seller:', phone);
      return;
    }

    // Find matching product by name (fuzzy match)
    const normalizedName = (productName || '').toLowerCase().trim();
    const matchingItem = catalogItems.find((item: any) => {
      const itemName = (item.becknItem?.descriptor?.name || '').toLowerCase().trim();
      return itemName.includes(normalizedName) || normalizedName.includes(itemName);
    });

    if (!matchingItem) {
      console.log('❌ No matching product found:', productName);
      const lang = language.split('-')[0] as 'hi' | 'mr' | 'en';
      const notFoundMsg = lang === 'hi'
        ? `❌ "${productName}" नाम का कोई उत्पाद नहीं मिला। कृपया सही नाम बताएं।`
        : `❌ No product found with name "${productName}". Please provide the correct name.`;
      await sendEnhancedAgentMessage(phone, notFoundMsg, language as any, 'voice');
      return;
    }

    const itemId = matchingItem.itemId;
    const displayName = matchingItem.becknItem?.descriptor?.name || productName;
    console.log('🗑️ Deleting product:', { phone, itemId, productName: displayName });

    // 1. Delete from main catalog (DynamoDB vyapar-vaani-data)
    await deleteCatalogItem(phone, itemId);

    // 2. Publish catalog.deleted event for marketplace sync
    const eventBusName = process.env.EVENT_BUS_NAME;
    if (eventBusName) {
      await eventBridgeClient.send(new PutEventsCommand({
        Entries: [{
          Source: EVENT_SOURCES.INTERNAL,
          DetailType: INTERNAL_EVENT_TYPES.CATALOG_DELETED,
          Detail: JSON.stringify({
            itemId,
            sellerId: phone,
            productName: displayName,
            timestamp: new Date().toISOString(),
          }),
          EventBusName: eventBusName,
        }],
      }));
      console.log('✅ Published catalog.deleted event for marketplace sync');
    }

    console.log('✅ Product deleted successfully:', itemId);
  } catch (error: any) {
    console.error('❌ Failed to delete product:', error);
    // Don't re-throw — send friendly error message instead
    try {
      const lang = language.split('-')[0] as 'hi' | 'mr' | 'en';
      const errMsg = lang === 'hi'
        ? '⚠️ उत्पाद हटाने में समस्या हुई। कृपया दुबारा कोशिश करें।'
        : '⚠️ Failed to delete product. Please try again.';
      await sendEnhancedAgentMessage(phone, errMsg, language as any, 'voice');
    } catch (e) {
      console.error('Failed to send delete error message:', e);
    }
  }
}

/**
 * Register seller's UPI ID for receiving payments
 */
async function registerUpi(phone: string, upiId: string, language: string): Promise<void> {
  try {
    if (!upiId || !upiId.includes('@')) {
      console.log('❌ Invalid UPI ID:', upiId);
      const lang = language.split('-')[0] as 'hi' | 'mr' | 'en';
      const invalidMsg = lang === 'hi'
        ? '❌ UPI ID सही नहीं लग रहा। कृपया सही UPI ID बताएं (जैसे: name@upi, 9876543210@paytm)'
        : '❌ Invalid UPI ID. Please provide a valid one (e.g., name@upi, 9876543210@paytm)';
      await sendEnhancedAgentMessage(phone, invalidMsg, language as any, 'voice');
      return;
    }

    // Look up seller profile by phone
    let seller: any = null;
    try {
      seller = await getSellerByPhone(phone);
    } catch (lookupErr) {
      console.warn('⚠️ Seller lookup failed, will try to create:', lookupErr);
    }

    if (seller) {
      // Update existing seller profile with UPI ID
      const sellerId = seller.PK.replace('SELLER#', '');
      await updateSellerProfile(sellerId, { upiId });
      console.log('✅ UPI ID registered for existing seller:', phone, upiId);
    } else {
      // No seller profile yet — store UPI in user state so it's available when profile is created
      try {
        const { createSellerProfile } = await import('../services/dynamodb-repository');
        await createSellerProfile({
          PK: `SELLER#${phone}`,
          SK: 'PROFILE',
          GSI1PK: phone,
          GSI1SK: 'PROFILE',
          entityType: 'SELLER',
          phone,
          name: phone,
          upiId,
          onboardingState: 'PARTIAL',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as any);
        console.log('✅ Created minimal seller profile with UPI ID:', phone, upiId);
      } catch (createErr: any) {
        // Profile might already exist (race condition) — try updating instead
        if (createErr.message?.includes('already exists') || createErr.name === 'ConditionalCheckFailedException') {
          console.log('⚠️ Profile exists, updating UPI instead');
          await updateSellerProfile(phone, { upiId });
        } else {
          throw createErr;
        }
      }
    }

    const lang = language.split('-')[0] as 'hi' | 'mr' | 'en';
    const successMsg = lang === 'hi'
      ? `✅ UPI ID *${upiId}* सफलतापूर्वक रजिस्टर हो गया! अब ग्राहक सीधे UPI से भुगतान कर सकते हैं। 💳`
      : lang === 'mr'
      ? `✅ UPI ID *${upiId}* यशस्वीरित्या नोंदणीकृत! आता ग्राहक थेट UPI ने पैसे देऊ शकतात। 💳`
      : `✅ UPI ID *${upiId}* registered successfully! Customers can now pay you directly via UPI. 💳`;
    await sendEnhancedAgentMessage(phone, successMsg, language as any, 'both');

    // Also update all existing marketplace products with the new UPI ID
    await updateMarketplaceProductsUpi(phone, upiId);

  } catch (error: any) {
    console.error('❌ Failed to register UPI:', error);
    // Don't re-throw — send friendly error message instead
    try {
      const lang = language.split('-')[0] as 'hi' | 'mr' | 'en';
      const errMsg = lang === 'hi'
        ? '⚠️ UPI रजिस्ट्रेशन में समस्या हुई। कृपया अपना UPI ID दुबारा भेजें (जैसे: name@upi)'
        : '⚠️ UPI registration had an issue. Please send your UPI ID again (e.g., name@upi)';
      await sendEnhancedAgentMessage(phone, errMsg, language as any, 'voice');
    } catch (e) {
      console.error('Failed to send UPI error message:', e);
    }
  }
}

/**
 * Update all marketplace products for a seller with their new UPI ID.
 * Called after UPI registration so buyers can see UPI payment option immediately.
 */
async function updateMarketplaceProductsUpi(sellerPhone: string, upiId: string): Promise<void> {
  const tableName = process.env.MARKETPLACE_PRODUCTS_TABLE;
  if (!tableName) {
    console.warn('MARKETPLACE_PRODUCTS_TABLE not configured, skipping marketplace UPI update');
    return;
  }

  try {
    // Scan for all products belonging to this seller
    const scanResult = await marketplaceDdbClient.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: '#seller.#phone = :phone',
      ExpressionAttributeNames: {
        '#seller': 'seller',
        '#phone': 'phone',
      },
      ExpressionAttributeValues: {
        ':phone': sellerPhone,
      },
      ProjectionExpression: 'productId',
    }));

    const products = scanResult.Items || [];
    if (products.length === 0) {
      console.log('No marketplace products found for seller', sellerPhone);
      return;
    }

    console.log(`Updating ${products.length} marketplace products with UPI ID for seller ${sellerPhone}`);

    // Update each product's seller.upiId
    const updatePromises = products.map(product =>
      marketplaceDdbClient.send(new UpdateCommand({
        TableName: tableName,
        Key: { productId: product.productId },
        UpdateExpression: 'SET seller.upiId = :upiId, updatedAt = :now',
        ExpressionAttributeValues: {
          ':upiId': upiId,
          ':now': new Date().toISOString(),
        },
      }))
    );

    await Promise.all(updatePromises);
    console.log(`✅ Updated ${products.length} marketplace products with UPI ID: ${upiId}`);
  } catch (error: any) {
    console.error('⚠️ Failed to update marketplace products with UPI (non-critical):', error.message);
    // Non-critical — don't throw. Products will get UPI on next catalog sync.
  }
}
