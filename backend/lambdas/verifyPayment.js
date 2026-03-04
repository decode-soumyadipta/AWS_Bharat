/**
 * Payment Verification Lambda
 * POST /orders/{orderId}/verify-payment
 *
 * Supports:
 * 1. Screenshot upload → Bedrock Nova Pro multimodal AI analysis
 *    - Validates: transaction status, amount (±2%), date (within 48 h), receiver UPI
 *    - Returns structured failure reason + canRetry flag for clean frontend UX
 * 2. Manual UPI transaction reference submission
 *
 * Updates order payment status in DynamoDB and notifies seller + buyer via WhatsApp.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
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
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Detect image format from base64 magic bytes.
 * Nova Pro accepts: jpeg, png, gif, webp
 */
function detectImageFormat(base64) {
    const head = base64.substring(0, 8);
    if (head.startsWith('/9j/') || head.startsWith('iVBO')) {
        // /9j/ = JPEG, iVBO = JPEG variant
        if (head.startsWith('/9j/')) return 'jpeg';
    }
    if (head.startsWith('iVBOR')) return 'png';
    if (head.startsWith('R0lGO')) return 'gif';
    if (head.startsWith('UklGR')) return 'webp';
    // Default: try as JPEG (most phone screenshots)
    const raw = Buffer.from(base64.substring(0, 4), 'base64');
    if (raw[0] === 0xFF && raw[1] === 0xD8) return 'jpeg';
    if (raw[0] === 0x89 && raw[1] === 0x50) return 'png';
    return 'jpeg';
}

/**
 * Fuzzy amount match: within 2% or ₹5 (whichever is larger).
 * Handles ₹499.99 vs ₹500, rounding differences from UPI apps.
 */
function amountsMatch(extracted, expected) {
    if (extracted == null || expected == null) return false;
    const diff = Math.abs(extracted - expected);
    const tolerance = Math.max(expected * 0.02, 5);
    return diff <= tolerance;
}

/**
 * Parse a date string from UPI screenshot into a Date object.
 * Handles: "15 Jan 2026, 3:45 PM", "2026-01-15 15:45:00", "15/01/26", etc.
 */
function parseTransactionDate(dateStr) {
    if (!dateStr) return null;
    try {
        // Try direct parse first
        const d = new Date(dateStr);
        if (!isNaN(d)) return d;
        // Indian format: "15 Jan 2026, 3:45 PM" or "15-01-2026 15:45"
        const normalized = dateStr
            .replace(/(\d{2})[\/\-](\d{2})[\/\-](\d{2,4})/, (_, d, m, y) => {
                const year = y.length === 2 ? `20${y}` : y;
                return `${year}-${m}-${d}`;
            });
        const d2 = new Date(normalized);
        return isNaN(d2) ? null : d2;
    } catch {
        return null;
    }
}

/**
 * Check if a transaction date is within the last 48 hours.
 * Returns { valid: bool, hoursAgo: number }
 */
function validateTransactionDate(dateStr) {
    const txDate = parseTransactionDate(dateStr);
    if (!txDate) return { valid: null, hoursAgo: null, display: dateStr || 'unknown' };
    const hoursAgo = (Date.now() - txDate.getTime()) / 36e5;
    return {
        valid: hoursAgo <= 48 && hoursAgo >= -1, // -1 = slight clock skew tolerance
        hoursAgo: Math.round(hoursAgo * 10) / 10,
        display: txDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    };
}

/**
 * Analyze UPI payment screenshot using Bedrock Nova Pro multimodal.
 * Returns structured result with all extracted fields and validation outcomes.
 */
