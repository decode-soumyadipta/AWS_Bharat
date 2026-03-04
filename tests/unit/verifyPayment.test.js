/**
 * Unit tests for verifyPayment.js helper functions
 * Run: node tests/unit/verifyPayment.test.js
 */

// ── Inline the helpers (copy from verifyPayment.js) ──────────────────────────

function detectImageFormat(base64) {
    const head = base64.substring(0, 8);
    if (head.startsWith('/9j/')) return 'jpeg';
    if (head.startsWith('iVBOR')) return 'png';
    if (head.startsWith('R0lGO')) return 'gif';
    if (head.startsWith('UklGR')) return 'webp';
    const raw = Buffer.from(base64.substring(0, 4), 'base64');
    if (raw[0] === 0xFF && raw[1] === 0xD8) return 'jpeg';
    if (raw[0] === 0x89 && raw[1] === 0x50) return 'png';
    return 'jpeg';
}

function amountsMatch(extracted, expected) {
    if (extracted == null || expected == null) return false;
    const diff = Math.abs(extracted - expected);
    const tolerance = Math.max(expected * 0.02, 5);
    return diff <= tolerance;
}

function parseTransactionDate(dateStr) {
    if (!dateStr) return null;
    try {
        const d = new Date(dateStr);
        if (!isNaN(d)) return d;
        const normalized = dateStr.replace(/(\d{2})[\/\-](\d{2})[\/\-](\d{2,4})/, (_, d, m, y) => {
            const year = y.length === 2 ? `20${y}` : y;
            return `${year}-${m}-${d}`;
        });
        const d2 = new Date(normalized);
        return isNaN(d2) ? null : d2;
    } catch { return null; }
}

function validateTransactionDate(dateStr) {
    const txDate = parseTransactionDate(dateStr);
    if (!txDate) return { valid: null, hoursAgo: null, display: dateStr || 'unknown' };
    const hoursAgo = (Date.now() - txDate.getTime()) / 36e5;
    return {
        valid: hoursAgo <= 48 && hoursAgo >= -1,
        hoursAgo: Math.round(hoursAgo * 10) / 10,
        display: txDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    };
}

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
    if (aiResult.notAPaymentScreenshot || aiResult.transactionStatus === 'unclear' && aiResult.confidence === 'low') {
        return { passed: false, paymentStatus: 'VERIFICATION_FAILED', canRetry: true, failureCode: 'not_payment_screenshot', details };
    }
    if (aiResult.confidence === 'low') {
        return { passed: false, paymentStatus: 'LOW_CONFIDENCE', canRetry: true, failureCode: 'low_confidence', details };
    }
    // Transaction pending (check before failed — pending is not yet failed)
    if (aiResult.transactionStatus === 'pending') {
        return { passed: false, paymentStatus: 'VERIFICATION_FAILED', canRetry: true, failureCode: 'transaction_pending', details };
    }
    // Transaction itself failed
    if (!aiResult.isSuccessfulPayment || aiResult.transactionStatus === 'failed') {
        return { passed: false, paymentStatus: 'VERIFICATION_FAILED', canRetry: true, failureCode: 'transaction_failed', details };
    }
    const dateCheck = validateTransactionDate(aiResult.dateTimeRaw);
    if (dateCheck.valid === false) {
        return { passed: false, paymentStatus: 'VERIFICATION_FAILED', canRetry: false, failureCode: 'old_screenshot', details: { ...details, hoursAgo: dateCheck.hoursAgo } };
    }
    if (!amountsMatch(aiResult.amount, expectedAmount)) {
        return { passed: false, paymentStatus: 'VERIFICATION_FAILED', canRetry: true, failureCode: 'amount_mismatch', details: { ...details, expectedAmount } };
    }
    return { passed: true, paymentStatus: 'PAID', canRetry: false, failureCode: null, details };
}

