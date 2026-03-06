
import { UserState, UserStateType } from './state-manager';
import { translateMessage, SupportedLanguage } from './language-manager';

export type HandlerType = 'KYC' | 'VOICE' | 'IMAGE' | 'CONFIRMATION' | 'AGENT' | 'ERROR';
export type MessageType = 'text' | 'audio' | 'image' | 'button_reply';

interface RouteDecision {
  handler: HandlerType;
  action: string;
  metadata?: Record<string, any>;
}

const ROUTING_RULES: Record<UserStateType, Record<MessageType | 'default', HandlerType>> = {
  NEW: {
    image: 'KYC',     
    text: 'AGENT',    
    audio: 'AGENT',   
    button_reply: 'AGENT',
    default: 'AGENT',
  },
  KYC_PENDING: {
    image: 'KYC',     
    text: 'AGENT',    
    audio: 'AGENT',   
    button_reply: 'AGENT',
    default: 'AGENT',
  },
  KYC_VERIFIED: {
    audio: 'AGENT',
    text: 'AGENT',
    image: 'AGENT',
    button_reply: 'AGENT',
    default: 'AGENT',
  },
  GUEST_ACTIVE: {
    audio: 'AGENT',   
    text: 'AGENT',
    image: 'AGENT',   
    button_reply: 'AGENT',
    default: 'AGENT',
  },
  VOICE_RECEIVED: {
    audio: 'AGENT',  
    text: 'AGENT',   
    image: 'AGENT',  
    button_reply: 'AGENT',  
    default: 'ERROR',
  },
  IMAGE_PENDING: {
    image: 'AGENT',  
    text: 'AGENT',   
    audio: 'AGENT',  
    button_reply: 'AGENT',  
    default: 'ERROR',
  },
  CONFIRMATION_PENDING: {
    button_reply: 'AGENT',  
    text: 'AGENT',  
    audio: 'AGENT', 
    image: 'AGENT', 
    default: 'ERROR',
  },
  ACTIVE: {
    audio: 'AGENT', 
    text: 'AGENT',  
    image: 'AGENT', 
    button_reply: 'AGENT', 
    default: 'AGENT',
  },
};

function generateGuidanceMessage(
  state: UserStateType,
  messageType: MessageType,
  language?: SupportedLanguage
): string {
  const lang = language || 'hi-IN';

  const guidance: Record<UserStateType, Record<SupportedLanguage, string>> = {
    NEW: {
      'hi-IN': 'नमस्ते! Vyapar Vaani में आपका स्वागत है। कुछ भी पूछिए या बताइए।',
      'mr-IN': 'नमस्कार! Vyapar Vaani मध्ये आपले स्वागत आहे.',
      'en-IN': 'Hello! Welcome to Vyapar Vaani. Ask me anything.',
    },
    KYC_PENDING: {
      'hi-IN': 'PAN card की फोटो भेज दीजिए, या कुछ और पूछिए।',
      'mr-IN': 'पॅन कार्डचा फोटो पाठवा, किंवा काहीही विचारा.',
      'en-IN': 'Send your PAN card photo, or ask me anything.',
    },
    GUEST_ACTIVE: {
      'hi-IN': 'बताइए क्या करना है? प्रोडक्ट जोड़ें, भाव जानें, या कुछ और।',
      'mr-IN': 'सांगा काय करायचे आहे? उत्पादन जोडा, किंमत तपासा.',
      'en-IN': 'What would you like to do? Add products, check prices, or anything else.',
    },
    KYC_VERIFIED: {
      'hi-IN': 'कृपया उत्पाद के बारे में वॉइस मैसेज भेजें।',
      'mr-IN': 'कृपया उत्पादाबद्दल व्हॉइस मेसेज पाठवा.',
      'en-IN': 'Please send a voice message about the product.',
    },
    VOICE_RECEIVED: {
      'hi-IN': 'कृपया अधिक जानकारी के लिए वॉइस मैसेज भेजें।',
      'mr-IN': 'कृपया अधिक माहितीसाठी व्हॉइस मेसेज पाठवा.',
      'en-IN': 'Please send a voice message for more information.',
    },
    IMAGE_PENDING: {
      'hi-IN': 'कृपया उत्पाद की फोटो भेजें।',
      'mr-IN': 'कृपया उत्पादाचा फोटो पाठवा.',
      'en-IN': 'Please send the product photo.',
    },
    CONFIRMATION_PENDING: {
      'hi-IN': 'कृपया "स्वीकार करें" या "संपादित करें" बटन दबाएं।',
      'mr-IN': 'कृपया "स्वीकार करा" किंवा "संपादित करा" बटण दाबा.',
      'en-IN': 'Please press "Approve" or "Edit" button.',
    },
    ACTIVE: {
      'hi-IN': 'नया उत्पाद जोड़ने के लिए वॉइस मैसेज भेजें।',
      'mr-IN': 'नवीन उत्पादन जोडण्यासाठी व्हॉइस मेसेज पाठवा.',
      'en-IN': 'Send a voice message to add a new product.',
    },
  };

  return guidance[state][lang];
}

export function route(
  messageType: MessageType,
  state: UserState
): RouteDecision {
  const rules = ROUTING_RULES[state.state];
  const handler = rules[messageType] || rules.default;

  if (handler === 'ERROR') {
    return {
      handler: 'ERROR',
      action: 'send_guidance',
      metadata: {
        guidanceMessage: generateGuidanceMessage(state.state, messageType, state.language),
        currentState: state.state,
        receivedMessageType: messageType,
      },
    };
  }

  return {
    handler,
    action: 'process',
    metadata: {
      currentState: state.state,
      messageType,
    },
  };
}

export function isValidTransition(
  currentState: UserStateType,
  newState: UserStateType
): boolean {
  const validTransitions: Record<UserStateType, UserStateType[]> = {
    NEW: ['KYC_PENDING', 'KYC_VERIFIED', 'GUEST_ACTIVE'],
    KYC_PENDING: ['KYC_VERIFIED', 'NEW', 'GUEST_ACTIVE'],
    KYC_VERIFIED: ['VOICE_RECEIVED', 'IMAGE_PENDING', 'CONFIRMATION_PENDING', 'ACTIVE'],
    GUEST_ACTIVE: ['KYC_PENDING', 'KYC_VERIFIED', 'VOICE_RECEIVED', 'IMAGE_PENDING', 'CONFIRMATION_PENDING', 'ACTIVE'],
    VOICE_RECEIVED: ['IMAGE_PENDING', 'VOICE_RECEIVED', 'CONFIRMATION_PENDING'],
    IMAGE_PENDING: ['CONFIRMATION_PENDING'],
    CONFIRMATION_PENDING: ['ACTIVE', 'VOICE_RECEIVED'],
    ACTIVE: ['VOICE_RECEIVED', 'IMAGE_PENDING', 'CONFIRMATION_PENDING'],
  };

  return validTransitions[currentState]?.includes(newState) || false;
}

export function getExpectedMessageTypes(state: UserStateType): MessageType[] {
  const rules = ROUTING_RULES[state];
  return Object.entries(rules)
    .filter(([key, value]) => key !== 'default' && value !== 'ERROR')
    .map(([key]) => key as MessageType);
}
