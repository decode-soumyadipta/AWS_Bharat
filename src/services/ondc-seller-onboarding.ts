/**
 * ONDC Seller WhatsApp Onboarding Service
 * 
 * Guides sellers through ONDC-required data collection via WhatsApp
 * using voice-first, AI-powered interactions. Collects only essential
 * fields and uses smart defaults for the rest.
 * 
 * ONDC Required Seller Fields (simplified for rural merchants):
 *   - Business name (from KYC or voice)
 *   - Business category (AI-inferred from products)
 *   - Fulfillment type (Delivery / Pickup — voice prompt)
 *   - UPI ID (voice prompt)
 *   - Approximate location / pincode (voice prompt)
 *   - Return policy (default: non-returnable for perishables)
 *   - Cancellation policy (default: free before packing)
 *   - Time to ship (default: P2D)
 * 
 * Skipped (too hard for rural merchants):
 *   - GSTIN (not required for small sellers < ₹40L turnover)
 *   - FSSAI license (only for food items)
 *   - PAN (already collected in KYC)
 */

import { InvokeModelCommand, BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
const NOVA_MODEL_ID = 'us.amazon.nova-lite-v1:0';

/**
 * ONDC seller profile completion status
 */
export interface ONDCProfileStatus {
  complete: boolean;
  missingFields: string[];
  completionPercent: number;
  nextPrompt?: {
    field: string;
    voicePrompt: Record<string, string>;  // language → prompt text
    type: 'text' | 'voice' | 'button';
    options?: Array<{ id: string; title: string }>;
  };
}

/**
 * Extended ONDC-specific seller data (stored alongside SellerProfile)
 */
export interface ONDCSelllerDetails {
  businessName: string;
  businessCategory: string;               // ONDC domain (e.g., 'ONDC:RET10')
  fulfillmentTypes: ('Delivery' | 'Self-Pickup')[];
  upiId?: string;
  location: {
    pincode: string;
    city: string;
    state: string;
    gps?: string;                          // 'lat,long'
  };
  timeToShip: string;                      // ISO 8601 Duration (default: 'P2D')
  returnable: boolean;
  returnWindow: string;                    // ISO 8601 Duration (default: 'P0D')
  cancellable: boolean;
  availableOnCOD: boolean;
  consumerCareContact: string;             // 'phone,email'
}

/**
 * Default ONDC profile for a new seller (sensible defaults for rural merchants)
 */
export function createDefaultONDCDetails(sellerName: string, phone: string): ONDCSelllerDetails {
  return {
    businessName: sellerName,
    businessCategory: 'ONDC:RET10',       // Default: Grocery
    fulfillmentTypes: ['Delivery', 'Self-Pickup'],
    location: {
      pincode: '',
      city: '',
      state: '',
    },
    timeToShip: 'P2D',                    // 2 days default
    returnable: false,                     // Non-returnable by default (perishables)
    returnWindow: 'P0D',
    cancellable: true,
    availableOnCOD: true,                  // COD common in rural India
    consumerCareContact: `${phone},support@vyaparvaani.in`,
  };
}

/**
 * Check ONDC profile completeness and return the next field to collect
 */
export function checkONDCProfileStatus(details: ONDCSelllerDetails): ONDCProfileStatus {
  const missing: string[] = [];

  if (!details.businessName) missing.push('businessName');
  if (!details.location.pincode) missing.push('pincode');
  if (!details.upiId) missing.push('upiId');
  if (details.fulfillmentTypes.length === 0) missing.push('fulfillmentType');

  const totalFields = 4; // Only essential fields
  const completionPercent = Math.round(((totalFields - missing.length) / totalFields) * 100);

  const result: ONDCProfileStatus = {
    complete: missing.length === 0,
    missingFields: missing,
    completionPercent,
  };

  // Generate the next prompt for the first missing field
  if (missing.length > 0) {
    result.nextPrompt = generatePromptForField(missing[0]);
  }

  return result;
}

/**
 * Generate a WhatsApp prompt for a missing ONDC field
 */
export function generatePromptForField(field: string): ONDCProfileStatus['nextPrompt'] {
  const prompts: Record<string, ONDCProfileStatus['nextPrompt']> = {
    businessName: {
      field: 'businessName',
      type: 'voice',
      voicePrompt: {
        hi: '🏪 आपकी दुकान का नाम क्या है? कृपया बोलकर बताएं।',
        mr: '🏪 तुमच्या दुकानाचे नाव काय आहे? कृपया बोलून सांगा.',
        en: '🏪 What is your shop/business name? Please say it.',
      },
    },
    pincode: {
      field: 'pincode',
      type: 'voice',
      voicePrompt: {
        hi: '📍 आपकी दुकान का पिनकोड क्या है? बोलकर बताएं या टाइप करें।',
        mr: '📍 तुमच्या दुकानाचा पिनकोड काय आहे? बोलून सांगा किंवा टाइप करा.',
        en: '📍 What is your shop\'s pincode? Say it or type it.',
      },
    },
    upiId: {
      field: 'upiId',
      type: 'voice',
      voicePrompt: {
        hi: '💰 भुगतान के लिए आपका UPI ID क्या है? (जैसे: name@paytm)\nबोलकर बताएं या टाइप करें।',
        mr: '💰 पेमेंटसाठी तुमचा UPI ID काय आहे? (उदा: name@paytm)\nबोलून सांगा किंवा टाइप करा.',
        en: '💰 What is your UPI ID for payments? (e.g., name@paytm)\nSay it or type it.',
      },
    },
    fulfillmentType: {
      field: 'fulfillmentType',
      type: 'button',
      voicePrompt: {
        hi: '🚚 आप ऑर्डर कैसे पूरा करेंगे?',
        mr: '🚚 तुम्ही ऑर्डर कसे पूर्ण कराल?',
        en: '🚚 How will you fulfill orders?',
      },
      options: [
        { id: 'ondc_delivery', title: '🚚 Delivery' },
        { id: 'ondc_pickup', title: '🏪 Pickup' },
        { id: 'ondc_both', title: '🚚🏪 Both' },
      ],
    },
  };

  return prompts[field] || prompts.businessName;
}

/**
 * AI-powered extraction of ONDC details from voice/text messages
 * Uses Nova Lite to parse seller's natural language into structured data
 */
export async function extractONDCDetailsFromMessage(
  message: string,
  currentField: string,
  language: string
): Promise<{ field: string; value: any; confidence: number } | null> {
  try {
    const prompt = buildExtractionPrompt(message, currentField, language);

    const command = new InvokeModelCommand({
      modelId: NOVA_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { temperature: 0.1, maxTokens: 200 },
      }),
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const text = responseBody.output?.message?.content?.[0]?.text || '';

    // Parse the AI response
    try {
      const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
      return {
        field: currentField,
        value: parsed.value,
        confidence: parsed.confidence || 0.8,
      };
    } catch {
      // Try direct value extraction for simple fields
      return extractDirectValue(message, currentField);
    }
  } catch (error) {
    console.error('AI extraction error:', error);
    return extractDirectValue(message, currentField);
  }
}

/**
 * Build AI prompt for extracting a specific ONDC field
 */
function buildExtractionPrompt(message: string, field: string, language: string): string {
  const fieldInstructions: Record<string, string> = {
    businessName: 'Extract the business/shop name. Return the name in original language.',
    pincode: 'Extract the 6-digit Indian pincode. It should be exactly 6 digits.',
    upiId: 'Extract the UPI ID (format: something@bank). Common formats: name@paytm, name@gpay, phone@ybl, etc.',
    fulfillmentType: 'Determine if the seller wants Delivery, Pickup, or Both.',
  };

  return `You are extracting structured ONDC seller profile data from a ${language} message.

Task: ${fieldInstructions[field] || 'Extract the value.'}

Message: "${message}"

Respond with ONLY a JSON object:
{"value": "<extracted_value>", "confidence": 0.0-1.0}

If you cannot extract the value, respond: {"value": null, "confidence": 0}`;
}

/**
 * Direct value extraction without AI (fallback)
 */
function extractDirectValue(
  message: string,
  field: string
): { field: string; value: any; confidence: number } | null {
  const cleaned = message.trim();

  switch (field) {
    case 'pincode': {
      const match = cleaned.match(/\b(\d{6})\b/);
      if (match) return { field, value: match[1], confidence: 0.95 };
      break;
    }
    case 'upiId': {
      const match = cleaned.match(/[\w.-]+@[\w]+/);
      if (match) return { field, value: match[0], confidence: 0.9 };
      break;
    }
    case 'businessName': {
      if (cleaned.length >= 2 && cleaned.length <= 100) {
        return { field, value: cleaned, confidence: 0.7 };
      }
      break;
    }
    case 'fulfillmentType': {
      const lower = cleaned.toLowerCase();
      if (lower.includes('delivery') || lower.includes('डिलीवरी') || lower.includes('डिलिव्हरी')) {
        return { field, value: 'Delivery', confidence: 0.9 };
      }
      if (lower.includes('pickup') || lower.includes('पिकअप')) {
        return { field, value: 'Self-Pickup', confidence: 0.9 };
      }
      if (lower.includes('both') || lower.includes('दोनों') || lower.includes('दोन्ही')) {
        return { field, value: 'Both', confidence: 0.9 };
      }
      break;
    }
  }

  return null;
}

/**
 * Auto-infer ONDC business category from seller's products
 */
export async function inferBusinessCategory(
  productNames: string[]
): Promise<{ category: string; domain: string; confidence: number }> {
  if (productNames.length === 0) {
    return { category: 'Grocery', domain: 'ONDC:RET10', confidence: 0.5 };
  }

  try {
    const prompt = `Classify these products into ONE ONDC retail category:
Products: ${productNames.join(', ')}

Categories:
- ONDC:RET10 = Grocery (rice, dal, atta, sugar, oil, spices, snacks)
- ONDC:RET11 = Food & Beverage (ready to eat, sweets, namkeen)
- ONDC:RET12 = Fashion (clothes, footwear)
- ONDC:RET13 = Beauty & Personal Care
- ONDC:RET14 = Electronics
- ONDC:RET15 = Appliances
- ONDC:RET16 = Home & Kitchen

Respond ONLY with JSON: {"category": "<name>", "domain": "<ONDC:RETxx>", "confidence": 0.0-1.0}`;

    const command = new InvokeModelCommand({
      modelId: NOVA_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { temperature: 0.1, maxTokens: 100 },
      }),
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const text = responseBody.output?.message?.content?.[0]?.text || '';
    const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());

    return {
      category: parsed.category || 'Grocery',
      domain: parsed.domain || 'ONDC:RET10',
      confidence: parsed.confidence || 0.7,
    };
  } catch {
    return { category: 'Grocery', domain: 'ONDC:RET10', confidence: 0.5 };
  }
}

/**
 * Look up city/state from pincode using India Post API
 */
export async function lookupPincode(pincode: string): Promise<{
  city: string;
  state: string;
  district: string;
} | null> {
  try {
    const response = await fetch(`https://api.postalpincode.in/pincode/${pincode}`);
    if (!response.ok) return null;

    const data = await response.json() as any[];
    if (data?.[0]?.Status === 'Success' && data[0].PostOffice?.length > 0) {
      const po = data[0].PostOffice[0];
      return {
        city: po.Block || po.Division || po.Region,
        state: po.State,
        district: po.District,
      };
    }
    return null;
  } catch {
    return null;
  }
}
