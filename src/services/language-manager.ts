/**
 * Language Manager Service
 * 
 * Manages language detection, storage, and message translations for the voice-first workflow.
 * Supports Hindi, Marathi, and English with natural, conversational phrasing.
 * 
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { updateUserLanguage } from './state-manager';

export type SupportedLanguage = 'hi-IN' | 'mr-IN' | 'en-IN';

/**
 * Message template keys for system responses
 */
export type MessageKey =
  | 'KYC_SUCCESS'
  | 'KYC_ERROR'
  | 'KYC_INVALID_DOCUMENT'
  | 'DOCUMENT_RECEIVED'
  | 'DOCUMENT_VERIFIED'
  | 'REGISTERING_SELLER'
  | 'IMAGE_REQUEST'
  | 'CATALOG_SUCCESS'
  | 'DOCUMENT_UNCLEAR'
  | 'AUDIO_TOO_LARGE'
  | 'IMAGE_TOO_LARGE'
  | 'UNEXPECTED_STATE'
  | 'MISSING_PRODUCT_NAME'
  | 'MISSING_PRICE'
  | 'MISSING_QUANTITY'
  | 'MISSING_UNIT'
  | 'CONFIRMATION_TEXT'
  | 'EDIT_PROMPT'
  | 'HELP_MESSAGE'
  | 'WELCOME_MESSAGE';

/**
 * Message templates in all supported languages
 */
