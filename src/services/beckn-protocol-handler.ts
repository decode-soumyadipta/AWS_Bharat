/**
 * Beckn Protocol Handler — BPP Implementation
 * 
 * Handles all 10 Beckn transaction APIs for the BPP (Buyer Platform Provider) side.
 * Each handler processes the incoming BAP request and returns the appropriate
 * on_* callback response that gets sent to the BAP's callback URI.
 * 
 * Architecture:
 *   BAP → /search  → handleSearch()  → on_search  → BAP callback
 *   BAP → /select  → handleSelect()  → on_select  → BAP callback
 *   BAP → /init    → handleInit()    → on_init    → BAP callback
 *   BAP → /confirm → handleConfirm() → on_confirm → BAP callback
 *   BAP → /status  → handleStatus()  → on_status  → BAP callback
 *   BAP → /cancel  → handleCancel()  → on_cancel  → BAP callback
 *   BAP → /update  → handleUpdate()  → on_update  → BAP callback
 *   BAP → /track   → handleTrack()   → on_track   → BAP callback
 *   BAP → /rating  → handleRating()  → on_rating  → BAP callback
 *   BAP → /support → handleSupport() → on_support → BAP callback
 */

import { randomUUID } from 'crypto';
import {
  BecknContext,
  BecknRequest,
  BecknResponse,
  BecknError,
  SearchMessage,
  OnSearchMessage,
  SelectMessage,
  OnSelectMessage,
  InitMessage,
  OnInitMessage,
  ConfirmMessage,
  OnConfirmMessage,
  StatusMessage,
  OnStatusMessage,
  CancelMessage,
  OnCancelMessage,
  UpdateMessage,
  OnUpdateMessage,
  TrackMessage,
  OnTrackMessage,
  RatingMessage,
  OnRatingMessage,
  SupportMessage,
  OnSupportMessage,
  BecknCatalogItemFull,
  BecknFulfillment,
  BecknQuotation,
  BecknPayment,
  BecknTagGroup,
  ONDC_ORDER_STATES,
} from '../models/beckn-protocol';
import {
  getCatalogItemsBySeller,
  getCatalogItemsByCategory,
  getCatalogItem,
  getSellerById,
  getSellerByPhone,
  getOrderById,
  createOrder,
  updateOrderStatus,
  getOrdersBySeller,
} from './dynamodb-repository';
import { CatalogItem } from '../models/catalog';
import { SellerProfile } from '../models/seller';
import { Order, OrderItem, VALID_ORDER_TRANSITIONS } from '../models/order';
import { createAuthorizationHeader } from './beckn-auth';

const BPP_ID = process.env.NETWORK_PARTICIPANT_ID || 'vyapar-vaani.ondc.in';
const BPP_URI = process.env.BPP_BASE_URL || 'https://api.vyapar-vaani.ondc.in';

// ============================================================================
// SEARCH → ON_SEARCH
// ============================================================================

/**
 * Handle /search — return matching catalog items
 * Searches across all active sellers' catalogs
 */
