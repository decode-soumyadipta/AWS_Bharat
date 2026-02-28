/**
 * AI Conversation Service
 * 
 * Uses Amazon Nova Pro to generate natural, conversational messages
 * based on context, user history, and current state.
 * 
 * All messages are AI-generated, no static templates.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getConversationContext, UserConversationContext } from './conversation-memory';
import { getPartialData, PartialCatalogItem } from './partial-data-store';

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
const NOVA_PRO_MODEL_ID = 'amazon.nova-pro-v1:0';

/**
 * Generate AI message for any scenario
 */
export async function generateAIMessage(
  phone: string,
  scenario: string,
  context: Record<string, any>,
  language: 'hi-IN' | 'mr-IN' | 'en-IN' = 'hi-IN'
): Promise<string> {
  // Get conversation history
  const conversationContext = await getConversationContext(phone);
  const partialData = await getPartialData(phone);

  // Build system prompt with full context
  const systemPrompt = buildSystemPrompt(language, conversationContext, partialData);

  // Build user prompt for specific scenario
  const userPrompt = buildScenarioPrompt(scenario, context, language);

  // Call Nova Pro
  const response = await callNovaPro(systemPrompt, userPrompt);

  return response;
}

/**
 * Build system prompt with user context
 */
function buildSystemPrompt(
  language: string,
  conversationContext: UserConversationContext | null,
  partialData: PartialCatalogItem | null
): string {
  const isHindi = language.startsWith('hi');
  const isMarathi = language.startsWith('mr');

  let prompt = '';

  if (isHindi) {
    prompt = `तुम व्यापार वाणी हो - एक AI सहायक जो भारतीय छोटे व्यापारियों को उनके उत्पादों को ऑनलाइन बेचने में मदद करता है।

तुम्हारी भूमिका:
- बहुत ही मानवीय और संवादात्मक तरीके से बात करो
- उपयोगकर्ता के पिछले इंटरैक्शन को याद रखो
- प्राकृतिक हिंदी में बात करो, जैसे एक दोस्त बात करता है
- संक्षिप्त और स्पष्ट संदेश भेजो
- इमोजी का उपयोग करो जहां उपयुक्त हो
- हमेशा सकारात्मक और मददगार रहो`;
  } else if (isMarathi) {
    prompt = `तू व्यापार वाणी आहेस - एक AI सहाय्यक जो भारतीय छोट्या व्यापाऱ्यांना त्यांची उत्पादने ऑनलाइन विकण्यात मदत करतो।

तुझी भूमिका:
- अतिशय मानवी आणि संवादात्मक पद्धतीने बोल
- वापरकर्त्याचे मागील संवाद लक्षात ठेव
- नैसर्गिक मराठीत बोल, जसे एक मित्र बोलतो
- संक्षिप्त आणि स्पष्ट संदेश पाठव
- इमोजी वापर जेथे योग्य असेल
- नेहमी सकारात्मक आणि मदतगार रहा`;
  } else {
    prompt = `You are Vyapar Vaani - an AI assistant helping Indian small business owners sell their products online.

Your role:
- Speak in a very human and conversational way
- Remember user's past interactions
- Speak in natural English, like a friend would
- Send brief and clear messages
- Use emojis where appropriate
- Always be positive and helpful`;
  }

  // Add conversation history context
  if (conversationContext && conversationContext.patterns.totalInteractions > 0) {
    const { patterns, preferences } = conversationContext;
    
    if (isHindi) {
      prompt += `\n\nउपयोगकर्ता का इतिहास:
- कुल इंटरैक्शन: ${patterns.totalInteractions}
- सफल कैटलॉग: ${patterns.successfulCatalogs}
- पसंदीदा श्रेणियां: ${preferences.preferredCategories?.join(', ') || 'कोई नहीं'}
- सामान्य कीमत रेंज: ₹${preferences.typicalPriceRange?.min || 0} - ₹${preferences.typicalPriceRange?.max || 0}`;
    } else if (isMarathi) {
      prompt += `\n\nवापरकर्त्याचा इतिहास:
- एकूण संवाद: ${patterns.totalInteractions}
- यशस्वी कॅटलॉग: ${patterns.successfulCatalogs}
- आवडते वर्ग: ${preferences.preferredCategories?.join(', ') || 'काहीही नाही'}
- सामान्य किंमत श्रेणी: ₹${preferences.typicalPriceRange?.min || 0} - ₹${preferences.typicalPriceRange?.max || 0}`;
    } else {
      prompt += `\n\nUser history:
- Total interactions: ${patterns.totalInteractions}
- Successful catalogs: ${patterns.successfulCatalogs}
- Preferred categories: ${preferences.preferredCategories?.join(', ') || 'None'}
- Typical price range: ₹${preferences.typicalPriceRange?.min || 0} - ₹${preferences.typicalPriceRange?.max || 0}`;
    }
  }

  // Add current partial data context
  if (partialData) {
    if (isHindi) {
      prompt += `\n\nवर्तमान ऑर्डर:
- उत्पाद: ${partialData.productName || 'अज्ञात'}
- कीमत: ₹${partialData.price || 0}/${partialData.unit || 'unit'}
- मात्रा: ${partialData.quantity || 0} ${partialData.unit || ''}
- श्रेणी: ${partialData.category || 'अन्य'}`;
    } else if (isMarathi) {
      prompt += `\n\nसध्याचा ऑर्डर:
- उत्पादन: ${partialData.productName || 'अज्ञात'}
- किंमत: ₹${partialData.price || 0}/${partialData.unit || 'unit'}
- प्रमाण: ${partialData.quantity || 0} ${partialData.unit || ''}
- वर्ग: ${partialData.category || 'इतर'}`;
    } else {
      prompt += `\n\nCurrent order:
- Product: ${partialData.productName || 'Unknown'}
- Price: ₹${partialData.price || 0}/${partialData.unit || 'unit'}
- Quantity: ${partialData.quantity || 0} ${partialData.unit || ''}
- Category: ${partialData.category || 'Other'}`;
    }
  }

  return prompt;
}

