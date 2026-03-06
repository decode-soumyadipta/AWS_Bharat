/**
 * Payment Verification Lambda
 * POST /orders/{orderId}/verify-payment
 *
 * Supports:
 * 1. Screenshot upload → Two-stage Bedrock Nova Pro multimodal verification:
 *    Stage 1 – EXTRACT:  Pure OCR extraction of all fields (no judgement)
 *    Stage 2 – CONFIRM:  Binary YES/NO confirmation with dynamic expected-value prompt
 *    Backend validates:  amount (±2%), date (within 48 h), status
 *    Returns structured failure reason + canRetry flag for clean frontend UX
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

/** English month name → 0-based index map used by date parser */
const MONTH_MAP = {
    jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
    jul:6, aug:7, sep:8, oct:9, nov:10, dec:11,
};

/**
 * Parse a date string from a UPI screenshot into a JS Date.
 * Covers every format seen in Indian UPI apps:
 *   "30 Jul 2024, 12:32 pm"    ← Google Pay
 *   "15 Jan 2026, 3:45 PM"
 *   "2026-01-15T15:45:00"      ← ISO
 *   "15-01-2026 15:45"         ← BHIM / SBI
 *   "15/01/26"                 ← short date only
 *   "Jan 30, 2024 at 12:32 PM" ← some apps
 */
function parseTransactionDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const s = dateStr.trim();
    try {
        // ── 1. "30 Jul 2024, 12:32 pm"  or  "15 Jan 2026, 3:45 PM" ─────────
        const m1 = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
        if (m1) {
            const [, d, mon, y, h, min, , ampm] = m1;
            const month = MONTH_MAP[mon.toLowerCase()];
            if (month !== undefined) {
                let hour = parseInt(h, 10);
                if (ampm?.toLowerCase() === 'pm' && hour < 12) hour += 12;
                if (ampm?.toLowerCase() === 'am' && hour === 12) hour = 0;
                return new Date(parseInt(y, 10), month, parseInt(d, 10), hour, parseInt(min, 10));
            }
        }

        // ── 2. "Jan 30, 2024 at 12:32 PM" ────────────────────────────────────
        const m2 = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
        if (m2) {
            const [, mon, d, y, h, min, ampm] = m2;
            const month = MONTH_MAP[mon.toLowerCase()];
            if (month !== undefined) {
                let hour = parseInt(h, 10);
                if (ampm?.toLowerCase() === 'pm' && hour < 12) hour += 12;
                if (ampm?.toLowerCase() === 'am' && hour === 12) hour = 0;
                return new Date(parseInt(y, 10), month, parseInt(d, 10), hour, parseInt(min, 10));
            }
        }

        // ── 3. ISO / "15-01-2026 15:45" / "15/01/26" ─────────────────────────
        //    Normalise DD/MM/YY(YY) → YYYY-MM-DD then let Date() parse
        const normalised = s.replace(
            /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
            (_, d, m, y) => `${y.length === 2 ? '20' + y : y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
        );
        const d3 = new Date(normalised);
        if (!isNaN(d3.getTime())) return d3;

        // ── 4. Raw Date() last-resort (handles ISO 8601 variants) ──────────────
        const d4 = new Date(s);
        if (!isNaN(d4.getTime())) return d4;

        return null;
    } catch {
        return null;
    }
}

/**
 * Check if a transaction date is within the last 48 hours.
 * CRITICAL: if date is unparseable (valid: null) we REJECT — never let through.
 * Returns { valid: true|false|null, hoursAgo: number|null, display: string }
 */
function validateTransactionDate(dateStr) {
    const txDate = parseTransactionDate(dateStr);
    if (!txDate) {
        // Cannot parse → treat as INVALID (fail safe, not fail open)
        return { valid: false, hoursAgo: null, display: dateStr || 'unknown', unparseable: true };
    }
    const hoursAgo = (Date.now() - txDate.getTime()) / 3.6e6;
    return {
        valid: hoursAgo <= 48 && hoursAgo >= -1, // -1 handles minor clock skew
        hoursAgo: Math.round(hoursAgo * 10) / 10,
        display: txDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// TWO-STAGE NOVA PRO VERIFICATION
//
//  Stage 1 – EXTRACT:  Pure OCR – model reads all visible text, no judgement.
//  Stage 2 – CONFIRM:  Dynamic binary YES/NO per-order question – model
//                       answers "valid?" with the expected values embedded.
//  Backend runs independent strict checks between and after stages.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * STAGE 1: Ask Nova Pro to extract raw fields from the screenshot like an OCR engine.
 * No validation logic – pure field extraction.
 */
async function extractPaymentData(imageBase64, imageFormat) {
    const extractionPrompt = `You are an OCR system for UPI payment receipts.
Read ALL visible text from this screenshot and return it as structured JSON.
Do NOT make any judgements — only extract exactly what you see.

Return ONLY this JSON (no other text):
{
  "amount": <numeric rupee amount as a number, e.g. 250, or null>,
  "status": "<exact status text shown, e.g. 'Completed', 'Successful', 'सफल', 'Failed', 'Pending', or null>",
  "dateTimeRaw": "<complete date and time text exactly as shown, e.g. '30 Jul 2024, 12:32 pm', or null>",
  "upiTransactionId": "<UTR or UPI transaction ID number/string, or null>",
  "googleTransactionId": "<Google Pay / other app transaction ID if shown, or null>",
  "senderName": "<sender full name as shown, or null>",
  "senderUpiId": "<sender's UPI address e.g. name@okicici, or null>",
  "receiverName": "<receiver full name, or null>",
  "receiverUpiId": "<receiver's UPI address, or null>",
  "paymentApp": "<app name: 'Google Pay' | 'PhonePe' | 'Paytm' | 'BHIM' | 'Amazon Pay' | 'other' | null>",
  "notAPaymentScreenshot": <true if this is clearly NOT a payment receipt, false otherwise>
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
                        { image: { format: imageFormat, source: { bytes: imageBase64 } } },
                        { text: extractionPrompt },
                    ],
                }],
                inferenceConfig: { maxTokens: 400, temperature: 0.0 },
            }),
        }));
        const result = JSON.parse(new TextDecoder().decode(response.body));
        const text = result.output?.message?.content?.[0]?.text || '';
        console.log('Stage 1 extraction raw:', text.substring(0, 600));
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return { notAPaymentScreenshot: true, _parseError: true };
        return JSON.parse(jsonMatch[0]);
    } catch (err) {
        console.error('Stage 1 extraction failed:', err.message);
        return { notAPaymentScreenshot: false, _extractError: err.message };
    }
}

