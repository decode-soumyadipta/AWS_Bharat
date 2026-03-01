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
import { sendTextMessage, sendTypingIndicator, sendTextWithVoice, sendVoiceOnly } from '../lambdas/whatsapp-message-sender';
import { remote_web_search, getLocalMarketPrice } from '../tools/web-search';
import { 
  getTopSellingProducts, 
  getSalesSummary, 
  getDateRangeAnalytics,
  formatDateRangeAnalytics,
  formatTopSellingProducts 
} from './analytics-service';

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
  /** 'voice' = voice-only, 'text' = text-only, 'both' = text + voice */
  responseMode: 'voice' | 'text' | 'both';
}

export interface AgentAction {
  type: 'STORE_DATA' | 'REQUEST_IMAGE' | 'CREATE_CATALOG' | 'ASK_QUESTION' | 'LANGUAGE_SWITCH' | 'DELETE_PRODUCT' | 'REGISTER_UPI';
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
    await showTypingIndicator(phone); // Keep typing active while searching
    marketInfo = await searchMarketPrice(priceQuery, currentLanguage);
    await showTypingIndicator(phone); // Refresh after search
  }

  // Auto-fetch market price if user is adding a product (has partial data with product name)
  if (!priceQuery && partialData?.productName && !partialData.price) {
    console.log('💰 Auto-fetching market price for product being added:', partialData.productName);
    const autoMarketPrice = getLocalMarketPrice(partialData.productName);
    if (autoMarketPrice.found) {
      marketInfo = `📋 आज का बाज़ार भाव ${partialData.productName}: ${autoMarketPrice.priceInfo} (${autoMarketPrice.sourceName})`;
    }
  }

  // Check if this is an analytics query
  const analyticsQuery = detectAnalyticsQuery(userMessage, currentLanguage);
  let analyticsInfo = '';
  
  if (analyticsQuery) {
    console.log('📊 Analytics query detected:', analyticsQuery);
    analyticsInfo = await getAnalyticsInfo(phone, analyticsQuery, currentLanguage);
  }

  // Fetch seller profile for UPI status
  let sellerInfo: { upiId?: string; name?: string } = {};
  try {
    const { getSellerByPhone } = await import('./dynamodb-repository');
    const seller = await getSellerByPhone(phone);
    if (seller) {
      sellerInfo = { upiId: seller.upiId, name: seller.name };
    }
  } catch (e) {
    console.warn('Could not fetch seller info for prompt:', e);
  }

  // Build enhanced agent prompt
  const agentPrompt = buildEnhancedPrompt(
    userMessage,
    messageType,
    conversationContext,
    partialData,
    userState,
    currentLanguage,
    marketInfo,
    analyticsInfo,
    sellerInfo
  );

  // Keep typing active while model thinks
  await showTypingIndicator(phone);

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
 * Detect analytics query - extremely broad pattern matching
 * Returns { type: 'yesterday'|'today'|'last_week'|'last_month'|'top_selling'|'sales_summary', product?: string }
 */
