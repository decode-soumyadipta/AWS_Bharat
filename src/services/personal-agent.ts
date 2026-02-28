/**
 * Personal AI Agent Service
 * 
 * A fully autonomous conversational AI agent that:
 * - Maintains complete conversation memory
 * - Generates ALL messages dynamically (no templates)
 * - Asks clarifying questions when uncertain
 * - Handles dilemmas interactively
 * - Operates in real-time with low latency
 * - Acts as a personal business assistant
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { 
  getConversationContext, 
  addConversationMessage,
  updateUserPreferences,
  UserConversationContext 
} from './conversation-memory';
import { getPartialData, mergePartialData, PartialCatalogItem } from './partial-data-store';
import { getUserState } from './state-manager';
import { sendTextMessage } from '../lambdas/whatsapp-message-sender';

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
const NOVA_PRO_MODEL_ID = 'amazon.nova-pro-v1:0';

/**
 * Agent response with actions
 */
export interface AgentResponse {
  message: string;
  actions?: AgentAction[];
  needsUserInput?: boolean;
  confidence?: number;
  reasoning?: string;
}

/**
 * Agent actions to perform
 */
export interface AgentAction {
  type: 'STORE_DATA' | 'REQUEST_IMAGE' | 'CREATE_CATALOG' | 'ASK_QUESTION' | 'UPDATE_STATE';
  data?: any;
}

/**
 * Main agent orchestrator - processes any user message
 */
export async function processWithAgent(
  phone: string,
  userMessage: string,
  messageType: 'text' | 'voice' | 'image',
  language: 'hi-IN' | 'mr-IN' | 'en-IN' = 'hi-IN'
): Promise<AgentResponse> {
  console.log('🤖 Agent processing:', { phone, messageType, language });

  // Get full context
  const conversationContext = await getConversationContext(phone);
  const partialData = await getPartialData(phone);
  const userState = await getUserState(phone);

  // Track user message
  await addConversationMessage(phone, {
    timestamp: Date.now(),
    role: 'user',
    content: userMessage,
    messageType,
  });

  // Build agent prompt with full context
  const agentPrompt = buildAgentPrompt(
    userMessage,
    messageType,
    conversationContext,
    partialData,
    userState,
    language
  );

  // Call Nova Pro with agent instructions
  const response = await callAgentModel(agentPrompt);

  // Parse agent response
  const agentResponse = parseAgentResponse(response);

  // Track agent message
  await addConversationMessage(phone, {
    timestamp: Date.now(),
    role: 'assistant',
    content: agentResponse.message,
    messageType: 'text',
  });

  console.log('🤖 Agent response:', agentResponse);

  return agentResponse;
}

/**
 * Build comprehensive agent prompt
 */