/**
 * STAGE 2: Ask Nova Pro a focused binary question after backend pre-validation passes.
 * The prompt is fully dynamic — it embeds the expected order values.
 * Returns { valid: boolean, confidence: 'high'|'medium'|'low', reason: string }
 */
async function confirmPaymentBinary(extracted, imageBase64, imageFormat, expectedAmount, expectedUpiId, orderId) {
    const nowIST = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    // Build a concise summary of what was extracted (Stage 1 result)
    const extractedSummary = [
        extracted.amount != null   ? `Amount: ₹${extracted.amount}`             : 'Amount: not readable',
        extracted.dateTimeRaw      ? `Date/time: ${extracted.dateTimeRaw}`       : 'Date: not visible',
        extracted.status           ? `Status: ${extracted.status}`               : 'Status: not visible',
        extracted.receiverUpiId    ? `Receiver UPI: ${extracted.receiverUpiId}`  : '',
        extracted.senderName       ? `Sender: ${extracted.senderName}`           : '',
        extracted.upiTransactionId ? `UTR/Txn ID: ${extracted.upiTransactionId}` : '',
    ].filter(Boolean).join('\n');

    const confirmationPrompt = `You are a payment fraud-detection system.
Current date and time (IST): ${nowIST}

The following fields were OCR-extracted from a UPI payment screenshot:
${extractedSummary}

This screenshot is being submitted as proof of payment for:
  Order ID : ${orderId}
  Expected amount : ₹${expectedAmount}
  ${expectedUpiId ? `Expected receiver UPI : ${expectedUpiId}` : ''}

Look at the screenshot carefully and answer:
1. Does the screenshot show a COMPLETED / SUCCESSFUL transaction? (not pending, not failed)
2. Is the amount ₹${expectedAmount} (within ₹5 or 2% tolerance)?
3. Is the transaction date RECENT — i.e., within the last 48 hours of today (${nowIST})?
${expectedUpiId ? `4. Is the receiver UPI ID "${expectedUpiId}" or very similar?` : ''}

If ALL of the above are YES → answer valid: true.
If ANY one is NO → answer valid: false.

Return ONLY this JSON (no other text):
{
  "valid": true | false,
  "confidence": "high" | "medium" | "low",
  "statusOk": true | false,
  "amountOk": true | false,
  "dateOk": true | false,
  ${expectedUpiId ? '"receiverOk": true | false,' : ''}
  "reason": "<one-sentence plain-language explanation>"
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
                        { image: { format: imageFormat, source: { bytes: imageBase64 } } },
                        { text: confirmationPrompt },
                    ],
                }],
                inferenceConfig: { maxTokens: 256, temperature: 0.0 },
            }),
        }));
        const result = JSON.parse(new TextDecoder().decode(response.body));
        const text = result.output?.message?.content?.[0]?.text || '';
        console.log('Stage 2 binary confirmation raw:', text.substring(0, 400));
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return { valid: false, confidence: 'low', reason: 'Could not parse binary confirmation response' };
        return JSON.parse(jsonMatch[0]);
    } catch (err) {
        console.error('Stage 2 confirmation failed:', err.message);
        return { valid: false, confidence: 'low', reason: `Confirmation error: ${err.message}` };
    }
}

/**
 * ORCHESTRATOR: Run both stages and return a unified aiResult compatible with buildVerdict.
 */
async function analyzePaymentScreenshot(imageBase64, expectedAmount, expectedUpiId, orderId) {
    const imageFormat = detectImageFormat(imageBase64);

    // ── STAGE 1: Extract ──────────────────────────────────────────────────────
    const extracted = await extractPaymentData(imageBase64, imageFormat);
    console.log('Stage 1 extracted:', JSON.stringify(extracted));

    // Fast-fail: not a payment screenshot
    if (extracted.notAPaymentScreenshot) {
        return {
            notAPaymentScreenshot: true,
            confidence: 'high',
            reasoning: 'Image does not appear to be a UPI payment receipt.',
            ...extracted,
        };
    }

    // Normalise status to our internal vocabulary
    const rawStatus = (extracted.status || '').toLowerCase();
    let transactionStatus = 'unclear';
    if (/complet|success|सफल|successful/i.test(rawStatus)) transactionStatus = 'success';
    else if (/fail|fail/i.test(rawStatus)) transactionStatus = 'failed';
    else if (/pend/i.test(rawStatus)) transactionStatus = 'pending';

    // Derive confidence from how much was extracted
    const fieldsExtracted = [extracted.amount, extracted.dateTimeRaw, extracted.status].filter(Boolean).length;
    const confidence = fieldsExtracted >= 3 ? 'high' : fieldsExtracted === 2 ? 'medium' : 'low';

    // ── STAGE 2: Binary confirmation (only if enough data extracted) ──────────
    let binaryResult = { valid: null, confidence, reason: 'Skipped (insufficient extraction)' };
    if (confidence !== 'low' && transactionStatus !== 'unclear') {
        binaryResult = await confirmPaymentBinary(extracted, imageBase64, imageFormat, expectedAmount, expectedUpiId, orderId);
        console.log('Stage 2 binary result:', JSON.stringify(binaryResult));
    }

    // ── Combine into unified result ───────────────────────────────────────────
    return {
        // Core fields consumed by buildVerdict
        transactionStatus,
        isSuccessfulPayment: transactionStatus === 'success' && binaryResult.valid === true,
        amount: extracted.amount,
        dateTimeRaw: extracted.dateTimeRaw,
        transactionRef: extracted.upiTransactionId || extracted.googleTransactionId,
        senderName: extracted.senderName,
        receiverUpiId: extracted.receiverUpiId,
        bankOrApp: extracted.paymentApp,
        notAPaymentScreenshot: false,
        confidence: binaryResult.confidence || confidence,
        // Binary result
        binaryValid: binaryResult.valid,
        binaryStatusOk: binaryResult.statusOk,
        binaryAmountOk: binaryResult.amountOk,
        binaryDateOk: binaryResult.dateOk,
        binaryReceiverOk: binaryResult.receiverOk,
        reasoning: binaryResult.reason || extracted.status,
    };
}

/**
 * Build a structured verification verdict from raw AI output.
 * Uses both the extracted fields (Stage 1) and the binary confirmation (Stage 2).
 * Returns: { passed, paymentStatus, failureCode, failureMessage, canRetry, details }
 *
 * Check order:
 *  1. notAPaymentScreenshot
 *  2. low confidence (unreadable)
 *  3. transaction pending
 *  4. transaction failed
 *  5. date invalid (backend date math — primary gate against old screenshots)
 *  6. binary model says date not OK (secondary gate)
 *  7. amount mismatch (backend fuzzy math)
 *  8. binary says amount not OK (secondary gate)
 *  9. final binary valid === false (catch-all)
 * 10. PAID ✅
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
        binaryValid: aiResult.binaryValid ?? null,
        binaryStatusOk: aiResult.binaryStatusOk ?? null,
        binaryAmountOk: aiResult.binaryAmountOk ?? null,
        binaryDateOk: aiResult.binaryDateOk ?? null,
    };

    // ── 1. Not a payment screenshot ───────────────────────────────────────────
    if (aiResult.notAPaymentScreenshot) {
        return {
            passed: false,
            paymentStatus: 'VERIFICATION_FAILED',
            canRetry: true,
            failureCode: 'not_payment_screenshot',
            failureMessage: 'This does not appear to be a UPI payment screenshot. Please upload the payment confirmation screen.',
            details,
        };
    }

    // ── 2. Unreadable / low confidence ────────────────────────────────────────
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

    // ── 3. Transaction pending ─────────────────────────────────────────────────
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

    // ── 4. Transaction failed ─────────────────────────────────────────────────
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

    // ── 5. Backend date validation (PRIMARY gate — catches old screenshots) ────
    //      validateTransactionDate now returns valid:false for unparseable dates too
    const dateCheck = validateTransactionDate(aiResult.dateTimeRaw);
    if (dateCheck.valid === false) {
        const hoursMsg = dateCheck.hoursAgo != null
            ? `This screenshot is ${dateCheck.hoursAgo} hours old (dated ${dateCheck.display}).`
            : dateCheck.unparseable
                ? `The transaction date "${aiResult.dateTimeRaw || 'unknown'}" could not be verified.`
                : `Transaction date "${dateCheck.display}" is outside the allowed 48-hour window.`;
        return {
            passed: false,
            paymentStatus: 'VERIFICATION_FAILED',
            canRetry: false,
            failureCode: 'old_screenshot',
            failureMessage: `${hoursMsg} Please make the payment now and upload the fresh receipt.`,
            details: { ...details, parsedDate: dateCheck.display, hoursAgo: dateCheck.hoursAgo },
        };
    }

    // ── 6. Binary model says date not OK (secondary gate) ────────────────────
    if (aiResult.binaryDateOk === false) {
        return {
            passed: false,
            paymentStatus: 'VERIFICATION_FAILED',
            canRetry: false,
            failureCode: 'old_screenshot',
            failureMessage: `The AI confirmed this screenshot is not from today. Date shown: ${aiResult.dateTimeRaw || 'unknown'}. Please pay and upload today's receipt.`,
            details,
        };
    }

    // ── 7. Backend amount fuzzy-match ─────────────────────────────────────────
    if (!amountsMatch(aiResult.amount, expectedAmount)) {
        const diff = aiResult.amount != null ? Math.abs(aiResult.amount - expectedAmount) : null;
        return {
            passed: false,
            paymentStatus: 'VERIFICATION_FAILED',
            canRetry: true,
            failureCode: 'amount_mismatch',
            failureMessage: aiResult.amount != null
                ? `Screenshot shows ₹${aiResult.amount}, but order requires ₹${expectedAmount}. Please pay the exact amount and re-upload.`
                : `Could not read the payment amount from the screenshot. Please ensure ₹${expectedAmount} is clearly visible.`,
            details: { ...details, expectedAmount, amountDiff: diff },
        };
    }

    // ── 8. Binary model says amount not OK ────────────────────────────────────
    if (aiResult.binaryAmountOk === false) {
        return {
            passed: false,
            paymentStatus: 'VERIFICATION_FAILED',
            canRetry: true,
            failureCode: 'amount_mismatch',
            failureMessage: `The AI confirmed the screenshot amount does not match the required ₹${expectedAmount}. ${aiResult.reasoning || ''}`,
            details,
        };
    }

    // ── 9. Final binary catch-all ─────────────────────────────────────────────
    if (aiResult.binaryValid === false) {
        return {
            passed: false,
            paymentStatus: 'VERIFICATION_FAILED',
            canRetry: true,
            failureCode: 'verification_failed',
            failureMessage: `Payment could not be verified: ${aiResult.reasoning || 'screenshot does not match the expected payment.'}`,
            details,
        };
    }

    // ── 10. All checks passed → PAID ✅ ───────────────────────────────────────
    return {
        passed: true,
        paymentStatus: 'PAID',
        canRetry: false,
        failureCode: null,
        failureMessage: null,
        details: { ...details, parsedDate: dateCheck.display },
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
