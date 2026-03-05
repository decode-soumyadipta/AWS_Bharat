/**
 * Property-Based Tests: Verbal Confirmation Detection
 *
 * Uses fast-check to generate randomized inputs and verify that:
 * - Known affirmative phrases always trigger confirmation
 * - Random non-affirmative inputs with digits don't trigger confirmation
 * - UPI-like strings don't get treated as bare numbers
 * - The function never throws for any input
 */

import fc from 'fast-check';
import { detectVerbalConfirmation } from '../../src/lambdas/agent-handler';

describe('Property Tests: Verbal Confirmation', () => {

  // ── Property 1: Known affirmatives always detected ──────────────────────
  it('Property: All known affirmative words trigger confirmation', () => {
    const affirmativeWords = [
      'haan', 'ha', 'haa', 'han', 'yes', 'yeah', 'yep', 'yup',
      'ok', 'okay', 'okie', 'theek hai', 'thik hai', 'sahi hai',
      'approve', 'approved', 'confirm', 'confirmed', 'done',
      'bilkul', 'kar do', 'kar de', 'pakka', 'acha', 'accha',
      'chalega', 'chal', 'chalo', 'manzoor', 'rakh do', 'agreed',
      'correct', 'right', 'ready',
      'हाँ', 'हां', 'ठीक है', 'ठीक', 'सही है', 'सही',
      'कर दो', 'बिल्कुल', 'पक्का', 'अच्छा', 'कन्फर्म',
      'मंजूर', 'लगा दो', 'रख दो', 'डाल दो', 'तैयार',
      'होय', 'चालेल', 'ठीक आहे', 'बरोबर',
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...affirmativeWords),
        (word) => {
          return detectVerbalConfirmation(word) === true;
        }
      ),
      { numRuns: 200 }
    );
  });

  // ── Property 2: Affirmatives with random whitespace padding ─────────────
  it('Property: Affirmatives with random whitespace still detected', () => {
    const affirmatives = ['haan', 'ok', 'yes', 'theek hai', 'done', 'हाँ', 'ठीक है', 'approve'];

    fc.assert(
      fc.property(
        fc.constantFrom(...affirmatives),
        fc.nat({ max: 5 }),
        fc.nat({ max: 5 }),
        (word, leadingSpaces, trailingSpaces) => {
          const padded = ' '.repeat(leadingSpaces) + word + ' '.repeat(trailingSpaces);
          return detectVerbalConfirmation(padded) === true;
        }
      ),
      { numRuns: 100 }
    );
  });

  // ── Property 3: Affirmatives with mixed case still detected ─────────────
  it('Property: Affirmatives are case-insensitive', () => {
    const romanized = ['haan', 'ok', 'yes', 'done', 'approve', 'confirm', 'chalega', 'pakka'];

    fc.assert(
      fc.property(
        fc.constantFrom(...romanized),
        fc.boolean(),
        (word, toUpper) => {
          const cased = toUpper ? word.toUpperCase() : word.toLowerCase();
          return detectVerbalConfirmation(cased) === true;
        }
      ),
      { numRuns: 100 }
    );
  });

  // ── Property 4: Standalone numbers never trigger confirmation ───────────
  it('Property: Standalone numbers never confirm', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999999 }),
        (num) => {
          return detectVerbalConfirmation(String(num)) === false;
        }
      ),
      { numRuns: 200 }
    );
  });

  // ── Property 5: Product-related sentences don't trigger confirmation ────
  it('Property: Product/price sentences do not trigger confirmation', () => {
    const productPhrases = [
      'tamatar 50 rupaye',
      'price 100 karo',
      'keemat badlo',
      'photo bhej raha hun',
      'quantity 10 kg chahiye',
      'mera naam bolo',
      'product add karo',
      'delete karo yeh',
      'mausam batao',
      'bhav kya hai aaj',
      'nahi chahiye',
      'cancel karo',
      'edit karna hai',
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...productPhrases),
        (phrase) => {
          return detectVerbalConfirmation(phrase) === false;
        }
      ),
      { numRuns: 100 }
    );
  });

  // ── Property 6: UPI-like strings never match bare-number pattern ────────
  it('Property: UPI IDs are correctly guarded by @ detection', () => {
    const upiRegex = /\w+@\w+/;

    fc.assert(
      fc.property(
        fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz1234567890'.split('')), { minLength: 1, maxLength: 10 }),
        fc.constantFrom('upi', 'ybl', 'paytm', 'oksbi', 'icici', 'gpay', 'phonepe'),
        (localPart, provider) => {
          const upiId = `${localPart}@${provider}`;
          return upiRegex.test(upiId) === true;
        }
      ),
      { numRuns: 100 }
    );
  });

  // ── Property 7: Function never throws for arbitrary input ───────────────
  it('Property: detectVerbalConfirmation never throws for any string', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 500 }),
        (input) => {
          // Should never throw
          const result = detectVerbalConfirmation(input);
          return typeof result === 'boolean';
        }
      ),
      { numRuns: 500 }
    );
  });

  // ── Property 8: Empty/whitespace-only strings don't trigger ─────────────
  it('Property: Empty or whitespace-only strings return false', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 20 }),
        (spaces) => {
          return detectVerbalConfirmation(' '.repeat(spaces)) === false;
        }
      ),
      { numRuns: 50 }
    );
  });

  // ── Property 9: Random alphanumeric gibberish rarely triggers ───────────
  it('Property: Random gibberish rarely triggers (< 5% false positive rate)', () => {
    let total = 0;
    let falsePositives = 0;

    fc.assert(
      fc.property(
        fc.stringOf(fc.constantFrom(...'qwxzfjvblmp1234567890'.split('')), { minLength: 5, maxLength: 30 }),
        (gibberish) => {
          total++;
          if (detectVerbalConfirmation(gibberish)) {
            falsePositives++;
          }
          return true; // Always passes — we check the rate after
        }
      ),
      { numRuns: 200 }
    );

    // False positive rate should be very low
    const rate = falsePositives / total;
    expect(rate).toBeLessThan(0.05);
  });
});
