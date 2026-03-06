/**
 * Typing Indicator Standalone Dedup Tests
 *
 * Validates the fix: WhatsApp Cloud API's markMessageAsRead(msgId, true) only
 * triggers typing on first call (unread→read). Subsequent calls are no-ops.
 * Fix: After first mark-as-read, use standalone typing_indicator endpoint (v22.0+).
 *
 * Test categories:
 * 1. Source-code contract tests (alreadyReadMessageIds, sendStandaloneTyping)
 * 2. sendTypingIndicator dedup logic (runtime tests)
 * 3. markMessageAsRead tracking
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..', '..', 'src');
const readSrc = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf-8');

// ── 1. SOURCE-CODE CONTRACT TESTS ─────────────────────────────────────────

describe('Typing indicator standalone dedup — source contracts', () => {
  const messageSender = readSrc('lambdas/whatsapp-message-sender.ts');

  it('has alreadyReadMessageIds Set for tracking read messages', () => {
    expect(messageSender).toContain('alreadyReadMessageIds');
    expect(messageSender).toMatch(/new Set/);
  });

  it('has sendStandaloneTyping function for v22.0+ direct typing', () => {
    expect(messageSender).toMatch(/async function sendStandaloneTyping/);
    expect(messageSender).toContain("type: 'typing_indicator'");
  });

  it('sendStandaloneTyping sends to phone number not message ID', () => {
    // The payload should have 'to' field (phone) not 'message_id'
    expect(messageSender).toMatch(/sendStandaloneTyping\(\s*to:\s*string/);
    // Check payload structure
    expect(messageSender).toContain("recipient_type: 'individual'");
    expect(messageSender).toContain("typing_indicator: { type: 'text' }");
  });

  it('sendTypingIndicator checks alreadyReadMessageIds before calling markMessageAsRead', () => {
    expect(messageSender).toContain('alreadyReadMessageIds.has(msgId)');
  });

  it('markMessageAsRead adds to alreadyReadMessageIds on success', () => {
    expect(messageSender).toContain('alreadyReadMessageIds.add(messageId)');
  });

  it('exports _alreadyReadMessageIds for testing', () => {
    expect(messageSender).toMatch(/export\s*{\s*alreadyReadMessageIds\s+as\s+_alreadyReadMessageIds\s*}/);
  });
});

// ── 2. RUNTIME TESTS ───────────────────────────────────────────────────────

describe('Typing indicator dedup — runtime behavior', () => {
  let fetchCalls: any[];
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchCalls = [];
    process.env.WHATSAPP_API_ENDPOINT = 'https://graph.facebook.com/v22.0';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';

    // Mock fetch to record calls
    (global as any).fetch = jest.fn(async (url: string, opts: any) => {
      const body = JSON.parse(opts.body);
      fetchCalls.push({ url, body });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      };
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.WHATSAPP_API_ENDPOINT;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    jest.resetModules();
  });

  it('first sendTypingIndicator uses markMessageAsRead (read + typing)', async () => {
    // Fresh module to clear alreadyReadMessageIds
    jest.resetModules();
    const { sendTypingIndicator, _alreadyReadMessageIds } = require('../../src/lambdas/whatsapp-message-sender');
    _alreadyReadMessageIds.clear();

    await sendTypingIndicator('919876543210', 'wamid.test123');

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].body.status).toBe('read');
    expect(fetchCalls[0].body.message_id).toBe('wamid.test123');
    expect(fetchCalls[0].body.typing_indicator).toEqual({ type: 'text' });
  });

  it('second sendTypingIndicator with same messageId uses standalone typing', async () => {
    jest.resetModules();
    const { sendTypingIndicator, _alreadyReadMessageIds } = require('../../src/lambdas/whatsapp-message-sender');
    _alreadyReadMessageIds.clear();

    // First call: mark as read + typing
    await sendTypingIndicator('919876543210', 'wamid.test456');

    // Clear fetchCalls to isolate second call
    fetchCalls = [];

    // Second call: should use standalone typing (no message_id, no status: 'read')
    await sendTypingIndicator('919876543210', 'wamid.test456');

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].body.type).toBe('typing_indicator');
    expect(fetchCalls[0].body.to).toBe('919876543210');
    expect(fetchCalls[0].body.status).toBeUndefined();
    expect(fetchCalls[0].body.message_id).toBeUndefined();
  });

  it('third, fourth calls also use standalone typing', async () => {
    jest.resetModules();
    const { sendTypingIndicator, _alreadyReadMessageIds } = require('../../src/lambdas/whatsapp-message-sender');
    _alreadyReadMessageIds.clear();

    await sendTypingIndicator('919876543210', 'wamid.multi');
    fetchCalls = [];

    // Multiple subsequent calls
    await sendTypingIndicator('919876543210', 'wamid.multi');
    await sendTypingIndicator('919876543210', 'wamid.multi');
    await sendTypingIndicator('919876543210', 'wamid.multi');

    expect(fetchCalls).toHaveLength(3);
    fetchCalls.forEach(call => {
      expect(call.body.type).toBe('typing_indicator');
      expect(call.body.status).toBeUndefined();
    });
  });

  it('markMessageAsRead directly also tracks for dedup', async () => {
    jest.resetModules();
    const { markMessageAsRead, sendTypingIndicator, _alreadyReadMessageIds } = require('../../src/lambdas/whatsapp-message-sender');
    _alreadyReadMessageIds.clear();

    // Direct markMessageAsRead (as called from agent-handler.ts top)
    await markMessageAsRead('wamid.direct', true);

    // Now sendTypingIndicator should use standalone
    fetchCalls = [];
    await sendTypingIndicator('919876543210', 'wamid.direct');

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].body.type).toBe('typing_indicator');
  });

  it('falls back to standalone typing when no messageId and no cache', async () => {
    jest.resetModules();
    const { sendTypingIndicator, _alreadyReadMessageIds } = require('../../src/lambdas/whatsapp-message-sender');
    _alreadyReadMessageIds.clear();

    const result = await sendTypingIndicator('919876543210', undefined);

    // Should attempt standalone typing since no messageId
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].body.type).toBe('typing_indicator');
    expect(fetchCalls[0].body.to).toBe('919876543210');
  });
});
