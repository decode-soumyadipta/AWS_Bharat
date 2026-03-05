/**
 * Typing Indicator – messageId Threading Tests
 *
 * Validates the fix for: typing indicator breaks because showTypingIndicator()
 * in enhanced-agent.ts was calling sendTypingIndicator(phone) WITHOUT a messageId.
 * On cold-start Lambda instances the in-memory cache is empty → typing silently failed.
 *
 * Fix: module-level _currentMessageId in enhanced-agent.ts, set by
 *      processWithEnhancedAgent / sendEnhancedAgentMessage, consumed by showTypingIndicator.
 *
 * Test categories:
 * 1. Source-code contract tests (static analysis — no runtime mocking)
 * 2. sendTypingIndicator unit tests  (runtime with fetch mock)
 * 3. setLastMessageId cache tests
 */

import * as fs from 'fs';
import * as path from 'path';

// ────────────────────────────────────────────────────────────────────────────
// 1. SOURCE-CODE CONTRACT TESTS
//    These ensure the fix is structurally present by inspecting the TS source.
// ────────────────────────────────────────────────────────────────────────────

const SRC = path.resolve(__dirname, '..', '..', 'src');
const readSrc = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf-8');

describe('Typing indicator messageId threading — source contracts', () => {
  const enhancedAgent = readSrc('services/enhanced-agent.ts');
  const agentHandler  = readSrc('lambdas/agent-handler.ts');
  const voiceHandler  = readSrc('lambdas/voice-handler.ts');
  const messageSender = readSrc('lambdas/whatsapp-message-sender.ts');

  // ── enhanced-agent.ts ──────────────────────────────────────────────────

  it('enhanced-agent declares _currentMessageId module-level variable', () => {
    expect(enhancedAgent).toMatch(/let\s+_currentMessageId\s*:\s*string\s*\|\s*undefined/);
  });

  it('processWithEnhancedAgent accepts messageId parameter', () => {
    // Should have messageId as the 5th param
    const sig = enhancedAgent.match(
      /export\s+async\s+function\s+processWithEnhancedAgent\s*\([^)]+\)/s
    );
    expect(sig).not.toBeNull();
    expect(sig![0]).toContain('messageId');
  });

  it('processWithEnhancedAgent sets _currentMessageId from parameter', () => {
    // After the signature, should assign _currentMessageId = messageId
    expect(enhancedAgent).toMatch(/_currentMessageId\s*=\s*messageId/);
  });

  it('sendEnhancedAgentMessage accepts messageId parameter', () => {
    const sig = enhancedAgent.match(
      /export\s+async\s+function\s+sendEnhancedAgentMessage\s*\([^)]+\)/s
    );
    expect(sig).not.toBeNull();
    expect(sig![0]).toContain('messageId');
  });

  it('showTypingIndicator forwards _currentMessageId to sendTypingIndicator', () => {
    // The showTypingIndicator function body should pass _currentMessageId
    expect(enhancedAgent).toMatch(
      /sendTypingIndicator\s*\(\s*phone\s*,\s*_currentMessageId\s*\)/
    );
  });

  it('showTypingIndicator is NOT exported (internal helper)', () => {
    expect(enhancedAgent).not.toMatch(/export\s+(async\s+)?function\s+showTypingIndicator/);
  });

  // ── agent-handler.ts ──────────────────────────────────────────────────

  it('agent-handler passes messageId to processWithEnhancedAgent', () => {
    // At least one call should include eventDetail.messageId as last arg
    const calls = agentHandler.match(/processWithEnhancedAgent\s*\([^)]+\)/gs) || [];
    const hasMessageId = calls.some(c => /eventDetail\.messageId/.test(c));
    expect(hasMessageId).toBe(true);
  });

  it('agent-handler passes messageId to sendEnhancedAgentMessage (main path)', () => {
    // The main agent response path should pass eventDetail.messageId
    const calls = agentHandler.match(/sendEnhancedAgentMessage\s*\([^)]+eventDetail\.messageId[^)]*\)/gs);
    expect(calls && calls.length).toBeGreaterThan(0);
  });

  // ── voice-handler.ts ──────────────────────────────────────────────────

  it('voice-handler passes messageId to processWithEnhancedAgent', () => {
    // The call spans multiple lines, so check that the function call block contains messageId
    const hasMessageIdCall = /processWithEnhancedAgent\s*\([\s\S]*?messageId[\s\S]*?\);/m.test(voiceHandler);
    expect(hasMessageIdCall).toBe(true);
  });

  it('voice-handler passes messageId to sendEnhancedAgentMessage', () => {
    const hasMessageIdCall = /sendEnhancedAgentMessage\s*\([\s\S]*?messageId[\s\S]*?\);/m.test(voiceHandler);
    expect(hasMessageIdCall).toBe(true);
  });

  // ── whatsapp-message-sender.ts ────────────────────────────────────────

  it('sendTypingIndicator accepts optional messageId parameter', () => {
    expect(messageSender).toMatch(
      /export\s+async\s+function\s+sendTypingIndicator\s*\(\s*to\s*:\s*string\s*,\s*messageId\?\s*:\s*string/
    );
  });

  it('sendTypingIndicator falls back to cache when no messageId provided', () => {
    expect(messageSender).toMatch(/lastMessageIdByPhone\s*\[\s*to\s*\]/);
  });

  it('setLastMessageId is exported', () => {
    expect(messageSender).toMatch(/export\s+function\s+setLastMessageId/);
  });
});