export async function handleSearch(
  request: BecknRequest<SearchMessage>
): Promise<BecknResponse<OnSearchMessage>> {
  const { context, message } = request;
  const intent = message.intent;

  console.log('BPP handling /search:', JSON.stringify(intent, null, 2));

  try {
    // Determine search criteria
    const searchName = intent?.item?.descriptor?.name?.toLowerCase();
    const searchCategory = intent?.category?.id || intent?.item?.category?.id;

    // Get all catalog items — filter by category if specified, else scan
    let allItems: CatalogItem[] = [];
    if (searchCategory) {
      allItems = await getCatalogItemsByCategory(searchCategory);
    } else {
      // For broader search, we'd need a scan — limit to known categories
      const categories = ['Grocery', 'Fruits', 'Vegetables', 'Dairy', 'Spices', 'Grains', 'Snacks', 'Beverages'];
      const fetches = categories.map(cat => getCatalogItemsByCategory(cat));
      const results = await Promise.all(fetches);
      allItems = results.flat();
    }

    // Filter active items only
    allItems = allItems.filter(item => item.status === 'ACTIVE');

    // Text search filter
    if (searchName) {
      allItems = allItems.filter(item =>
        item.becknItem.descriptor.name.toLowerCase().includes(searchName) ||
        item.becknItem.descriptor.short_desc.toLowerCase().includes(searchName)
      );
    }

    // Group items by seller
    const sellerItemsMap: Record<string, CatalogItem[]> = {};
    for (const item of allItems) {
      if (!sellerItemsMap[item.sellerId]) {
        sellerItemsMap[item.sellerId] = [];
      }
      sellerItemsMap[item.sellerId].push(item);
    }

    // Build provider catalog for each seller
    const providers = [];
    for (const [sellerId, items] of Object.entries(sellerItemsMap)) {
      const seller = await getSellerById(sellerId);
      if (!seller || seller.onboardingState !== 'ACTIVE') continue;

      const catalogItems: BecknCatalogItemFull[] = items.map(item => mapCatalogItemToBeckn(item));

      providers.push({
        id: sellerId,
        descriptor: {
          name: seller.name,
          short_desc: `${seller.name} — ONDC Seller`,
          long_desc: `Products from ${seller.name} via Vyapar Vaani`,
          images: [],
        },
        locations: [{
          id: `loc-${sellerId}`,
          gps: '19.0760,72.8777', // Default Mumbai — in production, pulled from seller profile
          address: {
            locality: 'Mumbai',
            city: 'Mumbai',
            state: 'Maharashtra',
            country: 'IND',
            area_code: '400001',
          },
        }],
        items: catalogItems,
        fulfillments: [
          { id: `fulf-${sellerId}-delivery`, type: 'Delivery' as const, contact: { phone: seller.phone, email: '' } },
          { id: `fulf-${sellerId}-pickup`, type: 'Self-Pickup' as const, contact: { phone: seller.phone, email: '' } },
        ],
        tags: [{
          code: 'serviceability',
          list: [
            { code: 'location', value: `loc-${sellerId}` },
            { code: 'category', value: items[0]?.becknItem.category_id || 'Grocery' },
            { code: 'type', value: '10' },
            { code: 'val', value: '3' },
            { code: 'unit', value: 'km' },
          ],
        }],
        time: { label: 'enable', timestamp: new Date().toISOString() },
      });
    }

    const responseContext = buildResponseContext(context, 'on_search');

    return {
      context: responseContext,
      message: {
        catalog: {
          'bpp/descriptor': {
            name: 'Vyapar Vaani',
            short_desc: 'Voice-first WhatsApp commerce for rural India',
            long_desc: 'ONDC-compliant seller platform powered by AI for rural merchants',
            images: [{ url: 'https://vyaparvaani.in/logo.png' }],
          },
          'bpp/fulfillments': [
            { id: 'delivery', type: 'Delivery' },
            { id: 'self-pickup', type: 'Self-Pickup' },
          ],
          'bpp/providers': providers,
        },
      },
    };
  } catch (error) {
    console.error('Search handler error:', error);
    return buildErrorResponse(context, 'on_search', '30001', 'Internal error during search');
  }
}

// ============================================================================
// SELECT → ON_SELECT (Quote Generation)
// ============================================================================

/**
 * Handle /select — generate quote for selected items
 */
