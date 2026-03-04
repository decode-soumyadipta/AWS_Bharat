/**
 * Bedrock Agent Action Group — Tool Functions
 * 
 * This Lambda implements the tool functions that the Bedrock Agent can autonomously invoke.
 * Each tool provides real data access that the AI agent uses for multi-step reasoning.
 * 
 * Tools:
 * 1. get_market_price — Live mandi/commodity prices from data.gov.in
 * 2. search_catalog — Query seller's products from DynamoDB
 * 3. get_order_details — Look up order status and details
 * 4. update_stock — Voice-driven stock quantity updates
 * 5. get_seller_analytics — Sales summary, top products, revenue
 * 
 * Architecture: Bedrock Agent → InvokeAgent API → This Lambda (action group)
 * The agent decides WHEN to call these tools based on conversation context.
 */

import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));
const TABLE_NAME = process.env.TABLE_NAME || 'vyapar-vaani-data';
const MARKETPLACE_TABLE = process.env.MARKETPLACE_PRODUCTS_TABLE || 'marketplace-products';

/**
 * Bedrock Agent action group handler.
 * Routes to the appropriate tool function based on the action group and function name.
 */
export async function handler(event: any): Promise<any> {
  console.log('Agent tool invocation:', JSON.stringify(event, null, 2));

  const actionGroup = event.actionGroup;
  const functionName = event.function || event.apiPath;
  const parameters = event.parameters || [];

  // Extract parameters into a key-value map
  const params: Record<string, string> = {};
  for (const param of parameters) {
    params[param.name] = param.value;
  }

  let result: any;

  try {
    switch (functionName) {
      case 'get_market_price':
        result = await getMarketPrice(params.product_name, params.region);
        break;
      case 'search_catalog':
        result = await searchCatalog(params.seller_phone, params.query);
        break;
      case 'get_order_details':
        result = await getOrderDetails(params.order_id);
        break;
      case 'update_stock':
        result = await updateStock(params.product_id, parseInt(params.new_quantity), params.seller_phone);
        break;
      case 'get_seller_analytics':
        result = await getSellerAnalytics(params.seller_phone, params.period);
        break;
      default:
        result = { error: `Unknown function: ${functionName}` };
    }
  } catch (error: any) {
    console.error(`Tool ${functionName} failed:`, error);
    result = { error: error.message };
  }

  // Return in Bedrock Agent action group response format
  return {
    messageVersion: '1.0',
    response: {
      actionGroup,
      function: functionName,
      functionResponse: {
        responseBody: {
          'TEXT': {
            body: JSON.stringify(result),
          },
        },
      },
    },
  };
}

/**
 * Tool 1: Get live market/mandi prices for a product.
 * Combines data.gov.in commodity prices with local commodity database.
 */
async function getMarketPrice(productName: string, region?: string): Promise<any> {
  // Import the existing market price utilities
  const { getLocalMarketPrice, fetchLiveMarketPrice } = await import('../tools/web-search');

  // First check local commodity database (instant, always available)
  const localPrice = getLocalMarketPrice(productName);

  // Try live mandi prices from data.gov.in
  let livePrice: any = null;
  try {
    livePrice = await fetchLiveMarketPrice(productName);
  } catch (err) {
    console.warn('Live market price fetch failed:', err);
  }

  return {
    product: productName,
    region: region || 'India',
    localData: localPrice.found ? {
      priceRange: localPrice.priceInfo,
      source: localPrice.sourceName,
      unit: 'per kg',
    } : null,
    liveMandiData: livePrice?.found ? {
      market: livePrice.market,
      price: livePrice.price,
      date: livePrice.date,
      source: 'data.gov.in',
    } : null,
    found: localPrice.found || (livePrice?.found ?? false),
    summary: localPrice.found
      ? `${productName}: ${localPrice.priceInfo} (Source: ${localPrice.sourceName})`
      : `Market price data not available for ${productName}`,
  };
}

/**
 * Tool 2: Search seller's product catalog from DynamoDB.
 * Returns all products for a seller, optionally filtered by search query.
 */
async function searchCatalog(sellerPhone: string, query?: string): Promise<any> {
  const result = await ddbClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `SELLER#${sellerPhone}`,
      ':sk': 'ITEM#',
    },
  }));

  let items = (result.Items || []).map((item: any) => ({
    itemId: item.itemId || item.SK?.replace('ITEM#', ''),
    name: item.becknItem?.descriptor?.name || item.productName || 'Unknown',
    price: item.becknItem?.price?.value || item.price || 0,
    unit: item.unit || 'unit',
    quantity: item.quantity || item.becknItem?.quantity?.available?.count || 0,
    category: item.category || item.becknItem?.category_id || 'other',
    imageUrl: item.becknItem?.descriptor?.images?.[0]?.url || null,
    status: item.status || 'active',
  }));

  // Apply search filter if provided
  if (query) {
    const q = query.toLowerCase();
    items = items.filter((i: any) =>
      i.name.toLowerCase().includes(q) ||
      i.category.toLowerCase().includes(q)
    );
  }

  return {
    sellerPhone,
    totalProducts: items.length,
    products: items,
    summary: items.length > 0
      ? `${items.length} products found: ${items.map((i: any) => `${i.name} (₹${i.price}/${i.unit})`).join(', ')}`
      : 'No products found in catalog.',
  };
}

/**
 * Tool 3: Get order details by order ID.
 * Returns full order information including status, items, payment, and timeline.
 */
