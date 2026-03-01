/**
 * Lambda function to submit orders and send to seller WhatsApp
 * POST /orders
 */

const axios = require('axios');
const { Order } = require('../lib/models');

const WHATSAPP_API_ENDPOINT = process.env.WHATSAPP_API_ENDPOINT || 'https://graph.facebook.com/v22.0';
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

/**
 * Send WhatsApp message with retry logic
 */
async function sendWhatsAppMessage(sellerPhone, message, retries = 3) {
    const url = `${WHATSAPP_API_ENDPOINT}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await axios.post(
                url,
                {
                    messaging_product: 'whatsapp',
                    to: sellerPhone,
                    type: 'text',
                    text: { body: message }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            console.log(`WhatsApp message sent successfully on attempt ${attempt}`, response.data);
            return { success: true, data: response.data };
        } catch (error) {
            console.error(`WhatsApp send attempt ${attempt} failed:`, error.response?.data || error.message);
            
            if (attempt === retries) {
                throw error;
            }
            
            // Exponential backoff
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

exports.handler = async (event) => {
    console.log('SubmitOrder Lambda invoked', { event });

    // Handle CORS preflight (OPTIONS)
    if (event.httpMethod === 'OPTIONS' || event.requestContext?.http?.method === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            body: JSON.stringify({ message: 'OK' })
        };
    }

    try {
        if (!event.body) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    success: false,
                    error: { code: 'MISSING_BODY', message: 'Request body is required' }
                })
            };
        }

        const orderData = JSON.parse(event.body);
        
        // Validate order data using Order model
        const order = new Order(orderData);
        const validation = order.validate();
        
        if (!validation.valid) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    success: false,
                    error: {
                        code: 'INVALID_ORDER_DATA',
                        message: 'Order validation failed',
                        details: validation.errors
                    }
                })
            };
        }

        // Group items by seller
        const itemsBySeller = {};
        orderData.items.forEach(item => {
            const sellerPhone = item.seller.phone;
            if (!itemsBySeller[sellerPhone]) {
                itemsBySeller[sellerPhone] = {
                    seller: item.seller,
                    items: []
                };
            }
            itemsBySeller[sellerPhone].items.push(item);
        });

        // Send order to each seller via WhatsApp
        const results = [];
        for (const [sellerPhone, sellerData] of Object.entries(itemsBySeller)) {
            const sellerOrderData = {
                buyer: orderData.buyer,
                items: sellerData.items,
                totalAmount: sellerData.items.reduce((sum, item) => sum + (item.price * item.quantity), 0)
            };
            
            const sellerOrder = new Order(sellerOrderData);
            const message = sellerOrder.formatWhatsAppMessage();
            
            try {
                const result = await sendWhatsAppMessage(sellerPhone, message);
                results.push({
                    seller: sellerData.seller.name,
                    success: true
                });
            } catch (error) {
                console.error(`Failed to send order to seller ${sellerData.seller.name}:`, error);
                results.push({
                    seller: sellerData.seller.name,
                    success: false,
                    error: error.message
                });
            }
        }

        // Check if all messages were sent successfully
        const allSuccess = results.every(r => r.success);

        return {
            statusCode: allSuccess ? 200 : 207,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            body: JSON.stringify({
                success: allSuccess,
                orderId: `ORD-${Date.now()}`,
                message: allSuccess 
                    ? 'Order submitted successfully. Sellers will contact you soon.'
                    : 'Order partially submitted. Some sellers could not be notified.',
                results
            })
        };
    } catch (error) {
        console.error('Error submitting order:', error);
        
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: false,
                error: {
                    code: 'ORDER_SUBMISSION_ERROR',
                    message: 'Failed to submit order',
                    details: error.message
                }
            })
        };
    }
};