function detectAnalyticsQuery(message: string, language: LanguageCode): { type: string; product?: string } | null {
  const lower = message.toLowerCase();

  // Romanized Hindi (most common for voice transcription)
  const romanizedYesterday = /\b(kal|yesterday|parso|beeta\s*kal|pichhla\s*din)\b/i;
  const romanizedToday = /\b(aaj|today|abhi)\b/i;
  const romanizedWeek = /\b(hafta|hafte|week|pichh?le?\s*(hafta|hafte|week)|last\s*week|saptah)\b/i;
  const romanizedMonth = /\b(mahina|mahine|month|pichh?le?\s*(mahina|mahine|month)|last\s*month)\b/i;
  const romanizedSoldPatterns = /\b(bik[ae]|bech[ae]|sol[de]|kitna|kitne|kitni|bikri|sell|sales|revenue|kamai|earning|order|hisab)\b/i;
  const romanizedTopSelling = /\b(sabse\s*(zyada|jyada|acch[ha])|top\s*sell|best\s*sell|konsa\s*(acch[ha]|zyada|sabse)|kya\s*(acch[ha]|zyada).*bik|popular)\b/i;
  
  // Hindi script patterns
  const hindiYesterday = /कल|बीता\s*कल|पिछला\s*दिन|परसों/;
  const hindiToday = /आज/;
  const hindiWeek = /हफ्त[ाे]|सप्ताह|पिछल[ेा]\s*हफ्त[ाे]/;
  const hindiMonth = /महीन[ाे]|पिछल[ेा]\s*महीन[ाे]/;
  const hindiSoldPatterns = /बिक[ाी]|बेच[ाी]|कितन[ाीे]|बिक्री|ऑर्डर|कमाई|हिसाब/;
  const hindiTopSelling = /सबसे\s*(ज़्यादा|ज्यादा|अच्छ[ाी])|कौन\s*सा.*(अच्छ|ज़्यादा|बिक)|क्या.*बिक|टॉप\s*सेलिंग|बेस्ट\s*सेलिंग/;

  // Marathi patterns
  const marathiYesterday = /काल|कालच[ाीे]/;
  const marathiToday = /आज|आजच[ाीे]/;
  const marathiSold = /विक[ले]|किती|विक्री|ऑर्डर|कमाई/;
  const marathiTopSelling = /सर्वात\s*जास्त|चांगल[ेाी].*विक|टॉप/;

  // Check if message is asking about sales/analytics
  const isSalesQuery = romanizedSoldPatterns.test(lower) || hindiSoldPatterns.test(message) || marathiSold.test(message);
  const isTopSellingQuery = romanizedTopSelling.test(lower) || hindiTopSelling.test(message) || marathiTopSelling.test(message);

  // Extract product name if mentioned (e.g., "kal tamatar kitna bika")
  let product: string | undefined;
  const productPatterns = [
    // "kal X kitna bika" / "X kitna bika kal"
    /(?:kal|yesterday|aaj|today)\s+(\w+)\s+(?:kitna|kitne|kitni|how\s*much|how\s*many)/i,
    /(\w+)\s+(?:kitna|kitne|kitni|how\s*much|how\s*many)\s+(?:bik[ae]|sell|sol[de])/i,
    /([\u0900-\u097F]+)\s+(?:कितन[ाीे]|की)\s+(?:बिक[ाी]|बेच[ाी])/,
    /(?:कल|आज)\s+([\u0900-\u097F]+)\s+(?:कितन[ाीे])/,
  ];
  
  for (const pattern of productPatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      product = match[1];
      break;
    }
  }

  if (isTopSellingQuery) {
    return { type: 'top_selling', product };
  }

  if (!isSalesQuery) return null;

  // Determine time range
  if (romanizedYesterday.test(lower) || hindiYesterday.test(message) || marathiYesterday.test(message)) {
    return { type: 'yesterday', product };
  }
  if (romanizedToday.test(lower) || hindiToday.test(message) || marathiToday.test(message)) {
    return { type: 'today', product };
  }
  if (romanizedWeek.test(lower) || hindiWeek.test(message)) {
    return { type: 'last_week', product };
  }
  if (romanizedMonth.test(lower) || hindiMonth.test(message)) {
    return { type: 'last_month', product };
  }

  // Generic sales query without specific time → sales summary
  return { type: 'sales_summary', product };
}

// detectOrderQuery was removed - detectAnalyticsQuery covers all query types

/**
 * Get analytics information using date-range or top-selling queries
 */