async function getOrderDetails(orderId: string): Promise<any> {
  const result = await ddbClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: `ORDER#${orderId}`, SK: 'METADATA' },
  }));

  if (!result.Item) {
    return { found: false, orderId, message: 'Order not found' };
  }

  const order = result.Item;
  return {
    found: true,
    orderId,
    status: order.status,
    items: (order.items || []).map((i: any) => ({
      name: i.name,
      quantity: i.quantity,
      price: i.price,
      unit: i.unit,
    })),
    totalAmount: order.payment?.amount || 0,
    paymentMethod: order.payment?.method || 'Unknown',
    paymentStatus: order.payment?.status || 'pending',
    buyer: {
      name: order.buyer?.name,
      phone: order.buyer?.phone,
    },
    sellerPhone: order.seller?.phone,
    createdAt: order.createdAt,
    timeline: order.timeline || [],
    summary: `Order ${orderId}: ${order.status} | ₹${order.payment?.amount || 0} | ${order.payment?.method || 'N/A'}`,
  };
}

/**
 * Tool 4: Update product stock quantity.
 * Allows the seller to say "mera aloo ka stock 50 kg kar do" and the agent updates it.
 */
async function updateStock(productId: string, newQuantity: number, sellerPhone: string): Promise<any> {
  if (!productId || isNaN(newQuantity) || newQuantity < 0) {
    return { success: false, error: 'Invalid product ID or quantity' };
  }

  // First verify the product exists in the seller's catalog before touching marketplace
  let productExists = false;

  // Update in main catalog (only if product exists — no upsert for new products)
  try {
    await ddbClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `SELLER#${sellerPhone}`, SK: `ITEM#${productId}` },
      UpdateExpression: 'SET quantity = :qty, updatedAt = :now',
      ConditionExpression: 'attribute_exists(PK)',  // only update existing items
      ExpressionAttributeValues: {
        ':qty': newQuantity,
        ':now': Date.now(),
      },
    }));
    productExists = true;
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.warn(`Product ${productId} not found in catalog for seller ${sellerPhone} — not a stock update`);
    } else {
      console.warn('Main catalog stock update failed:', err.message);
    }
  }

  if (!productExists) {
    // Product doesn't exist — this is a NEW product request, not a stock update
    return {
      success: false,
      productId,
      error: 'PRODUCT_NOT_FOUND',
      summary: `Product "${productId}" not found in your catalog. To add a new product, please describe it with a name, price, quantity, and photo.`,
    };
  }

  // Also update in marketplace table (only if product already exists there — no upsert)
  try {
    await ddbClient.send(new UpdateCommand({
      TableName: MARKETPLACE_TABLE,
      Key: { productId },
      UpdateExpression: 'SET quantity = :qty, updatedAt = :now, #s = :status',
      ConditionExpression: 'attribute_exists(productId)',  // only update existing items, never create
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':qty': newQuantity,
        ':now': new Date().toISOString(),
        ':status': newQuantity > 0 ? 'ACTIVE' : 'OUT_OF_STOCK',
      },
    }));
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.warn('Product not in marketplace table yet — sync will happen via catalog.created event');
    } else {
      console.warn('Marketplace stock update failed:', err.message);
    }
  }

  return {
    success: true,
    productId,
    newQuantity,
    status: newQuantity > 0 ? 'ACTIVE' : 'OUT_OF_STOCK',
    summary: `Stock updated to ${newQuantity} units for product ${productId}`,
  };
}

/**
 * Tool 5: Get seller analytics — sales summary, top products, revenue.
 * Provides data-driven insights the AI agent uses to advise sellers.
 */
async function getSellerAnalytics(sellerPhone: string, period?: string): Promise<any> {
  // Query orders for this seller
  const ordersResult = await ddbClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI2',
    KeyConditionExpression: 'GSI2PK = :seller AND begins_with(GSI2SK, :prefix)',
    ExpressionAttributeValues: {
      ':seller': `SELLER#${sellerPhone}`,
      ':prefix': 'STATUS#CONFIRMED',
    },
  }));

  const orders = ordersResult.Items || [];
  
  // Calculate analytics
  const totalOrders = orders.length;
  let totalRevenue = 0;
  const productSales: Record<string, { quantity: number; revenue: number }> = {};

  for (const order of orders) {
    const amount = order.payment?.amount || 0;
    totalRevenue += amount;

    for (const item of (order.items || [])) {
      const name = item.name || 'Unknown';
      if (!productSales[name]) {
        productSales[name] = { quantity: 0, revenue: 0 };
      }
      productSales[name].quantity += item.quantity || 1;
      productSales[name].revenue += (item.price || 0) * (item.quantity || 1);
    }
  }

  // Sort by revenue for top products
  const topProducts = Object.entries(productSales)
    .sort(([, a], [, b]) => b.revenue - a.revenue)
    .slice(0, 5)
    .map(([name, data]) => ({
      name,
      totalQuantity: data.quantity,
      totalRevenue: data.revenue,
    }));

  // Query catalog for total product count
  const catalogResult = await ddbClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `SELLER#${sellerPhone}`,
      ':sk': 'ITEM#',
    },
    Select: 'COUNT',
  }));

  return {
    sellerPhone,
    period: period || 'all-time',
    totalProducts: catalogResult.Count || 0,
    totalOrders,
    totalRevenue,
    averageOrderValue: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
    topProducts,
    summary: totalOrders > 0
      ? `${totalOrders} orders, ₹${totalRevenue} revenue. Top product: ${topProducts[0]?.name || 'N/A'}`
      : 'No confirmed orders yet. Keep adding products and sharing your marketplace link!',
  };
}
