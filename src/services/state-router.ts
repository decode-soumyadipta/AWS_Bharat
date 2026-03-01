/**
 * State Router Service
 * 
 * Routes incoming WhatsApp messages to appropriate handlers based on user state and message type.
 * Provides error guidance when users send unexpected message types.
 * 
 * Requirements: 3.2, 3.3, 3.4, 3.5, 3.6
 */

import { UserState, UserStateType } from './state-manager';
import { translateMessage, SupportedLanguage } from './language-manager';

export type HandlerType = 'KYC' | 'VOICE' | 'IMAGE' | 'CONFIRMATION' | 'AGENT' | 'ERROR';
export type MessageType = 'text' | 'audio' | 'image' | 'button_reply';

export interface RouteDecision {
  handler: HandlerType;
  action: string;
  metadata?: Record<string, any>;
}

/**
 * Routing rules mapping state and message type to handler
 */
const ROUTING_RULES: Record<UserStateType, Record<MessageType | 'default', HandlerType>> = {
  NEW: {
    image: 'KYC',
    text: 'ERROR',
    audio: 'ERROR',
    button_reply: 'ERROR',
    default: 'ERROR',
  },
  KYC_PENDING: {
    image: 'KYC',
    text: 'ERROR',
    audio: 'ERROR',
    button_reply: 'ERROR',
    default: 'ERROR',
  },
  KYC_VERIFIED: {
    audio: 'AGENT',  // Route to AI agent for UPI registration, product voice, etc.
    text: 'AGENT',   // Route to AI agent for UPI ID text, questions, etc.
    image: 'AGENT',  // Route to AI agent for product photos
    button_reply: 'AGENT',
    default: 'AGENT',
  },
  VOICE_RECEIVED: {
    audio: 'AGENT',  // Route to AI agent for natural language processing
    text: 'AGENT',   // Route to AI agent for text queries/UPI
    image: 'AGENT',  // Route to agent — agent handles download/enhance + state transition
    button_reply: 'ERROR',
    default: 'ERROR',
  },
  IMAGE_PENDING: {
    image: 'AGENT',  // Route to agent — handles download/enhance + confirmation trigger
    text: 'AGENT',   // Allow questions/queries while waiting for image
    audio: 'AGENT',  // Allow voice queries while waiting for image
    button_reply: 'ERROR',
    default: 'ERROR',
  },
  CONFIRMATION_PENDING: {
    button_reply: 'CONFIRMATION',
    text: 'AGENT',  // Route to AI agent for flexible conversational handling
    audio: 'AGENT', // Route to AI agent for flexible conversational handling  
    image: 'AGENT', // Allow image even in confirmation (new product photo)
    default: 'ERROR',
  },
  ACTIVE: {
    audio: 'AGENT', // Route to AI agent for natural language processing
    text: 'AGENT',  // Route to AI agent for natural language processing
    image: 'AGENT', // Route to AI agent for natural language processing
    button_reply: 'AGENT', // Route to AI agent for natural language processing
    default: 'AGENT',
  },
};

/**
 * Generate error guidance message based on current state
 * 
 * @param state - Current user state
 * @param messageType - Type of message received
 * @param language - User's language preference
 * @returns Guidance message in user's language
 */
function generateGuidanceMessage(
  state: UserStateType,
  messageType: MessageType,
  language?: SupportedLanguage
): string {
  const lang = language || 'hi-IN';

  const guidance: Record<UserStateType, Record<SupportedLanguage, string>> = {
    NEW: {
      'hi-IN': 'कृपया अपने पैन कार्ड की फोटो भेजें।',
      'mr-IN': 'कृपया तुमच्या पॅन कार्डचा फोटो पाठवा.',
      'en-IN': 'Please send your PAN card photo.',
    },
    KYC_PENDING: {
      'hi-IN': 'कृपया अपने पैन कार्ड की फोटो भेजें।',
      'mr-IN': 'कृपया तुमच्या पॅन कार्डचा फोटो पाठवा.',
      'en-IN': 'Please send your PAN card photo.',
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

/**
 * Route incoming message to appropriate handler
 * 
 * @param messageType - Type of message received
 * @param state - Current user state
 * @returns Route decision with handler and action
 */
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

/**
 * Validate state transition
 * 
 * @param currentState - Current user state
 * @param newState - Proposed new state
 * @returns true if transition is valid
 */
export function isValidTransition(
  currentState: UserStateType,
  newState: UserStateType
): boolean {
  const validTransitions: Record<UserStateType, UserStateType[]> = {
    NEW: ['KYC_PENDING'],
    KYC_PENDING: ['KYC_VERIFIED', 'NEW'],
    KYC_VERIFIED: ['VOICE_RECEIVED', 'IMAGE_PENDING', 'CONFIRMATION_PENDING', 'ACTIVE'],
    VOICE_RECEIVED: ['IMAGE_PENDING', 'VOICE_RECEIVED', 'CONFIRMATION_PENDING'],
    IMAGE_PENDING: ['CONFIRMATION_PENDING'],
    CONFIRMATION_PENDING: ['ACTIVE', 'VOICE_RECEIVED'],
    ACTIVE: ['VOICE_RECEIVED', 'IMAGE_PENDING', 'CONFIRMATION_PENDING'],
  };

  return validTransitions[currentState]?.includes(newState) || false;
}

/**
 * Get expected message types for current state
 * 
 * @param state - Current user state
 * @returns Array of expected message types
 */
export function getExpectedMessageTypes(state: UserStateType): MessageType[] {
  const rules = ROUTING_RULES[state];
  return Object.entries(rules)
    .filter(([key, value]) => key !== 'default' && value !== 'ERROR')
    .map(([key]) => key as MessageType);
}