/**
 * Build scenario-specific prompt
 */
function buildScenarioPrompt(
  scenario: string,
  context: Record<string, any>,
  language: string
): string {
  const isHindi = language.startsWith('hi');
  const isMarathi = language.startsWith('mr');

  switch (scenario) {
    case 'GREETING':
      if (isHindi) {
        return `उपयोगकर्ता ने अभी-अभी संपर्क किया है। उन्हें एक गर्मजोशी भरा स्वागत संदेश भेजो। अगर वे पहली बार हैं, तो परिचय दो। अगर वे वापस आए हैं, तो उनका स्वागत करो और उनके पिछले इंटरैक्शन का उल्लेख करो।

केवल स्वागत संदेश लिखो, कुछ और नहीं। 2-3 वाक्य।`;
      } else if (isMarathi) {
        return `वापरकर्त्याने आत्ताच संपर्क केला आहे। त्यांना एक उबदार स्वागत संदेश पाठवा. जर ते पहिल्यांदा आहेत, तर परिचय द्या. जर ते परत आले आहेत, तर त्यांचे स्वागत करा आणि त्यांच्या मागील संवादाचा उल्लेख करा.

फक्त स्वागत संदेश लिहा, काहीही नाही. 2-3 वाक्ये.`;
      } else {
        return `The user just contacted. Send them a warm welcome message. If they're first-time, introduce yourself. If they're returning, welcome them back and mention their past interactions.

Write only the welcome message, nothing else. 2-3 sentences.`;
      }

    case 'MISSING_FIELDS':
      const missingFields = context.missingFields || [];
      if (isHindi) {
        return `उपयोगकर्ता ने उत्पाद की जानकारी दी है, लेकिन कुछ जानकारी गायब है: ${missingFields.join(', ')}

उनसे गायब जानकारी के लिए पूछो। बहुत ही प्राकृतिक और संवादात्मक तरीके से पूछो, जैसे एक दोस्त पूछेगा। एक बार में केवल एक चीज़ के लिए पूछो।

केवल प्रश्न लिखो, कुछ और नहीं। 1-2 वाक्य।`;
      } else if (isMarathi) {
        return `वापरकर्त्याने उत्पादनाची माहिती दिली आहे, परंतु काही माहिती गहाळ आहे: ${missingFields.join(', ')}

त्यांना गहाळ माहितीसाठी विचारा. अतिशय नैसर्गिक आणि संवादात्मक पद्धतीने विचारा, जसे एक मित्र विचारेल. एका वेळी फक्त एक गोष्टीसाठी विचारा.

फक्त प्रश्न लिहा, काहीही नाही. 1-2 वाक्ये.`;
      } else {
        return `The user provided product information, but some information is missing: ${missingFields.join(', ')}

Ask them for the missing information. Ask in a very natural and conversational way, like a friend would ask. Ask for only one thing at a time.

Write only the question, nothing else. 1-2 sentences.`;
      }

    case 'REQUEST_IMAGE':
      if (isHindi) {
        return `उपयोगकर्ता ने सभी उत्पाद जानकारी दे दी है। अब उनसे उत्पाद की फोटो भेजने के लिए कहो।

बहुत ही उत्साहजनक और सकारात्मक तरीके से पूछो। उन्हें बताओ कि फोटो क्यों जरूरी है।

केवल अनुरोध संदेश लिखो, कुछ और नहीं। 2-3 वाक्य।`;
      } else if (isMarathi) {
        return `वापरकर्त्याने सर्व उत्पादन माहिती दिली आहे. आता त्यांना उत्पादनाचा फोटो पाठवण्यास सांगा.

अतिशय उत्साहवर्धक आणि सकारात्मक पद्धतीने विचारा. त्यांना सांगा की फोटो का आवश्यक आहे.

फक्त विनंती संदेश लिहा, काहीही नाही. 2-3 वाक्ये.`;
      } else {
        return `The user has provided all product information. Now ask them to send a product photo.

Ask in a very enthusiastic and positive way. Tell them why the photo is important.

Write only the request message, nothing else. 2-3 sentences.`;
      }

    case 'CONFIRMATION':
      const productDetails = context.productDetails || {};
      if (isHindi) {
        return `उपयोगकर्ता ने उत्पाद की सभी जानकारी और फोटो दे दी है। अब उन्हें एक पुष्टिकरण संदेश भेजो जिसमें सभी विवरण हों।

विवरण:
- उत्पाद: ${productDetails.productName}
- कीमत: ₹${productDetails.price}/${productDetails.unit}
- मात्रा: ${productDetails.quantity} ${productDetails.unit}
- श्रेणी: ${productDetails.category}

एक संक्षिप्त, स्पष्ट पुष्टिकरण संदेश लिखो। उनसे पूछो कि क्या यह सही है।

केवल पुष्टिकरण संदेश लिखो, कुछ और नहीं। 3-4 वाक्य।`;
      } else if (isMarathi) {
        return `वापरकर्त्याने उत्पादनाची सर्व माहिती आणि फोटो दिला आहे. आता त्यांना एक पुष्टीकरण संदेश पाठवा ज्यामध्ये सर्व तपशील असतील.

तपशील:
- उत्पादन: ${productDetails.productName}
- किंमत: ₹${productDetails.price}/${productDetails.unit}
- प्रमाण: ${productDetails.quantity} ${productDetails.unit}
- वर्ग: ${productDetails.category}

एक संक्षिप्त, स्पष्ट पुष्टीकरण संदेश लिहा. त्यांना विचारा की हे बरोबर आहे का.

फक्त पुष्टीकरण संदेश लिहा, काहीही नाही. 3-4 वाक्ये.`;
      } else {
        return `The user has provided all product information and photo. Now send them a confirmation message with all details.

Details:
- Product: ${productDetails.productName}
- Price: ₹${productDetails.price}/${productDetails.unit}
- Quantity: ${productDetails.quantity} ${productDetails.unit}
- Category: ${productDetails.category}

Write a brief, clear confirmation message. Ask them if this is correct.

Write only the confirmation message, nothing else. 3-4 sentences.`;
      }

    case 'SUCCESS':
      if (isHindi) {
        return `उपयोगकर्ता ने पुष्टि कर दी है। उन्हें एक सफलता संदेश भेजो।

बहुत ही उत्साहजनक और सकारात्मक संदेश लिखो। उन्हें बताओ कि उनका उत्पाद सफलतापूर्वक जोड़ा गया है।

केवल सफलता संदेश लिखो, कुछ और नहीं। 2-3 वाक्य।`;
      } else if (isMarathi) {
        return `वापरकर्त्याने पुष्टी केली आहे. त्यांना एक यश संदेश पाठवा.

अतिशय उत्साहवर्धक आणि सकारात्मक संदेश लिहा. त्यांना सांगा की त्यांचे उत्पादन यशस्वीरित्या जोडले गेले आहे.

फक्त यश संदेश लिहा, काहीही नाही. 2-3 वाक्ये.`;
      } else {
        return `The user has confirmed. Send them a success message.

Write a very enthusiastic and positive message. Tell them their product has been successfully added.

Write only the success message, nothing else. 2-3 sentences.`;
      }

    case 'INCOMPLETE_ORDER_REMINDER':
      if (isHindi) {
        return `उपयोगकर्ता का एक अधूरा ऑर्डर है। उन्हें याद दिलाओ और पूछो कि क्या वे इसे पूरा करना चाहते हैं या नया शुरू करना चाहते हैं।

बहुत ही मानवीय और समझदार तरीके से पूछो। उन्हें दोनों विकल्प दो।

केवल अनुस्मारक संदेश लिखो, कुछ और नहीं। 2-3 वाक्य।`;
      } else if (isMarathi) {
        return `वापरकर्त्याचा एक अपूर्ण ऑर्डर आहे. त्यांना आठवण करून द्या आणि विचारा की ते ते पूर्ण करू इच्छितात की नवीन सुरू करू इच्छितात.

अतिशय मानवी आणि समजूतदार पद्धतीने विचारा. त्यांना दोन्ही पर्याय द्या.

फक्त स्मरणपत्र संदेश लिहा, काहीही नाही. 2-3 वाक्ये.`;
      } else {
        return `The user has an incomplete order. Remind them and ask if they want to complete it or start a new one.

Ask in a very human and understanding way. Give them both options.

Write only the reminder message, nothing else. 2-3 sentences.`;
      }

    default:
      return 'Generate an appropriate message for the current context.';
  }
}

/**
 * Call Amazon Nova Pro for message generation
 */
async function callNovaPro(systemPrompt: string, userPrompt: string): Promise<string> {
  const requestBody = {
    messages: [
      {
        role: 'user',
        content: [
          {
            text: `${systemPrompt}\n\n${userPrompt}`,
          },
        ],
      },
    ],
    inferenceConfig: {
      max_new_tokens: 200,
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

  // Extract generated text
  const generatedText = responseBody.output.message.content[0].text;

  return generatedText.trim();
}
