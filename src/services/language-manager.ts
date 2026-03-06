
import { updateUserLanguage } from './state-manager';

export type SupportedLanguage = 'hi-IN' | 'mr-IN' | 'en-IN';

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

const MESSAGE_TEMPLATES: Record<MessageKey, Record<SupportedLanguage, string>> = {
  WELCOME_MESSAGE: {
    'hi-IN': 'नमस्ते! व्यापार वाणी में आपका स्वागत है। मैं आपका AI बिज़नेस असिस्टेंट हूँ। आप PAN कार्ड की फोटो भेज सकते हैं वेरिफिकेशन के लिए, या सीधे गेस्ट के रूप में शुरू कर सकते हैं।',
    'mr-IN': 'नमस्कार! व्यापार वाणी मध्ये तुमचे स्वागत आहे. मी तुमचा AI बिझनेस असिस्टंट आहे. तुम्ही PAN कार्डचा फोटो पाठवू शकता verification साठी, किंवा गेस्ट म्हणून सुरू करू शकता.',
    'en-IN': 'Hello! Welcome to Vyapar Vaani. I am your AI business assistant. You can send your PAN card photo for verification, or start as a guest.',
  },
  DOCUMENT_RECEIVED: {
    'hi-IN': 'आपका दस्तावेज़ मिल गया, चेक हो रहा है।',
    'mr-IN': 'तुमचे कागदपत्र मिळाले, तपासणी सुरू आहे.',
    'en-IN': 'Your document received, checking now.',
  },
  DOCUMENT_VERIFIED: {
    'hi-IN': 'PAN कार्ड वेरिफाई हो गया।',
    'mr-IN': 'PAN कार्ड verify झाले.',
    'en-IN': 'PAN card verified.',
  },
  REGISTERING_SELLER: {
    'hi-IN': 'आपका रजिस्ट्रेशन हो रहा है, बस थोड़ा सा इंतज़ार कीजिए।',
    'mr-IN': 'तुमची नोंदणी सुरू आहे, थोडा थांबा.',
    'en-IN': 'Your registration is in progress, just a moment.',
  },
  KYC_SUCCESS: {
    'hi-IN': 'आपका रजिस्ट्रेशन सफल रहा। अब आप प्रोडक्ट्स जोड़ सकते हैं या UPI ID भेज सकते हैं।',
    'mr-IN': 'तुमची नोंदणी यशस्वी झाली. आता तुम्ही प्रोडक्ट्स जोडू शकता किंवा UPI ID पाठवू शकता.',
    'en-IN': 'Your registration is successful. You can now add products or send your UPI ID.',
  },
  KYC_ERROR: {
    'hi-IN': 'दस्तावेज़ में कुछ समस्या है। कृपया फिर से कोशिश करें।',
    'mr-IN': 'कागदपत्रात काही समस्या आहे. कृपया पुन्हा प्रयत्न करा.',
    'en-IN': 'There is some problem with the document. Please try again.',
  },
  KYC_INVALID_DOCUMENT: {
    'hi-IN': 'यह PAN कार्ड नहीं है। कृपया सिर्फ अपने PAN कार्ड की साफ फोटो भेजिए। आधार या कोई और दस्तावेज़ स्वीकार नहीं होगा।',
    'mr-IN': 'हे PAN कार्ड नाही. कृपया फक्त तुमच्या PAN कार्डचा स्पष्ट फोटो पाठवा. आधार किंवा इतर कागदपत्रे चालणार नाहीत.',
    'en-IN': 'This is not a PAN card. Please send only your PAN card photo clearly. Aadhaar or other documents will not be accepted.',
  },
  IMAGE_REQUEST: {
    'hi-IN': 'बहुत अच्छा! अब कृपया प्रोडक्ट की फोटो भेजिए।',
    'mr-IN': 'खूप छान! आता कृपया प्रोडक्टचा फोटो पाठवा.',
    'en-IN': 'Great! Now please send the product photo.',
  },
  CATALOG_SUCCESS: {
    'hi-IN': 'बधाई हो! आपका प्रोडक्ट सफलतापूर्वक जोड़ दिया गया।',
    'mr-IN': 'अभिनंदन! तुमचे प्रोडक्ट यशस्वीरित्या जोडले गेले.',
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
    'hi-IN': 'मैं आपकी मदद कर सकता हूँ। आप PAN कार्ड की फोटो भेज सकते हैं, या वॉइस मैसेज से बताइए क्या बेचना है, या प्रोडक्ट की फोटो भेजिए। आप क्या करना चाहेंगे?',
    'mr-IN': 'मी तुम्हाला मदत करू शकतो. तुम्ही PAN कार्डचा फोटो पाठवू शकता, किंवा व्हॉइस मेसेजने सांगा काय विकायचे आहे, किंवा प्रोडक्टचा फोटो पाठवा. तुम्हाला काय करायचे आहे?',
    'en-IN': 'I can help you. You can send your PAN card photo, or tell me what you want to sell via voice message, or send a product photo. What would you like to do?',
  },
};

export function detectLanguage(transcription: string): SupportedLanguage {

  const hindiPatterns = /[\u0900-\u097F]/; 
  const marathiPatterns = /[\u0900-\u097F]/; 

  if (hindiPatterns.test(transcription)) {

    if (transcription.includes('आहे') || transcription.includes('नाही') || transcription.includes('काय')) {
      return 'mr-IN';
    }
    return 'hi-IN';
  }

  return 'en-IN'; 
}

export async function storeLanguagePreference(
  phone: string,
  language: SupportedLanguage
): Promise<void> {
  await updateUserLanguage(phone, language);
}

export function getLanguagePreference(language?: SupportedLanguage): SupportedLanguage {
  return language || 'hi-IN'; 
}

export function translateMessage(
  messageKey: MessageKey,
  language?: SupportedLanguage,
  params?: Record<string, string>
): string {
  const lang = getLanguagePreference(language);
  let message = MESSAGE_TEMPLATES[messageKey][lang];

  if (params) {
    Object.entries(params).forEach(([key, value]) => {

      message = message.replace(`{${key}}`, () => value);
    });
  }

  return message;
}

export function generateMissingFieldsPrompt(
  missingFields: string[],
  language?: SupportedLanguage
): string {
  const lang = getLanguagePreference(language);

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
