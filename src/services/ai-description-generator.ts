/**
 * AI-Powered Product Description Generator
 * 
 * Uses Amazon Nova Pro to generate compelling, SEO-friendly product descriptions
 * that help rural sellers create professional listings.
 * 
 * Features:
 * - Multilingual support (Hindi, Marathi, English)
 * - Context-aware descriptions based on product details
 * - Honest and accurate (no exaggeration)
 * - Optimized for e-commerce conversion
 */

import { InvokeModelCommand, BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

// Create a dedicated Bedrock client for us-east-1 (where Nova models are available)
const novaBedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });

/**
 * Product information for description generation
 */
export interface ProductInfo {
  name: string;
  price: number;
  quantity: number;
  unit: string;
  category: string;
  language: string; // 'hi-IN', 'mr-IN', 'en-IN'
  imageUrl?: string;
  sellerLocation?: string;
}

/**
 * Generated description with metadata
 */
export interface GeneratedDescription {
  shortDescription: string; // 1 line summary
  longDescription: string; // 2-3 sentences
  keywords: string[]; // SEO keywords
  highlights: string[]; // Bullet points
  confidence: number; // 0-1 score
}

/**
 * Amazon Nova Lite inference profile ID (cheaper, faster alternative to Nova Pro)
 * Cost: ~$0.00006 per 1K input tokens, ~$0.00024 per 1K output tokens
 */
const NOVA_MODEL_ID = 'us.amazon.nova-lite-v1:0';

/**
 * Generate compelling product description using AI
 */
export async function generateProductDescription(
  productInfo: ProductInfo
): Promise<GeneratedDescription> {
  console.log('Generating AI description for:', productInfo.name);

  try {
    // Construct prompt based on language
    const prompt = buildDescriptionPrompt(productInfo);

    // Call Amazon Nova Pro
    const response = await invokeNovaPro(prompt);

    // Parse and validate response
    const description = parseDescriptionResponse(response, productInfo);

    console.log('Generated description:', description);
    return description;

  } catch (error) {
    console.error('AI description generation failed:', error);
    
    // Fallback to template-based description
    return generateFallbackDescription(productInfo);
  }
}

/**
 * Build prompt for Nova Pro based on product info and language
 */
function buildDescriptionPrompt(product: ProductInfo): string {
  const languageMap = {
    'hi-IN': 'Hindi',
    'mr-IN': 'Marathi',
    'en-IN': 'English'
  };

  const language = languageMap[product.language as keyof typeof languageMap] || 'Hindi';

  return `You are helping a rural Indian seller create an attractive product listing for their e-commerce marketplace.

Product Details:
- Name: ${product.name}
- Price: ₹${product.price}
- Quantity: ${product.quantity} ${product.unit}
- Category: ${product.category}
${product.sellerLocation ? `- Location: ${product.sellerLocation}` : ''}
- Target Language: ${language}

Generate a compelling product description that:
1. Highlights freshness/quality (for food) or key features (for other products)
2. Mentions specific benefits to the buyer
3. Creates mild urgency without being pushy
4. Uses simple, conversational ${language} that rural buyers understand
5. Is 100% honest and accurate - NO exaggeration or false claims
6. Sounds natural, not robotic or marketing-heavy
7. Includes cultural context relevant to Indian buyers

Provide response in this JSON format:
{
  "shortDescription": "One line summary (max 50 characters)",
  "longDescription": "2-3 sentences describing the product naturally",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "highlights": ["benefit 1", "benefit 2", "benefit 3"]
}

Important: 
- For food items, emphasize freshness, taste, and direct-from-farmer
- For handicrafts, emphasize authenticity and craftsmanship
- For daily essentials, emphasize quality and value
- Keep language simple and relatable
- Avoid English words unless commonly used in ${language}

Generate the description now:`;
}

/**
 * Invoke Amazon Nova Pro model
 */
async function invokeNovaPro(prompt: string): Promise<string> {
  const requestBody = {
    messages: [
      {
        role: 'user',
        content: [
          {
            text: prompt
          }
        ]
      }
    ],
    inferenceConfig: {
      max_new_tokens: 500,
      temperature: 0.7,
      top_p: 0.9
    }
  };

  console.log('Calling Nova Lite with prompt length:', prompt.length);

  const command = new InvokeModelCommand({
    modelId: NOVA_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody)
  });

  const response = await novaBedrockClient.send(command);

  if (!response.body) {
    throw new Error('Empty response from Nova Lite');
  }

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  
  // Extract text from Nova Pro response
  const text = responseBody.output?.message?.content?.[0]?.text;
  
  if (!text) {
    throw new Error('No text in Nova Lite response');
  }

  console.log('Nova Lite response length:', text.length);
  return text;
}

