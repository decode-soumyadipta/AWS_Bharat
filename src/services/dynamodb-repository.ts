/**
 * DynamoDB Repository
 * 
 * This module provides data access functions for all entities
 * using DynamoDB single-table design with GSIs.
 * 
 * Access Patterns:
 * - Get seller profile by phone (GSI1)
 * - Get seller by seller ID
 * - Create and update catalog items (GSI3 for category lookup)
 * - Get all items for a seller
 * - Create and update orders (GSI2 for status lookup)
 * - Get orders by seller and status
 * - Optimistic locking for concurrent updates
 * 
 * Validates: Requirements 1.7, 2.9, 5.6, 6.4
 */

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

/**
 * Error thrown when optimistic locking fails
 */
export class OptimisticLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptimisticLockError';
  }
}

/**
 * Error thrown when an entity is not found
 */
export class EntityNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntityNotFoundError';
  }
}

// ============================================================================
// SELLER PROFILE OPERATIONS
// ============================================================================

/**
 * Create a new seller profile
 * 
 * @param profile - Seller profile to create
 * @returns Created seller profile
 */
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

/**
 * Get seller profile by seller ID
 * 
 * @param sellerId - Unique seller identifier
 * @returns Seller profile or null if not found
 */
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

/**
 * Get seller profile by phone number using GSI1
 * 
 * @param phone - Phone number in E.164 format
 * @returns Seller profile or null if not found
 */
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

/**
 * Update seller profile
 * 
 * @param sellerId - Seller ID
 * @param updates - Partial seller profile with fields to update
 * @returns Updated seller profile
 */
export async function updateSellerProfile(
  sellerId: string,
  updates: Partial<Omit<SellerProfile, 'PK' | 'SK' | 'sellerId' | 'createdAt'>>
): Promise<SellerProfile> {
  const updateExpressions: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, any> = {};

  // Build update expression dynamically
  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      updateExpressions.push(`#${key} = :${key}`);
      expressionAttributeNames[`#${key}`] = key;
      expressionAttributeValues[`:${key}`] = value;
    }
  });

  // Auto-populate GSI5 (ACTIVE_SELLERS) when onboardingState is set to ACTIVE
  if (updates.onboardingState === 'ACTIVE') {
    updateExpressions.push('#gsi5pk = :gsi5pk', '#gsi5sk = :gsi5sk');
    expressionAttributeNames['#gsi5pk'] = 'GSI5PK';
    expressionAttributeNames['#gsi5sk'] = 'GSI5SK';
    expressionAttributeValues[':gsi5pk'] = 'ACTIVE_SELLERS';
    expressionAttributeValues[':gsi5sk'] = sellerId;
  }

  // Always update the updatedAt timestamp
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

// ============================================================================
// CATALOG ITEM OPERATIONS
// ============================================================================

/**
 * Create a new catalog item
 * 
 * @param item - Catalog item to create
 * @returns Created catalog item
 */
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

/**
 * Get catalog item by seller ID and item ID
 * 
 * @param sellerId - Seller ID
 * @param itemId - Item ID
 * @returns Catalog item or null if not found
 */
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

/**
 * Get all catalog items for a seller
 * 
 * @param sellerId - Seller ID
 * @returns Array of catalog items
 */
export async function getCatalogItemsBySeller(sellerId: string): Promise<CatalogItem[]> {
  const params: QueryCommandInput = {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `SELLER#${sellerId}`,
      ':sk': 'ITEM#',
    },
  };

  const result = await docClient.send(new QueryCommand(params));
  return (result.Items || []) as CatalogItem[];
}

/**
 * Get catalog items by category using GSI3
 * 
 * @param category - Product category
 * @returns Array of catalog items in the category
 */
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

/**
 * Update catalog item with optimistic locking
 * 
 * @param sellerId - Seller ID
 * @param itemId - Item ID
 * @param updates - Partial catalog item with fields to update
 * @param currentVersion - Current version number for optimistic locking
 * @returns Updated catalog item
 * @throws OptimisticLockError if version mismatch
 */
export async function updateCatalogItem(
  sellerId: string,
  itemId: string,
  updates: Partial<Omit<CatalogItem, 'PK' | 'SK' | 'itemId' | 'sellerId' | 'createdAt'>>,
  currentVersion: number
): Promise<CatalogItem> {
  const updateExpressions: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, any> = {};

  // Build update expression dynamically
  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined && key !== 'version') {
      updateExpressions.push(`#${key} = :${key}`);
      expressionAttributeNames[`#${key}`] = key;
      expressionAttributeValues[`:${key}`] = value;
    }
  });

  // Increment version and update timestamp
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

/**
 * Delete catalog item
 * 
 * @param sellerId - Seller ID
 * @param itemId - Item ID
 */
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

// ============================================================================
// ORDER OPERATIONS
// ============================================================================

/**
 * Create a new order
 * 
 * @param order - Order to create
 * @returns Created order
 */
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

/**
 * Get order by order ID
 * 
 * @param orderId - Order ID
 * @returns Order or null if not found
 */
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

/**
 * Get all orders for a seller using GSI2
 * 
 * Queries by sellerId (UUID from registration) AND optionally by phone number,
 * because marketplace orders store GSI2PK as SELLER#<phone> while ONDC orders
 * use SELLER#<uuid>. Merges and deduplicates by orderId.
 * 
 * @param sellerId - Seller ID (UUID)
 * @param sellerPhone - Optional seller phone number for marketplace order lookup
 * @returns Array of orders
 */
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

  // Also query by phone number if provided and different from sellerId
  // (marketplace submitOrder stores GSI2PK as SELLER#<phone>)
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

    // Deduplicate by orderId
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

/**
 * Get orders by seller and status using GSI2
 * 
 * @param sellerId - Seller ID
 * @param status - Order status
 * @returns Array of orders with the specified status
 */
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

/**
 * Update order status and timeline
 * 
 * @param orderId - Order ID
 * @param sellerId - Seller ID (needed for GSI2SK update)
 * @param newStatus - New order status
 * @param timelineEntry - Timeline entry to add
 * @returns Updated order
 */
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

/**
 * Update order with optimistic locking
 * 
 * @param orderId - Order ID
 * @param updates - Partial order with fields to update
 * @param currentUpdatedAt - Current updatedAt timestamp for optimistic locking
 * @returns Updated order
 * @throws OptimisticLockError if timestamp mismatch
 */
export async function updateOrder(
  orderId: string,
  updates: Partial<Omit<Order, 'PK' | 'SK' | 'orderId' | 'createdAt'>>,
  currentUpdatedAt: number
): Promise<Order> {
  const updateExpressions: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, any> = {};

  // Build update expression dynamically
  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      updateExpressions.push(`#${key} = :${key}`);
      expressionAttributeNames[`#${key}`] = key;
      expressionAttributeValues[`:${key}`] = value;
    }
  });

  // Always update the updatedAt timestamp
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
