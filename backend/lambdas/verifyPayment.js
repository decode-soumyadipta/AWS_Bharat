/**
 * Payment Verification Lambda
 * POST /orders/{orderId}/verify-payment
 * 
 * Supports:
 * 1. Manual UPI transaction reference submission
 * 2. Screenshot upload → Bedrock Nova Pro multimodal AI analysis
 * 3. Seller confirmation (from WhatsApp callback)
 * 
 * Updates order payment status in DynamoDB and notifies seller via WhatsApp.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const axios = require('axios');

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const s3Client = new S3Client({});
const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });

const VYAPAR_VAANI_TABLE = process.env.VYAPAR_VAANI_TABLE || 'vyapar-vaani-data';
const PRODUCTS_BUCKET = process.env.PRODUCTS_BUCKET;
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
 * Analyze payment screenshot using Bedrock Nova Pro multimodal
 */
async function analyzePaymentScreenshot(imageBase64, expectedAmount, expectedUpiId) {
    const prompt = `You are a UPI payment verification assistant. Analyze this payment screenshot carefully.

Extract the following information:
1. Transaction status (Success/Failed/Pending)
2. Amount paid (in ₹)
3. UPI Transaction Reference ID / UTR number
4. Sender UPI ID or name
5. Receiver UPI ID or name
6. Date and time of transaction

Then verify:
- Is this a SUCCESSFUL payment? (yes/no)
- Does the amount match ₹${expectedAmount}? (yes/no/close)
${expectedUpiId ? `- Does the receiver UPI ID match "${expectedUpiId}"? (yes/no/partial)` : ''}

Respond in this exact JSON format:
{
  "transactionStatus": "success|failed|pending|unclear",
  "amount": <number or null>,
  "transactionRef": "<UTR/ref number or null>",
  "senderName": "<sender name or null>",
  "receiverUpiId": "<receiver UPI or null>",
  "dateTime": "<date time string or null>",
  "isPaymentSuccessful": true|false,
  "amountMatches": true|false,
  "receiverMatches": true|false,
  "confidence": "high|medium|low",
  "reasoning": "<brief explanation>"
}`;

    try {
        const response = await bedrockClient.send(new InvokeModelCommand({
            modelId: 'amazon.nova-pro-v1:0',
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
                messages: [{
                    role: 'user',
                    content: [
                        {
                            image: {
                                format: 'png',
                                source: { bytes: imageBase64 },
                            },
                        },
                        { text: prompt },
                    ],
                }],
                inferenceConfig: {
                    maxTokens: 1024,
                    temperature: 0.1,
                },
            }),
        }));

        const result = JSON.parse(new TextDecoder().decode(response.body));
        const text = result.output?.message?.content?.[0]?.text || '';
        
        // Extract JSON from the response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return { confidence: 'low', reasoning: 'Could not parse AI response', isPaymentSuccessful: false };
    } catch (error) {
        console.error('Bedrock analysis failed:', error);
        return { confidence: 'low', reasoning: `AI analysis error: ${error.message}`, isPaymentSuccessful: false };
    }
}

/**
 * Send payment confirmation to seller via WhatsApp
 */
async function notifySellerPayment(sellerPhone, orderId, amount, method) {
    const url = `${WHATSAPP_API_ENDPOINT}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const msg = method === 'SCREENSHOT_AI'
        ? `✅ *पेमेंट वेरिफाई हो गया!*\n\nOrder: *${orderId}*\nराशि: *₹${amount}*\n\nAI ने स्क्रीनशॉट से पेमेंट की पुष्टि की है। कृपया ऑर्डर पैक करें।\n📌 ऑर्डर ऑटो-कन्फ़र्म हो गया है।`
        : `✅ *पेमेंट रेफ़रेंस प्राप्त!*\n\nOrder: *${orderId}*\nराशि: *₹${amount}*\n\nग्राहक ने UPI Transaction Ref दिया है। कृपया अपने बैंक ऐप से कन्फ़र्म करें।`;

    try {
        await axios.post(url, {
            messaging_product: 'whatsapp',
            to: sellerPhone,
            type: 'text',
            text: { body: msg },
        }, {
            headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.warn('Seller notification failed:', error.message);
    }
}

/**
 * Send payment confirmation to buyer via WhatsApp
 */
async function notifyBuyerPaymentConfirmed(buyerPhone, orderId, amount) {
    const url = `${WHATSAPP_API_ENDPOINT}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const msg = `✅ *पेमेंट कन्फ़र्म!*\n\nOrder: *${orderId}*\nराशि: *₹${amount}*\n\n🎉 आपका भुगतान सफलतापूर्वक वेरिफाई हो गया है!\nसेलर आपका ऑर्डर पैक कर रहे हैं। जल्द ही डिलीवरी होगी।`;

    try {
        await axios.post(url, {
            messaging_product: 'whatsapp',
            to: buyerPhone,
            type: 'text',
            text: { body: msg },
        }, {
            headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        });
        console.log('Buyer payment confirmation sent to', buyerPhone);
    } catch (error) {
        console.warn('Buyer payment notification failed:', error.message);
    }
}

