/**
 * Partial Data Store Service
 * 
 * Stores incomplete catalog data during multi-step collection in the voice-first workflow.
 * Handles merging of partial data as new information is collected from users.
 * 
 * Requirements: 4.7, 7.5, 7.8
 */

import {
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
  type PutCommandInput,
  type GetCommandInput,
  type UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../config/aws-clients';

export interface PartialCatalogItem {
  phone: string;
  productName?: string;
  price?: number;
  quantity?: number;
  unit?: string;
  category?: string;
  description?: string;
  originalImageUrl?: string;
  enhancedImageUrl?: string;
  missingFields: string[];
  source: 'voice' | 'text';
  createdAt: number;
  updatedAt: number;
  // Cached LIVE market price — used when re-confirmation needs to resend but API is flaky
  cachedMarketPrice?: {
    priceInfo: string;
    sourceName: string;
    sourceUrl: string;
    isLive: true;
    cachedAt: number; // epoch ms
  };
}

interface PartialCatalogDataRecord extends PartialCatalogItem {
  PK: string; // USER#<phone>
  SK: string; // PARTIAL#<timestamp>
  entityType: 'PARTIAL_CATALOG';
  TTL: number;
}

/**
 * TTL configuration in days
 * Configurable via environment variable
 */
const STATE_TTL_DAYS = parseInt(process.env.STATE_TTL_DAYS || '7', 10);

/**
 * Required fields for a complete catalog item
 */
const REQUIRED_FIELDS = ['productName', 'price', 'quantity', 'unit'];

/**
 * Calculate missing fields from partial data
 */
function calculateMissingFields(data: Partial<PartialCatalogItem>): string[] {
  return REQUIRED_FIELDS.filter(field => !data[field as keyof PartialCatalogItem]);
}

/**
 * Save partial catalog data
 * 
 * @param phone - User phone number
 * @param data - Partial catalog item data
 * @returns Saved partial catalog item
 */
export async function savePartialData(
  phone: string,
  data: Partial<Omit<PartialCatalogItem, 'phone' | 'createdAt' | 'updatedAt' | 'missingFields'>>
): Promise<PartialCatalogItem> {
  const now = Date.now();
  const ttl = Math.floor(now / 1000) + (STATE_TTL_DAYS * 24 * 60 * 60);

  const partialData: PartialCatalogItem = {
    phone,
    ...data,
    missingFields: calculateMissingFields(data),
    source: data.source || 'voice',
    createdAt: now,
    updatedAt: now,
  };

  const record: PartialCatalogDataRecord = {
    ...partialData,
    PK: `USER#${phone}`,
    SK: `PARTIAL#${now}`,
    entityType: 'PARTIAL_CATALOG',
    TTL: ttl,
  };

  const params: PutCommandInput = {
    TableName: TABLE_NAME,
    Item: record,
  };

  await docClient.send(new PutCommand(params));
  console.log(`Saved partial data for ${phone}:`, { missingFields: partialData.missingFields });
  
  return partialData;
}

/**
 * Get partial catalog data for a user
 * 
 * @param phone - User phone number
 * @returns Partial catalog item or null if not found
 */
export async function getPartialData(phone: string): Promise<PartialCatalogItem | null> {
  // Query for all partial data items and get the most recent one
  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
  
  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `USER#${phone}`,
      ':sk': 'PARTIAL#',
    },
    ScanIndexForward: false, // Sort descending to get most recent first
    Limit: 1,
  };

  const result = await docClient.send(new QueryCommand(params));
  
  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  const record = result.Items[0] as PartialCatalogDataRecord;
  return {
    phone: record.phone,
    productName: record.productName,
    price: record.price,
    quantity: record.quantity,
    unit: record.unit,
    category: record.category,
    description: record.description,
    originalImageUrl: record.originalImageUrl,
    enhancedImageUrl: record.enhancedImageUrl,
    missingFields: record.missingFields,
    source: record.source,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Merge new data with existing partial data
 * 
 * Preserves existing values and only updates fields that are provided in newData.
 * Recalculates missing fields after merge.
 * 
 * @param phone - User phone number
 * @param newData - New partial data to merge
 * @returns Merged partial catalog item
 */
export async function mergePartialData(
  phone: string,
  newData: Partial<Omit<PartialCatalogItem, 'phone' | 'createdAt' | 'updatedAt' | 'missingFields'>>
): Promise<PartialCatalogItem> {
  // Get existing data
  const existing = await getPartialData(phone);
  
  if (!existing) {
    // No existing data, create new
    return savePartialData(phone, newData);
  }

  // Merge data, preserving existing values
  const merged: Partial<PartialCatalogItem> = {
    ...existing,
    ...Object.fromEntries(
      Object.entries(newData).filter(([_, value]) => value !== undefined)
    ),
  };

  const now = Date.now();
  const ttl = Math.floor(now / 1000) + (STATE_TTL_DAYS * 24 * 60 * 60);

  // Get the SK of the existing record
  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
  const queryParams = {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `USER#${phone}`,
      ':sk': 'PARTIAL#',
    },
    ScanIndexForward: false,
    Limit: 1,
  };
  const queryResult = await docClient.send(new QueryCommand(queryParams));
  const existingSK = queryResult.Items?.[0]?.SK || `PARTIAL#${existing.createdAt}`;

  // Build update expression
  const updateExpressions: string[] = ['#updatedAt = :updatedAt', '#missingFields = :missingFields'];
  const expressionAttributeNames: Record<string, string> = {
    '#updatedAt': 'updatedAt',
    '#missingFields': 'missingFields',
    '#ttl': 'TTL',
  };
  const expressionAttributeValues: Record<string, any> = {
    ':updatedAt': now,
    ':missingFields': calculateMissingFields(merged),
    ':ttl': ttl,
  };

  // Add fields from newData to update expression
  Object.entries(newData).forEach(([key, value]) => {
    if (value !== undefined && key !== 'phone' && key !== 'createdAt' && key !== 'updatedAt' && key !== 'missingFields') {
      updateExpressions.push(`#${key} = :${key}`);
      expressionAttributeNames[`#${key}`] = key;
      expressionAttributeValues[`:${key}`] = value;
    }
  });

  updateExpressions.push('#ttl = :ttl');

  const params: UpdateCommandInput = {
    TableName: TABLE_NAME,
    Key: {
      PK: `USER#${phone}`,
      SK: existingSK,
    },
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: 'ALL_NEW',
  };

  const result = await docClient.send(new UpdateCommand(params));
  const record = result.Attributes as PartialCatalogDataRecord;

  console.log(`Merged partial data for ${phone}:`, { 
    newFields: Object.keys(newData),
    missingFields: record.missingFields 
  });

  return {
    phone: record.phone,
    productName: record.productName,
    price: record.price,
    quantity: record.quantity,
    unit: record.unit,
    category: record.category,
    description: record.description,
    originalImageUrl: record.originalImageUrl,
    enhancedImageUrl: record.enhancedImageUrl,
    missingFields: record.missingFields,
    source: record.source,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Delete partial catalog data after successful catalog creation
 * 
 * @param phone - User phone number
 */
export async function deletePartialData(phone: string): Promise<void> {
  // Query for all partial data items
  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
  
  const queryParams = {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `USER#${phone}`,
      ':sk': 'PARTIAL#',
    },
  };

  const result = await docClient.send(new QueryCommand(queryParams));
  
  if (!result.Items || result.Items.length === 0) {
    console.log(`No partial data found to delete for ${phone}`);
    return;
  }

  // Delete all partial data items
  for (const item of result.Items) {
    const params = {
      TableName: TABLE_NAME,
      Key: {
        PK: item.PK,
        SK: item.SK,
      },
    };
    await docClient.send(new DeleteCommand(params));
  }
  
  console.log(`Deleted ${result.Items.length} partial data item(s) for ${phone}`);
}

/**
 * Check if partial data is complete (all required fields present)
 * 
 * @param data - Partial catalog item
 * @returns true if all required fields are present
 */
export function isPartialDataComplete(data: PartialCatalogItem): boolean {
  return data.missingFields.length === 0;
}