export async function handleSelect(
  request: BecknRequest<SelectMessage>
): Promise<BecknResponse<OnSelectMessage>> {
  const { context, message } = request;
  const { provider, items } = message.order;

  console.log('BPP handling /select for provider:', provider.id);

  try {
    // Look up each item and build quote
    const quotedItems = [];
    const breakup = [];
    let totalValue = 0;

    for (const reqItem of items) {
      const catalogItem = await getCatalogItem(provider.id, reqItem.id);
      if (!catalogItem || catalogItem.status !== 'ACTIVE') {
        return buildErrorResponse(context, 'on_select', '40002', `Item not found or unavailable: ${reqItem.id}`);
      }

      if (reqItem.quantity.count > catalogItem.becknItem.quantity.available.count) {
        return buildErrorResponse(context, 'on_select', '40002', `Insufficient stock for item: ${reqItem.id}`);
      }

      const itemPrice = parseFloat(catalogItem.becknItem.price.value);
      const lineTotal = itemPrice * reqItem.quantity.count;
      totalValue += lineTotal;

      quotedItems.push({
        id: reqItem.id,
        fulfillment_id: catalogItem.becknItem.fulfillment_id,
        quantity: { count: reqItem.quantity.count },
      });

      breakup.push({
        '@ondc/org/item_id': reqItem.id,
        '@ondc/org/item_quantity': { count: reqItem.quantity.count },
        title: catalogItem.becknItem.descriptor.name,
        '@ondc/org/title_type': 'item' as const,
        price: { currency: 'INR', value: lineTotal.toFixed(2) },
        item: { price: { currency: 'INR', value: itemPrice.toFixed(2) } },
      });
    }

    // Add delivery charge
    const deliveryCharge = totalValue >= 500 ? 0 : 30;
    if (deliveryCharge > 0) {
      breakup.push({
        '@ondc/org/item_id': '',
        title: 'Delivery charges',
        '@ondc/org/title_type': 'delivery' as const,
        price: { currency: 'INR', value: deliveryCharge.toFixed(2) },
      });
      totalValue += deliveryCharge;
    }

    // Add packing charge
    const packingCharge = 5;
    breakup.push({
      '@ondc/org/item_id': '',
      title: 'Packing charges',
      '@ondc/org/title_type': 'packing' as const,
      price: { currency: 'INR', value: packingCharge.toFixed(2) },
    });
    totalValue += packingCharge;

    const quote: BecknQuotation = {
      price: { currency: 'INR', value: totalValue.toFixed(2) },
      breakup,
      ttl: 'P1D',
    };

    const seller = await getSellerById(provider.id);
    const fulfillments: BecknFulfillment[] = [{
      id: `fulf-${provider.id}-delivery`,
      type: 'Delivery',
      '@ondc/org/category': 'Standard Delivery',
      '@ondc/org/TAT': 'P2D',
      state: { descriptor: { code: 'Serviceable' } },
      tracking: false,
    }];

    return {
      context: buildResponseContext(context, 'on_select'),
      message: {
        order: {
          provider: { id: provider.id },
          items: quotedItems,
          fulfillments,
          quote,
        },
      },
    };
  } catch (error) {
    console.error('Select handler error:', error);
    return buildErrorResponse(context, 'on_select', '30001', 'Internal error during select');
  }
}

// ============================================================================
// INIT → ON_INIT (Payment terms initialization)
// ============================================================================

/**
 * Handle /init — initialize order with billing + fulfillment + payment terms
 */
