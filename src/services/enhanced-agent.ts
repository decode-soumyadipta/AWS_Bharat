/**
 * Enhanced Personal AI Agent
 * 
 * Features:
 * - Extremely interactive and personal
 * - Dynamic language switching (Hindi/English/Marathi/Bengali)
 * - Web search for market prices
 * - WhatsApp typing indicator
 * - Zero hardcoded templates
 * - Careful order tracking
 * - Real-time market information
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { 
  getConversationContext, 
  addConversationMessage,
  updateUserPreferences,
  UserConversationContext 
} from './conversation-memory';
import { getPartialData, PartialCatalogItem } from './partial-data-store';
import { getUserState } from './state-manager';
import { sendTextMessage, sendTypingIndicator } from '../lambdas/whatsapp-message-sender';
import { remote_web_search } from '../tools/web-search'; // We'll create this

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
const NOVA_PRO_MODEL_ID = 'amazon.nova-pro-v1:0';

// Language codes
type LanguageCode = 'hi-IN' | 'en-IN' | 'mr-IN' | 'bn-IN';

/**
 * Enhanced agent response
 */
export interface EnhancedAgentResponse {
  message: string;
  actions?: AgentAction[];
  needsWebSearch?: boolean;
  searchQuery?: string;
  languageSwitch?: LanguageCode;
  confidence: number;
  reasoning: string;
}

export interface AgentAction {
  type: 'STORE_DATA' | 'REQUEST_IMAGE' | 'CREATE_CATALOG' | 'ASK_QUESTION' | 'WEB_SEARCH' | 'LANGUAGE_SWITCH';
  data?: any;
}

/**
 * Main enhanced agent processor
 */
export async function processWithEnhancedAgent(
  phone: string,
  userMessage: string,
  messageType: 'text' | 'voice' | 'image',
  currentLanguage: LanguageCode = 'hi-IN'
): Promise<EnhancedAgentResponse> {
  console.log('🤖 Enhanced Agent processing:', { phone, messageType, currentLanguage });

  // Show typing indicator immediately
  await showTypingIndicator(phone);

  // Get full context
  const conversationContext = await getConversationContext(phone);
  const partialData = await getPartialData(phone);
  const userState = await getUserState(phone);

  // Detect language switch request
  const detectedLanguage = detectLanguageSwitch(userMessage, currentLanguage);
  if (detectedLanguage !== currentLanguage) {
    console.log(`🌐 Language switch detected: ${currentLanguage} → ${detectedLanguage}`);
    await updateUserPreferences(phone, { language: detectedLanguage });
    currentLanguage = detectedLanguage;
  }

  // Track user message
  await addConversationMessage(phone, {
    timestamp: Date.now(),
    role: 'user',
    content: userMessage,
    messageType,
  });

  // Check if this is a market price query
  const priceQuery = detectPriceQuery(userMessage, currentLanguage);
  let marketInfo = '';
  
  if (priceQuery) {
    console.log('💰 Market price query detected:', priceQuery);
    marketInfo = await searchMarketPrice(priceQuery, currentLanguage);
  }

  // Build enhanced agent prompt
  const agentPrompt = buildEnhancedPrompt(
    userMessage,
    messageType,
    conversationContext,
    partialData,
    userState,
    currentLanguage,
    marketInfo
  );

  // Call Nova Pro
  const response = await callAgentModel(agentPrompt);

  // Parse response
  const agentResponse = parseEnhancedResponse(response, currentLanguage);

  // Track agent message
  await addConversationMessage(phone, {
    timestamp: Date.now(),
    role: 'assistant',
    content: agentResponse.message,
    messageType: 'text',
  });

  console.log('🤖 Enhanced agent response:', agentResponse);

  return agentResponse;
}

/**
 * Detect language switch request
 */
