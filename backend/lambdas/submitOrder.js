/**
 * Lambda function to submit orders and send to seller WhatsApp
 * POST /orders
 * 
 * Now persists orders to DynamoDB (vyapar-vaani-data) with payment info,
 * and sends interactive WhatsApp messages with accept/reject buttons.
 */

const axios = require('axios');
const { randomUUID } = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const eventBridgeClient = new EventBridgeClient({});

const WHATSAPP_API_ENDPOINT = process.env.WHATSAPP_API_ENDPOINT || 'https://graph.facebook.com/v22.0';
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const VYAPAR_VAANI_TABLE = process.env.VYAPAR_VAANI_TABLE || 'vyapar-vaani-data';
const MARKETPLACE_PRODUCTS_TABLE = process.env.MARKETPLACE_PRODUCTS_TABLE || 'marketplace-products';
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;

const CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

/**
 * Format order message for seller (Hindi + English, rich formatting)
 */
function formatSellerOrderMessage(orderId, buyer, items, total, paymentMethod) {
    const itemLines = items.map((item, i) => {
        const lineTotal = (item.price * item.quantity).toFixed(2);
        return `  ${i + 1}. ${item.name} — ${item.quantity} ${item.unit || 'pcs'} × ₹${item.price} = *₹${lineTotal}*`;
    }).join('\n');

    const address = buyer.address;
    const fullAddress = [
        address.street,
        address.city,
        address.state,
        address.postalCode ? `PIN: ${address.postalCode}` : '',
    ].filter(Boolean).join(', ');

    const paymentLine = paymentMethod === 'UPI'
        ? '💳 *भुगतान: UPI (ऑनलाइन)*'
        : '🏠 *भुगतान: COD (डिलीवरी पर)*';

    return [
        `🛒 *नया ऑर्डर आया है!*`,
        `📋 Order ID: *${orderId}*`,
        ``,
        `👤 *ग्राहक की जानकारी:*`,
        `  नाम: ${buyer.name}`,
        `  फ़ोन: ${buyer.phone}`,
        `  पता: ${fullAddress}`,
        ``,
        `📦 *ऑर्डर आइटम:*`,
        itemLines,
        ``,
        `💰 *कुल राशि: ₹${total.toFixed(2)}*`,
        paymentLine,
        ``,
        `⏰ कृपया जल्द से जल्द ऑर्डर स्वीकार करें।`,
    ].join('\n');
}

/**
 * Send interactive WhatsApp message with Accept/Reject buttons (COD orders only)
 */
async function sendInteractiveOrderMessage(sellerPhone, orderId, buyer, items, total, paymentMethod, retries = 3) {
    const url = `${WHATSAPP_API_ENDPOINT}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const messageBody = formatSellerOrderMessage(orderId, buyer, items, total, paymentMethod);

    const payload = {
        messaging_product: 'whatsapp',
        to: sellerPhone,
        type: 'interactive',
        interactive: {
            type: 'button',
            body: { text: messageBody },
            action: {
                buttons: [
                    { type: 'reply', reply: { id: `accept_order_${orderId}`, title: '✅ Accept / स्वीकार' } },
                    { type: 'reply', reply: { id: `reject_order_${orderId}`, title: '❌ Reject / अस्वीकार' } },
                ],
            },
        },
    };

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await axios.post(url, payload, {
                headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
            });
            console.log(`Interactive order message sent on attempt ${attempt}`, response.data);
            return { success: true, data: response.data };
        } catch (error) {
            console.error(`Send attempt ${attempt} failed:`, error.response?.data || error.message);
            if (attempt === retries) throw error;
            await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
    }
}

/**
 * Send auto-accepted UPI order notification — clean, minimal, no emoji flood
 */
async function sendAutoAcceptedOrderMessage(sellerPhone, orderId, buyer, items, total, retries = 3) {
    const url = `${WHATSAPP_API_ENDPOINT}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

    const itemLines = items.map(item => {
        const lineTotal = (item.price * item.quantity).toFixed(2);
        return `  ${item.name} — ${item.quantity} ${item.unit || 'pcs'} × ₹${item.price} = ₹${lineTotal}`;
    }).join('\n');

    const address = buyer.address;
    const fullAddress = [address.street, address.city, address.state, address.postalCode ? `PIN: ${address.postalCode}` : ''].filter(Boolean).join(', ');

    const messageBody = [
        `✅ *UPI ऑर्डर — #${orderId.slice(-8)}*`,
        ``,
        `ग्राहक: ${buyer.name}  |  ${buyer.phone}`,
        `पता: ${fullAddress}`,
        ``,
        itemLines,
        ``,
        `*कुल: ₹${total.toFixed(2)}*  •  कृपया पैक करें`,
    ].join('\n');

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await axios.post(url, {
                messaging_product: 'whatsapp',
                to: sellerPhone,
                type: 'text',
                text: { body: messageBody },
            }, {
                headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
            });
            console.log(`Auto-accepted UPI order message sent on attempt ${attempt}`, response.data);
            return { success: true, data: response.data };
        } catch (error) {
            console.error(`Auto-accept send attempt ${attempt} failed:`, error.response?.data || error.message);
            if (attempt === retries) throw error;
            await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
    }
}