export async function handleInit(
  request: BecknRequest<InitMessage>
): Promise<BecknResponse<OnInitMessage>> {
  const { context, message } = request;
  const { provider, items, billing, fulfillments } = message.order;

  console.log('BPP handling /init for provider:', provider.id);

  try {
    const seller = await getSellerById(provider.id);
    if (!seller) {
      return buildErrorResponse(context, 'on_init', '30004', `Provider not found: ${provider.id}`);
    }

    // Re-compute the quote (items may have changed)
    const breakup = [];
    let totalValue = 0;
    const quotedItems = [];

    for (const reqItem of items) {
      const catalogItem = await getCatalogItem(provider.id, reqItem.id);
      if (!catalogItem || catalogItem.status !== 'ACTIVE') {
        return buildErrorResponse(context, 'on_init', '40002', `Item unavailable: ${reqItem.id}`);
      }

      const itemPrice = parseFloat(catalogItem.becknItem.price.value);
      const lineTotal = itemPrice * reqItem.quantity.count;
      totalValue += lineTotal;

      quotedItems.push({
        id: reqItem.id,
        fulfillment_id: catalogItem.becknItem.fulfillment_id,
        quantity: { count: reqItem.quantity.count },
      });

      breakup.push({
        '@ondc/org/item_id': reqItem.id,
        '@ondc/org/item_quantity': { count: reqItem.quantity.count },
        title: catalogItem.becknItem.descriptor.name,
        '@ondc/org/title_type': 'item' as const,
        price: { currency: 'INR', value: lineTotal.toFixed(2) },
        item: { price: { currency: 'INR', value: itemPrice.toFixed(2) } },
      });
    }

    const deliveryCharge = totalValue >= 500 ? 0 : 30;
    if (deliveryCharge > 0) {
      breakup.push({
        '@ondc/org/item_id': '',
        title: 'Delivery charges',
        '@ondc/org/title_type': 'delivery' as const,
        price: { currency: 'INR', value: deliveryCharge.toFixed(2) },
      });
      totalValue += deliveryCharge;
    }

    const packingCharge = 5;
    breakup.push({
      '@ondc/org/item_id': '',
      title: 'Packing charges',
      '@ondc/org/title_type': 'packing' as const,
      price: { currency: 'INR', value: packingCharge.toFixed(2) },
    });
    totalValue += packingCharge;

    // Determine payment method — COD or pre-paid
    const payment: BecknPayment = {
      type: 'ON-ORDER',
      status: 'NOT-PAID',
      collected_by: 'BAP',
      '@ondc/org/buyer_app_finder_fee_type': 'percent',
      '@ondc/org/buyer_app_finder_fee_amount': '3',
      '@ondc/org/settlement_basis': 'delivery',
      '@ondc/org/settlement_window': 'P2D',
      '@ondc/org/withholding_amount': '0.00',
      '@ondc/org/settlement_details': [{
        settlement_counterparty: 'seller-app',
        settlement_phase: 'sale-amount',
        settlement_type: 'upi',
        upi_address: seller.upiId || `${seller.name.toLowerCase().replace(/\s/g, '')}@upi`,
        beneficiary_name: seller.name,
      }],
    };

    const cancellationTerms = [
      {
        fulfillment_state: { descriptor: { code: 'Pending' } },
        cancellation_fee: { percentage: '0' },
        reason_required: false,
      },
      {
        fulfillment_state: { descriptor: { code: 'Packed' } },
        cancellation_fee: { percentage: '10' },
        reason_required: true,
      },
      {
        fulfillment_state: { descriptor: { code: 'Order-delivered' } },
        cancellation_fee: { percentage: '100' },
        reason_required: true,
      },
    ];

    return {
      context: buildResponseContext(context, 'on_init'),
      message: {
        order: {
          provider: { id: provider.id },
          items: quotedItems,
          billing,
          fulfillments: fulfillments.map(f => ({
            ...f,
            '@ondc/org/TAT': 'P2D',
            tracking: false,
            state: { descriptor: { code: 'Serviceable', name: 'Serviceable' } },
            tags: [],
          })) as BecknFulfillment[],
          quote: {
            price: { currency: 'INR', value: totalValue.toFixed(2) },
            breakup,
            ttl: 'P1D',
          },
          payment,
          cancellation_terms: cancellationTerms,
          tags: [{
            code: 'bpp_terms',
            list: [
              { code: 'max_liability', value: 'INR 1000' },
              { code: 'max_liability_cap', value: '10000.00' },
              { code: 'mandatory_arbitration', value: 'false' },
              { code: 'court_jurisdiction', value: 'Mumbai' },
              { code: 'delay_interest', value: '0' },
            ],
          }],
        },
      },
    };
  } catch (error) {
    console.error('Init handler error:', error);
    return buildErrorResponse(context, 'on_init', '30001', 'Internal error during init');
  }
}

// ============================================================================
// CONFIRM → ON_CONFIRM (Order creation + WhatsApp notification)
// ============================================================================

/**
 * Handle /confirm — create order and notify seller via WhatsApp
 */
