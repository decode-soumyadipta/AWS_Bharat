
import {
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
  DeleteCommand,
  type PutCommandInput,
  type GetCommandInput,
  type UpdateCommandInput,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../config/aws-clients';
import { SellerProfile } from '../models/seller';
import { CatalogItem } from '../models/catalog';
import { Order, OrderStatus } from '../models/order';

export class OptimisticLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptimisticLockError';
  }
}

class EntityNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntityNotFoundError';
  }
}

export async function createSellerProfile(profile: SellerProfile): Promise<SellerProfile> {
  const params: PutCommandInput = {
    TableName: TABLE_NAME,
    Item: profile,
    ConditionExpression: 'attribute_not_exists(PK)',
  };

  try {
    await docClient.send(new PutCommand(params));
    return profile;
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      throw new Error(`Seller profile already exists: ${profile.sellerId}`);
    }
    throw error;
  }
}

export async function getSellerById(sellerId: string): Promise<SellerProfile | null> {
  const params: GetCommandInput = {
    TableName: TABLE_NAME,
    Key: {
      PK: `SELLER#${sellerId}`,
      SK: 'PROFILE',
    },
  };

  const result = await docClient.send(new GetCommand(params));
  return (result.Item as SellerProfile) || null;
}

export async function getSellerByPhone(phone: string): Promise<SellerProfile | null> {
  const params: QueryCommandInput = {
    TableName: TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :phone AND GSI1SK = :sk',
    ExpressionAttributeValues: {
      ':phone': phone,
      ':sk': 'PROFILE',
    },
    Limit: 1,
  };

  const result = await docClient.send(new QueryCommand(params));
  return result.Items && result.Items.length > 0 ? (result.Items[0] as SellerProfile) : null;
}

export async function updateSellerProfile(
  sellerId: string,
  updates: Partial<Omit<SellerProfile, 'PK' | 'SK' | 'sellerId' | 'createdAt'>>
): Promise<SellerProfile> {
  const updateExpressions: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, any> = {};

  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      updateExpressions.push(`#${key} = :${key}`);
      expressionAttributeNames[`#${key}`] = key;
      expressionAttributeValues[`:${key}`] = value;
    }
  });

  if (updates.onboardingState === 'ACTIVE') {
    updateExpressions.push('#gsi5pk = :gsi5pk', '#gsi5sk = :gsi5sk');
    expressionAttributeNames['#gsi5pk'] = 'GSI5PK';
    expressionAttributeNames['#gsi5sk'] = 'GSI5SK';
    expressionAttributeValues[':gsi5pk'] = 'ACTIVE_SELLERS';
    expressionAttributeValues[':gsi5sk'] = sellerId;
  }

  updateExpressions.push('#updatedAt = :updatedAt');
  expressionAttributeNames['#updatedAt'] = 'updatedAt';
  expressionAttributeValues[':updatedAt'] = Date.now();

  const params: UpdateCommandInput = {
    TableName: TABLE_NAME,
    Key: {
      PK: `SELLER#${sellerId}`,
      SK: 'PROFILE',
    },
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: 'ALL_NEW',
  };

  const result = await docClient.send(new UpdateCommand(params));
  return result.Attributes as SellerProfile;
}

export async function createCatalogItem(item: CatalogItem): Promise<CatalogItem> {
  const params: PutCommandInput = {
    TableName: TABLE_NAME,
    Item: item,
    ConditionExpression: 'attribute_not_exists(PK)',
  };

  try {
    await docClient.send(new PutCommand(params));
    return item;
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      throw new Error(`Catalog item already exists: ${item.itemId}`);
    }
    throw error;
  }
}

export async function getCatalogItem(sellerId: string, itemId: string): Promise<CatalogItem | null> {
  const params: GetCommandInput = {
    TableName: TABLE_NAME,
    Key: {
      PK: `SELLER#${sellerId}`,
      SK: `ITEM#${itemId}`,
    },
  };

  const result = await docClient.send(new GetCommand(params));
  return (result.Item as CatalogItem) || null;
}