async function getAnalyticsInfo(
  phone: string,
  query: { type: string; product?: string },
  language: LanguageCode
): Promise<string> {
  try {
    const userState = await getUserState(phone);
    if (!userState?.sellerId) {
      return language === 'hi-IN'
        ? 'आपका सेलर अकाउंट अभी सेटअप नहीं हुआ है।'
        : language === 'mr-IN'
        ? 'तुमचे सेलर खाते अजून सेटअप झाले नाही.'
        : 'Your seller account is not set up yet.';
    }

    const lang = language.split('-')[0] as 'hi' | 'en' | 'mr';

    if (query.type === 'top_selling') {
      const topProducts = await getTopSellingProducts(userState.sellerId, 5);
      return formatTopSellingProducts(topProducts, lang);
    }

    if (query.type === 'sales_summary') {
      const summary = await getSalesSummary(userState.sellerId);
      if (lang === 'hi') {
        return `बिक्री सारांश (${summary.timeRange}): ${summary.totalOrders} ऑर्डर, ₹${summary.totalRevenue.toFixed(0)} कमाई। टॉप: ${summary.topProduct || 'कोई नहीं'}`;
      } else if (lang === 'mr') {
        return `विक्री सारांश (${summary.timeRange}): ${summary.totalOrders} ऑर्डर, ₹${summary.totalRevenue.toFixed(0)} कमाई. टॉप: ${summary.topProduct || 'काहीही नाही'}`;
      }
      return `Sales summary (${summary.timeRange}): ${summary.totalOrders} orders, ₹${summary.totalRevenue.toFixed(0)} revenue. Top: ${summary.topProduct || 'None'}`;
    }

    // Date-range queries: yesterday, today, last_week, last_month  
    const analytics = await getDateRangeAnalytics(userState.sellerId, query.type);
    return formatDateRangeAnalytics(analytics, lang);
  } catch (error) {
    console.error('Analytics query failed:', error);
    return '';
  }
}

/**
 * Detect market price query - works with romanized Hindi, Devanagari, English
 */
function detectPriceQuery(message: string, language: LanguageCode): string | null {
  const lower = message.toLowerCase();

  // Romanized Hindi patterns (most common for voice transcription)
  const romanizedPricePatterns = [
    /(\w+)\s*(?:ka|ki|ke)\s*(?:bhav|keemat|rate|price|daam|dam)/i,
    /(?:bhav|keemat|rate|price|daam|dam)\s*(?:kya|kitna|kitni)?\s*(?:hai|he)?\s*(?:of\s+)?(\w+)/i,
    /(?:aaj|today)\s+(\w+)\s*(?:ka|ki|ke)?\s*(?:bhav|keemat|rate|price)/i,
    /market\s*price\s*(?:of\s+)?(\w+)/i,
    /(\w+)\s+(?:market\s*)?price/i,
    /(\w+)\s+(?:mandi|mandee)\s*(?:bhav|rate)/i,
  ];

  for (const pattern of romanizedPricePatterns) {
    const match = lower.match(pattern);
    if (match) {
      const product = match[1]?.trim();
      // Filter out noise words
      if (product && !['kya', 'hai', 'he', 'aaj', 'kal', 'the', 'what', 'is', 'of'].includes(product)) {
        return product;
      }
    }
  }

  // Hindi Devanagari patterns
  const hindiMatch = message.match(/([\u0900-\u097F]+)\s*(का|की|के)?\s*(भाव|कीमत|रेट|दाम)/);
  if (hindiMatch) return hindiMatch[1];
  
  const hindiMatch2 = message.match(/(भाव|कीमत|दाम)\s*(क्या|कितन[ाीे])?\s*(है)?\s*([\u0900-\u097F]+)/);
  if (hindiMatch2) return hindiMatch2[4];

  // Marathi patterns
  const marathiMatch = message.match(/([\u0900-\u097F]+)\s*(चा|ची|चे)?\s*(भाव|किंमत)/);
  if (marathiMatch) return marathiMatch[1];

  // Bengali patterns
  const bengaliMatch = message.match(/([\u0980-\u09FF]+)\s*(এর)?\s*(দাম|মূল্য)/);
  if (bengaliMatch) return bengaliMatch[1];

  // English patterns
  if (lower.includes('price') || lower.includes('rate') || lower.includes('market')) {
    const engMatch = message.match(/price\s+of\s+(\w+)|(\w+)\s+price|market\s+(?:price|rate)\s+(?:of\s+)?(\w+)/i);
    if (engMatch) return engMatch[1] || engMatch[2] || engMatch[3];
  }

  return null;
}

/**
 * Search market price using local knowledge + web search with source attribution
 */