export async function handleConfirm(
  request: BecknRequest<ConfirmMessage>
): Promise<BecknResponse<OnConfirmMessage>> {
  const { context, message } = request;
  const incomingOrder = message.order;

  console.log('BPP handling /confirm for provider:', incomingOrder.provider.id);

  try {
    const seller = await getSellerById(incomingOrder.provider.id);
    if (!seller) {
      return buildErrorResponse(context, 'on_confirm', '30004', 'Provider not found');
    }

    // Create order in our system
    const orderId = randomUUID();
    const now = Date.now();

    const orderItems: OrderItem[] = incomingOrder.items.map(item => ({
      itemId: item.id,
      quantity: item.quantity.count,
      price: item.price ? parseFloat(item.price.value) : 0,
    }));

    // Get item prices if not in the confirm message
    for (const orderItem of orderItems) {
      if (orderItem.price === 0) {
        const catalogItem = await getCatalogItem(incomingOrder.provider.id, orderItem.itemId);
        if (catalogItem) {
          orderItem.price = parseFloat(catalogItem.becknItem.price.value);
        }
      }
    }

    const order: Order = {
      PK: `ORDER#${orderId}`,
      SK: 'METADATA',
      GSI2PK: `SELLER#${seller.sellerId}`,
      GSI2SK: `STATUS#PENDING#${now}`,
      entityType: 'ORDER',
      orderId,
      sellerId: seller.sellerId,
      buyerAppId: context.bap_id,
      transactionId: context.transaction_id,
      items: orderItems,
      fulfillment: {
        type: (incomingOrder.fulfillments?.[0]?.type as 'Delivery' | 'Pickup') || 'Delivery',
        address: incomingOrder.fulfillments?.[0]?.end?.location?.address ? {
          name: incomingOrder.billing?.name || '',
          building: incomingOrder.fulfillments[0].end!.location!.address!.building || '',
          locality: incomingOrder.fulfillments[0].end!.location!.address!.locality || '',
          city: incomingOrder.fulfillments[0].end!.location!.address!.city || '',
          state: incomingOrder.fulfillments[0].end!.location!.address!.state || '',
          country: 'IND',
          area_code: incomingOrder.fulfillments[0].end!.location!.address!.area_code || '',
        } : undefined,
        contact: {
          phone: incomingOrder.billing?.phone || '',
          email: incomingOrder.billing?.email,
        },
      },
      payment: {
        type: incomingOrder.payment?.type === 'ON-FULFILLMENT' ? 'ON-FULFILLMENT' : 'ON-ORDER',
        status: incomingOrder.payment?.status === 'PAID' ? 'PAID' : 'NOT-PAID',
        amount: parseFloat(incomingOrder.quote?.price.value || '0'),
        method: incomingOrder.payment?.type === 'ON-FULFILLMENT' ? 'COD' : 'UPI',
      },
      status: 'PENDING',
      timeline: [{ status: 'PENDING', timestamp: now, actor: 'SYSTEM', notes: 'Order received from ONDC' }],
      createdAt: now,
      updatedAt: now,
    };

    await createOrder(order);

    // Send WhatsApp notification to seller (fire-and-forget via EventBridge)
    await notifySellerViaWhatsApp(seller, order, incomingOrder);

    // Build the on_confirm response
    const responseOrder = {
      id: orderId,
      state: ONDC_ORDER_STATES.CREATED,
      provider: incomingOrder.provider,
      items: incomingOrder.items,
      billing: incomingOrder.billing,
      fulfillments: incomingOrder.fulfillments?.map(f => ({
        ...f,
        state: { descriptor: { code: 'Pending', name: 'Pending' } },
      })) as BecknFulfillment[],
      quote: incomingOrder.quote,
      payment: incomingOrder.payment,
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
      tags: incomingOrder.tags,
    };

    return {
      context: buildResponseContext(context, 'on_confirm'),
      message: { order: responseOrder },
    };
  } catch (error) {
    console.error('Confirm handler error:', error);
    return buildErrorResponse(context, 'on_confirm', '30001', 'Internal error during confirm');
  }
}

// ============================================================================
// STATUS → ON_STATUS
// ============================================================================

/**
 * Handle /status — return order status
 */
export async function handleStatus(
  request: BecknRequest<StatusMessage>
): Promise<BecknResponse<OnStatusMessage>> {
  const { context, message } = request;

  try {
    const order = await getOrderById(message.order_id);
    if (!order) {
      return buildErrorResponse(context, 'on_status', '30004', `Order not found: ${message.order_id}`);
    }

    const becknState = mapOrderStatusToBeckn(order.status);

    return {
      context: buildResponseContext(context, 'on_status'),
      message: {
        order: {
          id: order.orderId,
          state: becknState,
          provider: { id: order.sellerId },
          items: order.items.map(item => ({
            id: item.itemId,
            fulfillment_id: `fulf-${order.sellerId}-delivery`,
            quantity: { count: item.quantity },
          })),
          fulfillments: [{
            id: `fulf-${order.sellerId}-delivery`,
            type: order.fulfillment.type === 'Pickup' ? 'Self-Pickup' : 'Delivery',
            state: {
              descriptor: {
                code: mapOrderStatusToFulfillmentCode(order.status),
                name: mapOrderStatusToFulfillmentCode(order.status),
              },
            },
            tracking: false,
          }],
        },
      },
    };
  } catch (error) {
    console.error('Status handler error:', error);
    return buildErrorResponse(context, 'on_status', '30001', 'Internal error during status');
  }
}

