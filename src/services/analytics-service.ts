/**
 * Analytics Service
 * 
 * Provides analytics and insights for sellers:
 * - Top selling products
 * - Order statistics
 * - Revenue insights
 * - Product performance
 * - Date-specific analytics (yesterday, specific date, last week)
 */

import { QueryCommand, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../config/aws-clients';
import { getOrdersBySeller } from './dynamodb-repository';

/**
 * Product sales statistics
 */
export interface ProductSalesStats {
  itemId: string;
  productName: string;
  totalOrders: number;
  totalQuantity: number;
  totalRevenue: number;
  averageOrderValue: number;
  lastOrderDate: number;
}

/**
 * Date-range analytics result
 */
export interface DateRangeAnalytics {
  dateLabel: string;
  totalOrders: number;
  totalRevenue: number;
  totalItemsSold: number;
  products: Array<{ name: string; quantity: number; revenue: number }>;
}

/**
 * Get top selling products for a seller
 * 
 * @param sellerId - Seller ID
 * @param limit - Number of top products to return (default: 5)
 * @param timeRangeMs - Time range in milliseconds (default: 30 days)
 * @returns Array of top selling products
 */
export async function getTopSellingProducts(
  sellerId: string,
  limit: number = 5,
  timeRangeMs: number = 30 * 24 * 60 * 60 * 1000 // 30 days
): Promise<ProductSalesStats[]> {
  console.log(`📊 Getting top selling products for seller: ${sellerId}`);

  // Get all orders for the seller
  const allOrders = await getOrdersBySeller(sellerId);

  // Filter orders within time range
  const cutoffTime = Date.now() - timeRangeMs;
  const recentOrders = allOrders.filter((order) => order.createdAt >= cutoffTime);

  console.log(`Found ${recentOrders.length} orders in the last ${timeRangeMs / (24 * 60 * 60 * 1000)} days`);

  // Aggregate sales by product
  const productStats = new Map<string, ProductSalesStats>();

  recentOrders.forEach((order) => {
    order.items.forEach((item) => {
      const existing = productStats.get(item.itemId);

      if (existing) {
        existing.totalOrders += 1;
        existing.totalQuantity += item.quantity;
        existing.totalRevenue += item.price * item.quantity;
        existing.lastOrderDate = Math.max(existing.lastOrderDate, order.createdAt);
      } else {
        productStats.set(item.itemId, {
          itemId: item.itemId,
          productName: (item as any).productName || (item as any).name || item.itemId,
          totalOrders: 1,
          totalQuantity: item.quantity,
          totalRevenue: item.price * item.quantity,
          averageOrderValue: item.price * item.quantity,
          lastOrderDate: order.createdAt,
        });
      }
    });
  });

  // Calculate average order value
  productStats.forEach((stats) => {
    stats.averageOrderValue = stats.totalRevenue / stats.totalOrders;
  });

  // Sort by total revenue (best selling)
  const sortedProducts = Array.from(productStats.values()).sort(
    (a, b) => b.totalRevenue - a.totalRevenue
  );

  console.log(`📈 Top ${limit} products:`, sortedProducts.slice(0, limit));

  return sortedProducts.slice(0, limit);
}

/**
 * Get sales summary for a seller
 * 
 * @param sellerId - Seller ID
 * @param timeRangeMs - Time range in milliseconds (default: 30 days)
 * @returns Sales summary
 */
export async function getSalesSummary(
  sellerId: string,
  timeRangeMs: number = 30 * 24 * 60 * 60 * 1000 // 30 days
): Promise<{
  totalOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
  topProduct: string | null;
  timeRange: string;
}> {
  const allOrders = await getOrdersBySeller(sellerId);
  const cutoffTime = Date.now() - timeRangeMs;
  const recentOrders = allOrders.filter((order) => order.createdAt >= cutoffTime);

  const totalOrders = recentOrders.length;
  const totalRevenue = recentOrders.reduce((sum, order) => {
    return sum + order.items.reduce((itemSum, item) => itemSum + item.price * item.quantity, 0);
  }, 0);
  const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // Get top product
  const topProducts = await getTopSellingProducts(sellerId, 1, timeRangeMs);
  const topProduct = topProducts.length > 0 ? topProducts[0].productName : null;

  const timeRangeDays = Math.floor(timeRangeMs / (24 * 60 * 60 * 1000));

  return {
    totalOrders,
    totalRevenue,
    averageOrderValue,
    topProduct,
    timeRange: `${timeRangeDays} days`,
  };
}

/**
 * Format top selling products for display
 * 
 * @param products - Array of product sales stats
 * @param language - Language code
 * @returns Formatted message
 */
export function formatTopSellingProducts(
  products: ProductSalesStats[],
  language: 'hi' | 'en' | 'mr' = 'hi'
): string {
  if (products.length === 0) {
    if (language === 'hi') {
      return '😔 अभी तक कोई ऑर्डर नहीं आया है।';
    } else if (language === 'mr') {
      return '😔 अजून कोणताही ऑर्डर आलेला नाही.';
    } else {
      return '😔 No orders yet.';
    }
  }

  let message = '';

  if (language === 'hi') {
    message = '🏆 आपके सबसे अच्छे बिकने वाले उत्पाद:\n\n';
    products.forEach((product, index) => {
      message += `${index + 1}. ${product.productName}\n`;
      message += `   📦 ${product.totalOrders} ऑर्डर | ₹${product.totalRevenue.toFixed(2)} कमाई\n`;
      message += `   📊 ${product.totalQuantity} यूनिट बिके\n\n`;
    });
  } else if (language === 'mr') {
    message = '🏆 तुमची सर्वात चांगली विकली जाणारी उत्पादने:\n\n';
    products.forEach((product, index) => {
      message += `${index + 1}. ${product.productName}\n`;
      message += `   📦 ${product.totalOrders} ऑर्डर | ₹${product.totalRevenue.toFixed(2)} कमाई\n`;
      message += `   📊 ${product.totalQuantity} युनिट विकले\n\n`;
    });
  } else {
    message = '🏆 Your top selling products:\n\n';
    products.forEach((product, index) => {
      message += `${index + 1}. ${product.productName}\n`;
      message += `   📦 ${product.totalOrders} orders | ₹${product.totalRevenue.toFixed(2)} revenue\n`;
      message += `   📊 ${product.totalQuantity} units sold\n\n`;
    });
  }

  return message.trim();
}

/**
 * Get analytics for a specific date range
 * Supports: 'yesterday', 'today', 'last_week', 'last_month', or specific date string 'YYYY-MM-DD'
 */
export async function getDateRangeAnalytics(
  sellerId: string,
  dateQuery: string
): Promise<DateRangeAnalytics> {
  const now = new Date();
  let startTime: number;
  let endTime: number;
  let dateLabel: string;

  switch (dateQuery) {
    case 'yesterday': {
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      const yesterdayEnd = new Date(now);
      yesterdayEnd.setDate(now.getDate() - 1);
      yesterdayEnd.setHours(23, 59, 59, 999);
      startTime = yesterday.getTime();
      endTime = yesterdayEnd.getTime();
      dateLabel = 'कल';
      break;
    }
    case 'today': {
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      startTime = todayStart.getTime();
      endTime = now.getTime();
      dateLabel = 'आज';
      break;
    }
    case 'last_week': {
      const weekAgo = new Date(now);
      weekAgo.setDate(now.getDate() - 7);
      weekAgo.setHours(0, 0, 0, 0);
      startTime = weekAgo.getTime();
      endTime = now.getTime();
      dateLabel = 'पिछले 7 दिन';
      break;
    }
    case 'last_month': {
      const monthAgo = new Date(now);
      monthAgo.setDate(now.getDate() - 30);
      monthAgo.setHours(0, 0, 0, 0);
      startTime = monthAgo.getTime();
      endTime = now.getTime();
      dateLabel = 'पिछले 30 दिन';
      break;
    }
    default: {
      // Try to parse as YYYY-MM-DD
      const parsed = new Date(dateQuery);
      if (!isNaN(parsed.getTime())) {
        parsed.setHours(0, 0, 0, 0);
        const dayEnd = new Date(parsed);
        dayEnd.setHours(23, 59, 59, 999);
        startTime = parsed.getTime();
        endTime = dayEnd.getTime();
        dateLabel = dateQuery;
      } else {
        // Default to last 7 days
        const weekAgo = new Date(now);
        weekAgo.setDate(now.getDate() - 7);
        weekAgo.setHours(0, 0, 0, 0);
        startTime = weekAgo.getTime();
        endTime = now.getTime();
        dateLabel = 'पिछले 7 दिन';
      }
    }
  }

  const allOrders = await getOrdersBySeller(sellerId);
  const filteredOrders = allOrders.filter(
    (order) => order.createdAt >= startTime && order.createdAt <= endTime
  );

  // Aggregate by product
  const productMap = new Map<string, { name: string; quantity: number; revenue: number }>();
  let totalItemsSold = 0;

  filteredOrders.forEach((order) => {
    order.items.forEach((item) => {
      totalItemsSold += item.quantity;
      const name = (item as any).productName || (item as any).name || item.itemId;
      const existing = productMap.get(item.itemId);
      if (existing) {
        existing.quantity += item.quantity;
        existing.revenue += item.price * item.quantity;
      } else {
        productMap.set(item.itemId, {
          name,
          quantity: item.quantity,
          revenue: item.price * item.quantity,
        });
      }
    });
  });

  const totalRevenue = filteredOrders.reduce((sum, order) => {
    return sum + order.items.reduce((itemSum, item) => itemSum + item.price * item.quantity, 0);
  }, 0);

  return {
    dateLabel,
    totalOrders: filteredOrders.length,
    totalRevenue,
    totalItemsSold,
    products: Array.from(productMap.values()).sort((a, b) => b.revenue - a.revenue),
  };
}

/**
 * Format date range analytics concisely for voice
 */
export function formatDateRangeAnalytics(
  analytics: DateRangeAnalytics,
  language: 'hi' | 'en' | 'mr' = 'hi'
): string {
  if (analytics.totalOrders === 0) {
    if (language === 'hi') return `${analytics.dateLabel} में कोई ऑर्डर नहीं आया।`;
    if (language === 'mr') return `${analytics.dateLabel} मध्ये कोणताही ऑर्डर आला नाही.`;
    return `No orders for ${analytics.dateLabel}.`;
  }

  if (language === 'hi') {
    let msg = `${analytics.dateLabel} की बिक्री: ${analytics.totalOrders} ऑर्डर, कुल ₹${analytics.totalRevenue.toFixed(0)} कमाई, ${analytics.totalItemsSold} आइटम बिके।`;
    if (analytics.products.length > 0) {
      const top = analytics.products.slice(0, 3);
      msg += ' सबसे ज़्यादा बिके: ' + top.map(p => `${p.name} ${p.quantity} यूनिट ₹${p.revenue.toFixed(0)}`).join(', ') + '।';
    }
    return msg;
  }

  if (language === 'mr') {
    let msg = `${analytics.dateLabel} ची विक्री: ${analytics.totalOrders} ऑर्डर, एकूण ₹${analytics.totalRevenue.toFixed(0)} कमाई, ${analytics.totalItemsSold} वस्तू विकल्या.`;
    if (analytics.products.length > 0) {
      const top = analytics.products.slice(0, 3);
      msg += ' सर्वात जास्त विकले: ' + top.map(p => `${p.name} ${p.quantity} युनिट ₹${p.revenue.toFixed(0)}`).join(', ') + '.';
    }
    return msg;
  }

  let msg = `Sales for ${analytics.dateLabel}: ${analytics.totalOrders} orders, ₹${analytics.totalRevenue.toFixed(0)} revenue, ${analytics.totalItemsSold} items sold.`;
  if (analytics.products.length > 0) {
    const top = analytics.products.slice(0, 3);
    msg += ' Top: ' + top.map(p => `${p.name} ${p.quantity} units ₹${p.revenue.toFixed(0)}`).join(', ') + '.';
  }
  return msg;
}
