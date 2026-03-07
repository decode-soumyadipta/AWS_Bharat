
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

function normalizeHindiNumbers(text: string): string {

  const numberWords: Record<string, number> = {

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

    'sau': 100, 'सौ': 100,

    'hazaar': 1000, 'हज़ार': 1000, 'hazar': 1000, 'hajaar': 1000, 'हजार': 1000,

    'lakh': 100000, 'लाख': 100000, 'lac': 100000,
    'crore': 10000000, 'करोड़': 10000000, 'karod': 10000000,

    'dedh sau': 150, 'डेढ़ सौ': 150,
    'dhai sau': 250, 'ढाई सौ': 250,
    'dedh': 1.5, 'डेढ़': 1.5,
    'dhai': 2.5, 'ढाई': 2.5,
    'sadhe': 0.5, 'साढ़े': 0.5,  
  };

  function wordBoundaryRegex(word: string, flags: string = 'gi'): RegExp {
    const isDevanagari = /[\u0900-\u097F]/.test(word);
    if (isDevanagari) {

      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?<=^|[\\s\\d])${escaped}(?=$|[\\s\\d])`, flags);
    }

    return new RegExp(`\\b${word}\\b`, flags);
  }

  let result = text;

  const compoundPatternAscii = /\b(ek|do|teen|char|panch|paanch|cheh|chhe|saat|aath|nau|das|bees|tees|chaalees|pachaas)\s+(sau|hazaar|hazar|hajaar|lakh|lac|crore|karod)\b/gi;
  result = result.replace(compoundPatternAscii, (match, multiplierWord, unitWord) => {
    const multiplier = numberWords[multiplierWord.toLowerCase()] || 1;
    const unit = numberWords[unitWord.toLowerCase()] || 1;
    return String(multiplier * unit);
  });

  const devanagariMultipliers = 'एक|दो|तीन|चार|पाँच|छह|सात|आठ|नौ|दस|बीस|तीस|चालीस|पचास';
  const devanagariUnits = 'सौ|हज़ार|हजार|लाख|करोड़';
  const compoundPatternDev = new RegExp(
    `(?<=^|[\\s\\d])(${devanagariMultipliers})\\s+(${devanagariUnits})(?=$|[\\s\\d])`, 'gi'
  );
  result = result.replace(compoundPatternDev, (match, multiplierWord, unitWord) => {
    const multiplier = numberWords[multiplierWord] || 1;
    const unit = numberWords[unitWord] || 1;
    return String(multiplier * unit);
  });

  const sortedWords = Object.entries(numberWords)
    .filter(([_, v]) => v >= 10) 
    .sort((a, b) => b[0].length - a[0].length);

  for (const [word, num] of sortedWords) {
    const regex = wordBoundaryRegex(word, 'gi');
    result = result.replace(regex, String(num));
  }

  result = result.replace(/\b1\.5\s+100\b/g, '150');
  result = result.replace(/\b2\.5\s+100\b/g, '250');
  result = result.replace(/\b1\.5\s+1000\b/g, '1500');
  result = result.replace(/\b2\.5\s+1000\b/g, '2500');

  result = result.replace(/(\d+)\s+(\d+)(?=\s*(rupaye|rupee|kilo|kg|gram|रुपये|किलो|ग्राम|rupaiye))/gi, 
    (match, n1, n2) => {
      const num1 = parseInt(n1);
      const num2 = parseInt(n2);

      if (num2 < num1) {
        return String(num1 + num2);
      }
      return match; 
    }
  );

  console.log(`🔢 Number normalization: "${text}" → "${result}"`);
  return result;
}

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

export const handler = async (event: any): Promise<any> => {
  console.log('🤖 Agent handler invoked:', JSON.stringify(event, null, 2));
  return processAgentEvent(event);
};

async function processAgentEvent(event: any): Promise<any> {
  try {
    const eventDetail = event.detail || event;
    const { phone, messageType, content } = eventDetail;
    let language = (eventDetail.language || 'hi-IN') as 'hi-IN' | 'en-IN' | 'mr-IN' | 'bn-IN';

    if (!phone) {
      throw new Error('Phone number is required');
    }

    const { sendTypingIndicator, markMessageAsRead, setLastMessageId } = await import('./whatsapp-message-sender');
    if (eventDetail.messageId) {
      setLastMessageId(phone, eventDetail.messageId);
      await markMessageAsRead(eventDetail.messageId, true);
    } else {

      await sendTypingIndicator(phone);
    }

    const userState = await getUserState(phone);
    const conversationContext = await getConversationContext(phone);
    const partialData = await getPartialData(phone);

    console.log('📊 Current state:', {
      state: userState?.state,
      hasPartialData: !!partialData,
      conversationLength: conversationContext?.messages.length || 0,
    });

    let userMessage = '';
    let shouldProcessWithAgent = true;

    switch (messageType) {
      case 'voice':
      case 'audio':
        await sendTypingIndicator(phone, eventDetail.messageId);
        userMessage = await handleVoiceMessage(eventDetail);
        await sendTypingIndicator(phone, eventDetail.messageId);
        break;

      case 'image':
        await sendTypingIndicator(phone, eventDetail.messageId);
        userMessage = await handleImageMessage(eventDetail, phone, language);
        if (userMessage === '__CONFIRMATION_TRIGGERED__' || userMessage === '__HANDLED__') {
          console.log('📸 Image handled directly, skipping agent processing');
          return { success: true, message: 'Image processed directly' };
        }
        await sendTypingIndicator(phone, eventDetail.messageId);
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

        console.warn('⚠️ Unknown message type:', messageType);
        userMessage = `[User sent a ${messageType || 'unknown'} message]`;
        break;
    }

    if (userMessage === '__VOICE_FAILED__') {
      console.log('⚠️ Voice transcription failed, asking user to retry or type');
      const voiceFailMsg: Record<string, string> = {
        'hi-IN': 'माफ़ करें, आपकी आवाज़ सुनाई नहीं दी। कृपया दुबारा बोलें या टाइप करें।',
        'mr-IN': 'माफ करा, तुमचा आवाज ऐकू आला नाही. कृपया पुन्हा बोला किंवा टाइप करा.',
        'en-IN': 'Sorry, I could not hear your voice message clearly. Please try again or type your message.',
      };
      try {
        await sendEnhancedAgentMessage(phone, voiceFailMsg[language] || voiceFailMsg['hi-IN'], language, 'voice');
      } catch (e) {
        console.error('Failed to send voice failure response:', e);
      }
      return { success: true };
    }

    if (!userMessage) {
      console.log('⚠️ No user message to process, sending helpful response');

      const emptyMsgResponse: Record<string, string> = {
        'hi-IN': 'मुझे आपका मैसेज समझ नहीं आया। कृपया दुबारा वॉइस मैसेज भेजें या टाइप करके बताएं की आपको क्या चाहिए।',
        'mr-IN': 'मला तुमचा मेसेज समजला नाही. कृपया पुन्हा व्हॉइस मेसेज पाठवा।',
        'en-IN': 'I couldn\'t understand your message. Please send a voice message again or type what you need.',
      };
      try {
        await sendEnhancedAgentMessage(phone, emptyMsgResponse[language] || emptyMsgResponse['hi-IN'], language, 'voice');
      } catch (e) {
        console.error('Failed to send empty message response:', e);
      }
      return { success: true };
    }

    if (userState?.state === 'CONFIRMATION_PENDING' && partialData) {

      if (detectVerbalConfirmation(userMessage)) {
        console.log('⚡ Verbal confirmation detected — directly approving catalog');
        await createCatalog(phone, language);
        return { success: true, message: 'Verbal confirmation → catalog created' };
      }

      const updateResult = await detectAndApplyUpdate(userMessage, phone, partialData, language, eventDetail.messageId);
      if (updateResult) {
        console.log('📝 Applied update in CONFIRMATION_PENDING:', updateResult);
        return { success: true, message: 'Update applied' };
      }
    }

    await sendTypingIndicator(phone, eventDetail.messageId);

    if (shouldProcessWithAgent) {
      const agentResponse = await processWithEnhancedAgent(
        phone,
        userMessage,
        messageType,
        language,
        eventDetail.messageId
      );

      console.log('🤖 Agent response:', agentResponse);

      if (agentResponse.languageSwitch) {
        console.log(`🌐 Applying language switch for voice: ${language} → ${agentResponse.languageSwitch}`);
        language = agentResponse.languageSwitch;
      }

      await sendTypingIndicator(phone, eventDetail.messageId);

      await sendEnhancedAgentMessage(
        phone, 
        agentResponse.message, 
        language, 
        agentResponse.responseMode || 'voice',
        eventDetail.messageId
      );

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

    try {
      const phone = event.detail?.phone || event.phone;
      const language = event.detail?.language || event.language || 'hi-IN';
      if (phone) {

        try { 
          const { sendTypingIndicator: sendTyp } = await import('./whatsapp-message-sender');
          await sendTyp(phone, (event.detail || event)?.messageId); 
        } catch (_) {}

        let errorMessage = '';
        const errMsg = error.message || '';

        if (errMsg.includes('transcription') || errMsg.includes('audio') || errMsg.includes('download')) {
          errorMessage = language === 'en-IN' 
            ? 'Your voice message was not clear. Could you send it again, a bit louder? You can also type your message if you prefer.' 
            : 'वॉइस मैसेज अच्छे से सुनाई नहीं दिया। क्या आप थोड़ा ज़ोर से दुबारा भेज सकते हैं? चाहें तो टाइप भी कर सकते हैं।';
        } else if (errMsg.includes('image') || errMsg.includes('Image')) {
          errorMessage = language === 'en-IN'
            ? 'That photo didn\'t come through properly. Could you send it once more? Make sure it\'s a clear photo of the product.'
            : 'फोटो ठीक से नहीं मिली। क्या आप दुबारा भेज सकते हैं? प्रोडक्ट की साफ फोटो भेजिए।';
        } else if (errMsg.includes('timeout') || errMsg.includes('Timeout')) {
          errorMessage = language === 'en-IN'
            ? 'That took a bit long. I\'m ready now. You can send a voice message or type what you need.'
            : 'थोड़ी देर हो गई। अब मैं तैयार हूँ। वॉइस मैसेज भेजिए या टाइप कर दीजिए क्या करना है।';
        } else {
          errorMessage = language === 'en-IN'
            ? 'Something went wrong on my end. Please tell me again. Send a voice message or type your question.'
            : 'मेरी तरफ से कुछ गड़बड़ हो गई। एक बार फिर बताइए। वॉइस मैसेज भेजें या टाइप करें।';
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

export function detectVerbalConfirmation(message: string): boolean {
  const m = message.toLowerCase().trim();

  const wordCount = m.split(/\s+/).length;

  const romanized = /\b(haan|ha|haa|han|ji\s*haan|yes|yeah|yep|yup|ok|okay|okie|theek\s*hai|thik\s*hai|sahi\s*hai|sahi|theek|thik|approve|approved|confirm|confirmed|done|bilkul|kar\s*do|kar\s*de|kar\s*dena|ban\s*jaye|chalega|chal|chalo|pakka|acha|accha|achha|achchha|ready|agreed|sab\s*theek|sab\s*thik|correct|right|laga\s*do|ho\s*gaya|ho\s*jayega|manzoor|rakh\s*do|chaaluuuu|chalu|daal\s*do|dal\s*do)\b/i;
  if (romanized.test(m)) return true;

  const hindi = /हाँ|हां|हा\b|जी\s*हाँ|जी\s*हां|ठीक\s*है|ठीक|सही\s*है|सही|हो\b|कर\s*दो|कर\s*दे|बन\s*जाये|बिल्कुल|पक्का|अच्छा|कन्फर्म|सब\s*ठीक|मंजूर|लगा\s*दो|रख\s*दो|डाल\s*दो|चालू|तैयार|हो\s*गया/;
  if (hindi.test(message)) return true;

  const marathi = /हो\b|होय|चालेल|ठीक\s*आहे|बरोबर|मंजूर|करा|करा\s*ना|ठीक|योग्य/;
  if (marathi.test(message)) return true;

  if (wordCount <= 2) {
    const shortAffirm = /^(ji|jee|hmm|hm|ho|हो|जी|हम्म)$/i;
    if (shortAffirm.test(m)) return true;
  }

  return false;
}

function autoDetectCategory(productName: string): string {
  if (!productName) return 'Grocery';
  const p = productName.toLowerCase();

  const vegetables = ['tomato','tamatar','potato','aloo','alu','onion','pyaaz','pyaz','cauliflower','gobi','lauki','tori','karela','baingan','matar','palak','methi','shimla','bhindi','mooli','gajar','kakdi','mirchi','adrak','lehsun','cabbage','patta','brinjal','spinach','ladyfinger','cucumber','radish','carrot','capsicum','pumpkin','kaddu','kathal','jackfruit','टमाटर','आलू','प्याज','गोभी','लौकी','करेला','बैंगन','मटर','पालक','मेथी','भिंडी','मूली','गाजर','मिर्ची','अदरक','लहसुन'];
  const fruits = ['mango','aam','banana','kela','apple','seb','orange','santra','grapes','angur','papaya','guava','amrud','litchi','watermelon','tarbooz','muskmelon','kharbooz','pomegranate','anar','pear','nashpati','lemon','nimbu','coconut','nariyal','आम','केला','सेब','संतरा','अनार','नींबू','नारियल'];
  const grains = ['wheat','gehu','gehun','rice','chawal','maize','makka','bajra','jowar','chana','dal','lentil','arhar','moong','urad','atta','maida','sooji','besan','barley','jau','oats','गेहूं','चावल','दाल','मक्का','बाजरा','ज्वार','आटा'];
  const dairy = ['milk','doodh','curd','dahi','paneer','ghee','butter','makhan','lassi','cheese','khoa','mawa','rabri','दूध','दही','पनीर','घी','मक्खन'];
  const spices = ['haldi','turmeric','jeera','cumin','dhaniya','coriander','mirch','garam','masala','kali','saunf','laung','elaichi','cardamom','clove','cinnamon','dalchini','kesar','saffron','हल्दी','जीरा','धनिया','मसाला','इलायची','लौंग'];
  const eggs = ['egg','anda','chicken','murgi','mutton','fish','machli','goat','बकरी','मुर्गी','अंडा'];
  const grocery = ['oil','tel','sugar','cheeni','salt','namak','dry fruit','kishmish','badam','kaju','cashew','almond','raisin','pickle','achar','honey','shahad','tea','chai','coffee'];

  if (vegetables.some(v => p.includes(v))) return 'Vegetables';
  if (fruits.some(f => p.includes(f))) return 'Fruits';
  if (grains.some(g => p.includes(g))) return 'Grains';
  if (dairy.some(d => p.includes(d))) return 'Dairy';
  if (spices.some(s => p.includes(s))) return 'Spices';
  if (eggs.some(e => p.includes(e))) return 'Eggs & Poultry';
  if (grocery.some(g => p.includes(g))) return 'Grocery';
  return 'Grocery'; 
}

async function detectAndApplyUpdate(
  message: string,
  phone: string,
  partialData: any,
  language: string,
  messageId?: string
): Promise<string | null> {

  const pricePatterns = [
    /(?:keemat|kimat|price|daam|dam|rate)\s*(?:₹|rs\.?)?\s*(\d+)/i,
    /(?:₹|rs\.?)\s*(\d+)/i,
    /(\d+)\s*(?:rupees?|rupi?ye?)\b/i,
    /कीमत\s*(?:₹)?\s*(\d+)/,
    /(\d+)\s*रुपये?\b/,
    /किंमत\s*(?:₹)?\s*(\d+)/,
    /दाम\s*(?:₹)?\s*(\d+)/,
  ];

  const quantityPatterns = [
    /(?:matra|quantity|qty|kitna|kitne)\s*(\d+)/i,
    /(\d+)\s*(?:kg|kilo(?:gram)?|पीस|piece|pcs|dozen|दर्जन|liter|litre|packet|bag|bundle|गट्ठा)/i,
    /(?:किलो|मात्रा|प्रमाण)\s*(\d+)/,
    /(\d+)\s*(?:kgs?|kilos?)\b/i,
    /(\d+)\s*(?:किलो|ग्राम|लीटर)\b/,
  ];

  const unitMap: Record<string, string> = {
    kg: 'kg', kilo: 'kg', kilogram: 'kg', किलो: 'kg', ग्राम: 'gram',
    piece: 'piece', pcs: 'piece', पीस: 'piece',
    dozen: 'dozen', दर्जन: 'dozen',
    liter: 'liter', litre: 'liter', लीटर: 'liter',
    packet: 'packet', पैकेट: 'packet',
    bag: 'bag', बैग: 'bag',
    bundle: 'bundle', गट्ठा: 'bundle',
  };
  function extractUnit(msg: string): string | null {
    for (const [word, unit] of Object.entries(unitMap)) {
      const re = new RegExp(`\\b${word}\\b`, 'i');
      if (re.test(msg)) return unit;
    }
    return null;
  }

  let newPrice: number | null = null;
  let newQty: number | null = null;
  let newUnit: string | null = null;

  for (const pattern of pricePatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const candidate = parseInt(match[1]);
      if (candidate > 0 && candidate < 1000000) {
        newPrice = candidate;
        break;
      }
    }
  }

  for (const pattern of quantityPatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const candidate = parseInt(match[1]);
      if (candidate > 0 && candidate < 100000) {

        if (newPrice === null || candidate !== newPrice) {
          newQty = candidate;
          newUnit = extractUnit(message);
          break;
        }
      }
    }
  }

  const looksLikeUpi = /\w+@\w+/.test(message);
  const bareNumberMatch = message.match(/^[^\d]*(\d+)[^\d]*$/);
  if (bareNumberMatch && newPrice === null && newQty === null && !looksLikeUpi) {
    const bare = parseInt(bareNumberMatch[1]);
    if (bare > 0 && bare < 1000000) {
      if (partialData?.price && !partialData?.quantity) {

        newQty = bare;
        newUnit = extractUnit(message);
      } else {

        newPrice = bare;
      }
    }
  }

  if (newPrice === null && newQty === null) return null;

  const updates: Record<string, any> = { source: 'text' };
  const summary: string[] = [];
  if (newPrice !== null) { updates.price = newPrice; summary.push(`price=₹${newPrice}`); }
  if (newQty !== null)   { updates.quantity = newQty; summary.push(`qty=${newQty}`); }
  if (newUnit !== null)  { updates.unit = newUnit; }

  console.log(`📝 Applying CONFIRMATION_PENDING updates:`, updates);
  await mergePartialData(phone, updates);

  const { sendEnhancedAgentMessage } = await import('../services/enhanced-agent');
  const ackMessages: Record<string, string> = {
    'hi-IN': newPrice !== null && newQty !== null
      ? `ठीक है, कीमत ${newPrice} और मात्रा ${newQty} कर दिया। अभी नई confirmation भेज रहे हैं।`
      : newPrice !== null
        ? `ठीक है, कीमत ${newPrice} रुपये कर दिया। अभी नई confirmation भेज रहे हैं।`
        : `ठीक है, मात्रा ${newQty} कर दिया। अभी नई confirmation भेज रहे हैं।`,
    'mr-IN': newPrice !== null && newQty !== null
      ? `ठीक आहे, किंमत ${newPrice} आणि प्रमाण ${newQty} केले. नवीन confirmation पाठवत आहे.`
      : newPrice !== null
        ? `ठीक आहे, किंमत ${newPrice} रुपये केली. नवीन confirmation पाठवत आहे.`
        : `ठीक आहे, प्रमाण ${newQty} केले. नवीन confirmation पाठवत आहे.`,
    'en-IN': newPrice !== null && newQty !== null
      ? `Got it — updated price to ₹${newPrice} and quantity to ${newQty}. Sending a new confirmation now.`
      : newPrice !== null
        ? `Got it — updated price to ₹${newPrice}. Sending a new confirmation now.`
        : `Got it — updated quantity to ${newQty}. Sending a new confirmation now.`,
  };
  await sendEnhancedAgentMessage(phone, ackMessages[language] || ackMessages['hi-IN'], language as any, 'voice');

  try {
    const confirmationFunctionName = process.env.CONFIRMATION_HANDLER_FUNCTION_NAME || 'vyapar-vaani-confirmation-handler';
    const { InvokeCommand } = await import('@aws-sdk/client-lambda');
    const { lambdaClient } = await import('../config/aws-clients');
    await lambdaClient.send(new InvokeCommand({
      FunctionName: confirmationFunctionName,
      InvocationType: 'Event', 
      Payload: JSON.stringify({ detail: { phone, action: 'generate', messageId } }),
    }));
    console.log('✅ Confirmation handler re-invoked after update (messageId:', messageId, ')');
  } catch (confErr) {
    console.error('⚠️ Confirmation handler re-invoke failed:', confErr);
  }

  return summary.join(', ');
}

async function handleVoiceMessage(eventDetail: any): Promise<string> {
  console.log('Handling voice message:', eventDetail.content.mediaUrl);

  const { downloadAudio } = await import('../services/media-download');
  const bucketName = process.env.PRODUCTS_BUCKET_NAME;

  if (!bucketName) {
    console.error('PRODUCTS_BUCKET_NAME not configured for voice');
    return ''; 
  }

  console.log('Downloading audio from WhatsApp...');
  const downloadResult = await downloadAudio(eventDetail.content.mediaUrl, bucketName);

  if (!downloadResult.success || !downloadResult.s3Url) {
    console.error('Audio download failed:', downloadResult.error);
    return ''; 
  }

  console.log('Audio downloaded successfully:', downloadResult.s3Url);

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
    return '__VOICE_FAILED__'; 
  }

  console.log('Transcription successful:', transcriptionResult.transcription);

  const normalizedText = normalizeHindiNumbers(transcriptionResult.transcription);
  return normalizedText;
}

async function handleImageMessage(
  eventDetail: any,
  phone: string,
  language: string
): Promise<string> {
  const partialData = await getPartialData(phone);

  const { downloadImage } = await import('../services/media-download');
  const bucketName = process.env.PRODUCTS_BUCKET_NAME;

  if (!bucketName) {
    console.error('PRODUCTS_BUCKET_NAME not configured for image');
    const errMsg: Record<string, string> = {
      'hi-IN': 'Photo mili, lekin process karne mein dikkat hui. Kripya product ki saaf photo dubara bhejiye.',
      'mr-IN': 'Photo milala, pan process kartana adchan aali. Krupya utpadnacha spasht photo punha pathva.',
      'en-IN': 'Got the photo but had trouble processing it. Please send a clear product photo again.',
    };
    await sendEnhancedAgentMessage(phone, errMsg[language] || errMsg['hi-IN'], language as any, 'voice');
    return '__HANDLED__';
  }

  const downloadResult = await downloadImage(eventDetail.content.mediaUrl, bucketName);
  if (!downloadResult.success || !downloadResult.s3Url) {
    console.error('Image download failed');
    const errMsg: Record<string, string> = {
      'hi-IN': 'Photo download nahi ho payi. Kripya product ki photo dubara bhejiye.',
      'mr-IN': 'Photo download zala nahi. Krupya utpadnacha photo punha pathva.',
      'en-IN': 'Couldn\'t download the photo. Please send the product photo again.',
    };
    await sendEnhancedAgentMessage(phone, errMsg[language] || errMsg['hi-IN'], language as any, 'voice');
    return '__HANDLED__';
  }

  await mergePartialData(phone, { originalImageUrl: downloadResult.s3Url });
  console.log('📸 Image stored in partial data:', downloadResult.s3Url);

  if (!partialData || !partialData.productName) {

    await new Promise(resolve => setTimeout(resolve, 2000));
    const refreshedData = await getPartialData(phone);

    if (refreshedData && refreshedData.productName) {

      console.log('📸 Product context available after brief wait, continuing with image processing');
    } else {

      const guidance: Record<string, string> = {
        'hi-IN': 'Photo mil gayi! Ab voice message mein product ka naam aur daam bata dijiye, jaise "tamatar pachaas rupaye kilo". Photo automatically jud jaayegi.',
        'mr-IN': 'Photo milala! Aata voice message madhye product che naav aani kimmat sanga, jase "tomato pachaas rupaye kilo". Photo aapoaap judel.',
        'en-IN': 'Got your photo! Now send a voice message with the product name and price, like "tomato fifty rupees per kilo". The photo will be linked automatically.',
      };
      await sendEnhancedAgentMessage(phone, guidance[language] || guidance['hi-IN'], language as any, 'voice');
      return '__HANDLED__';
    }
  }

  const { handler: enhancementHandler } = await import('./image-enhancement');

  try {
    const currentPartial = await getPartialData(phone);
    const enhancementResult = await enhancementHandler({
      rawImageUrl: downloadResult.s3Url,
      productName: currentPartial?.productName || partialData?.productName || 'Product',
      productCategory: currentPartial?.category || partialData?.category,
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

  const updatedPartial = await getPartialData(phone);
  const hasMissingFields = updatedPartial?.missingFields && updatedPartial.missingFields.length > 0;

  const PLACEHOLDER_NAMES_IMG = ['product', 'item', 'goods', 'unknown', 'na', 'n/a', 'product name', 'any product'];
  const imgProductNameLower = (updatedPartial?.productName || '').toLowerCase().trim();
  const imgHasRealProductName = !!(updatedPartial?.productName) &&
    !PLACEHOLDER_NAMES_IMG.includes(imgProductNameLower) &&
    imgProductNameLower.length >= 2;

  if (updatedPartial && !hasMissingFields && imgHasRealProductName) {

    console.log('✅ All fields + image present (real product name), triggering confirmation flow');
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
      const summary = `${updatedPartial.productName}, ${updatedPartial.price} rupaye per ${updatedPartial.unit}, ${updatedPartial.quantity} ${updatedPartial.unit}. Kya yeh sahi hai? Haan bolein ya badlav bataayein.`;
      await sendEnhancedAgentMessage(phone, summary, language as any, 'both');
    }
    return '__CONFIRMATION_TRIGGERED__';
  }

  const missingStr = updatedPartial?.missingFields?.join(', ') || 'details';
  console.log('📸 Image received but missing fields:', missingStr);
  const missingLabel = missingStr === 'price' ? 'keemat' : missingStr === 'quantity' ? 'matra' : missingStr === 'unit' ? 'ikaai, jaise kilo ya piece' : 'kuch jaankari';
  const askMissing: Record<string, string> = {
    'hi-IN': `Photo mil gayi! Ab bas ${missingLabel} bata dijiye toh product jod deta hoon.`,
    'mr-IN': `Photo milala! Aata phakta ${missingStr} sanga mhanje utpadan jodto.`,
    'en-IN': `Got the photo! Just tell me the ${missingStr} and I'll add your product.`,
  };
  await sendEnhancedAgentMessage(phone, askMissing[language] || askMissing['hi-IN'], language as any, 'voice');
  return '__HANDLED__';
}