function detectLanguageSwitch(message: string, currentLang: LanguageCode): LanguageCode {
  const lower = message.toLowerCase();

  // English requests
  if (lower.includes('english') || lower.includes('angrezi') || lower.includes('इंग्लिश') || 
      lower.includes('ইংরেজি') || lower.includes('इंग्रेजी')) {
    return 'en-IN';
  }

  // Hindi requests
  if (lower.includes('hindi') || lower.includes('हिंदी') || lower.includes('हिन्दी')) {
    return 'hi-IN';
  }

  // Marathi requests
  if (lower.includes('marathi') || lower.includes('मराठी')) {
    return 'mr-IN';
  }

  // Bengali requests
  if (lower.includes('bengali') || lower.includes('bangla') || lower.includes('বাংলা') || 
      lower.includes('बंगाली')) {
    return 'bn-IN';
  }

  return currentLang;
}

/**
 * Detect market price query
 */
function detectPriceQuery(message: string, language: LanguageCode): string | null {
  const lower = message.toLowerCase();

  // Hindi patterns
  if (language === 'hi-IN') {
    if (lower.includes('भाव') || lower.includes('कीमत') || lower.includes('रेट') || 
        lower.includes('price') || lower.includes('market')) {
      // Extract product name
      const match = message.match(/([\u0900-\u097F\w]+)\s*(का|की|के)?\s*(भाव|कीमत|रेट|price)/i);
      if (match) {
        return match[1];
      }
    }
  }

  // English patterns
  if (language === 'en-IN') {
    if (lower.includes('price') || lower.includes('rate') || lower.includes('market')) {
      const match = message.match(/price\s+of\s+(\w+)|(\w+)\s+price|market\s+price\s+of\s+(\w+)/i);
      if (match) {
        return match[1] || match[2] || match[3];
      }
    }
  }

  // Marathi patterns
  if (language === 'mr-IN') {
    if (lower.includes('भाव') || lower.includes('किंमत')) {
      const match = message.match(/([\u0900-\u097F\w]+)\s*(चा|ची|चे)?\s*(भाव|किंमत)/i);
      if (match) {
        return match[1];
      }
    }
  }

  // Bengali patterns
  if (language === 'bn-IN') {
    if (lower.includes('দাম') || lower.includes('মূল্য')) {
      const match = message.match(/([\u0980-\u09FF\w]+)\s*(এর)?\s*(দাম|মূল্য)/i);
      if (match) {
        return match[1];
      }
    }
  }

  return null;
}

/**
 * Search market price using web search
 */
async function searchMarketPrice(product: string, language: LanguageCode): Promise<string> {
  try {
    const searchQuery = `${product} market price today India ${new Date().toISOString().split('T')[0]}`;
    
    // Use web search tool
    const searchResults = await remote_web_search({ query: searchQuery });

    if (searchResults && searchResults.length > 0) {
      const topResult = searchResults[0];
      return `📊 Market Info: ${topResult.snippet}\n🔗 Source: ${topResult.url}`;
    }

    return '';
  } catch (error) {
    console.error('Market price search failed:', error);
    return '';
  }
}

/**
 * Show typing indicator
 */
async function showTypingIndicator(phone: string): Promise<void> {
  try {
    await sendTypingIndicator(phone);
  } catch (error) {
    console.error('Failed to send typing indicator:', error);
  }
}

/**
 * Build enhanced agent prompt
 */