export async function getCatalogItemsBySeller(sellerId: string, sellerPhone?: string): Promise<CatalogItem[]> {
  const params: QueryCommandInput = {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `SELLER#${sellerId}`,
      ':sk': 'ITEM#',
    },
  };

  const result = await docClient.send(new QueryCommand(params));
  const items = (result.Items || []) as CatalogItem[];

  if (sellerPhone && sellerPhone !== sellerId) {
    const phoneParams: QueryCommandInput = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SELLER#${sellerPhone}`,
        ':sk': 'ITEM#',
      },
    };
    const phoneResult = await docClient.send(new QueryCommand(phoneParams));
    const phoneItems = (phoneResult.Items || []) as CatalogItem[];
    const seenIds = new Set(items.map(i => i.itemId));
    for (const item of phoneItems) {
      if (!seenIds.has(item.itemId)) {
        items.push(item);
        seenIds.add(item.itemId);
      }
    }
  }

  return items;
}

export async function getCatalogItemsByCategory(category: string): Promise<CatalogItem[]> {
  const params: QueryCommandInput = {
    TableName: TABLE_NAME,
    IndexName: 'GSI3',
    KeyConditionExpression: 'GSI3PK = :category AND begins_with(GSI3SK, :sk)',
    ExpressionAttributeValues: {
      ':category': `CATEGORY#${category}`,
      ':sk': 'ITEM#',
    },
  };

  const result = await docClient.send(new QueryCommand(params));
  return (result.Items || []) as CatalogItem[];
}

export async function updateCatalogItem(
  sellerId: string,
  itemId: string,
  updates: Partial<Omit<CatalogItem, 'PK' | 'SK' | 'itemId' | 'sellerId' | 'createdAt'>>,
  currentVersion: number
): Promise<CatalogItem> {
  const updateExpressions: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, any> = {};

  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined && key !== 'version') {
      updateExpressions.push(`#${key} = :${key}`);
      expressionAttributeNames[`#${key}`] = key;
      expressionAttributeValues[`:${key}`] = value;
    }
  });

  updateExpressions.push('#version = :newVersion');
  updateExpressions.push('#updatedAt = :updatedAt');
  expressionAttributeNames['#version'] = 'version';
  expressionAttributeNames['#updatedAt'] = 'updatedAt';
  expressionAttributeValues[':newVersion'] = currentVersion + 1;
  expressionAttributeValues[':updatedAt'] = Date.now();
  expressionAttributeValues[':currentVersion'] = currentVersion;

  const params: UpdateCommandInput = {
    TableName: TABLE_NAME,
    Key: {
      PK: `SELLER#${sellerId}`,
      SK: `ITEM#${itemId}`,
    },
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ConditionExpression: '#version = :currentVersion',
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: 'ALL_NEW',
  };

  try {
    const result = await docClient.send(new UpdateCommand(params));
    return result.Attributes as CatalogItem;
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      throw new OptimisticLockError(
        `Version mismatch for catalog item ${itemId}. Expected version ${currentVersion}.`
      );
    }
    throw error;
  }
}

export async function deleteCatalogItem(sellerId: string, itemId: string): Promise<void> {
  const params = {
    TableName: TABLE_NAME,
    Key: {
      PK: `SELLER#${sellerId}`,
      SK: `ITEM#${itemId}`,
    },
  };

  await docClient.send(new DeleteCommand(params));
}

export async function createOrder(order: Order): Promise<Order> {
  const params: PutCommandInput = {
    TableName: TABLE_NAME,
    Item: order,
    ConditionExpression: 'attribute_not_exists(PK)',
  };

  try {
    await docClient.send(new PutCommand(params));
    return order;
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      throw new Error(`Order already exists: ${order.orderId}`);
    }
    throw error;
  }
}

export async function getOrderById(orderId: string): Promise<Order | null> {
  const params: GetCommandInput = {
    TableName: TABLE_NAME,
    Key: {
      PK: `ORDER#${orderId}`,
      SK: 'METADATA',
    },
  };

  const result = await docClient.send(new GetCommand(params));
  return (result.Item as Order) || null;
}

