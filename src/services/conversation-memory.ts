/**
 * Conversation Memory Service
 * 
 * Maintains conversation history and user context for more natural,
 * human-like interactions. Acts as a personal assistant with memory.
 * 
 * Features:
 * - Stores conversation history per user
 * - Tracks user preferences and patterns
 * - Enables contextual responses
 * - Supports multi-turn conversations
 */

import { DynamoDBClient, PutItemCommand, GetItemCommand, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

// Create DynamoDB client
const dynamoDBClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const TABLE_NAME = process.env.TABLE_NAME || 'vyapar-vaani-data';

/**
 * Conversation message
 */
export interface ConversationMessage {
  timestamp: number;
  role: 'user' | 'assistant';
  content: string;
  intent?: string;
  entities?: Record<string, any>;
  messageType?: 'text' | 'voice' | 'image';
}

/**
 * User conversation context
 */
export interface UserConversationContext {
  phone: string;
  messages: ConversationMessage[];
  preferences: {
    language?: string;
    preferredCategories?: string[];
    typicalPriceRange?: { min: number; max: number };
    commonUnits?: string[];
  };
  patterns: {
    totalInteractions: number;
    successfulCatalogs: number;
    lastInteractionTime: number;
    averageResponseTime?: number;
  };
  createdAt: number;
  updatedAt: number;
}

/**
 * Get conversation history for a user
 */
export async function getConversationHistory(
  phone: string,
  limit: number = 10
): Promise<ConversationMessage[]> {
  try {
    const command = new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        PK: `USER#${phone}`,
        SK: 'CONVERSATION',
      }),
    });

    const response = await dynamoDBClient.send(command);

    if (!response.Item) {
      return [];
    }

    const context = unmarshall(response.Item) as UserConversationContext;
    
    // Return last N messages
    return context.messages.slice(-limit);
  } catch (error) {
    console.error('Failed to get conversation history:', error);
    return [];
  }
}

/**
 * Add message to conversation history
 */
export async function addConversationMessage(
  phone: string,
  message: ConversationMessage
): Promise<void> {
  try {
    // Get existing context
    const existingContext = await getConversationContext(phone);

    // Add new message
    const messages = existingContext?.messages || [];
    messages.push(message);

    // Keep only last 50 messages to avoid data bloat
    const recentMessages = messages.slice(-50);

    // Update patterns
    const patterns = existingContext?.patterns || {
      totalInteractions: 0,
      successfulCatalogs: 0,
      lastInteractionTime: Date.now(),
    };
    patterns.totalInteractions += 1;
    patterns.lastInteractionTime = Date.now();

    // Save updated context
    const command = new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        PK: `USER#${phone}`,
        SK: 'CONVERSATION',
        phone,
        messages: recentMessages,
        preferences: existingContext?.preferences || {},
        patterns,
        createdAt: existingContext?.createdAt || Date.now(),
        updatedAt: Date.now(),
      }),
    });

    await dynamoDBClient.send(command);
  } catch (error) {
    console.error('Failed to add conversation message:', error);
    throw error;
  }
}

/**
 * Get full conversation context
 */
export async function getConversationContext(
  phone: string
): Promise<UserConversationContext | null> {
  try {
    const command = new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        PK: `USER#${phone}`,
        SK: 'CONVERSATION',
      }),
    });

    const response = await dynamoDBClient.send(command);

    if (!response.Item) {
      return null;
    }

    return unmarshall(response.Item) as UserConversationContext;
  } catch (error) {
    console.error('Failed to get conversation context:', error);
    return null;
  }
}

/**
 * Update user preferences based on interactions
 */
export async function updateUserPreferences(
  phone: string,
  updates: Partial<UserConversationContext['preferences']>
): Promise<void> {
  try {
    const context = await getConversationContext(phone);

    const preferences = {
      ...(context?.preferences || {}),
      ...updates,
    };

    const command = new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        PK: `USER#${phone}`,
        SK: 'CONVERSATION',
      }),
      UpdateExpression: 'SET preferences = :preferences, updatedAt = :updatedAt',
      ExpressionAttributeValues: marshall({
        ':preferences': preferences,
        ':updatedAt': Date.now(),
      }),
    });

    await dynamoDBClient.send(command);
  } catch (error) {
    console.error('Failed to update user preferences:', error);
    throw error;
  }
}

/**
 * Generate contextual greeting based on conversation history
 */