// ============================================================================
// CANCEL → ON_CANCEL
// ============================================================================

/**
 * Handle /cancel — cancel an order
 */
export async function handleCancel(
  request: BecknRequest<CancelMessage>
): Promise<BecknResponse<OnCancelMessage>> {
  const { context, message } = request;

  try {
    const order = await getOrderById(message.order_id);
    if (!order) {
      return buildErrorResponse(context, 'on_cancel', '30004', `Order not found: ${message.order_id}`);
    }

    // Check if cancellation is valid
    if (!VALID_ORDER_TRANSITIONS[order.status].includes('CANCELLED')) {
      return buildErrorResponse(context, 'on_cancel', '30005',
        `Cannot cancel order in ${order.status} state`);
    }

    const now = Date.now();
    await updateOrderStatus(order.orderId, order.sellerId, 'CANCELLED', {
      status: 'CANCELLED',
      timestamp: now,
      actor: 'BUYER',
      notes: `Cancelled by buyer via ONDC. Reason: ${message.cancellation_reason_id}`,
    });

    // Notify seller via WhatsApp
    const seller = await getSellerById(order.sellerId);
    if (seller) {
      await notifySellerOrderCancelled(seller, order, message.cancellation_reason_id);
    }

    return {
      context: buildResponseContext(context, 'on_cancel'),
      message: {
        order: {
          id: order.orderId,
          state: ONDC_ORDER_STATES.CANCELLED as 'Cancelled',
          provider: { id: order.sellerId },
          items: order.items.map(it => ({
            id: it.itemId,
            fulfillment_id: `fulf-${order.sellerId}-delivery`,
            quantity: { count: it.quantity },
          })),
          cancellation: {
            cancelled_by: context.bap_id,
            reason: { id: message.cancellation_reason_id },
          },
        },
      },
    };
  } catch (error) {
    console.error('Cancel handler error:', error);
    return buildErrorResponse(context, 'on_cancel', '30001', 'Internal error during cancel');
  }
}

// ============================================================================
// UPDATE → ON_UPDATE
// ============================================================================

export async function handleUpdate(
  request: BecknRequest<UpdateMessage>
): Promise<BecknResponse<OnUpdateMessage>> {
  const { context, message } = request;

  try {
    const order = await getOrderById(message.order.id);
    if (!order) {
      return buildErrorResponse(context, 'on_update', '30004', 'Order not found');
    }

    // For now, support fulfillment state updates only
    return {
      context: buildResponseContext(context, 'on_update'),
      message: {
        order: {
          id: order.orderId,
          state: mapOrderStatusToBeckn(order.status),
          provider: { id: order.sellerId },
          items: order.items.map(it => ({
            id: it.itemId,
            fulfillment_id: `fulf-${order.sellerId}-delivery`,
            quantity: { count: it.quantity },
          })),
        },
      },
    };
  } catch (error) {
    console.error('Update handler error:', error);
    return buildErrorResponse(context, 'on_update', '30001', 'Internal error during update');
  }
}

// ============================================================================
// TRACK → ON_TRACK
// ============================================================================

export async function handleTrack(
  request: BecknRequest<TrackMessage>
): Promise<BecknResponse<OnTrackMessage>> {
  const { context, message } = request;

  try {
    const order = await getOrderById(message.order_id);
    if (!order) {
      return buildErrorResponse(context, 'on_track', '30004', 'Order not found');
    }

    // No live tracking for now — return status-based tracking
    return {
      context: buildResponseContext(context, 'on_track'),
      message: {
        tracking: {
          status: mapOrderStatusToFulfillmentCode(order.status),
          url: `${BPP_URI}/track/${order.orderId}`,
        },
      },
    };
  } catch (error) {
    console.error('Track handler error:', error);
    return buildErrorResponse(context, 'on_track', '30001', 'Internal error during track');
  }
}

