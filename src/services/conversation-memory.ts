
import {
  PutCommand,
  QueryCommand,
  type PutCommandInput,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../config/aws-clients';

interface ConversationMessage {
  phone: string;
  messageId: string;
  timestamp: number;
  role: 'user' | 'agent' | 'system';
  content: string;
  messageType?: 'text' | 'voice' | 'image' | 'button_reply';
  metadata?: Record<string, any>;
}

interface ConversationMessageRecord extends ConversationMessage {
  PK: string; 
  SK: string; 
  entityType: 'CONVERSATION_MESSAGE';
  TTL?: number;
}

const CONVERSATION_TTL_DAYS = 30;

async function storeConversationMessage(
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
    ScanIndexForward: false, 
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

export async function getConversationContext(
  phone: string,
  messageCount: number = 20
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

  const totalInteractions = history.length;
  const successfulCatalogs = history.filter(
    (msg) => msg.role === 'system' && msg.metadata?.event === 'catalog_added'
  ).length;
  const lastInteractionTime = history[0]?.timestamp;

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

export async function updateUserPreferences(
  phone: string,
  preferences: { language?: string }
): Promise<void> {

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

  if (preferences.language) {
    const { updateUserLanguage } = await import('./state-manager');
    await updateUserLanguage(phone, preferences.language as any);
  }
}

async function getYesterdayOrders(phone: string): Promise<any[]> {

  const { getUserState } = await import('./state-manager');
  const userState = await getUserState(phone);

  if (!userState?.sellerId) {
    return [];
  }

  const now = new Date();
  const yesterdayStart = new Date(now);
  yesterdayStart.setDate(now.getDate() - 1);
  yesterdayStart.setHours(0, 0, 0, 0);

  const yesterdayEnd = new Date(now);
  yesterdayEnd.setDate(now.getDate() - 1);
  yesterdayEnd.setHours(23, 59, 59, 999);

  const { getOrdersBySeller } = await import('./dynamodb-repository');
  const allOrders = await getOrdersBySeller(userState.sellerId, phone);

  const yesterdayOrders = allOrders.filter((order) => {
    const orderDate = order.createdAt;
    return orderDate >= yesterdayStart.getTime() && orderDate <= yesterdayEnd.getTime();
  });

  return yesterdayOrders;
}

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

export async function getConversationSummary(phone: string): Promise<string> {
  try {
    const history = await getConversationHistory(phone, 50);
    if (history.length === 0) return '';

    const totalMessages = history.length;
    const catalogAdded = history.filter(m => m.role === 'system' && m.metadata?.event === 'catalog_added').length;
    const stockUpdates = history.filter(m => m.role === 'system' && m.metadata?.event === 'stock_updated').length;

    const categories = new Set<string>();
    const prices: number[] = [];
    const productNames = new Set<string>();

    history.forEach(msg => {
      if (msg.metadata?.category) categories.add(msg.metadata.category);
      if (msg.metadata?.price && typeof msg.metadata.price === 'number') prices.push(msg.metadata.price);
      if (msg.metadata?.productName) productNames.add(msg.metadata.productName);
    });

    const oldestMsg = history[history.length - 1];
    const newestMsg = history[0];
    const daysSinceFirst = oldestMsg?.timestamp
      ? Math.floor((Date.now() - oldestMsg.timestamp) / (1000 * 60 * 60 * 24))
      : 0;
    const lastActiveAgo = newestMsg?.timestamp
      ? Math.floor((Date.now() - newestMsg.timestamp) / (1000 * 60))
      : 0;

    let summary = `${totalMessages} messages over ${daysSinceFirst} days`;
    if (catalogAdded > 0) summary += `, ${catalogAdded} products added`;
    if (stockUpdates > 0) summary += `, ${stockUpdates} stock updates`;
    if (categories.size > 0) summary += `, categories: ${Array.from(categories).join(', ')}`;
    if (productNames.size > 0) summary += `, products: ${Array.from(productNames).slice(0, 5).join(', ')}`;
    if (prices.length > 0) {
      const avgPrice = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
      summary += `, avg price: ${avgPrice}`;
    }
    if (lastActiveAgo < 5) summary += ', currently active';
    else if (lastActiveAgo < 60) summary += `, last active ${lastActiveAgo} min ago`;
    else if (lastActiveAgo < 1440) summary += `, last active ${Math.floor(lastActiveAgo / 60)} hours ago`;

    return summary;
  } catch (error) {
    console.warn('Failed to generate conversation summary:', error);
    return '';
  }
}