async function handleButtonClick(
  eventDetail: any,
  phone: string,
  language: string
): Promise<string> {
  const buttonPayload = eventDetail.content.buttonPayload;

  let userMessage = '';

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

      await createCatalog(phone, language);
      return '__HANDLED__';

    case 'edit_quantity':
      userMessage = 'I want to edit the quantity';
      break;

    case 'view_products':
      userMessage = 'I want to view my products';
      break;

    default:
      userMessage = `Button clicked: ${buttonPayload}`;
  }

  const agentResponse = await processWithEnhancedAgent(phone, userMessage, 'text', language as any, eventDetail.messageId);
  return agentResponse.message;
}

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

function buildStockVoiceMessage(
  stockResults: Array<{ name: string; remainingQty: number; orderedQty: number; unit: string; outOfStock: boolean }>,
  lang: string
): string {
  if (stockResults.length === 0) return '';

  const isHindi = lang === 'hi' || lang === 'hi-IN';
  const lines = stockResults.map(s => {
    if (s.outOfStock) {
      return isHindi
        ? `${s.name} का स्टॉक खत्म हो गया। ${s.orderedQty} ${s.unit} बिक गए।`
        : `${s.name} is out of stock. ${s.orderedQty} ${s.unit} sold.`;
    }
    return isHindi
      ? `${s.name} में ${s.remainingQty} ${s.unit} बाकी हैं। ${s.orderedQty} ${s.unit} बिके।`
      : `${s.name} has ${s.remainingQty} ${s.unit} left. ${s.orderedQty} ${s.unit} sold.`;
  });

  const header = isHindi ? 'स्टॉक अपडेट' : 'Stock Update';
  const warning = stockResults.some(s => s.outOfStock)
    ? (isHindi ? ' कुछ उत्पादों का स्टॉक खत्म है, कृपया अपडेट करें।' : ' Some products are out of stock. Please restock.')
    : '';

  return `${header}। ${lines.join(' ')}${warning}`;
}