export async function getOrdersBySeller(sellerId: string, sellerPhone?: string): Promise<Order[]> {
  const params: QueryCommandInput = {
    TableName: TABLE_NAME,
    IndexName: 'GSI2',
    KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `SELLER#${sellerId}`,
      ':sk': 'STATUS#',
    },
  };

  const result = await docClient.send(new QueryCommand(params));
  const orders = (result.Items || []) as Order[];

  if (sellerPhone && sellerPhone !== sellerId) {
    const phoneParams: QueryCommandInput = {
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SELLER#${sellerPhone}`,
        ':sk': 'STATUS#',
      },
    };

    const phoneResult = await docClient.send(new QueryCommand(phoneParams));
    const phoneOrders = (phoneResult.Items || []) as Order[];

    const seenIds = new Set(orders.map(o => o.orderId));
    for (const order of phoneOrders) {
      if (!seenIds.has(order.orderId)) {
        orders.push(order);
        seenIds.add(order.orderId);
      }
    }
  }

  return orders;
}

export async function getOrdersBySellerAndStatus(
  sellerId: string,
  status: OrderStatus
): Promise<Order[]> {
  const params: QueryCommandInput = {
    TableName: TABLE_NAME,
    IndexName: 'GSI2',
    KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `SELLER#${sellerId}`,
      ':sk': `STATUS#${status}#`,
    },
  };

  const result = await docClient.send(new QueryCommand(params));
  return (result.Items || []) as Order[];
}

export async function updateOrderStatus(
  orderId: string,
  sellerId: string,
  newStatus: OrderStatus,
  timelineEntry: { status: OrderStatus; timestamp: number; actor: 'SELLER' | 'BUYER' | 'SYSTEM'; notes?: string }
): Promise<Order> {
  const timestamp = Date.now();

  const params: UpdateCommandInput = {
    TableName: TABLE_NAME,
    Key: {
      PK: `ORDER#${orderId}`,
      SK: 'METADATA',
    },
    UpdateExpression: 'SET #status = :status, #timeline = list_append(#timeline, :entry), #updatedAt = :updatedAt, #gsi2sk = :gsi2sk',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#timeline': 'timeline',
      '#updatedAt': 'updatedAt',
      '#gsi2sk': 'GSI2SK',
    },
    ExpressionAttributeValues: {
      ':status': newStatus,
      ':entry': [timelineEntry],
      ':updatedAt': timestamp,
      ':gsi2sk': `STATUS#${newStatus}#${timestamp}`,
    },
    ReturnValues: 'ALL_NEW',
  };

  const result = await docClient.send(new UpdateCommand(params));
  return result.Attributes as Order;
}

export async function updateOrder(
  orderId: string,
  updates: Partial<Omit<Order, 'PK' | 'SK' | 'orderId' | 'createdAt'>>,
  currentUpdatedAt: number
): Promise<Order> {
  const updateExpressions: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, any> = {};

  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      updateExpressions.push(`#${key} = :${key}`);
      expressionAttributeNames[`#${key}`] = key;
      expressionAttributeValues[`:${key}`] = value;
    }
  });

  updateExpressions.push('#updatedAt = :updatedAt');
  expressionAttributeNames['#updatedAt'] = 'updatedAt';
  expressionAttributeValues[':updatedAt'] = Date.now();
  expressionAttributeValues[':currentUpdatedAt'] = currentUpdatedAt;

  const params: UpdateCommandInput = {
    TableName: TABLE_NAME,
    Key: {
      PK: `ORDER#${orderId}`,
      SK: 'METADATA',
    },
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ConditionExpression: '#updatedAt = :currentUpdatedAt',
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: 'ALL_NEW',
  };

  try {
    const result = await docClient.send(new UpdateCommand(params));
    return result.Attributes as Order;
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      throw new OptimisticLockError(
        `Timestamp mismatch for order ${orderId}. Expected updatedAt ${currentUpdatedAt}.`
      );
    }
    throw error;
  }
}