function buildEnhancedPrompt(
  userMessage: string,
  messageType: string,
  conversationContext: UserConversationContext | null,
  partialData: PartialCatalogItem | null,
  userState: any,
  language: LanguageCode,
  marketInfo: string
): string {
  const langName = {
    'hi-IN': 'Hindi',
    'en-IN': 'English',
    'mr-IN': 'Marathi',
    'bn-IN': 'Bengali'
  }[language];

  let prompt = '';

  // Agent identity based on language
  if (language === 'hi-IN') {
    prompt = `तुम "व्यापार वाणी" हो - एक बेहद व्यक्तिगत और देखभाल करने वाला AI व्यापार सहायक।

तुम्हारा व्यक्तित्व:
- तुम उपयोगकर्ता के सबसे अच्छे दोस्त और विश्वसनीय सलाहकार हो
- तुम हर ऑर्डर की बहुत सावधानी से देखभाल करते हो
- तुम बहुत इंटरैक्टिव हो - हमेशा सवाल पूछते हो
- तुम बहुत समझदार हो - उपयोगकर्ता की हर बात समझते हो
- तुम कभी भी हार्डकोडेड टेम्पलेट का उपयोग नहीं करते
- तुम हर बार नया, ताज़ा, प्राकृतिक जवाब देते हो
- तुम इमोजी का भरपूर उपयोग करते हो 😊
- तुम 2-3 वाक्यों में बात करते हो

तुम्हारी जिम्मेदारियां:
- हर ऑर्डर को पूरी तरह ट्रैक करना
- कोई भी जानकारी मिस न होने देना
- अगर कुछ अस्पष्ट है तो तुरंत पूछना
- उपयोगकर्ता को हर कदम पर गाइड करना
- उनके हर सवाल का जवाब देना
- मार्केट की जानकारी देना जब पूछें`;
  } else if (language === 'en-IN') {
    prompt = `You are "Vyapar Vaani" - an extremely personal and caring AI business assistant.

Your personality:
- You are the user's best friend and trusted advisor
- You take great care of every order
- You are very interactive - always asking questions
- You are very understanding - you get every point
- You NEVER use hardcoded templates
- You give fresh, natural responses every time
- You use emojis generously 😊
- You speak in 2-3 sentences

Your responsibilities:
- Track every order completely
- Never miss any information
- Ask immediately if something is unclear
- Guide user at every step
- Answer every question they have
- Provide market information when asked`;
  } else if (language === 'mr-IN') {
    prompt = `तू "व्यापार वाणी" आहेस - एक अत्यंत वैयक्तिक आणि काळजी घेणारा AI व्यापार सहाय्यक।

तुझे व्यक्तिमत्व:
- तू वापरकर्त्याचा सर्वात चांगला मित्र आणि विश्वासू सल्लागार आहेस
- तू प्रत्येक ऑर्डरची खूप काळजी घेतोस
- तू खूप संवादात्मक आहेस - नेहमी प्रश्न विचारतोस
- तू खूप समजूतदार आहेस - प्रत्येक गोष्ट समजतोस
- तू कधीही हार्डकोडेड टेम्पलेट वापरत नाहीस
- तू प्रत्येक वेळी नवीन, ताजे, नैसर्गिक उत्तर देतोस
- तू इमोजी भरपूर वापरतोस 😊
- तू 2-3 वाक्यांत बोलतोस`;
  } else { // Bengali
    prompt = `তুমি "ব্যাপার বাণী" - একজন অত্যন্ত ব্যক্তিগত এবং যত্নশীল AI ব্যবসা সহায়ক।

তোমার ব্যক্তিত্ব:
- তুমি ব্যবহারকারীর সেরা বন্ধু এবং বিশ্বস্ত পরামর্শদাতা
- তুমি প্রতিটি অর্ডারের খুব যত্ন নাও
- তুমি খুব ইন্টারঅ্যাক্টিভ - সবসময় প্রশ্ন জিজ্ঞাসা করো
- তুমি খুব বোঝাপড়ার - প্রতিটি কথা বোঝো
- তুমি কখনও হার্ডকোডেড টেমপ্লেট ব্যবহার করো না
- তুমি প্রতিবার নতুন, তাজা, প্রাকৃতিক উত্তর দাও
- তুমি ইমোজি প্রচুর ব্যবহার করো 😊
- তুমি 2-3 বাক্যে কথা বলো`;
  }

  // Add conversation history
  if (conversationContext && conversationContext.messages.length > 0) {
    const recentMessages = conversationContext.messages.slice(-10);
    prompt += `\n\n📜 Recent conversation:\n`;
    recentMessages.forEach(msg => {
      const role = msg.role === 'user' ? 'User' : 'You';
      prompt += `${role}: ${msg.content}\n`;
    });
  }

  // Add user patterns
  if (conversationContext && conversationContext.patterns.totalInteractions > 0) {
    const { patterns, preferences } = conversationContext;
    prompt += `\n\n📊 User history:
- Total chats: ${patterns.totalInteractions}
- Successful orders: ${patterns.successfulCatalogs}
- Preferred categories: ${preferences.preferredCategories?.join(', ') || 'None'}
- Typical price range: ₹${preferences.typicalPriceRange?.min || 0}-₹${preferences.typicalPriceRange?.max || 0}`;
  }

  // Add current order
  if (partialData) {
    prompt += `\n\n📦 Current order being tracked:
- Product: ${partialData.productName || '❓ Unknown'}
- Price: ${partialData.price ? `₹${partialData.price}/${partialData.unit}` : '❓ Unknown'}
- Quantity: ${partialData.quantity ? `${partialData.quantity} ${partialData.unit}` : '❓ Unknown'}
- Category: ${partialData.category || '❓ Unknown'}
- Photo: ${partialData.originalImageUrl ? '✅ Received' : '❌ Not received'}`;
  }

  // Add market info if available
  if (marketInfo) {
    prompt += `\n\n${marketInfo}`;
  }

  // Add current message
  prompt += `\n\n💬 User's new message (${messageType}):
"${userMessage}"

🎯 Your task:
1. Understand the user's message deeply
2. If anything is missing or unclear, ask caring questions
3. If you need market info, indicate WEB_SEARCH
4. Track the order carefully - don't miss anything
5. Be extremely interactive and personal
6. Generate a completely fresh, natural response
7. NO templates - every response should be unique

📝 Response format:
MESSAGE: [Your caring, personal message in ${langName}]
ACTION: [NONE/STORE_DATA/REQUEST_IMAGE/CREATE_CATALOG/ASK_QUESTION/WEB_SEARCH]
CONFIDENCE: [0-100]
REASONING: [Why you said this]

Respond now in ${langName}:`;

  return prompt;
}