function buildAgentPrompt(
  userMessage: string,
  messageType: string,
  conversationContext: UserConversationContext | null,
  partialData: PartialCatalogItem | null,
  userState: any,
  language: string
): string {
  const isHindi = language.startsWith('hi');
  const isMarathi = language.startsWith('mr');

  let prompt = '';

  // Agent identity and role
  if (isHindi) {
    prompt = `तुम "व्यापार वाणी" हो - एक AI व्यापार सहायक जो भारतीय छोटे व्यापारियों का व्यक्तिगत सहायक है।

तुम्हारी भूमिका और व्यक्तित्व:
- तुम एक वास्तविक व्यक्ति की तरह बात करते हो, रोबोट की तरह नहीं
- तुम उपयोगकर्ता के दोस्त और विश्वसनीय सलाहकार हो
- तुम हमेशा सकारात्मक, मददगार और धैर्यवान हो
- तुम उपयोगकर्ता की हर बात याद रखते हो
- जब तुम्हें कुछ समझ नहीं आता, तो तुम पूछते हो
- जब तुम्हें दुविधा होती है, तो तुम विकल्प देते हो
- तुम संक्षिप्त और स्पष्ट संदेश भेजते हो (2-3 वाक्य)
- तुम इमोजी का उपयोग करते हो जहां उपयुक्त हो

तुम्हारे कार्य:
1. उपयोगकर्ता को उनके उत्पाद ऑनलाइन बेचने में मदद करना
2. उत्पाद की जानकारी इकट्ठा करना (नाम, कीमत, मात्रा, श्रेणी)
3. उत्पाद की फोटो मांगना
4. सभी जानकारी की पुष्टि करना
5. कैटलॉग बनाना

महत्वपूर्ण नियम:
- कभी भी अनुमान मत लगाओ - अगर कुछ स्पष्ट नहीं है तो पूछो
- एक बार में केवल एक चीज़ के लिए पूछो
- हमेशा पिछली बातचीत का संदर्भ याद रखो
- अगर उपयोगकर्ता ने पहले कुछ बेचा है, तो उसका उल्लेख करो
- अगर कीमत असामान्य लगती है, तो पुष्टि करो
- अगर कोई अधूरा ऑर्डर है, तो पूछो कि क्या जारी रखना है`;
  } else if (isMarathi) {
    prompt = `तू "व्यापार वाणी" आहेस - एक AI व्यापार सहाय्यक जो भारतीय छोट्या व्यापाऱ्यांचा वैयक्तिक सहाय्यक आहे।

तुझी भूमिका आणि व्यक्तिमत्व:
- तू एका वास्तविक व्यक्तीसारखे बोलतोस, रोबोटसारखे नाही
- तू वापरकर्त्याचा मित्र आणि विश्वासू सल्लागार आहेस
- तू नेहमी सकारात्मक, मदतगार आणि धैर्यवान आहेस
- तू वापरकर्त्याची प्रत्येक गोष्ट लक्षात ठेवतोस
- जेव्हा तुला काही समजत नाही, तेव्हा तू विचारतोस
- जेव्हा तुला संदिग्धता असते, तेव्हा तू पर्याय देतोस
- तू संक्षिप्त आणि स्पष्ट संदेश पाठवतोस (2-3 वाक्ये)
- तू इमोजी वापरतोस जेथे योग्य असेल

तुझी कार्ये:
1. वापरकर्त्याला त्यांची उत्पादने ऑनलाइन विकण्यात मदत करणे
2. उत्पादनाची माहिती गोळा करणे (नाव, किंमत, प्रमाण, वर्ग)
3. उत्पादनाचा फोटो मागणे
4. सर्व माहितीची पुष्टी करणे
5. कॅटलॉग तयार करणे

महत्त्वाचे नियम:
- कधीही अंदाज लावू नकोस - जर काही स्पष्ट नसेल तर विचार
- एका वेळी फक्त एका गोष्टीसाठी विचार
- नेहमी मागील संवादाचा संदर्भ लक्षात ठेव
- जर वापरकर्त्याने आधी काही विकले असेल, तर त्याचा उल्लेख कर
- जर किंमत असामान्य वाटत असेल, तर पुष्टी कर
- जर अपूर्ण ऑर्डर असेल, तर विचार की सुरू ठेवायचे आहे का`;
  } else {
    prompt = `You are "Vyapar Vaani" - an AI business assistant who is a personal assistant for Indian small business owners.

Your role and personality:
- You talk like a real person, not a robot
- You are the user's friend and trusted advisor
- You are always positive, helpful, and patient
- You remember everything the user says
- When you don't understand something, you ask
- When you have a dilemma, you offer options
- You send brief and clear messages (2-3 sentences)
- You use emojis where appropriate

Your tasks:
1. Help users sell their products online
2. Gather product information (name, price, quantity, category)
3. Request product photo
4. Confirm all information
5. Create catalog

Important rules:
- Never guess - if something is unclear, ask
- Ask for only one thing at a time
- Always remember previous conversation context
- If user sold something before, mention it
- If price seems unusual, confirm
- If there's an incomplete order, ask if they want to continue`;
  }

  // Add conversation history
  if (conversationContext && conversationContext.messages.length > 0) {
    const recentMessages = conversationContext.messages.slice(-10);
    prompt += `\n\n📜 पिछली बातचीत:\n`;
    recentMessages.forEach(msg => {
      const role = msg.role === 'user' ? 'उपयोगकर्ता' : 'तुम';
      prompt += `${role}: ${msg.content}\n`;
    });
  }

  // Add user patterns
  if (conversationContext && conversationContext.patterns.totalInteractions > 0) {
    const { patterns, preferences } = conversationContext;
    prompt += `\n\n📊 उपयोगकर्ता का इतिहास:
- कुल बातचीत: ${patterns.totalInteractions}
- सफल कैटलॉग: ${patterns.successfulCatalogs}
- पसंदीदा श्रेणियां: ${preferences.preferredCategories?.join(', ') || 'कोई नहीं'}
- सामान्य कीमत: ₹${preferences.typicalPriceRange?.min || 0}-₹${preferences.typicalPriceRange?.max || 0}`;
  }

  // Add current order status
  if (partialData) {
    prompt += `\n\n📦 वर्तमान ऑर्डर:
- उत्पाद: ${partialData.productName || '❓ अज्ञात'}
- कीमत: ${partialData.price ? `₹${partialData.price}/${partialData.unit}` : '❓ अज्ञात'}
- मात्रा: ${partialData.quantity ? `${partialData.quantity} ${partialData.unit}` : '❓ अज्ञात'}
- श्रेणी: ${partialData.category || '❓ अज्ञात'}
- फोटो: ${partialData.originalImageUrl ? '✅ मिल गया' : '❌ नहीं मिला'}`;
  }

  // Add current user message
  prompt += `\n\n💬 उपयोगकर्ता का नया संदेश (${messageType}):
"${userMessage}"

🎯 तुम्हारा काम:
1. उपयोगकर्ता के संदेश को समझो
2. अगर कुछ गायब है या अस्पष्ट है, तो पूछो
3. अगर सब कुछ है, तो अगला कदम बताओ
4. एक प्राकृतिक, मानवीय संदेश लिखो

📝 अपना जवाब इस फॉर्मेट में दो:
MESSAGE: [तुम्हारा संदेश यहां लिखो]
ACTION: [NONE/STORE_DATA/REQUEST_IMAGE/CREATE_CATALOG/ASK_QUESTION]
CONFIDENCE: [0-100]
REASONING: [तुमने यह क्यों कहा]

अब जवाब दो:`;

  return prompt;
}

