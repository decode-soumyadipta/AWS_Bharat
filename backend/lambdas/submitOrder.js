/**
 * Lambda function to submit orders and send to seller WhatsApp
 * POST /orders
 * 
 * Sends interactive WhatsApp messages with:
 * - Formatted order details (Hindi)
 * - Customer name, phone, full address
 * - Itemized list with prices
 * - Accept / Reject buttons
 * - Voice notification
 */

const axios = require('axios');
const { Order } = require('../lib/models');

const WHATSAPP_API_ENDPOINT = process.env.WHATSAPP_API_ENDPOINT || 'https://graph.facebook.com/v22.0';
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

const CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Format order message for seller (Hindi + English, rich formatting)
 */
function formatSellerOrderMessage(orderId, buyer, items, total) {
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
        ``,
        `⏰ कृपया जल्द से जल्द ऑर्डर स्वीकार करें।`,
    ].join('\n');
}

/**
 * Send interactive WhatsApp message with Accept/Reject buttons
 */
async function sendInteractiveOrderMessage(sellerPhone, orderId, buyer, items, total, retries = 3) {
    const url = `${WHATSAPP_API_ENDPOINT}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const messageBody = formatSellerOrderMessage(orderId, buyer, items, total);

    const payload = {
        messaging_product: 'whatsapp',
        to: sellerPhone,
        type: 'interactive',
        interactive: {
            type: 'button',
            body: {
                text: messageBody,
            },
            action: {
                buttons: [
                    {
                        type: 'reply',
                        reply: {
                            id: `accept_order_${orderId}`,
                            title: '✅ Accept / स्वीकार',
                        },
                    },
                    {
                        type: 'reply',
                        reply: {
                            id: `reject_order_${orderId}`,
                            title: '❌ Reject / अस्वीकार',
                        },
                    },
                ],
            },
        },
    };

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await axios.post(url, payload, {
                headers: {
                    Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json',
                },
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
 * Send a voice notification to seller about the new order
 */
async function sendVoiceNotification(sellerPhone, orderId, buyerName, total) {
    const url = `${WHATSAPP_API_ENDPOINT}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const voiceText = `🔔 *${buyerName}* ने ₹${total.toFixed(2)} का ऑर्डर दिया है (${orderId})। कृपया ऊपर दिए गए बटन से स्वीकार या अस्वीकार करें।`;

    try {
        await axios.post(url, {
            messaging_product: 'whatsapp',
            to: sellerPhone,
            type: 'text',
            text: { body: voiceText },
        }, {
            headers: {
                Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
            },
        });
        console.log('Voice notification text sent to', sellerPhone);
    } catch (error) {
        // Non-critical — interactive message already sent
        console.warn('Voice notification failed (non-critical):', error.message);
    }
}

exports.handler = async (event) => {
    console.log('SubmitOrder Lambda invoked', JSON.stringify(event));

    // CORS preflight
    if (event.httpMethod === 'OPTIONS' || event.requestContext?.http?.method === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ message: 'OK' }) };
    }

    try {
        if (!event.body) {
            return {
                statusCode: 400,
                headers: CORS_HEADERS,
                body: JSON.stringify({
                    success: false,
                    error: { code: 'MISSING_BODY', message: 'Request body is required' },
                }),
            };
        }

        const orderData = JSON.parse(event.body);

        // Validate using Order model
        const order = new Order(orderData);
        const validation = order.validate();

        if (!validation.valid) {
            return {
                statusCode: 400,
                headers: CORS_HEADERS,
                body: JSON.stringify({
                    success: false,
                    error: {
                        code: 'INVALID_ORDER_DATA',
                        message: 'Order validation failed',
                        details: validation.errors,
                    },
                }),
            };
        }

        const orderId = `ORD-${Date.now()}`;

        // Group items by seller phone
        const itemsBySeller = {};
        orderData.items.forEach(item => {
            // Handle seller as object {name, phone} or legacy string
            const sellerPhone = typeof item.seller === 'object' ? item.seller.phone : null;
            const sellerName = typeof item.seller === 'object' ? item.seller.name : (item.seller || 'Unknown');

            if (!sellerPhone) {
                console.warn('Item missing seller phone, skipping WhatsApp:', item.name);
                return;
            }

            if (!itemsBySeller[sellerPhone]) {
                itemsBySeller[sellerPhone] = {
                    seller: { name: sellerName, phone: sellerPhone },
                    items: [],
                };
            }
            itemsBySeller[sellerPhone].items.push(item);
        });

        // Send order to each seller via WhatsApp
        const results = [];
        for (const [sellerPhone, sellerData] of Object.entries(itemsBySeller)) {
            const sellerTotal = sellerData.items.reduce(
                (sum, item) => sum + item.price * item.quantity, 0
            );

            try {
                // 1) Interactive message with Accept/Reject buttons
                await sendInteractiveOrderMessage(
                    sellerPhone, orderId, orderData.buyer,
                    sellerData.items, sellerTotal
                );

                // 2) Follow-up voice/text notification
                await sendVoiceNotification(
                    sellerPhone, orderId,
                    orderData.buyer.name, sellerTotal
                );

                results.push({ seller: sellerData.seller.name, success: true });
            } catch (error) {
                console.error(`Failed to notify seller ${sellerData.seller.name}:`, error);
                results.push({
                    seller: sellerData.seller.name,
                    success: false,
                    error: error.message,
                });
            }
        }

        const allSuccess = results.every(r => r.success);

        return {
            statusCode: allSuccess ? 200 : 207,
            headers: CORS_HEADERS,
            body: JSON.stringify({
                success: allSuccess,
                orderId,
                message: allSuccess
                    ? 'Order submitted successfully! Seller has been notified.'
                    : 'Order partially submitted. Some sellers could not be notified.',
                results,
            }),
        };
    } catch (error) {
        console.error('Error submitting order:', error);

        return {
            statusCode: 500,
            headers: CORS_HEADERS,
            body: JSON.stringify({
                success: false,
                error: {
                    code: 'ORDER_SUBMISSION_ERROR',
                    message: 'Failed to submit order',
                    details: error.message,
                },
            }),
        };
    }
};
