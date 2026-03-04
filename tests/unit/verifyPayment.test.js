/**
 * Unit tests for verifyPayment.js helper functions (two-stage version)
 * Run: node tests/unit/verifyPayment.test.js
 *
 * Covers:
 *   detectImageFormat       – 5 tests
 *   amountsMatch            – 10 tests
 *   parseTransactionDate    – 10 tests  (all real UPI formats)
 *   validateTransactionDate – 8 tests   (null now returns valid:false = fail-safe)
 *   buildVerdict            – 12 tests  (includes binary confirmation fields)
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

const MONTH_MAP = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

function parseTransactionDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const s = dateStr.trim();
    try {
        // Format 1: "30 Jul 2024, 12:32 pm" / "15 Jan 2026, 3:45 PM"  (Google Pay)
        const m1 = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
        if (m1) {
            const [, d, mon, y, h, min, , ampm] = m1;
            const month = MONTH_MAP[mon.toLowerCase()];
            if (month !== undefined) {
                let hour = parseInt(h, 10);
                if (ampm && ampm.toLowerCase() === 'pm' && hour < 12) hour += 12;
                if (ampm && ampm.toLowerCase() === 'am' && hour === 12) hour = 0;
                return new Date(parseInt(y, 10), month, parseInt(d, 10), hour, parseInt(min, 10));
            }
        }
        // Format 2: "Jan 30, 2024 at 12:32 PM"
        const m2 = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
        if (m2) {
            const [, mon, d, y, h, min, ampm] = m2;
            const month = MONTH_MAP[mon.toLowerCase()];
            if (month !== undefined) {
                let hour = parseInt(h, 10);
                if (ampm && ampm.toLowerCase() === 'pm' && hour < 12) hour += 12;
                if (ampm && ampm.toLowerCase() === 'am' && hour === 12) hour = 0;
                return new Date(parseInt(y, 10), month, parseInt(d, 10), hour, parseInt(min, 10));
            }
        }
        // Format 3: DD/MM/YY(YY) → YYYY-MM-DD normalisation
        const normalised = s.replace(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
            (_, d, m, y) => `${y.length === 2 ? '20' + y : y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
        const d3 = new Date(normalised);
        if (!isNaN(d3.getTime())) return d3;
        // Format 4: ISO fallback
        const d4 = new Date(s);
        if (!isNaN(d4.getTime())) return d4;
        return null;
    } catch { return null; }
}

function validateTransactionDate(dateStr) {
    const txDate = parseTransactionDate(dateStr);
    if (!txDate) return { valid: false, hoursAgo: null, display: dateStr || 'unknown', unparseable: true };
    const hoursAgo = (Date.now() - txDate.getTime()) / 3.6e6;
    return {
        valid: hoursAgo <= 48 && hoursAgo >= -1,
        hoursAgo: Math.round(hoursAgo * 10) / 10,
        display: txDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    };
}

function buildVerdict(aiResult, expectedAmount) {
    const details = {
        extractedAmount: aiResult.amount, extractedDate: aiResult.dateTimeRaw,
        transactionRef: aiResult.transactionRef, confidence: aiResult.confidence,
        transactionStatus: aiResult.transactionStatus,
        binaryValid: aiResult.binaryValid != null ? aiResult.binaryValid : null,
        binaryDateOk: aiResult.binaryDateOk != null ? aiResult.binaryDateOk : null,
        binaryAmountOk: aiResult.binaryAmountOk != null ? aiResult.binaryAmountOk : null,
    };
    if (aiResult.notAPaymentScreenshot)
        return { passed: false, paymentStatus: 'VERIFICATION_FAILED', canRetry: true, failureCode: 'not_payment_screenshot', details };
    if (aiResult.confidence === 'low')
        return { passed: false, paymentStatus: 'LOW_CONFIDENCE', canRetry: true, failureCode: 'low_confidence', details };
    if (aiResult.transactionStatus === 'pending')
        return { passed: false, paymentStatus: 'VERIFICATION_FAILED', canRetry: true, failureCode: 'transaction_pending', details };
    if (!aiResult.isSuccessfulPayment || aiResult.transactionStatus === 'failed')
        return { passed: false, paymentStatus: 'VERIFICATION_FAILED', canRetry: true, failureCode: 'transaction_failed', details };
    const dateCheck = validateTransactionDate(aiResult.dateTimeRaw);
    if (dateCheck.valid === false)
        return { passed: false, paymentStatus: 'VERIFICATION_FAILED', canRetry: false, failureCode: 'old_screenshot', details: { ...details, parsedDate: dateCheck.display, hoursAgo: dateCheck.hoursAgo } };
    if (aiResult.binaryDateOk === false)
        return { passed: false, paymentStatus: 'VERIFICATION_FAILED', canRetry: false, failureCode: 'old_screenshot', details };
    if (!amountsMatch(aiResult.amount, expectedAmount))
        return { passed: false, paymentStatus: 'VERIFICATION_FAILED', canRetry: true, failureCode: 'amount_mismatch', details: { ...details, expectedAmount } };
    if (aiResult.binaryAmountOk === false)
        return { passed: false, paymentStatus: 'VERIFICATION_FAILED', canRetry: true, failureCode: 'amount_mismatch', details };
    if (aiResult.binaryValid === false)
        return { passed: false, paymentStatus: 'VERIFICATION_FAILED', canRetry: true, failureCode: 'verification_failed', details };
    return { passed: true, paymentStatus: 'PAID', canRetry: false, failureCode: null, details: { ...details, parsedDate: dateCheck.display } };
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

// ── parseTransactionDate ──────────────────────────────────────────────────────
console.log('\n📅 parseTransactionDate');
test('"30 Jul 2024, 12:32 pm" → year=2024, month=Jul(6), day=30', () => {
    const d = parseTransactionDate('30 Jul 2024, 12:32 pm');
    assert(d instanceof Date && !isNaN(d), 'expected valid Date');
    eq(d.getFullYear(), 2024); eq(d.getMonth(), 6); eq(d.getDate(), 30);
});
test('"15 Jan 2026, 3:45 PM" → PM converts hour to 15', () => {
    const d = parseTransactionDate('15 Jan 2026, 3:45 PM');
    assert(d instanceof Date && !isNaN(d)); eq(d.getHours(), 15);
});
test('"15 Jan 2026, 12:00 pm" → noon stays 12', () => {
    eq(parseTransactionDate('15 Jan 2026, 12:00 pm').getHours(), 12);
});
test('"Jan 30, 2024 at 12:32 PM" format', () => {
    const d = parseTransactionDate('Jan 30, 2024 at 12:32 PM');
    assert(d instanceof Date && !isNaN(d)); eq(d.getMonth(), 0);
});
test('ISO "2026-01-15T15:45:00"', () => {
    const d = parseTransactionDate('2026-01-15T15:45:00');
    assert(d instanceof Date && !isNaN(d)); eq(d.getFullYear(), 2026);
});
test('BHIM "15-01-2026 15:45"', () => {
    const d = parseTransactionDate('15-01-2026 15:45');
    assert(d instanceof Date && !isNaN(d)); eq(d.getFullYear(), 2026);
});
test('Short "15/01/26"', () => {
    const d = parseTransactionDate('15/01/26');
    assert(d instanceof Date && !isNaN(d)); eq(d.getFullYear(), 2026);
});
test('null → null', () => eq(parseTransactionDate(null), null));
test('empty string → null', () => eq(parseTransactionDate(''), null));
test('garbage → null', () => eq(parseTransactionDate('not-a-date-xyz'), null));

// ── validateTransactionDate ───────────────────────────────────────────────────
console.log('\n🛡️  validateTransactionDate (fail-safe)');
const now = new Date();
const recentDateStr = now.toISOString();
const oldDateStr = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(); // 3 days ago
test('Recent ISO date → valid:true', () => assert(validateTransactionDate(recentDateStr).valid === true));
test('Old date (3 days ago) → valid:false', () => assert(validateTransactionDate(oldDateStr).valid === false));
test('"30 Jul 2024, 12:32 pm" → valid:false  (THE BUG – was null before fix)', () => {
    const r = validateTransactionDate('30 Jul 2024, 12:32 pm');
    assert(r.valid === false, 'expected false, got ' + r.valid);
    assert(r.hoursAgo > 1000, 'hoursAgo=' + r.hoursAgo + ' expected >1000 (clearly old)');
});
test('null → valid:false, unparseable:true  (fail-safe, not pass-through)', () => {
    const r = validateTransactionDate(null);
    eq(r.valid, false); assert(r.unparseable === true);
});
test('garbage string → valid:false', () => eq(validateTransactionDate('random').valid, false));
test('hoursAgo is a number for recent date', () => assert(typeof validateTransactionDate(recentDateStr).hoursAgo === 'number'));
test('3-day-old: hoursAgo ≈ 72', () => {
    const h = validateTransactionDate(oldDateStr).hoursAgo;
    assert(h > 71 && h < 73, `hoursAgo=${h} not near 72`);
});
test('display is a string', () => assert(typeof validateTransactionDate(recentDateStr).display === 'string'));

// ── buildVerdict ──────────────────────────────────────────────────────────────
console.log('\n🏛️  buildVerdict');
const goodAI = {
    transactionStatus: 'success', isSuccessfulPayment: true,
    amount: 500, dateTimeRaw: new Date().toISOString(),
    transactionRef: 'UTR123456789012', confidence: 'high',
    notAPaymentScreenshot: false,
    binaryValid: true, binaryStatusOk: true, binaryAmountOk: true, binaryDateOk: true,
};

test('Good AI + correct amount → PAID', () => {
    const v = buildVerdict(goodAI, 500);
    eq(v.paymentStatus, 'PAID'); assert(v.passed === true);
});
test('₹498 ≈ ₹500 (within tolerance) → PAID', () => eq(buildVerdict({ ...goodAI, amount: 498 }, 500).paymentStatus, 'PAID'));
test('₹600 ≠ ₹500 → amount_mismatch, canRetry', () => {
    const v = buildVerdict({ ...goodAI, amount: 600 }, 500);
    eq(v.failureCode, 'amount_mismatch'); assert(v.canRetry === true);
});
test('Failed transaction → transaction_failed', () =>
    eq(buildVerdict({ ...goodAI, isSuccessfulPayment: false, transactionStatus: 'failed' }, 500).failureCode, 'transaction_failed'));
test('Pending transaction → transaction_pending', () =>
    eq(buildVerdict({ ...goodAI, transactionStatus: 'pending', isSuccessfulPayment: false }, 500).failureCode, 'transaction_pending'));
test('Low confidence → low_confidence, canRetry', () => {
    const v = buildVerdict({ ...goodAI, confidence: 'low' }, 500);
    eq(v.failureCode, 'low_confidence'); assert(v.canRetry === true);
});
test('Not a payment screenshot → not_payment_screenshot', () =>
    eq(buildVerdict({ ...goodAI, notAPaymentScreenshot: true }, 500).failureCode, 'not_payment_screenshot'));
test('Old screenshot (3 days ago ISO) → old_screenshot, canRetry=false', () => {
    const oldDate = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    const v = buildVerdict({ ...goodAI, dateTimeRaw: oldDate }, 500);
    eq(v.failureCode, 'old_screenshot'); assert(v.canRetry === false);
});
test('"30 Jul 2024, 12:32 pm" → old_screenshot  (THE BUG – was PAID before fix)', () => {
    const v = buildVerdict({ ...goodAI, dateTimeRaw: '30 Jul 2024, 12:32 pm' }, 500);
    eq(v.failureCode, 'old_screenshot');
});
test('Unparseable date → old_screenshot, canRetry=false', () => {
    const v = buildVerdict({ ...goodAI, dateTimeRaw: 'garbage' }, 500);
    eq(v.failureCode, 'old_screenshot'); assert(v.canRetry === false);
});
test('binaryDateOk:false → old_screenshot', () =>
    eq(buildVerdict({ ...goodAI, binaryDateOk: false }, 500).failureCode, 'old_screenshot'));
test('binaryValid:false (all else ok) → verification_failed', () =>
    eq(buildVerdict({ ...goodAI, binaryValid: false }, 500).failureCode, 'verification_failed'));

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(45)}`);
console.log(`Results: ${pass} passed, ${fail} failed out of ${pass + fail} tests`);
if (fail > 0) process.exit(1);
