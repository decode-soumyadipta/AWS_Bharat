
import { QueryCommand, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../config/aws-clients';
import { getOrdersBySeller } from './dynamodb-repository';
import type { OrderStatus } from '../models/order';

const CONFIRMED_STATUSES: OrderStatus[] = ['CONFIRMED', 'ACCEPTED', 'PACKED', 'SHIPPED', 'DELIVERED'];
const PENDING_STATUSES: OrderStatus[] = ['PENDING'];
const REJECTED_STATUSES: OrderStatus[] = ['REJECTED'];
const CANCELLED_STATUSES: OrderStatus[] = ['CANCELLED'];

export interface ProductSalesStats {
  itemId: string;
  productName: string;
  totalOrders: number;
  totalQuantity: number;
  totalRevenue: number;
  averageOrderValue: number;
  lastOrderDate: number;
}

export interface DateRangeAnalytics {
  dateLabel: string;
  totalOrders: number;
  confirmedOrders: number;
  pendingOrders: number;
  rejectedOrders: number;
  cancelledOrders: number;
  totalRevenue: number;
  confirmedRevenue: number;
  pendingRevenue: number;
  totalItemsSold: number;
  products: Array<{ name: string; quantity: number; revenue: number }>;
}

export async function getTopSellingProducts(
  sellerId: string,
  limit: number = 5,
  timeRangeMs: number = 30 * 24 * 60 * 60 * 1000,
  sellerPhone?: string,
  confirmedOnly: boolean = true
): Promise<ProductSalesStats[]> {
  console.log(`📊 Getting top selling products for seller: ${sellerId} (phone: ${sellerPhone || 'N/A'})`);

  const allOrders = await getOrdersBySeller(sellerId, sellerPhone);

  const cutoffTime = Date.now() - timeRangeMs;
  let recentOrders = allOrders.filter((order) => order.createdAt >= cutoffTime);

  if (confirmedOnly) {
    recentOrders = recentOrders.filter((order) => CONFIRMED_STATUSES.includes(order.status));
  }

  console.log(`Found ${recentOrders.length} orders (confirmedOnly=${confirmedOnly}) in the last ${timeRangeMs / (24 * 60 * 60 * 1000)} days`);

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

  productStats.forEach((stats) => {
    stats.averageOrderValue = stats.totalRevenue / stats.totalOrders;
  });

  const sortedProducts = Array.from(productStats.values()).sort(
    (a, b) => b.totalRevenue - a.totalRevenue
  );

  console.log(`📈 Top ${limit} products:`, sortedProducts.slice(0, limit));

  return sortedProducts.slice(0, limit);
}

interface SalesSummary {
  totalOrders: number;
  confirmedOrders: number;
  pendingOrders: number;
  rejectedOrders: number;
  cancelledOrders: number;
  totalRevenue: number;
  confirmedRevenue: number;
  pendingRevenue: number;
  averageOrderValue: number;
  topProduct: string | null;
  topProducts: Array<{ name: string; quantity: number; revenue: number }>;
  timeRange: string;
}

export async function getSalesSummary(
  sellerId: string,
  timeRangeMs: number = 30 * 24 * 60 * 60 * 1000,
  sellerPhone?: string
): Promise<SalesSummary> {
  const allOrders = await getOrdersBySeller(sellerId, sellerPhone);
  const cutoffTime = Date.now() - timeRangeMs;
  const recentOrders = allOrders.filter((order) => order.createdAt >= cutoffTime);

  const confirmed = recentOrders.filter(o => CONFIRMED_STATUSES.includes(o.status));
  const pending = recentOrders.filter(o => PENDING_STATUSES.includes(o.status));
  const rejected = recentOrders.filter(o => REJECTED_STATUSES.includes(o.status));
  const cancelled = recentOrders.filter(o => CANCELLED_STATUSES.includes(o.status));

  const calcRevenue = (orders: typeof recentOrders) =>
    orders.reduce((sum, order) =>
      sum + order.items.reduce((s, item) => s + item.price * item.quantity, 0), 0);

  const confirmedRevenue = calcRevenue(confirmed);
  const pendingRevenue = calcRevenue(pending);
  const totalRevenue = calcRevenue(recentOrders);
  const averageOrderValue = confirmed.length > 0 ? confirmedRevenue / confirmed.length : 0;

  const topProductsList = await getTopSellingProducts(sellerId, 50, timeRangeMs, sellerPhone, true);
  const topProduct = topProductsList.length > 0 ? topProductsList[0].productName : null;
  const topProducts = topProductsList.map(p => ({
    name: p.productName,
    quantity: p.totalQuantity,
    revenue: p.totalRevenue,
  }));

  const timeRangeDays = Math.floor(timeRangeMs / (24 * 60 * 60 * 1000));

  return {
    totalOrders: recentOrders.length,
    confirmedOrders: confirmed.length,
    pendingOrders: pending.length,
    rejectedOrders: rejected.length,
    cancelledOrders: cancelled.length,
    totalRevenue,
    confirmedRevenue,
    pendingRevenue,
    averageOrderValue,
    topProduct,
    topProducts,
    timeRange: `${timeRangeDays} days`,
  };
}

export function formatTopSellingProducts(
  products: ProductSalesStats[],
  language: 'hi' | 'en' | 'mr' = 'hi'
): string {
  if (products.length === 0) {
    if (language === 'hi') {
      return 'अभी तक कोई ऑर्डर नहीं आया है।';
    } else if (language === 'mr') {
      return 'अजून कोणताही ऑर्डर आलेला नाही.';
    } else {
      return 'No orders yet.';
    }
  }

  let message = '';

  if (language === 'hi') {
    message = 'आपके सबसे अच्छे बिकने वाले उत्पाद: ';
    products.forEach((product, index) => {
      message += `${product.productName} (${product.totalOrders} ऑर्डर, ${product.totalQuantity} यूनिट बिके, ${product.totalRevenue.toFixed(0)} रुपये कमाई, औसत ऑर्डर ${product.averageOrderValue.toFixed(0)} रुपये)`;
      if (index < products.length - 1) message += '; ';
    });
  } else if (language === 'mr') {
    message = 'तुमची सर्वात चांगली विकली जाणारी उत्पादने: ';
    products.forEach((product, index) => {
      message += `${product.productName} (${product.totalOrders} ऑर्डर, ${product.totalQuantity} युनिट विकले, ${product.totalRevenue.toFixed(0)} रुपये कमाई, सरासरी ऑर्डर ${product.averageOrderValue.toFixed(0)} रुपये)`;
      if (index < products.length - 1) message += '; ';
    });
  } else {
    message = 'Your top selling products: ';
    products.forEach((product, index) => {
      message += `${product.productName} (${product.totalOrders} orders, ${product.totalQuantity} units sold, Rs ${product.totalRevenue.toFixed(0)} revenue, avg order Rs ${product.averageOrderValue.toFixed(0)})`;
      if (index < products.length - 1) message += '; ';
    });
  }

  return message.trim();
}

export async function getDateRangeAnalytics(
  sellerId: string,
  dateQuery: string,
  sellerPhone?: string
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

      const parsed = new Date(dateQuery);
      if (!isNaN(parsed.getTime())) {
        parsed.setHours(0, 0, 0, 0);
        const dayEnd = new Date(parsed);
        dayEnd.setHours(23, 59, 59, 999);
        startTime = parsed.getTime();
        endTime = dayEnd.getTime();
        dateLabel = dateQuery;
      } else {

        const weekAgo = new Date(now);
        weekAgo.setDate(now.getDate() - 7);
        weekAgo.setHours(0, 0, 0, 0);
        startTime = weekAgo.getTime();
        endTime = now.getTime();
        dateLabel = 'पिछले 7 दिन';
      }
    }
  }

  const allOrders = await getOrdersBySeller(sellerId, sellerPhone);
  const filteredOrders = allOrders.filter(
    (order) => order.createdAt >= startTime && order.createdAt <= endTime
  );

  const confirmed = filteredOrders.filter(o => CONFIRMED_STATUSES.includes(o.status));
  const pending = filteredOrders.filter(o => PENDING_STATUSES.includes(o.status));
  const rejected = filteredOrders.filter(o => REJECTED_STATUSES.includes(o.status));
  const cancelled = filteredOrders.filter(o => CANCELLED_STATUSES.includes(o.status));

  const productMap = new Map<string, { name: string; quantity: number; revenue: number }>();
  let totalItemsSold = 0;

  confirmed.forEach((order) => {
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

  const calcRevenue = (orders: typeof filteredOrders) =>
    orders.reduce((sum, order) =>
      sum + order.items.reduce((s, item) => s + item.price * item.quantity, 0), 0);

  const confirmedRevenue = calcRevenue(confirmed);
  const pendingRevenue = calcRevenue(pending);
  const totalRevenue = calcRevenue(filteredOrders);

  return {
    dateLabel,
    totalOrders: filteredOrders.length,
    confirmedOrders: confirmed.length,
    pendingOrders: pending.length,
    rejectedOrders: rejected.length,
    cancelledOrders: cancelled.length,
    totalRevenue,
    confirmedRevenue,
    pendingRevenue,
    totalItemsSold,
    products: Array.from(productMap.values()).sort((a, b) => b.revenue - a.revenue),
  };
}

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
    let msg = `${analytics.dateLabel} की बिक्री: कुल ${analytics.totalOrders} ऑर्डर।`;
    msg += ` कन्फर्म: ${analytics.confirmedOrders} ऑर्डर, ₹${analytics.confirmedRevenue.toFixed(0)} कमाई।`;
    if (analytics.pendingOrders > 0) msg += ` पेंडिंग: ${analytics.pendingOrders} ऑर्डर (₹${analytics.pendingRevenue.toFixed(0)})।`;
    if (analytics.rejectedOrders > 0) msg += ` रिजेक्ट: ${analytics.rejectedOrders}।`;
    if (analytics.cancelledOrders > 0) msg += ` कैंसल: ${analytics.cancelledOrders}।`;
    msg += ` ${analytics.totalItemsSold} आइटम बिके।`;
    if (analytics.products.length > 0) {
      const top = analytics.products.slice(0, 3);
      msg += ' सबसे ज़्यादा बिके: ' + top.map(p => `${p.name} ${p.quantity} यूनिट ₹${p.revenue.toFixed(0)}`).join(', ') + '।';
    }
    return msg;
  }

  if (language === 'mr') {
    let msg = `${analytics.dateLabel} ची विक्री: एकूण ${analytics.totalOrders} ऑर्डर.`;
    msg += ` कन्फर्म: ${analytics.confirmedOrders} ऑर्डर, ₹${analytics.confirmedRevenue.toFixed(0)} कमाई.`;
    if (analytics.pendingOrders > 0) msg += ` पेंडिंग: ${analytics.pendingOrders} ऑर्डर (₹${analytics.pendingRevenue.toFixed(0)}).`;
    if (analytics.rejectedOrders > 0) msg += ` नाकारले: ${analytics.rejectedOrders}.`;
    if (analytics.cancelledOrders > 0) msg += ` रद्द: ${analytics.cancelledOrders}.`;
    msg += ` ${analytics.totalItemsSold} वस्तू विकल्या.`;
    if (analytics.products.length > 0) {
      const top = analytics.products.slice(0, 3);
      msg += ' सर्वात जास्त विकले: ' + top.map(p => `${p.name} ${p.quantity} युनिट ₹${p.revenue.toFixed(0)}`).join(', ') + '.';
    }
    return msg;
  }

  let msg = `Sales for ${analytics.dateLabel}: ${analytics.totalOrders} total orders.`;
  msg += ` Confirmed: ${analytics.confirmedOrders} orders, Rs ${analytics.confirmedRevenue.toFixed(0)} revenue.`;
  if (analytics.pendingOrders > 0) msg += ` Pending: ${analytics.pendingOrders} orders (Rs ${analytics.pendingRevenue.toFixed(0)}).`;
  if (analytics.rejectedOrders > 0) msg += ` Rejected: ${analytics.rejectedOrders}.`;
  if (analytics.cancelledOrders > 0) msg += ` Cancelled: ${analytics.cancelledOrders}.`;
  msg += ` ${analytics.totalItemsSold} items sold.`;
  if (analytics.products.length > 0) {
    const top = analytics.products.slice(0, 3);
    msg += ' Top: ' + top.map(p => `${p.name} ${p.quantity} units Rs ${p.revenue.toFixed(0)}`).join(', ') + '.';
  }
  return msg;
}