export function generateContextualGreeting(
  context: UserConversationContext | null,
  language: string
): string {
  const isHindi = language.startsWith('hi');
  const isMarathi = language.startsWith('mr');

  if (!context || context.patterns.totalInteractions === 0) {
    // First time user
    if (isHindi) {
      return 'नमस्ते! मैं आपका व्यापार सहायक हूं। मैं आपके उत्पादों को ऑनलाइन बेचने में मदद करूंगा। आप क्या बेचना चाहते हैं?';
    } else if (isMarathi) {
      return 'नमस्कार! मी तुमचा व्यापार सहाय्यक आहे। मी तुमच्या उत्पादनांना ऑनलाइन विकण्यात मदत करेन। तुम्हाला काय विकायचे आहे?';
    } else {
      return 'Hello! I\'m your business assistant. I\'ll help you sell your products online. What would you like to sell?';
    }
  }

  // Returning user
  const hoursSinceLastInteraction = (Date.now() - context.patterns.lastInteractionTime) / (1000 * 60 * 60);

  if (hoursSinceLastInteraction < 24) {
    // Recent interaction
    if (isHindi) {
      return 'फिर से आपका स्वागत है! आज क्या बेचना चाहते हैं?';
    } else if (isMarathi) {
      return 'पुन्हा स्वागत आहे! आज काय विकायचे आहे?';
    } else {
      return 'Welcome back! What would you like to sell today?';
    }
  } else if (hoursSinceLastInteraction < 168) {
    // Within a week
    if (isHindi) {
      return `नमस्ते! अच्छा लगा आपको फिर से देखकर। ${context.patterns.successfulCatalogs > 0 ? `आपने ${context.patterns.successfulCatalogs} उत्पाद सफलतापूर्वक जोड़े हैं।` : ''} आज क्या नया है?`;
    } else if (isMarathi) {
      return `नमस्कार! तुम्हाला पुन्हा पाहून आनंद झाला। ${context.patterns.successfulCatalogs > 0 ? `तुम्ही ${context.patterns.successfulCatalogs} उत्पादने यशस्वीरित्या जोडली आहेत।` : ''} आज काय नवीन आहे?`;
    } else {
      return `Hello! Good to see you again. ${context.patterns.successfulCatalogs > 0 ? `You've successfully added ${context.patterns.successfulCatalogs} products.` : ''} What's new today?`;
    }
  } else {
    // Long time user
    if (isHindi) {
      return 'नमस्ते! बहुत दिनों बाद! मैं आपकी मदद के लिए यहां हूं। आज क्या बेचना चाहते हैं?';
    } else if (isMarathi) {
      return 'नमस्कार! खूप दिवसांनंतर! मी तुमच्या मदतीसाठी येथे आहे। आज काय विकायचे आहे?';
    } else {
      return 'Hello! It\'s been a while! I\'m here to help. What would you like to sell today?';
    }
  }
}

/**
 * Generate contextual response based on conversation history
 */
export function generateContextualResponse(
  context: UserConversationContext | null,
  currentIntent: string,
  entities: Record<string, any>,
  language: string
): string {
  const isHindi = language.startsWith('hi');
  const isMarathi = language.startsWith('mr');

  // Check if user has patterns we can reference
  if (context && context.preferences.preferredCategories && context.preferences.preferredCategories.length > 0) {
    const lastCategory = context.preferences.preferredCategories[context.preferences.preferredCategories.length - 1];
    
    if (currentIntent === 'CREATE_CATALOG' && entities.category === lastCategory) {
      if (isHindi) {
        return `अच्छा! फिर से ${lastCategory} बेच रहे हैं। बढ़िया!`;
      } else if (isMarathi) {
        return `छान! पुन्हा ${lastCategory} विकत आहात। उत्तम!`;
      } else {
        return `Great! Selling ${lastCategory} again. Excellent!`;
      }
    }
  }

  // Check for price patterns
  if (context && context.preferences.typicalPriceRange && entities.price) {
    const { min, max } = context.preferences.typicalPriceRange;
    const currentPrice = entities.price;

    if (currentPrice < min * 0.5 || currentPrice > max * 2) {
      if (isHindi) {
        return `यह कीमत आपकी सामान्य कीमत से अलग है। क्या यह सही है?`;
      } else if (isMarathi) {
        return `ही किंमत तुमच्या सामान्य किंमतीपेक्षा वेगळी आहे। हे बरोबर आहे का?`;
      } else {
        return `This price is different from your usual range. Is this correct?`;
      }
    }
  }

  return '';
}

/**
 * Track successful catalog creation
 */
export async function trackSuccessfulCatalog(phone: string): Promise<void> {
  try {
    const command = new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        PK: `USER#${phone}`,
        SK: 'CONVERSATION',
      }),
      UpdateExpression: 'SET patterns.successfulCatalogs = patterns.successfulCatalogs + :inc, updatedAt = :updatedAt',
      ExpressionAttributeValues: marshall({
        ':inc': 1,
        ':updatedAt': Date.now(),
      }),
    });

    await dynamoDBClient.send(command);
  } catch (error) {
    console.error('Failed to track successful catalog:', error);
  }
}