/**
 * Call Nova Pro agent model
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
      max_new_tokens: 500,
      temperature: 0.7,
      top_p: 0.9,
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
 * Parse agent response
 */
function parseAgentResponse(response: string): AgentResponse {
  const lines = response.split('\n');
  let message = '';
  let action = 'NONE';
  let confidence = 80;
  let reasoning = '';

  for (const line of lines) {
    if (line.startsWith('MESSAGE:')) {
      message = line.replace('MESSAGE:', '').trim();
    } else if (line.startsWith('ACTION:')) {
      action = line.replace('ACTION:', '').trim();
    } else if (line.startsWith('CONFIDENCE:')) {
      confidence = parseInt(line.replace('CONFIDENCE:', '').trim()) || 80;
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
    needsUserInput: action === 'ASK_QUESTION',
    confidence,
    reasoning,
  };
}

/**
 * Send agent message via WhatsApp
 */
export async function sendAgentMessage(
  phone: string,
  message: string,
  language: 'hi-IN' | 'mr-IN' | 'en-IN' = 'hi-IN'
): Promise<void> {
  const lang = language.split('-')[0] as 'hi' | 'mr' | 'en';
  await sendTextMessage(phone, message, lang);
}

/**
 * Extract product information from conversation using agent
 */
export async function extractProductInfo(
  phone: string,
  conversationContext: UserConversationContext | null
): Promise<Partial<PartialCatalogItem>> {
  if (!conversationContext || conversationContext.messages.length === 0) {
    return {};
  }

  // Build extraction prompt
  const messages = conversationContext.messages.slice(-10);
  const conversationText = messages
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');

  const extractionPrompt = `निम्नलिखित बातचीत से उत्पाद की जानकारी निकालो:

${conversationText}

JSON फॉर्मेट में जवाब दो:
{
  "productName": "उत्पाद का नाम",
  "price": कीमत (संख्या),
  "quantity": मात्रा (संख्या),
  "unit": "इकाई (kg/bottles/pieces)",
  "category": "श्रेणी (food/handicraft/other)",
  "description": "विवरण"
}

अगर कोई जानकारी नहीं मिली तो null रखो।`;

  try {
    const response = await callAgentModel(extractionPrompt);
    
    // Try to parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const extracted = JSON.parse(jsonMatch[0]);
      return {
        productName: extracted.productName || undefined,
        price: extracted.price || undefined,
        quantity: extracted.quantity || undefined,
        unit: extracted.unit || undefined,
        category: extracted.category || undefined,
        description: extracted.description || undefined,
      };
    }
  } catch (error) {
    console.error('Failed to extract product info:', error);
  }

  return {};
}
