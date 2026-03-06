
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

  cachedMarketPrice?: {
    priceInfo: string;
    sourceName: string;
    sourceUrl: string;
    isLive: true;
    cachedAt: number; 
  };
}

interface PartialCatalogDataRecord extends PartialCatalogItem {
  PK: string; 
  SK: string; 
  entityType: 'PARTIAL_CATALOG';
  TTL: number;
}

const STATE_TTL_DAYS = parseInt(process.env.STATE_TTL_DAYS || '7', 10);

const REQUIRED_FIELDS = ['productName', 'price', 'quantity', 'unit'];

function calculateMissingFields(data: Partial<PartialCatalogItem>): string[] {
  return REQUIRED_FIELDS.filter(field => !data[field as keyof PartialCatalogItem]);
}

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

export async function getPartialData(phone: string): Promise<PartialCatalogItem | null> {

  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');

  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `USER#${phone}`,
      ':sk': 'PARTIAL#',
    },
    ScanIndexForward: false, 
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

export async function mergePartialData(
  phone: string,
  newData: Partial<Omit<PartialCatalogItem, 'phone' | 'createdAt' | 'updatedAt' | 'missingFields'>>
): Promise<PartialCatalogItem> {

  const existing = await getPartialData(phone);

  if (!existing) {

    return savePartialData(phone, newData);
  }

  const merged: Partial<PartialCatalogItem> = {
    ...existing,
    ...Object.fromEntries(
      Object.entries(newData).filter(([_, value]) => value !== undefined)
    ),
  };

  const now = Date.now();
  const ttl = Math.floor(now / 1000) + (STATE_TTL_DAYS * 24 * 60 * 60);

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

export async function deletePartialData(phone: string): Promise<void> {

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

export function isPartialDataComplete(data: PartialCatalogItem): boolean {
  return data.missingFields.length === 0;
}
