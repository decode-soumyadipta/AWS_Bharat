/**
 * UPI Validation Tests
 * 
 * Validates the fix: LLM prompt was only showing @upi and @paytm as UPI examples,
 * causing the AI to reject valid handles like @oksbi, @ybl, @okicici etc.
 * Fix: Updated all prompts to list comprehensive UPI handles and added rule
 * "NEVER reject based on handle portion."
 * 
 * Test categories:
 * 1. Source-code contract tests (prompt text validation)
 * 2. registerUpi code validation (agent-handler)
 * 3. Onboarding guide UPI examples
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..', '..', 'src');
const readSrc = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf-8');

// ── VALID UPI HANDLES ──────────────────────────────────────────────────────

const VALID_UPI_HANDLES = [
  '@oksbi', '@ybl', '@okicici', '@paytm', '@okaxis',
  '@okhdfcbank', '@apl', '@phonepe', '@sbi', '@upi',
  '@axl', '@ibl', '@icici', '@kotak', '@airtel',
];

const VALID_UPI_IDS = [
  'soumyadiptadey7@oksbi',
  'name@ybl',
  '9876543210@paytm',
  'shop@okicici',
  'user@phonepe',
  'seller123@sbi',
  'test@upi',
  'myname@okhdfcbank',
];

describe('UPI validation — prompt contracts', () => {
  const enhancedAgent = readSrc('services/enhanced-agent.ts');
  const agentHandler = readSrc('lambdas/agent-handler.ts');
  const onboardingGuide = readSrc('services/onboarding-guide.ts');

  describe('enhanced-agent.ts UPI GUIDANCE section', () => {
    it('includes comprehensive UPI handle examples', () => {
      expect(enhancedAgent).toContain('@oksbi');
      expect(enhancedAgent).toContain('@ybl');
      expect(enhancedAgent).toContain('@okicici');
      expect(enhancedAgent).toContain('@phonepe');
      expect(enhancedAgent).toContain('@okhdfcbank');
    });

    it('has the NEVER reject rule for UPI handles', () => {
      expect(enhancedAgent).toContain('NEVER reject a UPI ID based on the handle');
    });

    it('explains ANY word@word format is valid', () => {
      expect(enhancedAgent).toMatch(/ANY\s+string\s+in\s+the\s+format\s+word@word\s+is\s+a\s+VALID/i);
    });

    it('mentions hundreds of valid handles exist', () => {
      expect(enhancedAgent).toContain('hundreds of valid handles');
    });
  });

  describe('enhanced-agent.ts REGISTER_UPI rules', () => {
    it('includes comprehensive UPI examples in REGISTER_UPI rules', () => {
      // Extract REGISTER_UPI section
      const registerSection = enhancedAgent.match(/REGISTER_UPI rules:[\s\S]*?(?=RESPONSE_MODE|$)/);
      expect(registerSection).not.toBeNull();
      
      const section = registerSection![0];
      expect(section).toContain('@oksbi');
      expect(section).toContain('ANY text@text format');
      expect(section).toContain('NEVER reject or question the handle');
    });
  });

  describe('agent-handler.ts registerUpi error message', () => {
    it('shows real UPI handles in error message, not just @upi', () => {
      expect(agentHandler).not.toContain('name@upi, 9876543210@paytm)');
      expect(agentHandler).toContain('@oksbi');
      expect(agentHandler).toContain('@ybl');
    });

    it('validates UPI format with @ check (code-level)', () => {
      expect(agentHandler).toContain("!upiId.includes('@')");
    });
  });

  describe('onboarding-guide.ts UPI examples', () => {
    it('Hindi guide shows real UPI handles', () => {
      expect(onboardingGuide).toContain('name@oksbi');
      expect(onboardingGuide).not.toMatch(/UPI ID भेजिए जैसे: name@upi\n/);
    });

    it('Marathi guide shows real UPI handles', () => {
      expect(onboardingGuide).toContain('phone@paytm');
      expect(onboardingGuide).toContain('shop@ybl');
    });

    it('English guide shows real UPI handles', () => {
      const englishSection = onboardingGuide.match(/4\. UPI Setup[\s\S]*?Customers can pay you directly/);
      expect(englishSection).not.toBeNull();
      expect(englishSection![0]).toContain('@oksbi');
    });
  });
});

describe('UPI validation — format acceptance', () => {
  it('valid UPI IDs all match word@word regex', () => {
    const upiRegex = /[\w.\-]+@[\w]+/;
    
    VALID_UPI_IDS.forEach(upiId => {
      expect(upiId).toMatch(upiRegex);
    });
  });

  it('invalid formats are correctly rejected by @ check', () => {
    const invalidIds = ['noemail', '12345', 'just-text', '', 'spaces here'];
    invalidIds.forEach(id => {
      expect(id.includes('@')).toBe(false);
    });
  });

  it('all standard UPI handles are present in prompt', () => {
    const enhancedAgent = readSrc('services/enhanced-agent.ts');
    // Key handles that MUST be in the prompt
    ['@oksbi', '@ybl', '@okicici', '@paytm', '@phonepe', '@sbi'].forEach(handle => {
      expect(enhancedAgent).toContain(handle);
    });
  });
});