exports.handler = async (event) => {
    console.log('VerifyPayment Lambda invoked', JSON.stringify(event));

    if (event.httpMethod === 'OPTIONS' || event.requestContext?.http?.method === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ message: 'OK' }) };
    }

    try {
        const orderId = event.pathParameters?.orderId;
        if (!orderId) {
            return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'orderId is required' }) };
        }

        // Fetch order from DynamoDB
        const orderResult = await docClient.send(new GetCommand({
            TableName: VYAPAR_VAANI_TABLE,
            Key: { PK: `ORDER#${orderId}`, SK: 'METADATA' },
        }));

        const order = orderResult.Item;
        if (!order) {
            return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ success: false, error: 'Order not found' }) };
        }

        const body = JSON.parse(event.body || '{}');
        const { verificationType, transactionRef, screenshotBase64 } = body;

        let verificationResult = {};
        let verifiedBy = 'MANUAL_REF';
        let newPaymentStatus = 'PENDING_VERIFICATION';

        if (verificationType === 'screenshot' && screenshotBase64) {
            // AI Screenshot verification
            const s3Key = `payment-screenshots/${orderId}-${Date.now()}.png`;

            // Upload screenshot to S3
            await s3Client.send(new PutObjectCommand({
                Bucket: PRODUCTS_BUCKET,
                Key: s3Key,
                Body: Buffer.from(screenshotBase64, 'base64'),
                ContentType: 'image/png',
            }));

            // Analyze with Bedrock
            verificationResult = await analyzePaymentScreenshot(
                screenshotBase64,
                order.payment?.amount,
                order.payment?.upiId
            );

            verifiedBy = 'SCREENSHOT_AI';

            if (verificationResult.isPaymentSuccessful && verificationResult.confidence !== 'low') {
                newPaymentStatus = verificationResult.amountMatches ? 'PAID' : 'PENDING_VERIFICATION';
            }

            // Update order with screenshot verification + top-level status
            const updateExpr = newPaymentStatus === 'PAID'
                ? 'SET payment.#ps = :payStatus, payment.verifiedBy = :vby, payment.screenshotS3Key = :skey, payment.upiTransactionRef = :ref, payment.paidAt = :paidAt, payment.aiVerification = :aiResult, #os = :orderStatus, #timeline = list_append(if_not_exists(#timeline, :emptyList), :event), updatedAt = :now'
                : 'SET payment.#ps = :payStatus, payment.verifiedBy = :vby, payment.screenshotS3Key = :skey, payment.upiTransactionRef = :ref, payment.paidAt = :paidAt, payment.aiVerification = :aiResult, updatedAt = :now';
            
            const exprNames = newPaymentStatus === 'PAID'
                ? { '#ps': 'status', '#os': 'status', '#timeline': 'timeline' }
                : { '#ps': 'status' };
            
            const exprValues = {
                ':payStatus': newPaymentStatus,
                ':vby': verifiedBy,
                ':skey': s3Key,
                ':ref': verificationResult.transactionRef || null,
                ':paidAt': newPaymentStatus === 'PAID' ? Date.now() : null,
                ':aiResult': verificationResult,
                ':now': Date.now(),
            };
            
            if (newPaymentStatus === 'PAID') {
                exprValues[':orderStatus'] = 'PAYMENT_CONFIRMED';
                exprValues[':event'] = [{ status: 'PAYMENT_CONFIRMED', timestamp: Date.now(), actor: 'SYSTEM', notes: `UPI payment verified via ${verifiedBy}` }];
                exprValues[':emptyList'] = [];
            }

            await docClient.send(new UpdateCommand({
                TableName: VYAPAR_VAANI_TABLE,
                Key: { PK: `ORDER#${orderId}`, SK: 'METADATA' },
                UpdateExpression: updateExpr,
                ExpressionAttributeNames: exprNames,
                ExpressionAttributeValues: exprValues,
            }));

        } else if (verificationType === 'manual_ref' && transactionRef) {
            // Manual transaction reference — add timeline entry
            verifiedBy = 'MANUAL_REF';
            newPaymentStatus = 'PENDING_VERIFICATION';

            await docClient.send(new UpdateCommand({
                TableName: VYAPAR_VAANI_TABLE,
                Key: { PK: `ORDER#${orderId}`, SK: 'METADATA' },
                UpdateExpression: 'SET payment.#s = :payStatus, payment.verifiedBy = :vby, payment.upiTransactionRef = :ref, #timeline = list_append(if_not_exists(#timeline, :emptyList), :event), updatedAt = :now',
                ExpressionAttributeNames: { '#s': 'status', '#timeline': 'timeline' },
                ExpressionAttributeValues: {
                    ':payStatus': newPaymentStatus,
                    ':vby': verifiedBy,
                    ':ref': transactionRef,
                    ':now': Date.now(),
                    ':event': [{ status: 'PAYMENT_REF_SUBMITTED', timestamp: Date.now(), actor: 'BUYER', notes: `Transaction ref: ${transactionRef}` }],
                    ':emptyList': [],
                },
            }));

            verificationResult = { transactionRef, method: 'manual' };

        } else {
            return {
                statusCode: 400, headers: CORS_HEADERS,
                body: JSON.stringify({ success: false, error: 'Must provide verificationType (screenshot or manual_ref) with corresponding data' }),
            };
        }

        // Notify seller about payment
        if (newPaymentStatus === 'PAID' || newPaymentStatus === 'PENDING_VERIFICATION') {
            await notifySellerPayment(order.sellerId, orderId, order.payment?.amount, verifiedBy);
        }

        // If payment is verified (PAID), also auto-confirm the order and notify buyer
        if (newPaymentStatus === 'PAID') {
            // Auto-confirm order status since payment is verified
            try {
                await docClient.send(new UpdateCommand({
                    TableName: VYAPAR_VAANI_TABLE,
                    Key: { PK: `ORDER#${orderId}`, SK: 'METADATA' },
                    UpdateExpression: 'SET #s = :status, #timeline = list_append(if_not_exists(#timeline, :emptyList), :event), updatedAt = :now',
                    ExpressionAttributeNames: { '#s': 'status', '#timeline': 'timeline' },
                    ExpressionAttributeValues: {
                        ':status': 'CONFIRMED',
                        ':event': [{ status: 'CONFIRMED', timestamp: Date.now(), actor: 'SYSTEM', notes: 'Auto-confirmed: Payment verified successfully' }],
                        ':emptyList': [],
                        ':now': Date.now(),
                    },
                }));
                console.log('Order auto-confirmed after payment verification:', orderId);
            } catch (confirmErr) {
                console.warn('Failed to auto-confirm order (non-critical):', confirmErr.message);
            }

            // Notify buyer their payment was confirmed
            const buyerPhone = order.buyer?.phone || order.fulfillment?.contact?.phone;
            if (buyerPhone) {
                await notifyBuyerPaymentConfirmed(buyerPhone, orderId, order.payment?.amount);
            }
        }

        return {
            statusCode: 200,
            headers: CORS_HEADERS,
            body: JSON.stringify({
                success: true,
                orderId,
                paymentStatus: newPaymentStatus,
                verifiedBy,
                verification: verificationResult,
                message: newPaymentStatus === 'PAID'
                    ? 'Payment verified successfully! Seller has been notified.'
                    : 'Payment reference submitted. Seller will verify and confirm.',
            }),
        };

    } catch (error) {
        console.error('Error verifying payment:', error);
        return {
            statusCode: 500, headers: CORS_HEADERS,
            body: JSON.stringify({ success: false, error: error.message }),
        };
    }
};