/**
 * Send order confirmation to buyer via WhatsApp
 */
async function sendBuyerConfirmation(buyerPhone, orderId, total, paymentMethod) {
    const url = `${WHATSAPP_API_ENDPOINT}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const msg = paymentMethod === 'UPI'
        ? `✅ *ऑर्डर कन्फ़र्म!*\n\nOrder: *${orderId}*\nराशि: ₹${total.toFixed(2)}\n\n💳 UPI पेमेंट प्राप्त — आपका ऑर्डर स्वीकार हो गया है!\nसेलर ऑर्डर पैक कर रहे हैं। 🎉`
        : `📋 *ऑर्डर सबमिट!*\n\nOrder: *${orderId}*\nराशि: ₹${total.toFixed(2)}\n\n🏠 COD — सेलर को सूचित कर दिया गया है।\nस्वीकार होने पर आपको मैसेज मिलेगा।`;

    try {
        await axios.post(url, {
            messaging_product: 'whatsapp', to: buyerPhone, type: 'text',
            text: { body: msg },
        }, {
            headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        });
        console.log('Buyer confirmation sent to', buyerPhone);
    } catch (error) {
        console.warn('Buyer confirmation failed (non-critical):', error.message);
    }
}

/**
 * Decrement product stock in marketplace-products table after order confirmation.
 * Returns an array of { productId, name, remainingQty } for stock notification.
 */
async function decrementProductStock(items) {
    const stockUpdates = [];

    for (const item of items) {
        const productId = item.productId || item.itemId;
        if (!productId) {
            console.warn('Item missing productId, skipping stock decrement:', item.name);
            continue;
        }

        try {
            // Atomically decrement quantity, but don't allow negative stock
            const result = await docClient.send(new UpdateCommand({
                TableName: MARKETPLACE_PRODUCTS_TABLE,
                Key: { productId },
                UpdateExpression: 'SET quantity = quantity - :qty, updatedAt = :now',
                ConditionExpression: 'quantity >= :qty',
                ExpressionAttributeValues: {
                    ':qty': item.quantity || 1,
                    ':now': new Date().toISOString(),
                },
                ReturnValues: 'ALL_NEW',
            }));

            const updatedProduct = result.Attributes;
            const remainingQty = updatedProduct?.quantity ?? 0;
            
            console.log(`📦 Stock updated: ${item.name} — ordered ${item.quantity}, remaining: ${remainingQty}`);

            stockUpdates.push({
                productId,
                name: item.name,
                orderedQty: item.quantity || 1,
                remainingQty,
                unit: item.unit || updatedProduct?.unit || 'pcs',
            });

            // If stock is now 0, mark product as OUT_OF_STOCK
            if (remainingQty <= 0) {
                try {
                    await docClient.send(new UpdateCommand({
                        TableName: MARKETPLACE_PRODUCTS_TABLE,
                        Key: { productId },
                        UpdateExpression: 'SET #s = :status',
                        ExpressionAttributeNames: { '#s': 'status' },
                        ExpressionAttributeValues: { ':status': 'OUT_OF_STOCK' },
                    }));
                    console.log(`⚠️ Product ${item.name} marked OUT_OF_STOCK`);
                } catch (e) {
                    console.warn('Failed to mark out of stock:', e.message);
                }
            }
        } catch (error) {
            if (error.name === 'ConditionalCheckFailedException') {
                console.warn(`⚠️ Insufficient stock for ${item.name} (productId: ${productId})`);
                stockUpdates.push({
                    productId,
                    name: item.name,
                    orderedQty: item.quantity || 1,
                    remainingQty: 0,
                    unit: item.unit || 'pcs',
                    outOfStock: true,
                });
            } else {
                console.error(`Failed to decrement stock for ${item.name}:`, error.message);
            }
        }
    }

    return stockUpdates;
}

/**
 * Send stock update to seller as VOICE only (via EventBridge → whatsapp-sender Lambda with Polly)
 */
async function sendStockUpdateNotification(sellerPhone, stockUpdates, buyerName, total) {
    if (!stockUpdates || stockUpdates.length === 0) return;
    if (!EVENT_BUS_NAME) {
        console.warn('EVENT_BUS_NAME not set — skipping voice stock update');
        return;
    }

    const stockLines = stockUpdates.map(s => {
        if (s.outOfStock || s.remainingQty <= 0) {
            return `${s.name} का स्टॉक खत्म हो गया।`;
        }
        return `${s.name}: ${s.remainingQty} ${s.unit} बाकी।`;
    }).join(' ');

    const hasOutOfStock = stockUpdates.some(s => s.remainingQty <= 0);
    const voiceText = buyerName
        ? `${buyerName} ने ₹${parseFloat(total).toFixed(0)} का UPI ऑर्डर दिया। स्टॉक अपडेट: ${stockLines}${hasOutOfStock ? ' कुछ उत्पाद खत्म हो गए, कृपया स्टॉक भरें।' : ''}`
        : `स्टॉक अपडेट: ${stockLines}${hasOutOfStock ? ' कुछ उत्पाद खत्म हो गए, कृपया स्टॉक भरें।' : ''}`;

    try {
        await eventBridgeClient.send(new PutEventsCommand({
            Entries: [{
                EventBusName: EVENT_BUS_NAME,
                Source: 'vyapar.vaani.internal',
                DetailType: 'whatsapp.message.send',
                Detail: JSON.stringify({
                    to: sellerPhone,
                    type: 'voice',
                    content: { text: voiceText },
                    language: 'hi',
                }),
            }],
        }));
        console.log('Voice stock update dispatched for seller', sellerPhone);
    } catch (error) {
        console.warn('Voice stock notification failed (non-critical):', error.message);
    }
}

/**
 * Send follow-up COD order alert to seller (text only, no voice — UPI already gets voice via stock update)
 */
async function sendCodOrderAlert(sellerPhone, buyerName, total) {
    if (!EVENT_BUS_NAME) return;
    const voiceText = `${buyerName} ने ₹${parseFloat(total).toFixed(0)} का COD ऑर्डर दिया है। कृपया स्वीकार या अस्वीकार करें।`;
    try {
        await eventBridgeClient.send(new PutEventsCommand({
            Entries: [{
                EventBusName: EVENT_BUS_NAME,
                Source: 'vyapar.vaani.internal',
                DetailType: 'whatsapp.message.send',
                Detail: JSON.stringify({
                    to: sellerPhone,
                    type: 'voice',
                    content: { text: voiceText },
                    language: 'hi',
                }),
            }],
        }));
    } catch (error) {
        console.warn('COD order alert failed (non-critical):', error.message);
    }
}

/**
 * Persist order to DynamoDB (vyapar-vaani-data table)
 */
async function persistOrder(orderId, sellerPhone, orderData, paymentMethod) {
    const now = Date.now();

    const orderRecord = {
        PK: `ORDER#${orderId}`,
        SK: 'METADATA',
        GSI2PK: `SELLER#${sellerPhone}`,
        GSI2SK: `STATUS#PENDING#${now}`,
        entityType: 'ORDER',
        orderId,
        sellerId: sellerPhone,
        buyerAppId: 'marketplace-web',
        transactionId: randomUUID(),
        // ONDC Beckn Protocol fields
        becknContext: {
            domain: 'ONDC:RET10',
            action: 'confirm',
            core_version: '1.2.0',
            bap_id: 'marketplace-web.vyapar-vaani.ondc.in',
            bap_uri: 'https://marketplace.vyapar-vaani.ondc.in',
            bpp_id: process.env.NETWORK_PARTICIPANT_ID || 'vyapar-vaani.ondc.in',
            bpp_uri: process.env.BPP_BASE_URL || 'https://api.vyapar-vaani.ondc.in',
            transaction_id: randomUUID(),
            message_id: randomUUID(),
            timestamp: new Date().toISOString(),
            country: 'IND',
            city: 'std:*',
        },
        items: orderData.items.map(item => ({
            itemId: item.productId || item.name,
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            unit: item.unit || 'pcs',
            seller: item.seller,
        })),
        fulfillment: {
            type: 'Delivery',
            state: { descriptor: { code: 'Pending' } },
            address: {
                name: orderData.buyer.address.name || orderData.buyer.name,
                building: '',
                locality: orderData.buyer.address.street,
                city: orderData.buyer.address.city,
                state: orderData.buyer.address.state,
                country: 'IND',
                area_code: orderData.buyer.address.postalCode,
            },
            contact: {
                phone: orderData.buyer.phone,
            },
        },
        payment: {
            type: paymentMethod === 'UPI' ? 'ON-ORDER' : 'ON-FULFILLMENT',
            status: paymentMethod === 'UPI' ? 'PENDING_VERIFICATION' : 'NOT-PAID',
            amount: orderData.totalAmount,
            method: paymentMethod,
            upiTransactionRef: orderData.upiTransactionRef || null,
            upiId: orderData.sellerUpiId || null,
            // Beckn payment params
            params: {
                currency: 'INR',
                amount: String(orderData.totalAmount),
            },
        },
        // Beckn order state
        state: 'Created',
        status: 'PENDING',
        timeline: [{
            status: 'PENDING',
            timestamp: now,
            actor: 'BUYER',
            notes: `Order placed via marketplace (${paymentMethod})`,
        }],
        buyer: {
            name: orderData.buyer.name,
            phone: orderData.buyer.phone,
            address: orderData.buyer.address,
        },
        createdAt: now,
        updatedAt: now,
    };

    await docClient.send(new PutCommand({
        TableName: VYAPAR_VAANI_TABLE,
        Item: orderRecord,
        ConditionExpression: 'attribute_not_exists(PK)',
    }));

    console.log('Order persisted to DynamoDB:', orderId);

    // Publish order.created event for inventory management
    if (EVENT_BUS_NAME) {
        try {
            await eventBridgeClient.send(new PutEventsCommand({
                Entries: [{
                    Source: 'vyapar.vaani.internal',
                    DetailType: 'order.created',
                    Detail: JSON.stringify({
                        orderId,
                        sellerId: sellerPhone,
                        items: orderRecord.items,
                        totalAmount: orderData.totalAmount,
                        paymentMethod,
                        timestamp: new Date().toISOString(),
                    }),
                    EventBusName: EVENT_BUS_NAME,
                }],
            }));
            console.log('Published order.created event');
        } catch (err) {
            console.warn('Failed to publish order.created event (non-critical):', err.message);
        }
    }

    return orderRecord;
}

