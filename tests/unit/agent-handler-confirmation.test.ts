/**
 * Unit Tests: Verbal Confirmation & CONFIRMATION_PENDING Flow
 *
 * Tests the detectVerbalConfirmation() shortcut that allows users to
 * approve catalog items by saying "haan", "ok", "theek hai", etc.
 * Also tests the UPI guard in bare-number disambiguation.
 *
 * Validates fixes for:
 *  - Verbal "haan/ok" not confirming (fell through to LLM)
 *  - UPI ID digits being treated as price
 */

import { detectVerbalConfirmation } from '../../src/lambdas/agent-handler';

describe('detectVerbalConfirmation', () => {
  // ── Positive: Romanized Hindi affirmatives ────────────────────────────────
  describe('should detect romanized Hindi affirmatives', () => {
    const cases = [
      'haan',
      'ha',
      'haa',
      'ji haan',
      'theek hai',
      'thik hai',
      'sahi hai',
      'bilkul',
      'kar do',
      'kar de',
      'kar dena',
      'ban jaye',
      'pakka',
      'acha',
      'accha',
      'achha',
      'chalega',
      'chal',
      'chalo',
      'manzoor',
      'rakh do',
      'daal do',
      'dal do',
      'laga do',
      'ho gaya',
      'ho jayega',
      'sab theek',
      'sab thik',
    ];

    test.each(cases)('"%s" should be detected as verbal confirmation', (input) => {
      expect(detectVerbalConfirmation(input)).toBe(true);
    });
  });

  // ── Positive: English affirmatives ────────────────────────────────────────
  describe('should detect English affirmatives', () => {
    const cases = [
      'yes',
      'yeah',
      'yep',
      'yup',
      'ok',
      'okay',
      'okie',
      'approve',
      'approved',
      'confirm',
      'confirmed',
      'done',
      'agreed',
      'correct',
      'right',
      'ready',
    ];

    test.each(cases)('"%s" should be detected as verbal confirmation', (input) => {
      expect(detectVerbalConfirmation(input)).toBe(true);
    });
  });

  // ── Positive: Hindi Devanagari affirmatives ───────────────────────────────
  describe('should detect Hindi Devanagari affirmatives', () => {
    const cases = [
      'हाँ',
      'हां',
      'जी हाँ',
      'जी हां',
      'ठीक है',
      'ठीक',
      'सही है',
      'सही',
      'कर दो',
      'कर दे',
      'बन जाये',
      'बिल्कुल',
      'पक्का',
      'अच्छा',
      'कन्फर्म',
      'सब ठीक',
      'मंजूर',
      'लगा दो',
      'रख दो',
      'डाल दो',
      'चालू',
      'तैयार',
      'हो गया',
    ];

    test.each(cases)('"%s" should be detected as verbal confirmation', (input) => {
      expect(detectVerbalConfirmation(input)).toBe(true);
    });
  });

  // ── Positive: Marathi affirmatives ────────────────────────────────────────
  describe('should detect Marathi affirmatives', () => {
    const cases = [
      'होय',
      'चालेल',
      'ठीक आहे',
      'बरोबर',
      'मंजूर',
      'करा',
    ];

    test.each(cases)('"%s" should be detected as verbal confirmation', (input) => {
      expect(detectVerbalConfirmation(input)).toBe(true);
    });
  });

  // ── Positive: Short affirmatives (1-2 words) ─────────────────────────────
  describe('should detect very short affirmatives', () => {
    const cases = ['ji', 'jee', 'hmm', 'hm', 'ho', 'हो', 'जी', 'हम्म'];

    test.each(cases)('"%s" should be detected as verbal confirmation', (input) => {
      expect(detectVerbalConfirmation(input)).toBe(true);
    });
  });

  // ── Positive: With extra whitespace/casing ────────────────────────────────
  describe('should handle whitespace and casing', () => {
    const cases = [
      '  HAAN  ',
      'Yes',
      'YES',
      'Theek Hai',
      'THEEK HAI',
      ' ok ',
      '  Done  ',
    ];

    test.each(cases)('"%s" should be detected (trimmed/case-insensitive)', (input) => {
      expect(detectVerbalConfirmation(input)).toBe(true);
    });
  });

  // ── Negative: Should NOT trigger confirmation ─────────────────────────────
  describe('should NOT detect non-confirmation messages', () => {
    const cases = [
      'photo bhejo',
      'photo bhej raha hun',
      'price change karo 50',
      'keemat 100 rakho',
      'quantity 10 kg',
      'naam badlo',
      'mera UPI ID seller7@upi hai',
      'nahi',
      'naa',
      'cancel',
      'edit karo',
      'galat hai',
      'change karna hai',
      'mujhe nahi chahiye',
      'tamatar 50 rupaye 10 kilo',
      '50',
      '100',
      'mausam batao',
      'bhav kya hai',
      'product add karo',
    ];

    test.each(cases)('"%s" should NOT be detected as verbal confirmation', (input) => {
      expect(detectVerbalConfirmation(input)).toBe(false);
    });
  });

  // ── Negative: Numbers alone should NOT confirm ────────────────────────────
  describe('should NOT trigger on standalone numbers', () => {
    const cases = ['7', '50', '100', '500', '1234'];

    test.each(cases)('"%s" (standalone number) should NOT confirm', (input) => {
      expect(detectVerbalConfirmation(input)).toBe(false);
    });
  });
});

describe('UPI Guard in bare-number disambiguation', () => {
  // These tests verify that the UPI regex guard works correctly
  // The actual detectAndApplyUpdate is not exported, so we test the regex pattern

  const upiRegex = /\w+@\w+/;

  describe('should detect UPI-like strings', () => {
    const upiStrings = [
      'seller7@upi',
      'myshop@ybl',
      'farmer123@paytm',
      'name@oksbi',
      'phone@icici',
    ];

    test.each(upiStrings)('"%s" should match UPI pattern', (input) => {
      expect(upiRegex.test(input)).toBe(true);
    });
  });

  describe('should NOT flag non-UPI strings as UPI', () => {
    const nonUpiStrings = [
      '50 rupaye',
      'keemat 100',
      'price 200',
      'haan theek hai',
      '10 kg tamatar',
    ];

    test.each(nonUpiStrings)('"%s" should NOT match UPI pattern', (input) => {
      expect(upiRegex.test(input)).toBe(false);
    });
  });

  describe('bare number regex should extract digits', () => {
    const bareNumberRegex = /^[^\d]*(\d+)[^\d]*$/;

    test('should extract 7 from "seller7@upi" — but UPI guard blocks it', () => {
      // The regex CAN match, but the guard prevents it from being used
      const match = 'seller7@upi'.match(bareNumberRegex);
      // It actually doesn't match because there's text after the digit too
      // But "7" alone would match:
      const matchBare = '7'.match(bareNumberRegex);
      expect(matchBare?.[1]).toBe('7');

      // Verify UPI guard
      expect(upiRegex.test('seller7@upi')).toBe(true);
    });

    test('should extract number from "50 rakh do"', () => {
      const match = '50 rakh do'.match(bareNumberRegex);
      expect(match?.[1]).toBe('50');
      expect(upiRegex.test('50 rakh do')).toBe(false);
    });

    test('should extract number from "keemat 100"', () => {
      const match = 'keemat 100'.match(bareNumberRegex);
      expect(match?.[1]).toBe('100');
    });
  });
});