async function handleOrderAcceptReject(
  sellerPhone: string,
  orderId: string,
  decision: 'ACCEPTED' | 'REJECTED',
  language: string
): Promise<void> {
  try {
    console.log(`📦 Order ${decision}: ${orderId} by seller ${sellerPhone}`);

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

      const sellerMsg = lang === 'hi'
        ? `✅ ऑर्डर स्वीकार किया!\n\n📦 ${itemSummary}\n💰 ₹${totalAmount}\n💳 ${paymentMethod === 'UPI' ? 'UPI भुगतान' : 'कैश ऑन डिलीवरी'}\n\n${paymentMethod === 'UPI' ? '💡 UPI भुगतान आने का इंतजार करें। भुगतान मिलने पर आपको सूचना मिलेगी।' : '📦 कृपया ऑर्डर पैक करें और डिलीवरी की तैयारी करें!'}`
        : `✅ Order Accepted!\n\n📦 ${itemSummary}\n💰 ₹${totalAmount}\n💳 ${paymentMethod === 'UPI' ? 'UPI Payment' : 'Cash on Delivery'}\n\n${paymentMethod === 'UPI' ? '💡 Wait for UPI payment. You will be notified when payment is received.' : '📦 Please pack the order and prepare for delivery!'}`;
      await sendEnhancedAgentMessage(sellerPhone, sellerMsg, language as any, 'voice');

      if (buyerPhone) {
        const buyerMsg = lang === 'hi'
          ? `🎉 आपका ऑर्डर स्वीकार हो गया!\n\n📦 ${itemSummary}\n💰 ₹${totalAmount}\n\n${paymentMethod === 'UPI' ? '💳 कृपया UPI से ₹' + totalAmount + ' भुगतान करें। भुगतान के बाद स्क्रीनशॉट या रेफरेंस नंबर भेजें।' : '💵 कैश ऑन डिलीवरी - डिलीवरी के समय भुगतान करें।'}\n\n🚚 डिलीवरी जल्द होगी!`
          : `🎉 Your order has been accepted!\n\n📦 ${itemSummary}\n💰 ₹${totalAmount}\n\n${paymentMethod === 'UPI' ? '💳 Please pay ₹' + totalAmount + ' via UPI. Send screenshot or reference number after payment.' : '💵 Cash on Delivery - Pay when your order is delivered.'}\n\n🚚 Delivery coming soon!`;
        await sendEnhancedAgentMessage(buyerPhone, buyerMsg, language as any, 'both');
      }

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

      const sellerMsg = lang === 'hi'
        ? `ऑर्डर अस्वीकार किया गया। ग्राहक को सूचित कर दिया गया है। अगर कोई और ऑर्डर आए तो आपको बताएंगे।`
        : `Order rejected. The buyer has been notified. We'll let you know when new orders come in.`;
      await sendEnhancedAgentMessage(sellerPhone, sellerMsg, language as any, 'voice');

      if (buyerPhone) {
        const buyerMsg = lang === 'hi'
          ? `माफ़ कीजिए, विक्रेता ने आपका ऑर्डर स्वीकार नहीं किया। ${itemSummary}. कृपया दूसरे विक्रेता से ऑर्डर करें।`
          : `Sorry, the seller couldn't accept your order. ${itemSummary}. Please try ordering from another seller.`;
        await sendEnhancedAgentMessage(buyerPhone, buyerMsg, language as any, 'both');
      }
    }
  } catch (error: any) {
    console.error('❌ Failed to handle order accept/reject:', error);
    try {
      const lang = language.split('-')[0] as 'hi' | 'mr' | 'en';
      const errMsg = lang === 'hi'
        ? 'ऑर्डर प्रोसेस करने में समस्या हुई। कृपया दुबारा कोशिश करें।'
        : 'There was an issue processing the order. Please try again.';
      await sendEnhancedAgentMessage(sellerPhone, errMsg, language as any, 'voice');
    } catch (e) {
      console.error('Failed to send error msg:', e);
    }
  }
}

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

            if (!action.data.category || action.data.category === 'Unknown') {
              const productNameForCategory = action.data.productName || '';
              action.data.category = autoDetectCategory(productNameForCategory);
            }

            const merged = await mergePartialData(phone, action.data);
            console.log('📦 STORE_DATA merged:', {
              productName: merged.productName,
              price: merged.price,
              quantity: merged.quantity,
              unit: merged.unit,
              missingFields: merged.missingFields,
              hasImage: !!(merged.originalImageUrl || merged.enhancedImageUrl),
            });

            try {
              const { addConversationMessage } = await import('../services/conversation-memory');
              await addConversationMessage(phone, {
                timestamp: Date.now(),
                role: 'system',
                content: `Product data stored: ${merged.productName || 'unknown'}`,
                messageType: 'text',
                metadata: {
                  event: 'store_data',
                  productName: merged.productName,
                  price: merged.price,
                  quantity: merged.quantity,
                  unit: merged.unit,
                  category: merged.category || action.data.category,
                },
              });
            } catch (memErr) {
              console.warn('Failed to track STORE_DATA in conversation memory:', memErr);
            }

            const allFieldsPresent = !merged.missingFields || merged.missingFields.length === 0;
            const hasImage = !!(merged.originalImageUrl || merged.enhancedImageUrl);
            const currentState = (await getUserState(phone))?.state;

            const PLACEHOLDER_NAMES = ['product', 'item', 'goods', 'unknown', 'na', 'n/a', 'product name', 'any product'];
            const productNameLower = (merged.productName || '').toLowerCase().trim();
            const hasRealProductName = !!(merged.productName) &&
              !PLACEHOLDER_NAMES.includes(productNameLower) &&
              productNameLower.length >= 2;

            if (allFieldsPresent && hasRealProductName && hasImage) {

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
            } else if (allFieldsPresent && hasRealProductName && !hasImage) {

              console.log('📸 All fields present, moving to IMAGE_PENDING');
              await updateUserState(phone, 'IMAGE_PENDING');
            } else if (currentState === 'KYC_VERIFIED' || currentState === 'ACTIVE' || currentState === 'GUEST_ACTIVE') {

              console.log('📝 Partial data or placeholder name, moving to VOICE_RECEIVED');
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

        case 'SKIP_KYC':

          console.log('Guest mode: skipping KYC for', phone);
          await updateUserState(phone, 'GUEST_ACTIVE');

          try {
            const { createSellerProfile, getSellerByPhone } = await import('../services/dynamodb-repository');
            const existingSeller = await getSellerByPhone(phone);
            if (!existingSeller) {
              const { randomUUID } = await import('crypto');
              const sellerId = randomUUID();
              const now = Date.now();
              await createSellerProfile({
                PK: `SELLER#${sellerId}`,
                SK: 'PROFILE',
                GSI1PK: phone,
                GSI1SK: 'PROFILE',
                entityType: 'SELLER_PROFILE',
                sellerId,
                phone,
                name: '',
                language: language.split('-')[0] as 'hi' | 'mr' | 'en',
                onboardingState: 'GUEST',
                kyc: { panNumber: '', verified: false } as any,
                ondc: { subscriberId: '', subscriberUrl: '', signingPublicKey: '', encryptionPublicKey: '' },
                createdAt: now,
                updatedAt: now,
              });

              const { updateUserSellerId } = await import('../services/state-manager');
              await updateUserSellerId(phone, sellerId);
            }
          } catch (e) {
            console.warn('Guest seller profile creation failed (non-blocking):', e);
          }

          await new Promise(resolve => setTimeout(resolve, 2000));
          const { sendOnboardingGuide } = await import('../services/onboarding-guide');
          await sendOnboardingGuide(phone, language);

          await updateUserState(phone, 'GUEST_ACTIVE', { guideSent: true });
          break;

        default:
          console.log('⚠️ Unknown action type:', action.type);
      }
    } catch (actionError: any) {
      console.error(`❌ Action ${action.type} failed:`, actionError.message);

    }
  }
}

