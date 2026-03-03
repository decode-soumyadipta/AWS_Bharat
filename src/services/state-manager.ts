/**
 * State Manager Service
 * 
 * Manages user state transitions and persistence for the voice-first workflow.
 * Tracks user progress through onboarding states and ensures atomic state transitions.
 * 
 * Requirements: 3.1, 3.7, 3.8, 7.1, 7.2, 7.3, 7.4, 7.7
 */

import {
  PutCommand,
  GetCommand,
  UpdateCommand,
  type PutCommandInput,
  type GetCommandInput,
  type UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../config/aws-clients';

export type UserStateType = 
  | 'NEW'
  | 'KYC_PENDING'
  | 'KYC_VERIFIED'
  | 'GUEST_ACTIVE'
  | 'VOICE_RECEIVED'
  | 'IMAGE_PENDING'
  | 'CONFIRMATION_PENDING'
  | 'ACTIVE';

export interface UserState {
  phone: string;
  state: UserStateType;
  language?: 'hi-IN' | 'mr-IN' | 'en-IN';
  sellerId?: string;
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

interface UserStateRecord extends UserState {
  PK: string; // USER#<phone>
  SK: string; // STATE
  entityType: 'USER_STATE';
  TTL?: number;
  // GSI4: For querying users by state (analytics and monitoring)
  GSI4PK?: string; // STATE#<state>
  GSI4SK?: string; // <updatedAt>#<phone>
}

/**
 * TTL configuration in days
 * Configurable via environment variable
 */
const STATE_TTL_DAYS = parseInt(process.env.STATE_TTL_DAYS || '7', 10);

import { retryWithBackoff as retryWithBackoffUtil, logStructured } from '../utils/error-handler';
import { publishStateTransitionMetric } from '../utils/monitoring';

/**
 * Retry a function with exponential backoff
 * Uses centralized error handling utility
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  operation: string
): Promise<T> {
  return retryWithBackoffUtil(fn, operation, undefined, { component: 'state-manager' });
}

/**
 * Get user state from DynamoDB
 * 
 * @param phone - User phone number in E.164 format
 * @returns User state or null if not found
 */
export async function getUserState(phone: string): Promise<UserState | null> {
  const params: GetCommandInput = {
    TableName: TABLE_NAME,
    Key: {
      PK: `USER#${phone}`,
      SK: 'STATE',
    },
  };

  const result = await retryWithBackoff(
    async () => docClient.send(new GetCommand(params)),
    'getUserState'
  );

  if (!result.Item) {
    return null;
  }

  const record = result.Item as UserStateRecord;
  return {
    phone: record.phone,
    state: record.state,
    language: record.language,
    sellerId: record.sellerId,
    metadata: record.metadata,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Initialize a new user with NEW state
 * 
 * @param phone - User phone number in E.164 format
 * @returns Initialized user state
 */
export async function initializeNewUser(phone: string, profileName?: string): Promise<UserState> {
  const now = Date.now();
  const ttl = Math.floor(now / 1000) + (STATE_TTL_DAYS * 24 * 60 * 60);
  
  const userState: UserState = {
    phone,
    state: 'NEW',
    metadata: profileName ? { profileName } : undefined,
    createdAt: now,
    updatedAt: now,
  };

  const record: UserStateRecord = {
    ...userState,
    PK: `USER#${phone}`,
    SK: 'STATE',
    entityType: 'USER_STATE',
    TTL: ttl,
    GSI4PK: `STATE#${userState.state}`,
    GSI4SK: `${now}#${phone}`,
  };

  const params: PutCommandInput = {
    TableName: TABLE_NAME,
    Item: record,
    ConditionExpression: 'attribute_not_exists(PK)',
  };

  try {
    await retryWithBackoff(
      async () => docClient.send(new PutCommand(params)),
      'initializeNewUser'
    );
    console.log(`Initialized new user state for ${phone}`);
    return userState;
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      // User already exists, fetch and return existing state
      console.log(`User ${phone} already exists, fetching existing state`);
      const existing = await getUserState(phone);
      if (existing) {
        return existing;
      }
    }
    throw error;
  }
}

/**
 * Update user state with atomic transition
 * 
 * @param phone - User phone number
 * @param newState - New state to transition to
 * @param metadata - Optional metadata to store with state
 */
export async function updateUserState(
  phone: string,
  newState: UserStateType,
  metadata?: Record<string, any>
): Promise<void> {
  const startTime = Date.now();
  
  // Get current state for metrics
  const currentState = await getUserState(phone);
  const previousState = currentState?.state || 'UNKNOWN';
  
  const now = Date.now();
  const ttl = (newState === 'ACTIVE' || newState === 'GUEST_ACTIVE' || newState === 'KYC_VERIFIED')
    ? undefined // No TTL for active/verified/guest users — prevent re-NEW-ification
    : Math.floor(now / 1000) + (STATE_TTL_DAYS * 24 * 60 * 60);

  const updateExpressions: string[] = ['#state = :state', '#updatedAt = :updatedAt'];
  const expressionAttributeNames: Record<string, string> = {
    '#state': 'state',
    '#updatedAt': 'updatedAt',
  };
  const expressionAttributeValues: Record<string, any> = {
    ':state': newState,
    ':updatedAt': now,
  };

  // Update GSI4 attributes for state-based querying
  updateExpressions.push('#gsi4pk = :gsi4pk', '#gsi4sk = :gsi4sk');
  expressionAttributeNames['#gsi4pk'] = 'GSI4PK';
  expressionAttributeNames['#gsi4sk'] = 'GSI4SK';
  expressionAttributeValues[':gsi4pk'] = `STATE#${newState}`;
  expressionAttributeValues[':gsi4sk'] = `${now}#${phone}`;

  if (metadata) {
    updateExpressions.push('#metadata = :metadata');
    expressionAttributeNames['#metadata'] = 'metadata';
    expressionAttributeValues[':metadata'] = metadata;
  }

  if (ttl) {
    updateExpressions.push('#ttl = :ttl');
    expressionAttributeNames['#ttl'] = 'TTL';
    expressionAttributeValues[':ttl'] = ttl;
  } else {
    // Remove TTL for active users
    updateExpressions.push('REMOVE #ttl');
    expressionAttributeNames['#ttl'] = 'TTL';
  }

  const params: UpdateCommandInput = {
    TableName: TABLE_NAME,
    Key: {
      PK: `USER#${phone}`,
      SK: 'STATE',
    },
    UpdateExpression: `SET ${updateExpressions.filter(e => !e.startsWith('REMOVE')).join(', ')}${updateExpressions.some(e => e.startsWith('REMOVE')) ? ' REMOVE ' + updateExpressions.filter(e => e.startsWith('REMOVE')).map(e => e.replace('REMOVE ', '')).join(', ') : ''}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  };

  await retryWithBackoff(
    async () => docClient.send(new UpdateCommand(params)),
    'updateUserState'
  );

  const duration = Date.now() - startTime;
  
  // Publish state transition metric
  await publishStateTransitionMetric(phone, previousState as UserStateType, newState, duration);

  logStructured('INFO', `Updated user state for ${phone}: ${previousState} -> ${newState}`, {
    phone,
    previousState,
    newState,
    duration,
    metadata,
  });
}

/**
 * Update user language preference
 * 
 * @param phone - User phone number
 * @param language - Detected language
 */
export async function updateUserLanguage(
  phone: string,
  language: 'hi-IN' | 'mr-IN' | 'en-IN'
): Promise<void> {
  const params: UpdateCommandInput = {
    TableName: TABLE_NAME,
    Key: {
      PK: `USER#${phone}`,
      SK: 'STATE',
    },
    UpdateExpression: 'SET #language = :language, #updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#language': 'language',
      '#updatedAt': 'updatedAt',
    },
    ExpressionAttributeValues: {
      ':language': language,
      ':updatedAt': Date.now(),
    },
  };

  await retryWithBackoff(
    async () => docClient.send(new UpdateCommand(params)),
    'updateUserLanguage'
  );

  console.log(`Updated language for ${phone}: ${language}`);
}

/**
 * Update seller ID after KYC verification
 * 
 * @param phone - User phone number
 * @param sellerId - Seller ID from registration
 */
export async function updateUserSellerId(
  phone: string,
  sellerId: string
): Promise<void> {
  const params: UpdateCommandInput = {
    TableName: TABLE_NAME,
    Key: {
      PK: `USER#${phone}`,
      SK: 'STATE',
    },
    UpdateExpression: 'SET #sellerId = :sellerId, #updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#sellerId': 'sellerId',
      '#updatedAt': 'updatedAt',
    },
    ExpressionAttributeValues: {
      ':sellerId': sellerId,
      ':updatedAt': Date.now(),
    },
  };

  await retryWithBackoff(
    async () => docClient.send(new UpdateCommand(params)),
    'updateUserSellerId'
  );

  console.log(`Updated seller ID for ${phone}: ${sellerId}`);
}

/**
 * Query users by state using GSI4
 * Useful for analytics and monitoring
 * 
 * @param state - User state to query
 * @param limit - Maximum number of results to return (default: 100)
 * @returns Array of user states
 */
export async function getUsersByState(
  state: UserStateType,
  limit: number = 100
): Promise<UserState[]> {
  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
  
  const params = {
    TableName: TABLE_NAME,
    IndexName: 'GSI4',
    KeyConditionExpression: '#gsi4pk = :gsi4pk',
    ExpressionAttributeNames: {
      '#gsi4pk': 'GSI4PK',
    },
    ExpressionAttributeValues: {
      ':gsi4pk': `STATE#${state}`,
    },
    Limit: limit,
    ScanIndexForward: false, // Most recent first
  };

  const result = await retryWithBackoff(
    async () => docClient.send(new QueryCommand(params)),
    'getUsersByState'
  );

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  return result.Items.map((item: any) => ({
    phone: item.phone,
    state: item.state,
    language: item.language,
    sellerId: item.sellerId,
    metadata: item.metadata,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
}

