/**
 * Context-Aware Voice Guidance Generator
 * 
 * Generates specific, contextual voice instructions for sellers
 * that mention actual product names and values instead of generic templates.
 * 
 * Features:
 * - Product-specific examples
 * - Realistic modifications
 * - Multilingual support
 * - Easy to understand
 */

import { InvokeModelCommand, BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });
const NOVA_MODEL_ID = 'us.amazon.nova-lite-v1:0';

/**
 * Voice guidance with examples
 */
export interface VoiceGuidance {
  instructions: string; // Main instructions
  examples: string[]; // 2-3 specific examples
  tips: string; // Helpful tips
  confidence: number;
}

/**
 * Generate contextual voice instructions
 */
export async function generateContextualInstructions(
  productName: string,
  price: number,
  quantity: number,
  unit: string,
  language: string
): Promise<VoiceGuidance> {
  console.log('Generating contextual voice guidance for:', productName);

  try {
    const prompt = buildGuidancePrompt({
      productName,
      price,
      quantity,
      unit,
      language
    });

    const aiResponse = await invokeNovaLite(prompt);
    const guidance = parseVoiceGuidance(aiResponse);

    console.log('Generated voice guidance:', guidance);
    return guidance;

  } catch (error) {
    console.error('Voice guidance generation failed:', error);
    
    // Fallback to template-based guidance
    return generateFallbackGuidance(productName, price, quantity, unit, language);
  }
}

/**
 * Build AI prompt for voice guidance
 */
function buildGuidancePrompt(data: {
  productName: string;
  price: number;
  quantity: number;
  unit: string;
  language: string;
}): string {
  const languageMap: Record<string, string> = {
    'hi-IN': 'Hindi',
    'mr-IN': 'Marathi',
    'en-IN': 'English'
  };

  const language = languageMap[data.language] || 'Hindi';

  return `You are helping a rural Indian seller understand how to modify their product listing using voice commands.

Current Product:
- Name: ${data.productName}
- Price: ₹${data.price}
- Quantity: ${data.quantity} ${data.unit}
- Language: ${language}

Generate natural, easy-to-understand voice command instructions in ${language}.

Requirements:
1. Use the ACTUAL product name "${data.productName}" in examples
2. Show REALISTIC modifications (not random numbers)
   - For price: suggest ±10-20% changes
   - For quantity: suggest realistic adjustments
3. Use conversational ${language} that rural sellers understand
4. Provide 3 specific examples they can say
5. Keep it simple, friendly, and encouraging
6. Avoid technical jargon

Provide response in this JSON format:
{
  "instructions": "Main instruction text in ${language}",
  "examples": [
    "Example 1 with actual product name and realistic values",
    "Example 2 with actual product name and realistic values",
    "Example 3 with actual product name and realistic values"
  ],
  "tips": "Helpful tip in ${language}"
}

Example for "आम, ₹50, 20 किलो":
{
  "instructions": "अपने आम की जानकारी बदलने के लिए, आप ये बोल सकते हैं:",
  "examples": [
    "आम की कीमत 55 रुपये करें",
    "आम की मात्रा 25 किलो करें",
    "आम की कीमत 48 रुपये और मात्रा 30 किलो करें"
  ],
  "tips": "आप एक साथ कीमत और मात्रा दोनों बदल सकते हैं। बस साफ़ और धीरे बोलें।"
}

Generate instructions now:`;
}

/**
 * Invoke Nova Lite for guidance generation
 */
async function invokeNovaLite(prompt: string): Promise<string> {
  const requestBody = {
    messages: [
      {
        role: 'user',
        content: [{ text: prompt }]
      }
    ],
    inferenceConfig: {
      max_new_tokens: 400,
      temperature: 0.7,
      top_p: 0.9
    }
  };

  console.log('Calling Nova Lite for voice guidance...');

  const command = new InvokeModelCommand({
    modelId: NOVA_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody)
  });

  const response = await bedrockClient.send(command);

  if (!response.body) {
    throw new Error('Empty response from Nova Lite');
  }

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const text = responseBody.output?.message?.content?.[0]?.text;

  if (!text) {
    throw new Error('No text in Nova Lite response');
  }

  return text;
}

/**
 * Parse AI response into voice guidance
 */
function parseVoiceGuidance(response: string): VoiceGuidance {
  try {
    // Extract JSON from response
    let jsonText = response.trim();
    
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```\n?/g, '');
    }

    const parsed = JSON.parse(jsonText);

    return {
      instructions: parsed.instructions || '',
      examples: Array.isArray(parsed.examples) ? parsed.examples.slice(0, 3) : [],
      tips: parsed.tips || '',
      confidence: 0.9
    };

  } catch (error) {
    console.error('Failed to parse voice guidance:', error);
    throw error;
  }
}

/**
 * Generate fallback guidance using templates
 */
function generateFallbackGuidance(
  productName: string,
  price: number,
  quantity: number,
  unit: string,
  language: string
): VoiceGuidance {
  console.log('Using fallback guidance template');

  const templates: Record<string, any> = {
    'hi-IN': {
      instructions: `अपने ${productName} की जानकारी बदलने के लिए, आप ये बोल सकते हैं:`,
      examples: [
        `${productName} की कीमत ${Math.round(price * 1.1)} रुपये करें`,
        `${productName} की मात्रा ${Math.round(quantity * 1.2)} ${unit} करें`,
        `${productName} की कीमत ${Math.round(price * 0.9)} रुपये और मात्रा ${Math.round(quantity * 1.5)} ${unit} करें`
      ],
      tips: 'आप एक साथ कीमत और मात्रा दोनों बदल सकते हैं। बस साफ़ और धीरे बोलें।'
    },
    'mr-IN': {
      instructions: `तुमच्या ${productName} ची माहिती बदलण्यासाठी, तुम्ही हे बोलू शकता:`,
      examples: [
        `${productName} ची किंमत ${Math.round(price * 1.1)} रुपये करा`,
        `${productName} चे प्रमाण ${Math.round(quantity * 1.2)} ${unit} करा`,
        `${productName} ची किंमत ${Math.round(price * 0.9)} रुपये आणि प्रमाण ${Math.round(quantity * 1.5)} ${unit} करा`
      ],
      tips: 'तुम्ही एकाच वेळी किंमत आणि प्रमाण दोन्ही बदलू शकता. फक्त स्पष्ट आणि हळू बोला.'
    },
    'en-IN': {
      instructions: `To modify your ${productName} details, you can say:`,
      examples: [
        `Change ${productName} price to ${Math.round(price * 1.1)} rupees`,
        `Change ${productName} quantity to ${Math.round(quantity * 1.2)} ${unit}`,
        `Change ${productName} price to ${Math.round(price * 0.9)} rupees and quantity to ${Math.round(quantity * 1.5)} ${unit}`
      ],
      tips: 'You can change both price and quantity together. Just speak clearly and slowly.'
    }
  };

  const template = templates[language] || templates['hi-IN'];

  return {
    instructions: template.instructions,
    examples: template.examples,
    tips: template.tips,
    confidence: 0.3
  };
}