async function createCatalog(phone: string, language: string): Promise<void> {
  const partialData = await getPartialData(phone);

  if (!partialData) {
    console.warn('⚠️ CREATE_CATALOG called but no partial data found');
    const lang = language.split('-')[0] as 'hi' | 'mr' | 'en';
    const msg = lang === 'hi'
      ? 'Product ki jaankari abhi puri nahi hai. Pehle product ka naam, price aur photo bhejiye.'
      : 'Product information is incomplete. Please send product name, price, and photo first.';
    await sendEnhancedAgentMessage(phone, msg, language as any, 'voice');
    return;
  }

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

  await updateUserState(phone, 'ACTIVE');
  await deletePartialData(phone);
  await trackSuccessfulCatalog(phone);

  try {
    const seller = await getSellerByPhone(phone);
    if (seller) {
      const profileUpdates: Record<string, any> = { onboardingState: 'ACTIVE' };

      if (partialData?.productName) {
        const existingCrops = seller.cropsGrown || [];
        const newCrop = partialData.productName.toLowerCase().trim();
        if (!existingCrops.some((c: string) => c.toLowerCase() === newCrop)) {
          profileUpdates.cropsGrown = [...existingCrops, partialData.productName.trim()];
        }
      }
      await updateSellerProfile(seller.sellerId, profileUpdates);
      console.log('✅ Seller profile marked ACTIVE with GSI5 + cropsGrown updated');
    }
  } catch (e) {
    console.warn('Non-critical: failed to update seller profile', e);
  }

  const lang = language.split('-')[0] as 'hi' | 'mr' | 'en';
  const successMsg = lang === 'hi'
    ? '✅ आपका उत्पाद सफलतापूर्वक जोड़ा गया है। अब यह ऑनलाइन बिक्री के लिए तैयार है।'
    : lang === 'mr'
    ? '✅ तुमचे उत्पादन यशस्वीरित्या जोडले गेले आहे. आता ते ऑनलाइन विक्रीसाठी तयार आहे.'
    : '✅ Your product has been successfully added. It\'s now ready for online sale.';

  await sendEnhancedAgentMessage(phone, successMsg, language as any, 'both');
}

