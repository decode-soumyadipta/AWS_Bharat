/**
 * Typing Indicator Dedup Tests
 *
 * Validates the fix: WhatsApp Cloud API requires message_id for typing indicators.
 * After first mark-as-read, re-sending markMessageAsRead(msgId, true) is idempotent
 * for the read status but fires the typing indicator every time.
 *
 * Fix: After first mark-as-read, use resendTypingWithMessageId (which calls
 * markMessageAsRead again with typing=true).
 *
 * Test categories:
 * 1. Source-code contract tests (alreadyReadMessageIds, resendTypingWithMessageId)
 * 2. sendTypingIndicator dedup logic (runtime tests)
 * 3. markMessageAsRead tracking
 */

import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "..", "..", "src");
const readSrc = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf-8");

// ── 1. SOURCE-CODE CONTRACT TESTS ─────────────────────────────

describe("Typing indicator dedup — source contracts", () => {
  const messageSender = readSrc("lambdas/whatsapp-message-sender.ts");

  it("has alreadyReadMessageIds Set for tracking read messages", () => {
    expect(messageSender).toContain("alreadyReadMessageIds");
    expect(messageSender).toMatch(/new Set/);
  });

  it("sendTypingIndicator calls markMessageAsRead with typing=true", () => {
    expect(messageSender).toContain("markMessageAsRead(msgId, true)");
  });

  it("markMessageAsRead adds to alreadyReadMessageIds on success", () => {
    expect(messageSender).toContain("alreadyReadMessageIds.add(");
  });

  it("exports _alreadyReadMessageIds for testing", () => {
    expect(messageSender).toMatch(/export\s*{\s*alreadyReadMessageIds\s+as\s+_alreadyReadMessageIds\s*}/);
  });
});

// ── 2. RUNTIME TESTS ─────────────────────────────

describe("Typing indicator dedup — runtime behavior", () => {
  let fetchCalls: any[];
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchCalls = [];
    process.env.WHATSAPP_API_ENDPOINT = "https://graph.facebook.com/v22.0";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-id";
    process.env.WHATSAPP_ACCESS_TOKEN = "test-token";

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

  it("first sendTypingIndicator uses markMessageAsRead (read + typing)", async () => {
    jest.resetModules();
    const { sendTypingIndicator, _alreadyReadMessageIds } = require("../../src/lambdas/whatsapp-message-sender");
    _alreadyReadMessageIds.clear();

    await sendTypingIndicator("919876543210", "wamid.test123");

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].body.status).toBe("read");
    expect(fetchCalls[0].body.message_id).toBe("wamid.test123");
    expect(fetchCalls[0].body.typing_indicator).toEqual({ type: "text" });
  });

  it("second sendTypingIndicator with same messageId re-sends read+typing", async () => {
    jest.resetModules();
    const { sendTypingIndicator, _alreadyReadMessageIds } = require("../../src/lambdas/whatsapp-message-sender");
    _alreadyReadMessageIds.clear();

    await sendTypingIndicator("919876543210", "wamid.test456");
    fetchCalls = [];

    await sendTypingIndicator("919876543210", "wamid.test456");

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].body.status).toBe("read");
    expect(fetchCalls[0].body.message_id).toBe("wamid.test456");
    expect(fetchCalls[0].body.typing_indicator).toEqual({ type: "text" });
  });

  it("third, fourth calls also re-send typing via markMessageAsRead", async () => {
    jest.resetModules();
    const { sendTypingIndicator, _alreadyReadMessageIds } = require("../../src/lambdas/whatsapp-message-sender");
    _alreadyReadMessageIds.clear();

    await sendTypingIndicator("919876543210", "wamid.multi");
    fetchCalls = [];

    await sendTypingIndicator("919876543210", "wamid.multi");
    await sendTypingIndicator("919876543210", "wamid.multi");
    await sendTypingIndicator("919876543210", "wamid.multi");

    expect(fetchCalls).toHaveLength(3);
    fetchCalls.forEach(call => {
      expect(call.body.status).toBe("read");
      expect(call.body.typing_indicator).toEqual({ type: "text" });
    });
  });

  it("markMessageAsRead directly also tracks for dedup", async () => {
    jest.resetModules();
    const { markMessageAsRead, sendTypingIndicator, _alreadyReadMessageIds } = require("../../src/lambdas/whatsapp-message-sender");
    _alreadyReadMessageIds.clear();

    await markMessageAsRead("wamid.direct", true);

    fetchCalls = [];
    await sendTypingIndicator("919876543210", "wamid.direct");

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].body.status).toBe("read");
    expect(fetchCalls[0].body.message_id).toBe("wamid.direct");
    expect(fetchCalls[0].body.typing_indicator).toEqual({ type: "text" });
  });

  it("returns error when no messageId is available at all", async () => {
    jest.resetModules();
    const { sendTypingIndicator, _alreadyReadMessageIds } = require("../../src/lambdas/whatsapp-message-sender");
    _alreadyReadMessageIds.clear();

    const result = await sendTypingIndicator("919876543210", undefined);

    expect(fetchCalls).toHaveLength(0);
    expect(result.success).toBe(false);
  });
});