/**
 * Parse and validate AI response
 */
function parseDescriptionResponse(
  response: string,
  product: ProductInfo
): GeneratedDescription {
  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonText = response.trim();
    
    // Remove markdown code blocks if present
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```\n?/g, '');
    }

    const parsed = JSON.parse(jsonText);

    // Validate required fields
    if (!parsed.shortDescription || !parsed.longDescription) {
      throw new Error('Missing required description fields');
    }

    // Ensure arrays exist
    const keywords = Array.isArray(parsed.keywords) ? parsed.keywords : [];
    const highlights = Array.isArray(parsed.highlights) ? parsed.highlights : [];

    return {
      shortDescription: parsed.shortDescription.substring(0, 100),
      longDescription: parsed.longDescription.substring(0, 500),
      keywords: keywords.slice(0, 10),
      highlights: highlights.slice(0, 5),
      confidence: 0.9 // High confidence for AI-generated content
    };

  } catch (error) {
    console.error('Failed to parse AI response:', error);
    console.error('Response was:', response);
    
    // Fallback: use response as-is if it's reasonable text
    if (response.length > 20 && response.length < 1000) {
      return {
        shortDescription: `${product.name} - ${product.quantity} ${product.unit}`,
        longDescription: response.substring(0, 500),
        keywords: [product.name, product.category],
        highlights: [`₹${product.price}`, `${product.quantity} ${product.unit}`],
        confidence: 0.5
      };
    }

    throw error;
  }
}

/**
 * Generate fallback description using templates (no AI)
 */
function generateFallbackDescription(product: ProductInfo): GeneratedDescription {
  console.log('Using fallback template for:', product.name);

  const templates = {
    'hi-IN': {
      short: `${product.name} - ${product.quantity} ${product.unit}`,
      long: `ताज़ा ${product.name} उपलब्ध है। ${product.quantity} ${product.unit} पैक में। सीधे विक्रेता से खरीदें और अच्छी गुणवत्ता का आनंद लें।`,
      highlights: ['ताज़ा उत्पाद', 'अच्छी गुणवत्ता', 'सीधे विक्रेता से']
    },
    'mr-IN': {
      short: `${product.name} - ${product.quantity} ${product.unit}`,
      long: `ताजे ${product.name} उपलब्ध आहे. ${product.quantity} ${product.unit} पॅकमध्ये. विक्रेत्याकडून थेट खरेदी करा.`,
      highlights: ['ताजे उत्पादन', 'चांगली गुणवत्ता', 'थेट विक्रेत्याकडून']
    },
    'en-IN': {
      short: `${product.name} - ${product.quantity} ${product.unit}`,
      long: `Fresh ${product.name} available. ${product.quantity} ${product.unit} pack. Buy directly from seller and enjoy good quality.`,
      highlights: ['Fresh product', 'Good quality', 'Direct from seller']
    }
  };

  const template = templates[product.language as keyof typeof templates] || templates['hi-IN'];

  return {
    shortDescription: template.short,
    longDescription: template.long,
    keywords: [product.name, product.category, 'fresh', 'quality'],
    highlights: template.highlights,
    confidence: 0.3 // Low confidence for template
  };
}

/**
 * Validate generated description for quality and safety
 */
export function validateDescription(description: GeneratedDescription): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // Check length constraints
  if (description.shortDescription.length > 100) {
    issues.push('Short description too long');
  }

  if (description.longDescription.length > 500) {
    issues.push('Long description too long');
  }

  // Check for inappropriate content (basic check)
  const inappropriateWords = ['fake', 'duplicate', 'copy', 'नकली', 'धोखा'];
  const allText = `${description.shortDescription} ${description.longDescription}`.toLowerCase();
  
  for (const word of inappropriateWords) {
    if (allText.includes(word.toLowerCase())) {
      issues.push(`Contains inappropriate word: ${word}`);
    }
  }

  // Check for excessive punctuation (spam indicator)
  const exclamationCount = (allText.match(/!/g) || []).length;
  if (exclamationCount > 3) {
    issues.push('Too many exclamation marks');
  }

  return {
    valid: issues.length === 0,
    issues
  };
}