// ────────────────────────────────────────────────────────────────────────────
// 2. RUNTIME UNIT TESTS — sendTypingIndicator / setLastMessageId
// ────────────────────────────────────────────────────────────────────────────

// Mock fetch globally before importing the module
global.fetch = jest.fn();

import {
  sendTypingIndicator,
  setLastMessageId,
  markMessageAsRead,
} from '../../src/lambdas/whatsapp-message-sender';

describe('sendTypingIndicator runtime behaviour', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WHATSAPP_API_ENDPOINT = 'https://api.whatsapp.test';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
  });

  it('returns success:false when no messageId and no cache', async () => {
    const result = await sendTypingIndicator('+910000000000');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No messageId/i);
    // fetch should NOT have been called
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends typing indicator when messageId is provided directly', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });

    const result = await sendTypingIndicator('+919999999999', 'wamid.abc123');
    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // The body should contain the messageId and typing_indicator
    const call = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.message_id).toBe('wamid.abc123');
    expect(body.typing_indicator).toBeDefined();
  });

  it('uses cached messageId when no explicit messageId given', async () => {
    // Prime the cache
    setLastMessageId('+918888888888', 'wamid.cached456');

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });

    const result = await sendTypingIndicator('+918888888888');
    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const call = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.message_id).toBe('wamid.cached456');
  });

  it('prefers explicit messageId over cached one', async () => {
    // Prime cache with an older messageId
    setLastMessageId('+917777777777', 'wamid.old');

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });

    const result = await sendTypingIndicator('+917777777777', 'wamid.explicit');
    expect(result.success).toBe(true);

    const call = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.message_id).toBe('wamid.explicit');
  });

  it('handles fetch failure gracefully', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

    const result = await sendTypingIndicator('+916666666666', 'wamid.xyz');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. markMessageAsRead with typing
// ────────────────────────────────────────────────────────────────────────────

describe('markMessageAsRead with typing=true', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WHATSAPP_API_ENDPOINT = 'https://api.whatsapp.test';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
  });

  it('sends typing_indicator when typing=true', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });

    const result = await markMessageAsRead('wamid.readTest', true);
    expect(result.success).toBe(true);

    const call = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.status).toBe('read');
    expect(body.message_id).toBe('wamid.readTest');
    expect(body.typing_indicator).toEqual({ type: 'text' });
  });

  it('does NOT send typing_indicator when typing=false', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });

    const result = await markMessageAsRead('wamid.readTest2', false);
    expect(result.success).toBe(true);

    const call = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.status).toBe('read');
    expect(body.typing_indicator).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. CROSS-LAMBDA ISOLATION — the root cause scenario
// ────────────────────────────────────────────────────────────────────────────

describe('Cross-Lambda cache isolation scenario', () => {
  it('demonstrates that sendTypingIndicator fails when cache not primed (cold start)', async () => {
    // Simulate a fresh import = new Lambda instance = empty cache.
    // Phone number that has never called setLastMessageId:
    const coldStartPhone = '+910000099999';

    const result = await sendTypingIndicator(coldStartPhone);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No messageId/i);
  });

  it('sendTypingIndicator succeeds with explicit messageId even on cold start', async () => {
    const coldStartPhone = '+910000098888';

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });

    const result = await sendTypingIndicator(coldStartPhone, 'wamid.coldstart123');
    expect(result.success).toBe(true);
  });
});