async function searchMarketPrice(product: string, language: LanguageCode): Promise<string> {
  try {
    // First check local knowledge base for instant response
    const localPrice = getLocalMarketPrice(product);
    
    // Also try web search for fresh data
    const searchQuery = `${product} mandi bhav price today India ${new Date().toISOString().split('T')[0]}`;
    const searchResults = await remote_web_search({ query: searchQuery });

    let result = '';

    if (searchResults && searchResults.length > 0) {
      const topResult = searchResults[0];
      result = `📊 Market Info: ${topResult.snippet}\n🔗 Source: ${topResult.url}`;
      
      // Add more sources
      if (searchResults.length > 1) {
        result += `\n📌 Also see: ${searchResults[1].url}`;
      }
    }

    // Supplement with local knowledge if web search was sparse
    if (localPrice.found) {
      const localInfo = `\n📋 Reference price: ${localPrice.priceInfo}\n🏛️ Source: ${localPrice.sourceName} (${localPrice.sourceUrl})`;
      result = result ? result + localInfo : `📊 ${localPrice.priceInfo}${localInfo}`;
    }

    if (!result) {
      result = '📊 Market price data not available right now. Prices vary by region and season.\n🏛️ Check: https://agmarknet.gov.in for latest mandi prices.';
    }

    return result;
  } catch (error) {
    console.error('Market price search failed:', error);
    return '📊 Check latest mandi prices at: https://agmarknet.gov.in';
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
  marketInfo: string,
  analyticsInfo: string,
  sellerInfo: { upiId?: string; name?: string } = {}
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

  // Add current order + CONFIRMATION_PENDING awareness
  if (partialData) {
    prompt += `\n\n📦 Current order being tracked:
- Product: ${partialData.productName || '❓ Unknown'}
- Price: ${partialData.price ? `₹${partialData.price}/${partialData.unit}` : '❓ Not set'}
- Quantity: ${partialData.quantity ? `${partialData.quantity} ${partialData.unit}` : '❓ Not set'}
- Category: ${partialData.category || '❓ Unknown'}
- Photo: ${partialData.originalImageUrl ? '✅ Received' : '❌ Not received'}
- Missing fields: ${partialData.missingFields?.length ? partialData.missingFields.join(', ') : 'NONE - all fields complete'}`;
    
    if (userState?.state === 'CONFIRMATION_PENDING') {
      prompt += `\n\n⚠️ STATE: CONFIRMATION_PENDING - User is reviewing the above product.
- If they ask about market prices, analytics, or general questions → answer normally
- If they want to change price/quantity → confirm the change was noted
- If they talk about something completely different → assume they want a general answer, don't force them back to the product`;
    } else if (userState?.state === 'IMAGE_PENDING') {
      prompt += `\n\n⚠️ STATE: IMAGE_PENDING - Waiting for product photo.
- User needs to send a product photo next
- If user asks something else → answer and gently remind to send a product photo
- DO NOT say "product added" or "bahut badhiya" - product is NOT added yet, we need the photo first`;
    }
  }

  // Add UPI status
  prompt += `\n\n💳 Seller UPI Status: ${sellerInfo.upiId ? `✅ Registered: ${sellerInfo.upiId}` : '❌ Not registered'}`;
  prompt += `\n🔑 User State: ${userState?.state || 'UNKNOWN'}`;

  // Add market info if available
  if (marketInfo) {
    prompt += `\n\n${marketInfo}`;
  }

  // Add analytics info if available
  if (analyticsInfo) {
    prompt += `\n\n📊 Analytics data:\n${analyticsInfo}`;
  }

  // Add current message
  prompt += `\n\n💬 User's new message (${messageType}):
"${userMessage}"

🧠 INTENT INFERENCE RULES (LangChain-like reasoning):
- If message is a greeting (hi, hello, namaste, namaskar, haan, ji) → greet warmly, mention their name if known, ask how you can help
- If message is garbled / unclear / too short → DON'T ignore. Ask sweetly: "Mujhe samajh nahi aaya, kya aap thoda detail mein bata sakte hain?" NEVER return empty/generic
- If message mentions a PRODUCT with DETAILS (name, price, quantity, unit) → use STORE_DATA with all extracted fields
- If message is partial (e.g., just "tomato" or "100 rupees") → infer context from conversation history. If adding product, treat as product info. Use STORE_DATA to save what you have.
- If message mentions numbers → treat as price/quantity based on context. "sau" = 100, "do sau" = 200, "hazaar" = 1000
- If message asks "kya kar sakte ho" or "help" or "kaise" → explain ALL features: add products, UPI setup, marketplace link, price check, analytics, delete products
- ALWAYS respond — never return empty or stay silent

🔄 CRITICAL WORKFLOW RULES (MUST FOLLOW):
The product addition workflow has STRICT steps. You must follow them IN ORDER:
1. User describes product → YOU extract productName, price, quantity, unit, category → use STORE_DATA action
2. After STORE_DATA: the system automatically checks completeness and asks for photo if ready
3. If fields are missing → ask for the SPECIFIC missing field (check "Missing fields" above). Use STORE_DATA when user provides it.
4. User sends photo → system handles confirmation automatically (you don't need to do anything)
5. User clicks approve button → product is created

⛔ NEVER DO THESE:
- NEVER say "product added" / "उत्पाद जोड़ा गया" / "बहुत बढ़िया जोड़ दिया" unless you are using CREATE_CATALOG action AND all fields + photo exist
- NEVER say "photo mil gayi, add kar diya" — receiving a photo does NOT mean the product is added
- NEVER ask for UPI ID if UPI is already registered (check status above)
- NEVER ask for product photo in your message — the system will ask automatically when all text fields are complete
- NEVER use CREATE_CATALOG unless ALL fields (productName, price, quantity, unit) AND photo exist in partial data
- NEVER use REQUEST_IMAGE — the system handles image requests automatically

🎯 STRICT RULES:
1. Give a DIRECT, COMPLETE answer immediately - NEVER say "wait", "let me check", "one moment", "rukiye" etc.
2. If market info is provided above, use it directly to answer with actual numbers.
3. Keep response SHORT - max 2-3 sentences. Rural users prefer brief answers spoken aloud.
4. If user is adding a product and market price data exists above, mention the current market price naturally.
5. If anything is missing for a product catalog, ask ONE clear question about the FIRST missing field.
6. Be warm but concise - like a knowledgeable friend talking.
7. NEVER use the WEB_SEARCH action.
8. Include actual price numbers if available.
9. Remember this user's history/preferences from conversation above. Reference past interactions naturally.
10. For analytics responses, be concise - just state the numbers clearly.
11. ALWAYS end with a friendly follow-up question like "Aur kya madad chahiye?" / "Aur kuch?" / "What else can I help with?" — never leave a dead-end.
12. NEVER show errors, technical messages, or stack traces. If something fails internally, casually ask the user to try again.

💳 UPI GUIDANCE:
${sellerInfo.upiId 
  ? `- UPI is ALREADY registered (${sellerInfo.upiId}). Do NOT ask user to set up UPI again. If they ask about UPI, confirm it's already set.`
  : `- UPI is NOT registered. If user sends a UPI ID (like name@upi, phone@paytm) → use REGISTER_UPI action
- If user state is KYC_VERIFIED, gently mention: "UPI ID bhej dijiye toh customers seedha payment kar payenge!"
- If user mentions "payment", "paisa", "paise kaise milenge" → guide them to set up UPI`
}

� ORDER & PAYMENT GUIDANCE:
- When seller asks about orders, tell them buyers can order from the marketplace and they'll get WhatsApp notifications with Accept/Reject buttons.
- If seller asks about payments: UPI payments are verified automatically via screenshot AI, or buyer sends transaction reference. COD is collected on delivery.
- If seller asks "order kaise aayega" → explain: "Jab koi customer marketplace se order karega toh aapko WhatsApp pe Accept/Reject button aayega. Accept karne pe aapko delivery ki taiyari karni hogi."
- If seller asks "paisa kab milega" → explain: "UPI se order hua toh payment turant verify ho jaata hai, COD mein delivery ke waqt milega."
- Keep all payment/order explanations conversational and brief — like talking to a friend.

�📦 STORE_DATA RULES (MOST IMPORTANT):
- When user describes a product, ALWAYS use STORE_DATA to save the information
- Extract ALL fields you can: productName, price, quantity, unit, category, description
- Common units: "kilo"/"kg", "piece"/"pcs", "dozen", "liter", "packet", "bag", "bundle"
- If user says "tamatar 50 rupaye kilo, 10 kilo" → DATA: {"productName": "Tomato", "price": 50, "quantity": 10, "unit": "kg", "category": "vegetables"}
- If user says "50 rupees" and product context exists → DATA: {"price": 50}
- If user mentions only a product name → DATA: {"productName": "Tomato"} and ask for price
- ALWAYS include ALL fields you can extract in a single STORE_DATA call

🗑️ DELETE_PRODUCT rules:
- When user says "delete", "remove", "hatao", "nikalo", "हटाओ", "निकालो" a product → use DELETE_PRODUCT action
- ALWAYS include DATA with {"productName": "<exact product name>"}

💳 REGISTER_UPI rules:
- When user sends a UPI ID (like xyz@upi, phone@paytm) → use REGISTER_UPI action
- ALWAYS include DATA with {"upiId": "<their UPI ID>"}
- Only use this when UPI is NOT already registered (check status above)

🎙️ RESPONSE_MODE rules:
- Use "voice" for: general chat, price queries, analytics, greetings, asking questions
- Use "both" for: product deletion confirmations, UPI registration
- Use "text" for: sending links/URLs

📝 Response format:
MESSAGE: [Your concise answer in ${langName}]
ACTION: [NONE/STORE_DATA/CREATE_CATALOG/ASK_QUESTION/DELETE_PRODUCT/REGISTER_UPI]
DATA: {"productName": "<name>", "price": <num>, "quantity": <num>, "unit": "<unit>", "category": "<cat>", "upiId": "<upi@id>"}
RESPONSE_MODE: [voice/text/both]
CONFIDENCE: [0-100]
REASONING: [Brief reason]

Respond now in ${langName}:`;

  return prompt;
}


/**
 * Call agent model with timeout protection
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
      max_new_tokens: 600, // More room for detailed, helpful responses
      temperature: 0.7, // Slightly creative for natural conversation
      top_p: 0.92,
    },
  };

  const command = new InvokeModelCommand({
    modelId: NOVA_PRO_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody),
  });

  // Timeout protection: 12 seconds max for model inference (upgraded for better quality)
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Model inference timeout')), 12000)
  );

  try {
    const response = await Promise.race([
      bedrockClient.send(command),
      timeoutPromise,
    ]);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    return responseBody.output.message.content[0].text.trim();
  } catch (error: any) {
    if (error.message === 'Model inference timeout') {
      console.warn('⚠️ Model inference timed out, returning fallback');
      return 'MESSAGE: माफ़ करें, जवाब में थोड़ी देर हो गई। कृपया फिर से पूछें।\nACTION: NONE\nRESPONSE_MODE: voice\nCONFIDENCE: 50\nREASONING: Model timeout';
    }
    throw error;
  }
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
  let responseMode: 'voice' | 'text' | 'both' = 'voice'; // Default to voice-only

  for (const line of lines) {
    if (line.startsWith('MESSAGE:')) {
      message = line.replace('MESSAGE:', '').trim();
    } else if (line.startsWith('ACTION:')) {
      action = line.replace('ACTION:', '').trim();
    } else if (line.startsWith('CONFIDENCE:')) {
      confidence = parseInt(line.replace('CONFIDENCE:', '').trim()) || 85;
    } else if (line.startsWith('REASONING:')) {
      reasoning = line.replace('REASONING:', '').trim();
    } else if (line.startsWith('RESPONSE_MODE:')) {
      const mode = line.replace('RESPONSE_MODE:', '').trim().toLowerCase();
      if (mode === 'text' || mode === 'both' || mode === 'voice') {
        responseMode = mode;
      }
    }
  }

  // If no structured response, use entire response as message
  if (!message) {
    message = response;
  }

  // Force text+voice for actions that need visual confirmation
  if (action === 'CREATE_CATALOG' || action === 'DELETE_PRODUCT' || action === 'REGISTER_UPI') {
    responseMode = 'both';
  }

  // Parse DATA line for action parameters
  let actionData: any = undefined;
  for (const line of lines) {
    if (line.startsWith('DATA:')) {
      const dataStr = line.replace('DATA:', '').trim();
      try {
        actionData = JSON.parse(dataStr);
      } catch (e) {
        console.warn('Failed to parse DATA line as JSON, trying regex fallback:', line);
        // Fallback: extract UPI ID via regex (handles non-JSON agent outputs)
        const upiMatch = dataStr.match(/[\w.\-]+@[\w]+/);
        if (upiMatch && action === 'REGISTER_UPI') {
          actionData = { upiId: upiMatch[0] };
          console.log('✅ Extracted UPI ID via fallback regex:', upiMatch[0]);
        }
        // Fallback: extract productName from quoted text
        const nameMatch = dataStr.match(/"([^"]+)"/);
        if (nameMatch && (action === 'DELETE_PRODUCT' || action === 'STORE_DATA')) {
          actionData = { ...(actionData || {}), productName: nameMatch[1] };
          console.log('✅ Extracted productName via fallback regex:', nameMatch[1]);
        }
        // Fallback: extract price/quantity numbers
        const priceMatch = dataStr.match(/price["\s:]*(\d+)/i);
        if (priceMatch && action === 'STORE_DATA') {
          actionData = { ...(actionData || {}), price: parseInt(priceMatch[1]) };
        }
        const qtyMatch = dataStr.match(/quantity["\s:]*(\d+)/i);
        if (qtyMatch && action === 'STORE_DATA') {
          actionData = { ...(actionData || {}), quantity: parseInt(qtyMatch[1]) };
        }
        const unitMatch = dataStr.match(/unit["\s:]*"?(\w+)"?/i);
        if (unitMatch && action === 'STORE_DATA') {
          actionData = { ...(actionData || {}), unit: unitMatch[1] };
        }
      }
    }
  }

  // Extra fallback: if REGISTER_UPI action but no upiId in data, try to extract from the full response
  if (action === 'REGISTER_UPI' && (!actionData || !actionData.upiId)) {
    const upiMatch = response.match(/[\w.\-]+@[\w]+/);
    if (upiMatch) {
      actionData = { ...(actionData || {}), upiId: upiMatch[0] };
      console.log('✅ Extracted UPI ID from full response:', upiMatch[0]);
    }
  }

  const actions: AgentAction[] = [];
  if (action !== 'NONE' && action !== 'WEB_SEARCH') {
    actions.push({ type: action as any, data: actionData });
  }

  return {
    message,
    actions,
    needsWebSearch: false,
    confidence,
    reasoning,
    responseMode,
  };
}

/**
 * Send agent message respecting response mode
 * - 'voice': voice-only (clean chat)
 * - 'text': text-only (for things that need visual confirmation like buttons)
 * - 'both': text + voice (for catalog confirmations needing both)
 */
export async function sendEnhancedAgentMessage(
  phone: string,
  message: string,
  language: LanguageCode,
  mode: 'voice' | 'text' | 'both' = 'voice'
): Promise<void> {
  // Show typing for realistic delay
  await showTypingIndicator(phone);

  const lang = language.split('-')[0] as 'hi' | 'mr' | 'en' | 'bn';
  // Map Bengali to English for WhatsApp message sender (Bengali not yet supported)
  const whatsappLang = lang === 'bn' ? 'en' : lang;

  switch (mode) {
    case 'voice':
      await sendVoiceOnly(phone, message, whatsappLang);
      break;
    case 'text':
      await sendTextMessage(phone, message, whatsappLang);
      break;
    case 'both':
      await sendTextWithVoice(phone, message, whatsappLang);
      break;
    default:
      await sendVoiceOnly(phone, message, whatsappLang);
  }
}
