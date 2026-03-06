/**
 * Recommendation & Conversation Context Prompt Tests
 * 
 * Validates that the enhanced-agent prompt has strong rules for:
 * 1. Proactive market price recommendations
 * 2. Analytics insights in responses
 * 3. Weather and crop advisory mentions
 * 4. Conversation history usage
 * 5. Spelling correction behavior
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..', '..', 'src');
const readSrc = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf-8');

describe('Proactive recommendation prompt rules', () => {
  const enhancedAgent = readSrc('services/enhanced-agent.ts');

  describe('PROACTIVE RECOMMENDATIONS section', () => {
    it('has a dedicated PROACTIVE RECOMMENDATIONS section', () => {
      expect(enhancedAgent).toContain('PROACTIVE RECOMMENDATIONS');
    });

    it('has MARKET PRICES rule — mention current prices when relevant', () => {
      expect(enhancedAgent).toMatch(/MARKET PRICES.*mention.*naturally.*relevant/s);
    });

    it('has ANALYTICS INSIGHTS rule — weave sales data into responses', () => {
      expect(enhancedAgent).toMatch(/ANALYTICS INSIGHTS.*weave.*into responses/s);
    });

    it('has WEATHER AND CROP ADVISORY rule', () => {
      expect(enhancedAgent).toContain('WEATHER AND CROP ADVISORY');
    });

    it('has SPELLING AND NAME CORRECTIONS rule', () => {
      expect(enhancedAgent).toContain('SPELLING AND NAME CORRECTIONS');
    });

    it('has PRICE ADVISORY rule for below/above market', () => {
      expect(enhancedAgent).toContain('PRICE ADVISORY');
      expect(enhancedAgent).toContain('significantly below market');
    });

    it('has SEASONAL TIPS rule', () => {
      expect(enhancedAgent).toContain('SEASONAL TIPS');
    });

    it('has CROSS-SELL rule', () => {
      expect(enhancedAgent).toContain('CROSS-SELL');
    });
  });

  describe('Strengthened numbered rules', () => {
    it('rule 4: ALWAYS mentions market price comparison when data exists', () => {
      expect(enhancedAgent).toContain('ALWAYS mention the current market price and compare');
    });

    it('rule 9: references top products, recent activity, previous questions', () => {
      expect(enhancedAgent).toContain('mention their top products, recent activity, or previous questions');
    });
  });

  describe('Existing context pipeline', () => {
    it('builds prompt with conversation history', () => {
      expect(enhancedAgent).toContain('getConversationContext');
      expect(enhancedAgent).toContain('conversationSummary');
    });

    it('builds prompt with market info', () => {
      expect(enhancedAgent).toContain('marketInfo');
    });

    it('builds prompt with analytics info', () => {
      expect(enhancedAgent).toContain('analyticsInfo');
    });

    it('builds prompt with recent alerts', () => {
      expect(enhancedAgent).toContain('recentAlerts');
    });

    it('has DEEP PERSONALIZATION RULES', () => {
      expect(enhancedAgent).toContain('DEEP PERSONALIZATION RULES');
    });

    it('has MEMORY AND CONTINUITY RULES', () => {
      expect(enhancedAgent).toContain('MEMORY AND CONTINUITY RULES');
    });
  });
});