const MESSAGE_TEMPLATES: Record<MessageKey, Record<SupportedLanguage, string>> = {
  WELCOME_MESSAGE: {
    'hi-IN': 'Namaste! Vyapar Vaani mein aapka swagat hai. Main aapka AI business assistant hoon. Aap PAN card ki photo bhej sakte hain verification ke liye, ya seedha guest ke roop mein shuru kar sakte hain.',
    'mr-IN': 'Namaskar! Vyapar Vaani madhye tumche swagat aahe. Mi tumcha AI business assistant aahe. Tumhi PAN card cha photo pathavu shakta verification la, kinva guest mhanun suru karu shakta.',
    'en-IN': 'Hello! Welcome to Vyapar Vaani. I am your AI business assistant. You can send your PAN card photo for verification, or start as a guest.',
  },
  DOCUMENT_RECEIVED: {
    'hi-IN': 'Aapka document mil gaya, check ho raha hai.',
    'mr-IN': 'Tumche document milale, tapasani suru aahe.',
    'en-IN': 'Your document received, checking now.',
  },
  DOCUMENT_VERIFIED: {
    'hi-IN': 'PAN card verify ho gaya.',
    'mr-IN': 'PAN card verify zale.',
    'en-IN': 'PAN card verified.',
  },
  REGISTERING_SELLER: {
    'hi-IN': 'Aapka registration ho raha hai, bas thoda sa wait kijiye.',
    'mr-IN': 'Tumchi nondani suru aahe, thoda thamba.',
    'en-IN': 'Your registration is in progress, just a moment.',
  },
  KYC_SUCCESS: {
    'hi-IN': 'Aapka registration safal raha. Ab aap products add kar sakte hain ya UPI ID bhej sakte hain.',
    'mr-IN': 'Tumchi nondani yashashvi zali. Aata tumhi products add karu shakta kinva UPI ID pathavu shakta.',
    'en-IN': 'Your registration is successful. You can now add products or send your UPI ID.',
  },
  KYC_ERROR: {
    'hi-IN': 'दस्तावेज़ में कुछ समस्या है। कृपया फिर से कोशिश करें।',
    'mr-IN': 'कागदपत्रात काही समस्या आहे. कृपया पुन्हा प्रयत्न करा.',
    'en-IN': 'There is some problem with the document. Please try again.',
  },
  KYC_INVALID_DOCUMENT: {
    'hi-IN': 'Yeh PAN card nahi hai. Kripya sirf apne PAN card ki saaf photo bhejiye. Aadhaar ya koi aur document sweekar nahi hoga.',
    'mr-IN': 'He PAN card nahi. Krupaya phakt tumchya PAN card cha spashta photo pathva. Aadhaar kinva itar kagadpatre chalnar nahit.',
    'en-IN': 'This is not a PAN card. Please send only your PAN card photo clearly. Aadhaar or other documents will not be accepted.',
  },
  IMAGE_REQUEST: {
    'hi-IN': 'Bahut accha! Ab kripya product ki photo bhejiye.',
    'mr-IN': 'Khup chhan! Aata krupaya product cha photo pathva.',
    'en-IN': 'Great! Now please send the product photo.',
  },
  CATALOG_SUCCESS: {
    'hi-IN': 'Badhai ho! Aapka product safaltapoorvak jod diya gaya.',
    'mr-IN': 'Abhinandan! Tumche product yashashviritya jodle gele.',
    'en-IN': 'Congratulations! Your product has been added successfully.',
  },
  DOCUMENT_UNCLEAR: {
    'hi-IN': 'दस्तावेज़ स्पष्ट नहीं है। कृपया अच्छी रोशनी में साफ फोटो भेजें।',
    'mr-IN': 'कागदपत्र स्पष्ट नाही. कृपया चांगल्या प्रकाशात स्पष्ट फोटो पाठवा.',
    'en-IN': 'Document is not clear. Please send a clear photo in good lighting.',
  },
  AUDIO_TOO_LARGE: {
    'hi-IN': 'ऑडियो फ़ाइल बहुत बड़ी है। कृपया छोटा संदेश भेजें।',
    'mr-IN': 'ऑडिओ फाइल खूप मोठी आहे. कृपया लहान संदेश पाठवा.',
    'en-IN': 'Audio file is too large. Please send a shorter message.',
  },
  IMAGE_TOO_LARGE: {
    'hi-IN': 'फोटो बहुत बड़ी है। कृपया छोटी फोटो भेजें।',
    'mr-IN': 'फोटो खूप मोठा आहे. कृपया लहान फोटो पाठवा.',
    'en-IN': 'Photo is too large. Please send a smaller photo.',
  },
  UNEXPECTED_STATE: {
    'hi-IN': 'कुछ गलत हो गया। कृपया "शुरू करें" लिखकर फिर से शुरू करें।',
    'mr-IN': 'काहीतरी चूक झाली. कृपया "सुरू करा" लिहून पुन्हा सुरू करा.',
    'en-IN': 'Something went wrong. Please type "start" to begin again.',
  },
  MISSING_PRODUCT_NAME: {
    'hi-IN': 'कृपया उत्पाद का नाम बताएं।',
    'mr-IN': 'कृपया उत्पादाचे नाव सांगा.',
    'en-IN': 'Please tell the product name.',
  },
  MISSING_PRICE: {
    'hi-IN': 'कीमत क्या है?',
    'mr-IN': 'किंमत काय आहे?',
    'en-IN': 'What is the price?',
  },
  MISSING_QUANTITY: {
    'hi-IN': 'कितनी मात्रा है?',
    'mr-IN': 'किती प्रमाण आहे?',
    'en-IN': 'What is the quantity?',
  },
  MISSING_UNIT: {
    'hi-IN': 'इकाई क्या है? जैसे किलो, लीटर, पीस।',
    'mr-IN': 'एकक काय आहे? जसे किलो, लिटर, पीस.',
    'en-IN': 'What is the unit? Like kilo, liter, piece.',
  },
  CONFIRMATION_TEXT: {
    'hi-IN': 'कृपया जांच लें:\n\n{details}\n\nक्या यह सही है?',
    'mr-IN': 'कृपया तपासा:\n\n{details}\n\nहे बरोबर आहे का?',
    'en-IN': 'Please check:\n\n{details}\n\nIs this correct?',
  },
  EDIT_PROMPT: {
    'hi-IN': 'कौन सी जानकारी बदलनी है? कृपया वॉइस मैसेज भेजें।',
    'mr-IN': 'कोणती माहिती बदलायची आहे? कृपया व्हॉइस मेसेज पाठवा.',
    'en-IN': 'Which information to change? Please send a voice message.',
  },
  HELP_MESSAGE: {
    'hi-IN': 'Main aapki madad kar sakta hoon. Aap PAN card ki photo bhej sakte hain, ya voice message se bataiye kya bechna hai, ya product ki photo bhejiye. Aap kya karna chahenge?',
    'mr-IN': 'Mi tumhala madat karu shakto. Tumhi PAN card cha photo pathavu shakta, kinva voice message ne sanga kay vikayche aahe, kinva product cha photo pathva. Tumhala kay karayche aahe?',
    'en-IN': 'I can help you. You can send your PAN card photo, or tell me what you want to sell via voice message, or send a product photo. What would you like to do?',
  },
};

/**
 * Detect language from transcribed text
 * 
 * This is a simple heuristic-based detection. In production, you would use
 * Amazon Comprehend or a similar service for accurate language detection.
 * 
 * @param transcription - Transcribed text
 * @returns Detected language code
 */
export function detectLanguage(transcription: string): SupportedLanguage {
  // Simple heuristic: check for common Hindi/Marathi/English words
  const hindiPatterns = /[\u0900-\u097F]/; // Devanagari script
  const marathiPatterns = /[\u0900-\u097F]/; // Also Devanagari
  
  if (hindiPatterns.test(transcription)) {
    // Check for Marathi-specific words
    if (transcription.includes('आहे') || transcription.includes('नाही') || transcription.includes('काय')) {
      return 'mr-IN';
    }
    return 'hi-IN';
  }
  
  return 'en-IN'; // Default to English
}

/**
 * Store language preference for a user
 * 
 * @param phone - User phone number
 * @param language - Detected language
 */
export async function storeLanguagePreference(
  phone: string,
  language: SupportedLanguage
): Promise<void> {
  await updateUserLanguage(phone, language);
}