// ── Test runner ───────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ ${name}`);
        pass++;
    } catch (e) {
        console.log(`  ❌ ${name}: ${e.message}`);
        fail++;
    }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b) { assert(a === b, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

// ── detectImageFormat ─────────────────────────────────────────────────────────
console.log('\n🔍 detectImageFormat');
test('JPEG base64 prefix /9j/ → jpeg', () => eq(detectImageFormat('/9j/4AAQSkZJRgAB'), 'jpeg'));
test('PNG base64 prefix iVBOR → png', () => eq(detectImageFormat('iVBORw0KGgoAAAANSUhEUgAA'), 'png'));
test('GIF base64 R0lGO → gif', () => eq(detectImageFormat('R0lGODlhAQABAIAA'), 'gif'));
test('WEBP base64 UklGR → webp', () => eq(detectImageFormat('UklGRlYAAABXRUJQ'), 'webp'));
test('Unknown defaults to jpeg', () => eq(detectImageFormat('AAAA'), 'jpeg'));

// ── amountsMatch ──────────────────────────────────────────────────────────────
console.log('\n💰 amountsMatch');
test('Exact match ₹500 = ₹500', () => assert(amountsMatch(500, 500)));
test('Within 2% ₹499 ≈ ₹500', () => assert(amountsMatch(499, 500)));
test('₹495 ≈ ₹500 (within ₹10 tolerance)', () => assert(amountsMatch(495, 500)));
test('₹490 ≈ ₹500 (exactly at ₹10 boundary... 500*.02=10, diff=10)', () => assert(amountsMatch(490, 500)));
test('₹489 ≠ ₹500 (diff 11 > max(10, 10))', () => assert(!amountsMatch(489, 500)));
test('₹600 ≠ ₹500', () => assert(!amountsMatch(600, 500)));
test('Null extracted → false', () => assert(!amountsMatch(null, 500)));
test('Null expected → false', () => assert(!amountsMatch(500, null)));
test('Large amounts: ₹4990 ≈ ₹5000 (within 2%)', () => assert(amountsMatch(4990, 5000)));
test('₹4899 ≠ ₹5000 (diff 101 > 100)', () => assert(!amountsMatch(4899, 5000)));

// ── validateTransactionDate ───────────────────────────────────────────────────
console.log('\n📅 validateTransactionDate');
const now = new Date();
const recentDateStr = now.toISOString();
const oldDateStr = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(); // 3 days ago
test('Recent ISO date → valid', () => assert(validateTransactionDate(recentDateStr).valid === true));
test('Old date (3 days ago) → invalid', () => assert(validateTransactionDate(oldDateStr).valid === false));
test('Null date → valid = null', () => assert(validateTransactionDate(null).valid === null));
test('Invalid string → valid = null', () => assert(validateTransactionDate('not-a-date').valid === null));
test('hoursAgo is a number for recent date', () => assert(typeof validateTransactionDate(recentDateStr).hoursAgo === 'number'));
test('3-day-old: hoursAgo ≈ 72', () => {
    const h = validateTransactionDate(oldDateStr).hoursAgo;
    assert(h > 71 && h < 73, `hoursAgo=${h} not near 72`);
});

// ── buildVerdict ──────────────────────────────────────────────────────────────
console.log('\n🏛️  buildVerdict');
const goodAI = {
    transactionStatus: 'success', isSuccessfulPayment: true,
    amount: 500, dateTimeRaw: new Date().toISOString(),
    transactionRef: 'UTR123456789012', confidence: 'high',
    notAPaymentScreenshot: false,
};

test('Good AI + correct amount → PAID', () => {
    const v = buildVerdict(goodAI, 500, null);
    eq(v.paymentStatus, 'PAID'); assert(v.passed === true);
});
test('Good AI + amount off by ₹2 → PAID (within tolerance)', () => {
    const v = buildVerdict({ ...goodAI, amount: 498 }, 500, null);
    eq(v.paymentStatus, 'PAID');
});
test('Good AI + amount off by ₹100 → amount_mismatch', () => {
    const v = buildVerdict({ ...goodAI, amount: 600 }, 500, null);
    eq(v.failureCode, 'amount_mismatch'); assert(v.canRetry === true);
});
test('Failed transaction → transaction_failed', () => {
    const v = buildVerdict({ ...goodAI, isSuccessfulPayment: false, transactionStatus: 'failed' }, 500, null);
    eq(v.failureCode, 'transaction_failed');
});
test('Pending transaction → transaction_pending', () => {
    const v = buildVerdict({ ...goodAI, transactionStatus: 'pending', isSuccessfulPayment: false }, 500, null);
    eq(v.failureCode, 'transaction_pending');
});
test('Low confidence → low_confidence, canRetry', () => {
    const v = buildVerdict({ ...goodAI, confidence: 'low' }, 500, null);
    eq(v.failureCode, 'low_confidence'); assert(v.canRetry === true);
});
test('Not a payment screenshot → not_payment_screenshot', () => {
    const v = buildVerdict({ ...goodAI, notAPaymentScreenshot: true }, 500, null);
    eq(v.failureCode, 'not_payment_screenshot');
});
test('Old screenshot (3 days ago) → old_screenshot, canRetry=false', () => {
    const oldDate = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    const v = buildVerdict({ ...goodAI, dateTimeRaw: oldDate }, 500, null);
    eq(v.failureCode, 'old_screenshot'); assert(v.canRetry === false);
});
test('Amount null → amount_mismatch', () => {
    const v = buildVerdict({ ...goodAI, amount: null }, 500, null);
    eq(v.failureCode, 'amount_mismatch');
});
test('details always attached to verdict', () => {
    const v = buildVerdict(goodAI, 500, null);
    assert(typeof v.details === 'object');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(45)}`);
console.log(`Results: ${pass} passed, ${fail} failed out of ${pass + fail} tests`);
if (fail > 0) process.exit(1);