async function deleteProduct(phone: string, productName: string, language: string): Promise<void> {
  try {

    const catalogItems = await getCatalogItemsBySeller(phone);

    if (!catalogItems || catalogItems.length === 0) {
      console.log('❌ No catalog items found for seller:', phone);
      return;
    }

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

    await deleteCatalogItem(phone, itemId);

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

async function registerUpi(phone: string, upiId: string, language: string): Promise<void> {
  try {
    if (!upiId || !upiId.includes('@')) {
      console.log('❌ Invalid UPI ID:', upiId);
      const lang = language.split('-')[0] as 'hi' | 'mr' | 'en';
      const invalidMsg = lang === 'hi'
        ? '❌ UPI ID सही नहीं लग रहा। कृपया सही UPI ID बताएं जिसमें @ लगा हो, जैसे: name@oksbi, 9876543210@paytm, shop@ybl'
        : '❌ Invalid UPI ID. Please provide a valid one with @ symbol (e.g., name@oksbi, 9876543210@paytm, shop@ybl)';
      await sendEnhancedAgentMessage(phone, invalidMsg, language as any, 'voice');
      return;
    }

    let seller: any = null;
    try {
      seller = await getSellerByPhone(phone);
    } catch (lookupErr) {
      console.warn('⚠️ Seller lookup failed, will try to create:', lookupErr);
    }

    if (seller) {

      const sellerId = seller.PK.replace('SELLER#', '');
      await updateSellerProfile(sellerId, { upiId });
      console.log('✅ UPI ID registered for existing seller:', phone, upiId);
    } else {

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
      ? `✅ UPI ID *${upiId}* सफलतापूर्वक रजिस्टर हो गया। अब ग्राहक सीधे UPI से भुगतान कर सकते हैं।`
      : lang === 'mr'
      ? `✅ UPI ID *${upiId}* यशस्वीरित्या नोंदणीकृत। आता ग्राहक थेट UPI ने पैसे देऊ शकतात।`
      : `✅ UPI ID *${upiId}* registered successfully. Customers can now pay you directly via UPI.`;
    await sendEnhancedAgentMessage(phone, successMsg, language as any, 'both');

    await updateMarketplaceProductsUpi(phone, upiId);

  } catch (error: any) {
    console.error('❌ Failed to register UPI:', error);

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

async function updateMarketplaceProductsUpi(sellerPhone: string, upiId: string): Promise<void> {
  const tableName = process.env.MARKETPLACE_PRODUCTS_TABLE;
  if (!tableName) {
    console.warn('MARKETPLACE_PRODUCTS_TABLE not configured, skipping marketplace UPI update');
    return;
  }

  try {

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

  }
}