/**
 * Get language preference for a user
 * 
 * @param language - User's language preference (optional)
 * @returns Language code, defaults to Hindi if not provided
 */
export function getLanguagePreference(language?: SupportedLanguage): SupportedLanguage {
  return language || 'hi-IN'; // Default to Hindi
}

/**
 * Translate a message key to the user's language
 * 
 * @param messageKey - Message template key
 * @param language - User's language preference
 * @param params - Optional parameters for template substitution
 * @returns Translated message
 */
export function translateMessage(
  messageKey: MessageKey,
  language?: SupportedLanguage,
  params?: Record<string, string>
): string {
  const lang = getLanguagePreference(language);
  let message = MESSAGE_TEMPLATES[messageKey][lang];
  
  // Substitute parameters if provided
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      // Use a function replacer to avoid issues with special replacement patterns like $&, $`, $', $n
      message = message.replace(`{${key}}`, () => value);
    });
  }
  
  return message;
}

/**
 * Generate a conversational missing fields prompt in the user's language
 * 
 * @param missingFields - Array of missing field names
 * @param language - User's language preference
 * @returns Natural, conversational prompt asking for missing information
 */
export function generateMissingFieldsPrompt(
  missingFields: string[],
  language?: SupportedLanguage
): string {
  const lang = getLanguagePreference(language);
  
  // Create conversational prompts based on what's missing
  const conversationalPrompts: Record<SupportedLanguage, Record<string, string>> = {
    'hi-IN': {
      productName: 'उत्पाद का नाम क्या है',
      price: 'कीमत कितनी है',
      quantity: 'कितनी मात्रा है',
      unit: 'इकाई क्या है - जैसे किलो, बोतल, पीस',
    },
    'mr-IN': {
      productName: 'उत्पादाचे नाव काय आहे',
      price: 'किंमत किती आहे',
      quantity: 'किती प्रमाण आहे',
      unit: 'एकक काय आहे - जसे किलो, बाटली, पीस',
    },
    'en-IN': {
      productName: 'what is the product name',
      price: 'what is the price',
      quantity: 'what is the quantity',
      unit: 'what is the unit - like kg, bottle, piece',
    },
  };
  
  const prompts = missingFields.map(field => conversationalPrompts[lang][field]).filter(Boolean);
  
  // Create natural conversation flow
  if (prompts.length === 0) {
    return '';
  }
  
  const intro = {
    'hi-IN': 'कृपया बताएं',
    'mr-IN': 'कृपया सांगा',
    'en-IN': 'Please tell me',
  };
  
  const connector = {
    'hi-IN': 'और',
    'mr-IN': 'आणि',
    'en-IN': 'and',
  };
  
  if (prompts.length === 1) {
    return `${intro[lang]} ${prompts[0]}?`;
  } else if (prompts.length === 2) {
    return `${intro[lang]} ${prompts[0]} ${connector[lang]} ${prompts[1]}?`;
  } else {
    const lastPrompt = prompts.pop();
    return `${intro[lang]} ${prompts.join(', ')} ${connector[lang]} ${lastPrompt}?`;
  }
}

/**
 * Format catalog item details for confirmation
 * 
 * @param item - Partial catalog item
 * @param language - User's language preference
 * @returns Formatted details string
 */
export function formatCatalogDetails(
  item: {
    productName?: string;
    price?: number;
    quantity?: number;
    unit?: string;
    category?: string;
    description?: string;
  },
  language?: SupportedLanguage
): string {
  const lang = getLanguagePreference(language);
  
  const labels = {
    'hi-IN': {
      product: 'उत्पाद',
      price: 'कीमत',
      quantity: 'मात्रा',
      category: 'श्रेणी',
      description: 'विवरण',
    },
    'mr-IN': {
      product: 'उत्पादन',
      price: 'किंमत',
      quantity: 'प्रमाण',
      category: 'श्रेणी',
      description: 'तपशील',
    },
    'en-IN': {
      product: 'Product',
      price: 'Price',
      quantity: 'Quantity',
      category: 'Category',
      description: 'Description',
    },
  };
  
  const l = labels[lang];
  const parts: string[] = [];
  
  if (item.productName) {
    parts.push(`${l.product}: ${item.productName}`);
  }
  if (item.price !== undefined && item.unit) {
    // Show per-unit price for all unit types (e.g., "₹500/kg", "₹250/bottle", "₹100/piece")
    parts.push(`${l.price}: ₹${item.price}/${item.unit}`);
  } else if (item.price !== undefined) {
    parts.push(`${l.price}: ₹${item.price}`);
  }
  if (item.quantity !== undefined && item.unit) {
    parts.push(`${l.quantity}: ${item.quantity} ${item.unit}`);
  }
  if (item.category) {
    parts.push(`${l.category}: ${item.category}`);
  }
  if (item.description) {
    parts.push(`${l.description}: ${item.description}`);
  }
  
  return parts.join('\n');
}
