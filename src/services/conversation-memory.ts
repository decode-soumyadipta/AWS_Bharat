/**
 * Conversation Memory Service
 * 
 * Manages conversation history and memory for the agentic system.
 * Allows the agent to remember past conversations, orders, and interactions.
 * 
 * Features:
 * - Store conversation messages with timestamps
 * - Retrieve conversation history
 * - Query past orders
 * - Track successful catalog additions
 * - Support for "yesterday's order" type queries
 */

import {
  PutCommand,
  QueryCommand,
  type PutCommandInput,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../config/aws-clients';

/**
 * Conversation message record
 */
export interface ConversationMessage {
  phone: string;
  messageId: string;
  timestamp: number;
  role: 'user' | 'agent' | 'system';
  content: string;
  messageType?: 'text' | 'voice' | 'image' | 'button_reply';
  metadata?: Record<string, any>;
}

interface ConversationMessageRecord extends ConversationMessage {
  PK: string; // USER#<phone>
  SK: string; // CONVERSATION#<timestamp>#<messageId>
  entityType: 'CONVERSATION_MESSAGE';
  TTL?: number;
}

/**
 * TTL configuration - keep conversation history for 30 days
 */
const CONVERSATION_TTL_DAYS = 30;

/**
 * Store a conversation message
 * 
 * @param message - Conversation message to store
 */
export async function storeConversationMessage(
  message: ConversationMessage
): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + (CONVERSATION_TTL_DAYS * 24 * 60 * 60);

  const record: ConversationMessageRecord = {
    ...message,
    PK: `USER#${message.phone}`,
    SK: `CONVERSATION#${message.timestamp}#${message.messageId}`,
    entityType: 'CONVERSATION_MESSAGE',
    TTL: ttl,
  };

  const params: PutCommandInput = {
    TableName: TABLE_NAME,
    Item: record,
  };

  await docClient.send(new PutCommand(params));
  console.log(`Stored conversation message for ${message.phone}`);
}

/**
 * Get conversation history for a user
 * 
 * @param phone - User phone number
 * @param limit - Maximum number of messages to retrieve (default: 50)
 * @param startTime - Optional start timestamp for filtering
 * @param endTime - Optional end timestamp for filtering
 * @returns Array of conversation messages
 */
export async function getConversationHistory(
  phone: string,
  limit: number = 50,
  startTime?: number,
  endTime?: number
): Promise<ConversationMessage[]> {
  const params: QueryCommandInput = {
    TableName: TABLE_NAME,
    KeyConditionExpression: startTime && endTime
      ? 'PK = :pk AND SK BETWEEN :startSk AND :endSk'
      : 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: startTime && endTime
      ? {
          ':pk': `USER#${phone}`,
          ':startSk': `CONVERSATION#${startTime}`,
          ':endSk': `CONVERSATION#${endTime}`,
        }
      : {
          ':pk': `USER#${phone}`,
          ':skPrefix': 'CONVERSATION#',
        },
    Limit: limit,
    ScanIndexForward: false, // Most recent first
  };

  const result = await docClient.send(new QueryCommand(params));

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  return result.Items.map((item: any) => ({
    phone: item.phone,
    messageId: item.messageId,
    timestamp: item.timestamp,
    role: item.role,
    content: item.content,
    messageType: item.messageType,
    metadata: item.metadata,
  }));
}

/**
 * User conversation context with patterns and preferences
 */
export interface UserConversationContext {
  messages: Array<{ role: string; content: string; timestamp: number }>;
  patterns: {
    totalInteractions: number;
    successfulCatalogs: number;
    lastInteractionTime?: number;
  };
  preferences: {
    language?: string;
    preferredCategories?: string[];
    typicalPriceRange?: { min: number; max: number };
  };
}

/**
 * Get conversation context for agent
 * Returns recent conversation history formatted for agent context with patterns
 * 
 * @param phone - User phone number
 * @param messageCount - Number of recent messages to include (default: 10)
 * @returns Formatted conversation context with patterns and preferences
 */