/**
 * Call agent model
 */
async function callAgentModel(prompt: string): Promise<string> {
  const requestBody = {
    messages: [
      {
        role: 'user',
        content: [{ text: prompt }],
      },
    ],
    inferenceConfig: {
      max_new_tokens: 600,
      temperature: 0.8, // Higher for more creativity
      top_p: 0.95,
    },
  };

  const command = new InvokeModelCommand({
    modelId: NOVA_PRO_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody),
  });

  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  return responseBody.output.message.content[0].text.trim();
}

/**
 * Parse enhanced response
 */
function parseEnhancedResponse(response: string, language: LanguageCode): EnhancedAgentResponse {
  const lines = response.split('\n');
  let message = '';
  let action = 'NONE';
  let confidence = 85;
  let reasoning = '';

  for (const line of lines) {
    if (line.startsWith('MESSAGE:')) {
      message = line.replace('MESSAGE:', '').trim();
    } else if (line.startsWith('ACTION:')) {
      action = line.replace('ACTION:', '').trim();
    } else if (line.startsWith('CONFIDENCE:')) {
      confidence = parseInt(line.replace('CONFIDENCE:', '').trim()) || 85;
    } else if (line.startsWith('REASONING:')) {
      reasoning = line.replace('REASONING:', '').trim();
    }
  }

  // If no structured response, use entire response as message
  if (!message) {
    message = response;
  }

  const actions: AgentAction[] = [];
  if (action !== 'NONE') {
    actions.push({ type: action as any });
  }

  return {
    message,
    actions,
    needsWebSearch: action === 'WEB_SEARCH',
    confidence,
    reasoning,
  };
}

/**
 * Send agent message with typing indicator
 */
export async function sendEnhancedAgentMessage(
  phone: string,
  message: string,
  language: LanguageCode
): Promise<void> {
  // Show typing for realistic delay
  await showTypingIndicator(phone);
  
  // Wait a bit for natural feel (simulate thinking time)
  await new Promise(resolve => setTimeout(resolve, 1500));

  const lang = language.split('-')[0] as 'hi' | 'mr' | 'en' | 'bn';
  // Map Bengali to English for WhatsApp message sender (Bengali not yet supported)
  const whatsappLang = lang === 'bn' ? 'en' : lang;
  await sendTextMessage(phone, message, whatsappLang);
}