// ============================================================================
// RATING → ON_RATING
// ============================================================================

export async function handleRating(
  request: BecknRequest<RatingMessage>
): Promise<BecknResponse<OnRatingMessage>> {
  const { context, message } = request;

  console.log('BPP handling /rating:', JSON.stringify(message.ratings));

  // Store ratings in DynamoDB (future enhancement)
  // For now acknowledge receipt

  return {
    context: buildResponseContext(context, 'on_rating'),
    message: {
      feedback_ack: true,
      rating_ack: true,
    },
  };
}

// ============================================================================
// SUPPORT → ON_SUPPORT
// ============================================================================

export async function handleSupport(
  request: BecknRequest<SupportMessage>
): Promise<BecknResponse<OnSupportMessage>> {
  const { context } = request;

  return {
    context: buildResponseContext(context, 'on_support'),
    message: {
      phone: '+918902418321',
      email: 'support@vyaparvaani.in',
      url: 'https://vyaparvaani.in/support',
    },
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function buildResponseContext(inContext: BecknContext, action: BecknContext['action']): BecknContext {
  return {
    ...inContext,
    action,
    bpp_id: BPP_ID,
    bpp_uri: BPP_URI,
    message_id: randomUUID(),
    timestamp: new Date().toISOString(),
  };
}

function buildErrorResponse(context: BecknContext, action: BecknContext['action'], code: string, message: string): BecknResponse<any> {
  return {
    context: buildResponseContext(context, action),
    message: {},
    error: { type: 'DOMAIN-ERROR', code, message },
  };
}

function mapCatalogItemToBeckn(item: CatalogItem): BecknCatalogItemFull {
  const b = item.becknItem;
  return {
    id: item.itemId,
    descriptor: {
      name: b.descriptor.name,
      code: b.descriptor.code,
      symbol: b.descriptor.symbol,
      short_desc: b.descriptor.short_desc,
      long_desc: b.descriptor.long_desc,
      images: b.descriptor.images.map(url => ({ url })),
    },
    price: {
      currency: b.price.currency,
      value: b.price.value,
      maximum_value: b.price.maximum_value,
    },
    quantity: b.quantity,
    category_id: b.category_id,
    fulfillment_id: b.fulfillment_id,
    location_id: b.location_id,
    time: b.time,
    tags: b.tags,
    '@ondc/org/returnable': b['@ondc/org/returnable'] ?? false,
    '@ondc/org/cancellable': b['@ondc/org/cancellable'] ?? true,
    '@ondc/org/return_window': b['@ondc/org/return_window'] || 'P0D',
    '@ondc/org/seller_pickup_return': b['@ondc/org/seller_pickup_return'] ?? false,
    '@ondc/org/time_to_ship': b['@ondc/org/time_to_ship'] || 'P2D',
    '@ondc/org/available_on_cod': b['@ondc/org/available_on_cod'] ?? true,
    '@ondc/org/contact_details_consumer_care': b['@ondc/org/contact_details_consumer_care'] || '+918902418321,support@vyaparvaani.in',
  };
}

function mapOrderStatusToBeckn(status: string): string {
  const map: Record<string, string> = {
    PENDING: ONDC_ORDER_STATES.CREATED,
    ACCEPTED: ONDC_ORDER_STATES.ACCEPTED,
    PACKED: ONDC_ORDER_STATES.IN_PROGRESS,
    SHIPPED: ONDC_ORDER_STATES.IN_PROGRESS,
    DELIVERED: ONDC_ORDER_STATES.COMPLETED,
    CANCELLED: ONDC_ORDER_STATES.CANCELLED,
    REJECTED: ONDC_ORDER_STATES.CANCELLED,
  };
  return map[status] || ONDC_ORDER_STATES.CREATED;
}

function mapOrderStatusToFulfillmentCode(status: string): string {
  const map: Record<string, string> = {
    PENDING: 'Pending',
    ACCEPTED: 'Packed',
    PACKED: 'Packed',
    SHIPPED: 'Order-picked-up',
    DELIVERED: 'Order-delivered',
    CANCELLED: 'Cancelled',
    REJECTED: 'Cancelled',
  };
  return map[status] || 'Pending';
}

/**
 * Fire EventBridge event to notify seller via WhatsApp about new ONDC order
 */
async function notifySellerViaWhatsApp(seller: SellerProfile, order: Order, becknOrder: any): Promise<void> {
  const { eventBridgeClient, EVENT_BUS_NAME } = await import('../config/aws-clients');
  const { PutEventsCommand } = await import('@aws-sdk/client-eventbridge');

  // Build item names for notification
  const itemNames = [];
  for (const item of order.items) {
    const catalogItem = await getCatalogItem(order.sellerId, item.itemId);
    itemNames.push(catalogItem ? catalogItem.becknItem.descriptor.name : item.itemId);
  }

  const totalAmount = order.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const lang = seller.language || 'hi';

  const messages: Record<string, string> = {
    hi: `🛒 *नया ONDC ऑर्डर!*\n\n📦 ऑर्डर: ${order.orderId.substring(0, 8)}\n🛍️ सामान: ${itemNames.join(', ')}\n💰 कुल: ₹${totalAmount}\n📍 ${order.fulfillment.type === 'Delivery' ? 'डिलीवरी' : 'पिकअप'}\n\nक्या आप स्वीकार करते हैं?`,
    mr: `🛒 *नवीन ONDC ऑर्डर!*\n\n📦 ऑर्डर: ${order.orderId.substring(0, 8)}\n🛍️ वस्तू: ${itemNames.join(', ')}\n💰 एकूण: ₹${totalAmount}\n📍 ${order.fulfillment.type === 'Delivery' ? 'डिलिव्हरी' : 'पिकअप'}\n\nतुम्ही स्वीकार करता?`,
    en: `🛒 *New ONDC Order!*\n\n📦 Order: ${order.orderId.substring(0, 8)}\n🛍️ Items: ${itemNames.join(', ')}\n💰 Total: ₹${totalAmount}\n📍 ${order.fulfillment.type}\n\nDo you accept?`,
  };

  await eventBridgeClient.send(new PutEventsCommand({
    Entries: [{
      EventBusName: EVENT_BUS_NAME,
      Source: 'vyapar.vaani.internal',
      DetailType: 'whatsapp.message.send',
      Detail: JSON.stringify({
        to: seller.phone,
        type: 'interactive',
        content: {
          type: 'button',
          body: { text: messages[lang] || messages.en },
          action: {
            buttons: [
              { type: 'reply', reply: { id: `accept_order_${order.orderId}`, title: '✅ Accept' } },
              { type: 'reply', reply: { id: `reject_order_${order.orderId}`, title: '❌ Reject' } },
            ],
          },
        },
        language: lang,
      }),
    }],
  }));
}

/**
 * Notify seller of order cancellation via WhatsApp
 */
async function notifySellerOrderCancelled(seller: SellerProfile, order: Order, reasonId: string): Promise<void> {
  const { eventBridgeClient, EVENT_BUS_NAME } = await import('../config/aws-clients');
  const { PutEventsCommand } = await import('@aws-sdk/client-eventbridge');

  const lang = seller.language || 'hi';
  const messages: Record<string, string> = {
    hi: `❌ ऑर्डर ${order.orderId.substring(0, 8)} रद्द कर दिया गया। कारण: ${reasonId}`,
    mr: `❌ ऑर्डर ${order.orderId.substring(0, 8)} रद्द केले. कारण: ${reasonId}`,
    en: `❌ Order ${order.orderId.substring(0, 8)} has been cancelled. Reason: ${reasonId}`,
  };

  await eventBridgeClient.send(new PutEventsCommand({
    Entries: [{
      EventBusName: EVENT_BUS_NAME,
      Source: 'vyapar.vaani.internal',
      DetailType: 'whatsapp.message.send',
      Detail: JSON.stringify({
        to: seller.phone,
        type: 'text',
        content: { text: messages[lang] || messages.en },
        language: lang,
      }),
    }],
  }));
}