export async function getConversationContext(
  phone: string,
  messageCount: number = 10
): Promise<UserConversationContext | null> {
  const history = await getConversationHistory(phone, messageCount);

  if (history.length === 0) {
    return null;
  }

  const messages = history.reverse().map((msg) => ({
    role: msg.role === 'agent' ? 'assistant' : msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
  }));

  // Calculate patterns
  const totalInteractions = history.length;
  const successfulCatalogs = history.filter(
    (msg) => msg.role === 'system' && msg.metadata?.event === 'catalog_added'
  ).length;
  const lastInteractionTime = history[0]?.timestamp;

  // Extract preferences from conversation history
  const categories = new Set<string>();
  const prices: number[] = [];

  history.forEach((msg) => {
    if (msg.metadata?.category) {
      categories.add(msg.metadata.category);
    }
    if (msg.metadata?.price) {
      prices.push(msg.metadata.price);
    }
  });

  const preferredCategories = Array.from(categories);
  const typicalPriceRange =
    prices.length > 0
      ? {
          min: Math.min(...prices),
          max: Math.max(...prices),
        }
      : undefined;

  return {
    messages,
    patterns: {
      totalInteractions,
      successfulCatalogs,
      lastInteractionTime,
    },
    preferences: {
      preferredCategories,
      typicalPriceRange,
    },
  };
}

/**
 * Add a conversation message (alias for storeConversationMessage)
 * 
 * @param phone - User phone number
 * @param message - Message data
 */
export async function addConversationMessage(
  phone: string,
  message: {
    timestamp: number;
    role: 'user' | 'assistant' | 'system';
    content: string;
    messageType?: 'text' | 'voice' | 'image' | 'button_reply';
    metadata?: Record<string, any>;
  }
): Promise<void> {
  await storeConversationMessage({
    phone,
    messageId: `msg-${message.timestamp}`,
    timestamp: message.timestamp,
    role: message.role === 'assistant' ? 'agent' : message.role,
    content: message.content,
    messageType: message.messageType,
    metadata: message.metadata,
  });
}

/**
 * Update user preferences
 * 
 * @param phone - User phone number
 * @param preferences - Preferences to update
 */
export async function updateUserPreferences(
  phone: string,
  preferences: { language?: string }
): Promise<void> {
  // Store preference as a system message
  await storeConversationMessage({
    phone,
    messageId: `pref-${Date.now()}`,
    timestamp: Date.now(),
    role: 'system',
    content: `User preferences updated: ${JSON.stringify(preferences)}`,
    metadata: {
      event: 'preferences_updated',
      preferences,
    },
  });

  // Also update in state manager if language changed
  if (preferences.language) {
    const { updateUserLanguage } = await import('./state-manager');
    await updateUserLanguage(phone, preferences.language as any);
  }
}

/**
 * Get yesterday's orders for a user
 * 
 * @param phone - User phone number (seller)
 * @returns Array of orders from yesterday
 */
export async function getYesterdayOrders(phone: string): Promise<any[]> {
  // Get seller ID from user state
  const { getUserState } = await import('./state-manager');
  const userState = await getUserState(phone);

  if (!userState?.sellerId) {
    return [];
  }

  // Calculate yesterday's date range
  const now = new Date();
  const yesterdayStart = new Date(now);
  yesterdayStart.setDate(now.getDate() - 1);
  yesterdayStart.setHours(0, 0, 0, 0);

  const yesterdayEnd = new Date(now);
  yesterdayEnd.setDate(now.getDate() - 1);
  yesterdayEnd.setHours(23, 59, 59, 999);

  // Query orders from DynamoDB
  const { getOrdersBySeller } = await import('./dynamodb-repository');
  const allOrders = await getOrdersBySeller(userState.sellerId, phone);

  // Filter orders from yesterday
  const yesterdayOrders = allOrders.filter((order) => {
    const orderDate = order.createdAt;
    return orderDate >= yesterdayStart.getTime() && orderDate <= yesterdayEnd.getTime();
  });

  return yesterdayOrders;
}

/**
 * Track successful catalog addition
 * Stores a system message in conversation history
 * 
 * @param phone - User phone number
 */
export async function trackSuccessfulCatalog(phone: string): Promise<void> {
  await storeConversationMessage({
    phone,
    messageId: `system-${Date.now()}`,
    timestamp: Date.now(),
    role: 'system',
    content: 'Product successfully added to catalog',
    metadata: {
      event: 'catalog_added',
    },
  });
}