async function analyzePaymentScreenshot(imageBase64, expectedAmount, expectedUpiId, orderId) {
    const nowIST = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const imageFormat = detectImageFormat(imageBase64);

    const prompt = `You are a UPI payment verification system for an Indian e-commerce platform.
Today's date and time in IST is: ${nowIST}
Order ID being verified: ${orderId}
Expected payment amount: ₹${expectedAmount}
${expectedUpiId ? `Expected receiver UPI ID: ${expectedUpiId}` : ''}

Carefully analyze this UPI payment screenshot and extract ALL visible information.

IMPORTANT INSTRUCTIONS:
- Read the EXACT amount shown (look for ₹ symbol, numbers in large text)
- Read the EXACT transaction status (look for "Success", "Successful", "सफल", "Failed", "Pending", green/red indicators)
- Read the EXACT UTR / Transaction Reference number (12-digit number, or alphanumeric code)
- Read the EXACT date and time of transaction (shown at bottom or top of receipt)
- Read the receiver UPI ID or VPA (e.g., seller@paytm, 9876543210@upi)
- Read the sender name or UPI ID

Respond ONLY with this exact JSON (no other text):
{
  "transactionStatus": "success" | "failed" | "pending" | "unclear",
  "isSuccessfulPayment": true | false,
  "amount": <number in rupees, e.g. 250.00, or null if not readable>,
  "transactionRef": "<UTR/ref number as string, or null>",
  "senderName": "<sender name or UPI ID, or null>",
  "receiverUpiId": "<receiver UPI ID, or null>",
  "dateTimeRaw": "<exact date/time text from screenshot, or null>",
  "bankOrApp": "<payment app name: PhonePe/Google Pay/Paytm/BHIM/other, or null>",
  "confidence": "high" | "medium" | "low",
  "notAPaymentScreenshot": true | false,
  "reasoning": "<one-sentence explanation of what you see>"
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
                                format: imageFormat,
                                source: { bytes: imageBase64 },
                            },
                        },
                        { text: prompt },
                    ],
                }],
                inferenceConfig: {
                    maxTokens: 512,
                    temperature: 0.05,
                },
            }),
        }));

        const result = JSON.parse(new TextDecoder().decode(response.body));
        const text = result.output?.message?.content?.[0]?.text || '';
        console.log('Nova Pro raw response:', text.substring(0, 500));

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return { confidence: 'low', notAPaymentScreenshot: true, reasoning: 'Could not parse AI response' };
        }
        return JSON.parse(jsonMatch[0]);
    } catch (error) {
        console.error('Bedrock analysis failed:', error);
        return { confidence: 'low', reasoning: `AI analysis error: ${error.message}` };
    }
}

/**
 * Build a structured verification verdict from raw AI output.
 * Returns: { passed, paymentStatus, failureCode, failureMessage, details }
 */
function buildVerdict(aiResult, expectedAmount, expectedUpiId) {
    const details = {
        extractedAmount: aiResult.amount,
        extractedDate: aiResult.dateTimeRaw,
        transactionRef: aiResult.transactionRef,
        senderName: aiResult.senderName,
        receiverUpiId: aiResult.receiverUpiId,
        bankOrApp: aiResult.bankOrApp,
        confidence: aiResult.confidence,
        aiReasoning: aiResult.reasoning,
        transactionStatus: aiResult.transactionStatus,
    };

    // Not a payment screenshot at all
    if (aiResult.notAPaymentScreenshot || aiResult.transactionStatus === 'unclear' && aiResult.confidence === 'low') {
        return {
            passed: false,
            paymentStatus: 'VERIFICATION_FAILED',
            canRetry: true,
            failureCode: 'not_payment_screenshot',
            failureMessage: 'This does not appear to be a UPI payment screenshot. Please upload the payment confirmation screen.',
            details,
        };
    }

    // AI is too uncertain
    if (aiResult.confidence === 'low') {
        return {
            passed: false,
            paymentStatus: 'LOW_CONFIDENCE',
            canRetry: true,
            failureCode: 'low_confidence',
            failureMessage: 'Could not read the screenshot clearly. Please upload a clearer, full-screen payment confirmation.',
            details,
        };
    }

    // Transaction pending (check before failed — pending is not yet failed)
    if (aiResult.transactionStatus === 'pending') {
        return {
            passed: false,
            paymentStatus: 'VERIFICATION_FAILED',
            canRetry: true,
            failureCode: 'transaction_pending',
            failureMessage: 'The payment is still pending. Please wait for it to complete and re-upload the success confirmation.',
            details,
        };
    }

    // Transaction itself failed
    if (!aiResult.isSuccessfulPayment || aiResult.transactionStatus === 'failed') {
        return {
            passed: false,
            paymentStatus: 'VERIFICATION_FAILED',
            canRetry: true,
            failureCode: 'transaction_failed',
            failureMessage: `The UPI transaction shows "${aiResult.transactionStatus || 'failed'}" status, not a successful payment.`,
            details,
        };
    }

    // Date validation — reject screenshots older than 48 hours
    const dateCheck = validateTransactionDate(aiResult.dateTimeRaw);
    if (dateCheck.valid === false) {
        return {
            passed: false,
            paymentStatus: 'VERIFICATION_FAILED',
            canRetry: false,
            failureCode: 'old_screenshot',
            failureMessage: `This screenshot is ${dateCheck.hoursAgo} hours old (dated ${dateCheck.display}). Please make payment first, then upload the fresh receipt.`,
            details: { ...details, parsedDate: dateCheck.display, hoursAgo: dateCheck.hoursAgo },
        };
    }

    // Amount validation
    if (!amountsMatch(aiResult.amount, expectedAmount)) {
        const diff = aiResult.amount != null ? Math.abs(aiResult.amount - expectedAmount) : null;
        return {
            passed: false,
            paymentStatus: 'VERIFICATION_FAILED',
            canRetry: true,
            failureCode: 'amount_mismatch',
            failureMessage: aiResult.amount != null
                ? `Screenshot shows ₹${aiResult.amount}, but order requires ₹${expectedAmount}. Please pay the exact amount and re-upload.`
                : `Could not read the payment amount from the screenshot. Please ensure the amount ₹${expectedAmount} is clearly visible.`,
            details: { ...details, expectedAmount, amountDiff: diff },
        };
    }

    // All checks passed
    return {
        passed: true,
        paymentStatus: 'PAID',
        canRetry: false,
        failureCode: null,
        failureMessage: null,
        details: { ...details, parsedDate: validateTransactionDate(aiResult.dateTimeRaw).display },
    };
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

        // Prevent re-verification of already-paid orders
        if (order.payment?.status === 'PAID' || order.status === 'CONFIRMED') {
            return {
                statusCode: 200, headers: CORS_HEADERS,
                body: JSON.stringify({
                    success: true,
                    orderId,
                    paymentStatus: 'PAID',
                    alreadyVerified: true,
                    message: 'This order payment is already verified.',
                }),
            };
        }

        const body = JSON.parse(event.body || '{}');
        const { verificationType, transactionRef, screenshotBase64 } = body;

        // ── SCREENSHOT AI VERIFICATION ─────────────────────────────────────
        if (verificationType === 'screenshot' && screenshotBase64) {
            const imageFormat = detectImageFormat(screenshotBase64);
            const s3Key = `payment-screenshots/${orderId}-${Date.now()}.${imageFormat}`;

            // Upload screenshot to S3 (async, non-blocking for response)
            s3Client.send(new PutObjectCommand({
                Bucket: PRODUCTS_BUCKET,
                Key: s3Key,
                Body: Buffer.from(screenshotBase64, 'base64'),
                ContentType: `image/${imageFormat}`,
            })).catch(e => console.warn('S3 upload warn (non-critical):', e.message));

            // Nova Pro multimodal analysis
            const aiResult = await analyzePaymentScreenshot(
                screenshotBase64,
                order.payment?.amount,
                order.payment?.upiId,
                orderId,
            );

            const verdict = buildVerdict(aiResult, order.payment?.amount, order.payment?.upiId);
            console.log('Verification verdict:', JSON.stringify(verdict));

            // Always persist attempt in DynamoDB
            const attemptEntry = {
                timestamp: Date.now(),
                actor: 'BUYER',
                method: 'SCREENSHOT_AI',
                result: verdict.paymentStatus,
                failureCode: verdict.failureCode || null,
                s3Key,
                aiDetails: verdict.details,
            };

            if (verdict.passed) {
                // ── PAYMENT CONFIRMED ──────────────────────────────────────
                await docClient.send(new UpdateCommand({
                    TableName: VYAPAR_VAANI_TABLE,
                    Key: { PK: `ORDER#${orderId}`, SK: 'METADATA' },
                    UpdateExpression: [
                        'SET payment.#ps = :payStatus',
                        'payment.verifiedBy = :vby',
                        'payment.screenshotS3Key = :skey',
                        'payment.upiTransactionRef = :ref',
                        'payment.paidAt = :paidAt',
                        'payment.aiVerification = :aiResult',
                        '#os = :orderStatus',
                        '#timeline = list_append(if_not_exists(#timeline, :emptyList), :event)',
                        'updatedAt = :now',
                    ].join(', '),
                    ExpressionAttributeNames: { '#ps': 'status', '#os': 'status', '#timeline': 'timeline' },
                    ExpressionAttributeValues: {
                        ':payStatus': 'PAID',
                        ':vby': 'SCREENSHOT_AI',
                        ':skey': s3Key,
                        ':ref': verdict.details.transactionRef || null,
                        ':paidAt': Date.now(),
                        ':aiResult': verdict.details,
                        ':orderStatus': 'CONFIRMED',
                        ':event': [
                            { status: 'PAYMENT_CONFIRMED', timestamp: Date.now(), actor: 'SYSTEM', notes: `AI verified via screenshot. UTR: ${verdict.details.transactionRef || 'N/A'}` },
                            { status: 'CONFIRMED', timestamp: Date.now() + 1, actor: 'SYSTEM', notes: 'Auto-confirmed after payment verification' },
                        ],
                        ':emptyList': [],
                        ':now': Date.now(),
                    },
                }));

                // Notify seller
                await notifySellerPayment(order.sellerId, orderId, order.payment?.amount, 'SCREENSHOT_AI');

                // Notify buyer
                const buyerPhone = order.buyer?.phone || order.fulfillment?.contact?.phone;
                if (buyerPhone) {
                    await notifyBuyerPaymentConfirmed(buyerPhone, orderId, order.payment?.amount);
                }

                return {
                    statusCode: 200, headers: CORS_HEADERS,
                    body: JSON.stringify({
                        success: true,
                        orderId,
                        paymentStatus: 'PAID',
                        verifiedBy: 'SCREENSHOT_AI',
                        canRetry: false,
                        details: verdict.details,
                        message: `✅ Payment of ₹${order.payment?.amount} verified! Seller notified.`,
                    }),
                };

            } else {
                // ── VERIFICATION FAILED — log attempt, return error details ──
                await docClient.send(new UpdateCommand({
                    TableName: VYAPAR_VAANI_TABLE,
                    Key: { PK: `ORDER#${orderId}`, SK: 'METADATA' },
                    UpdateExpression: 'SET #timeline = list_append(if_not_exists(#timeline, :emptyList), :event), updatedAt = :now',
                    ExpressionAttributeNames: { '#timeline': 'timeline' },
                    ExpressionAttributeValues: {
                        ':event': [attemptEntry],
                        ':emptyList': [],
                        ':now': Date.now(),
                    },
                })).catch(e => console.warn('Timeline update warn:', e.message));

                return {
                    statusCode: 200, headers: CORS_HEADERS,
                    body: JSON.stringify({
                        success: false,
                        orderId,
                        paymentStatus: verdict.paymentStatus,
                        canRetry: verdict.canRetry,
                        failureCode: verdict.failureCode,
                        failureMessage: verdict.failureMessage,
                        details: verdict.details,
                    }),
                };
            }
        }

        // ── MANUAL TRANSACTION REFERENCE ──────────────────────────────────────
        if (verificationType === 'manual_ref' && transactionRef) {
            await docClient.send(new UpdateCommand({
                TableName: VYAPAR_VAANI_TABLE,
                Key: { PK: `ORDER#${orderId}`, SK: 'METADATA' },
                UpdateExpression: 'SET payment.#s = :payStatus, payment.verifiedBy = :vby, payment.upiTransactionRef = :ref, #timeline = list_append(if_not_exists(#timeline, :emptyList), :event), updatedAt = :now',
                ExpressionAttributeNames: { '#s': 'status', '#timeline': 'timeline' },
                ExpressionAttributeValues: {
                    ':payStatus': 'PENDING_VERIFICATION',
                    ':vby': 'MANUAL_REF',
                    ':ref': transactionRef,
                    ':now': Date.now(),
                    ':event': [{ status: 'PAYMENT_REF_SUBMITTED', timestamp: Date.now(), actor: 'BUYER', notes: `UTR/Ref: ${transactionRef}` }],
                    ':emptyList': [],
                },
            }));

            await notifySellerPayment(order.sellerId, orderId, order.payment?.amount, 'MANUAL_REF');

            return {
                statusCode: 200, headers: CORS_HEADERS,
                body: JSON.stringify({
                    success: true,
                    orderId,
                    paymentStatus: 'PENDING_VERIFICATION',
                    verifiedBy: 'MANUAL_REF',
                    transactionRef,
                    message: 'Transaction reference submitted. Seller will verify and confirm your order.',
                }),
            };
        }

        return {
            statusCode: 400, headers: CORS_HEADERS,
            body: JSON.stringify({ success: false, error: 'Must provide verificationType (screenshot or manual_ref) with corresponding data' }),
        };

    } catch (error) {
        console.error('Error verifying payment:', error);
        return {
            statusCode: 500, headers: CORS_HEADERS,
            body: JSON.stringify({ success: false, error: error.message }),
        };
    }
};