/**
 * Get order by ID (for status tracking)
 */
async function getOrder(orderId) {
    const { GetCommand } = require('@aws-sdk/lib-dynamodb');
    const result = await docClient.send(new GetCommand({
        TableName: VYAPAR_VAANI_TABLE,
        Key: { PK: `ORDER#${orderId}`, SK: 'METADATA' },
    }));
    return result.Item || null;
}

exports.handler = async (event) => {
    console.log('SubmitOrder Lambda invoked', JSON.stringify(event));

    // CORS preflight
    if (event.httpMethod === 'OPTIONS' || event.requestContext?.http?.method === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ message: 'OK' }) };
    }

    // GET /orders/{orderId} — order status tracking
    if (event.httpMethod === 'GET' || event.requestContext?.http?.method === 'GET') {
        try {
            const orderId = event.pathParameters?.orderId;
            if (!orderId) {
                return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'orderId required' }) };
            }
            const order = await getOrder(orderId);
            if (!order) {
                return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'Order not found' }) };
            }
            return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true, order }) };
        } catch (error) {
            return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: error.message }) };
        }
    }

    // POST /orders — create order
    try {
        if (!event.body) {
            return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: { code: 'MISSING_BODY', message: 'Request body is required' } }) };
        }

        const orderData = JSON.parse(event.body);

        // Basic validation
        if (!orderData.buyer || !orderData.items || orderData.items.length === 0) {
            return {
                statusCode: 400, headers: CORS_HEADERS,
                body: JSON.stringify({ success: false, error: { code: 'INVALID_ORDER_DATA', message: 'buyer and items are required' } }),
            };
        }

        if (!orderData.buyer.address || !orderData.buyer.address.street || !orderData.buyer.address.city) {
            return {
                statusCode: 400, headers: CORS_HEADERS,
                body: JSON.stringify({ success: false, error: { code: 'INVALID_ADDRESS', message: 'Complete address is required' } }),
            };
        }

        const orderId = `ORD-${randomUUID().split('-')[0].toUpperCase()}`;
        const paymentMethod = orderData.paymentMethod || 'COD';

        // Group items by seller phone
        const itemsBySeller = {};
        orderData.items.forEach(item => {
            const sellerPhone = typeof item.seller === 'object' ? item.seller.phone : null;
            const sellerName = typeof item.seller === 'object' ? item.seller.name : (item.seller || 'Unknown');

            if (!sellerPhone) {
                console.warn('Item missing seller phone, skipping WhatsApp:', item.name);
                return;
            }

            if (!itemsBySeller[sellerPhone]) {
                itemsBySeller[sellerPhone] = { seller: { name: sellerName, phone: sellerPhone }, items: [] };
            }
            itemsBySeller[sellerPhone].items.push(item);
        });

        // Persist order for EACH seller (each gets their own order record)
        const results = [];
        for (const [sellerPhone, sellerData] of Object.entries(itemsBySeller)) {
            const sellerTotal = sellerData.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
            const sellerOrderId = Object.keys(itemsBySeller).length > 1
                ? `${orderId}-${sellerPhone.slice(-4)}`
                : orderId;

            try {
                // 1) Persist to DynamoDB
                const sellerOrderData = {
                    ...orderData,
                    items: sellerData.items,
                    totalAmount: sellerTotal,
                    sellerUpiId: sellerData.items[0]?.sellerUpiId || null,
                };

                if (paymentMethod === 'UPI') {
                    // UPI: Auto-accept order — no buttons needed
                    // Set status directly to CONFIRMED since payment is committed
                    sellerOrderData.autoAccepted = true;
                    const orderRecord = await persistOrder(sellerOrderId, sellerPhone, sellerOrderData, paymentMethod);

                    // Override status to CONFIRMED for UPI orders
                    await docClient.send(new UpdateCommand({
                        TableName: VYAPAR_VAANI_TABLE,
                        Key: { PK: `ORDER#${sellerOrderId}`, SK: 'METADATA' },
                        UpdateExpression: 'SET #s = :status, #timeline = list_append(if_not_exists(#timeline, :emptyList), :event), updatedAt = :now',
                        ExpressionAttributeNames: { '#s': 'status', '#timeline': 'timeline' },
                        ExpressionAttributeValues: {
                            ':status': 'CONFIRMED',
                            ':event': [{ status: 'CONFIRMED', timestamp: Date.now(), actor: 'SYSTEM', notes: 'Auto-accepted: UPI payment committed' }],
                            ':emptyList': [],
                            ':now': Date.now(),
                        },
                    }));

                    // Send plain notification (no accept/reject buttons)
                    await sendAutoAcceptedOrderMessage(
                        sellerPhone, sellerOrderId, orderData.buyer,
                        sellerData.items, sellerTotal
                    );

                    // Notify buyer order is confirmed
                    if (orderData.buyer.phone) {
                        await sendBuyerConfirmation(orderData.buyer.phone, sellerOrderId, sellerTotal, paymentMethod);
                    }

                    // Decrement stock for UPI auto-confirmed orders, notify via voice
                    const stockUpdates = await decrementProductStock(sellerData.items);
                    await sendStockUpdateNotification(sellerPhone, stockUpdates, orderData.buyer.name, sellerTotal);
                } else {
                    // COD: Show accept/reject buttons, seller decides
                    await persistOrder(sellerOrderId, sellerPhone, sellerOrderData, paymentMethod);

                    await sendInteractiveOrderMessage(
                        sellerPhone, sellerOrderId, orderData.buyer,
                        sellerData.items, sellerTotal, paymentMethod
                    );

                    // Notify buyer order is submitted (pending seller acceptance)
                    if (orderData.buyer.phone) {
                        await sendBuyerConfirmation(orderData.buyer.phone, sellerOrderId, sellerTotal, paymentMethod);
                    }
                }

                // COD: send voice alert (UPI already gets one via sendStockUpdateNotification)
                if (paymentMethod !== 'UPI') {
                    await sendCodOrderAlert(sellerPhone, orderData.buyer.name, sellerTotal);
                }

                results.push({ seller: sellerData.seller.name, orderId: sellerOrderId, success: true });
            } catch (error) {
                console.error(`Failed for seller ${sellerData.seller.name}:`, error);
                results.push({ seller: sellerData.seller.name, success: false, error: error.message });
            }
        }

        const allSuccess = results.every(r => r.success);

        return {
            statusCode: allSuccess ? 200 : 207,
            headers: CORS_HEADERS,
            body: JSON.stringify({
                success: allSuccess,
                orderId,
                paymentMethod,
                message: allSuccess
                    ? paymentMethod === 'UPI'
                        ? 'Order placed! Complete UPI payment to confirm.'
                        : 'Order submitted successfully! Seller has been notified.'
                    : 'Order partially submitted. Some sellers could not be notified.',
                results,
            }),
        };
    } catch (error) {
        console.error('Error submitting order:', error);
        return {
            statusCode: 500, headers: CORS_HEADERS,
            body: JSON.stringify({ success: false, error: { code: 'ORDER_SUBMISSION_ERROR', message: 'Failed to submit order', details: error.message } }),
        };
    }
};
