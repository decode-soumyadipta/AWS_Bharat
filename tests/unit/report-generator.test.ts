/**
 * Report Generator Tests
 * 
 * Tests for the PDF report generation feature:
 * 1. Intent detection (Hindi/English/Devanagari triggers)
 * 2. Report generation (data assembly, PDF building)
 * 3. Voice summary generation
 * 4. sendDocumentMessage payload structure
 * 5. Source contract tests
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..', '..', 'src');
const readSrc = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf-8');

// ── 1. SOURCE-CODE CONTRACT TESTS ─────────────────────────────────────────

describe('Report generator — source contracts', () => {
  const reportGen = readSrc('services/report-generator.ts');
  const enhancedAgent = readSrc('services/enhanced-agent.ts');
  const messageSender = readSrc('lambdas/whatsapp-message-sender.ts');
  const whatsappModel = readSrc('models/whatsapp.ts');

  it('report-generator.ts exports generateReport function', () => {
    expect(reportGen).toMatch(/export\s+async\s+function\s+generateReport/);
  });

  it('report-generator.ts exports detectReportIntent function', () => {
    expect(reportGen).toMatch(/export\s+function\s+detectReportIntent/);
  });

  it('supports weekly, monthly, and custom report types', () => {
    expect(reportGen).toContain("'weekly' | 'monthly' | 'custom'");
  });

  it('generates PDF using pdfmake', () => {
    expect(reportGen).toContain("require('pdfmake')");
    expect(reportGen).toContain("require('pdfmake/build/vfs_fonts')");
  });

  it('uploads PDF to S3 with correct content type', () => {
    expect(reportGen).toContain("ContentType: 'application/pdf'");
    expect(reportGen).toContain('PRODUCTS_BUCKET_NAME');
  });

  it('generates pre-signed URL valid for 24 hours', () => {
    expect(reportGen).toContain('expiresIn: 86400');
  });

  it('includes AI recommendations via Bedrock Nova Lite', () => {
    expect(reportGen).toContain('amazon.nova-lite-v1:0');
    expect(reportGen).toContain('generateRecommendations');
  });

  it('builds voice summary for WhatsApp delivery', () => {
    expect(reportGen).toContain('buildVoiceSummary');
  });

  it('enhanced-agent.ts imports and uses detectReportIntent', () => {
    expect(enhancedAgent).toContain('detectReportIntent');
    expect(enhancedAgent).toContain('generateReport');
  });

  it('enhanced-agent.ts sends document via sendDocumentMessage', () => {
    expect(enhancedAgent).toContain('sendDocumentMessage');
  });

  describe('WhatsApp document message support', () => {
    it('WhatsAppOutboundMessage type includes document', () => {
      expect(whatsappModel).toContain("'document'");
      expect(whatsappModel).toContain('documentUrl');
      expect(whatsappModel).toContain('documentFilename');
    });

    it('message sender has sendDocumentMessage function', () => {
      expect(messageSender).toMatch(/export\s+async\s+function\s+sendDocumentMessage/);
    });

    it('message sender builds document payload with link and filename', () => {
      expect(messageSender).toContain("case 'document':");
      expect(messageSender).toContain('document:');
      expect(messageSender).toContain('link: message.content.documentUrl');
      expect(messageSender).toContain("filename: message.content.documentFilename || 'report.pdf'");
    });

    it('handler has document case', () => {
      expect(messageSender).toContain("case 'document':");
      expect(messageSender).toContain('sendDocumentMessage');
    });
  });
});

// ── 2. INTENT DETECTION TESTS ──────────────────────────────────────────────

describe('Report intent detection', () => {
  // We import the actual function for runtime tests
  let detectReportIntent: any;

  beforeAll(() => {
    // Set up required env vars
    process.env.AWS_REGION = 'us-east-1';
    process.env.TABLE_NAME = 'test-table';

    const reportGen = require('../../src/services/report-generator');
    detectReportIntent = reportGen.detectReportIntent;
  });

  describe('Hindi/Devanagari triggers', () => {
    it('detects "हफ्ते की रिपोर्ट" as weekly', () => {
      expect(detectReportIntent('हफ्ते की रिपोर्ट')).toEqual({ reportType: 'weekly' });
    });

    it('detects "हफ्ते का हिसाब" as weekly', () => {
      expect(detectReportIntent('हफ्ते का हिसाब')).toEqual({ reportType: 'weekly' });
    });

    it('detects "महीने की रिपोर्ट" as monthly', () => {
      expect(detectReportIntent('महीने की रिपोर्ट')).toEqual({ reportType: 'monthly' });
    });

    it('detects "महीने का हिसाब" as monthly', () => {
      const result = detectReportIntent('महीने का हिसाब');
      expect(result).not.toBeNull();
      expect(result!.reportType).toBe('monthly');
    });

    it('detects "पिछले हफ्ते" as weekly', () => {
      const result = detectReportIntent('पिछले हफ्ते');
      expect(result).not.toBeNull();
      expect(result!.reportType).toBe('weekly');
    });

    it('detects generic "रिपोर्ट" as weekly (default)', () => {
      expect(detectReportIntent('रिपोर्ट भेजो')).toEqual({ reportType: 'weekly' });
    });

    it('detects "बिक्री की रिपोर्ट" as weekly', () => {
      expect(detectReportIntent('बिक्री की रिपोर्ट')).toEqual({ reportType: 'weekly' });
    });
  });

  describe('English triggers', () => {
    it('detects "weekly report" as weekly', () => {
      expect(detectReportIntent('weekly report')).toEqual({ reportType: 'weekly' });
    });

    it('detects "monthly report" as monthly', () => {
      expect(detectReportIntent('monthly report')).toEqual({ reportType: 'monthly' });
    });

    it('detects "send me a report" as weekly', () => {
      const result = detectReportIntent('send me a report');
      expect(result).not.toBeNull();
      expect(result!.reportType).toBe('weekly');
    });

    it('detects "PDF" as weekly', () => {
      const result = detectReportIntent('PDF bhejo');
      expect(result).not.toBeNull();
      expect(result!.reportType).toBe('weekly');
    });

    it('detects "sales report" as weekly', () => {
      expect(detectReportIntent('sales report')).toEqual({ reportType: 'weekly' });
    });

    it('detects "business report" as weekly', () => {
      expect(detectReportIntent('business report')).toEqual({ reportType: 'weekly' });
    });
  });

  describe('Custom date range', () => {
    it('detects date range with "report"', () => {
      const result = detectReportIntent('report 2024-01-01 to 2024-01-31');
      expect(result).not.toBeNull();
      expect(result!.reportType).toBe('custom');
      expect(result!.customStart).toBe('2024-01-01');
      expect(result!.customEnd).toBe('2024-01-31');
    });

    it('detects Hindi date range with "रिपोर्ट"', () => {
      const result = detectReportIntent('2024-03-01 से 2024-03-31 रिपोर्ट');
      expect(result).not.toBeNull();
      expect(result!.reportType).toBe('custom');
      expect(result!.customStart).toBe('2024-03-01');
      expect(result!.customEnd).toBe('2024-03-31');
    });
  });

  describe('Non-report messages', () => {
    it('returns null for regular messages', () => {
      expect(detectReportIntent('tamatar bechna hai')).toBeNull();
      expect(detectReportIntent('namaste')).toBeNull();
      expect(detectReportIntent('mera product dikhao')).toBeNull();
      expect(detectReportIntent('50 rupaye kilo')).toBeNull();
    });
  });
});

// ── 3. DOCUMENT MESSAGE TESTS ──────────────────────────────────────────────

describe('sendDocumentMessage — payload structure', () => {
  let fetchCalls: any[];
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchCalls = [];
    process.env.WHATSAPP_API_ENDPOINT = 'https://graph.facebook.com/v22.0';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';

    (global as any).fetch = jest.fn(async (_url: string, opts: any) => {
      const body = JSON.parse(opts.body);
      fetchCalls.push(body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ messages: [{ id: 'wamid.doc1' }] }),
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

  it('sends correct document payload to WhatsApp API', async () => {
    jest.resetModules();
    const { sendDocumentMessage } = require('../../src/lambdas/whatsapp-message-sender');

    await sendDocumentMessage(
      '919876543210',
      'https://s3.amazonaws.com/bucket/report.pdf',
      'weekly-report.pdf',
      '📊 Weekly Business Report',
      'hi'
    );

    expect(fetchCalls).toHaveLength(1);
    const payload = fetchCalls[0];
    expect(payload.messaging_product).toBe('whatsapp');
    expect(payload.type).toBe('document');
    expect(payload.to).toBe('919876543210');
    expect(payload.document).toBeDefined();
    expect(payload.document.link).toBe('https://s3.amazonaws.com/bucket/report.pdf');
    expect(payload.document.filename).toBe('weekly-report.pdf');
    expect(payload.document.caption).toBe('📊 Weekly Business Report');
  });
});

// ── 4. ENHANCED AGENT PROMPT TESTS ─────────────────────────────────────────

describe('Enhanced agent — report feature in prompt', () => {
  const enhancedAgent = readSrc('services/enhanced-agent.ts');

  it('mentions report feature in help/features list', () => {
    expect(enhancedAgent).toContain('PDF business reports');
  });

  it('has REPORT FEATURE GUIDANCE section', () => {
    expect(enhancedAgent).toContain('REPORT FEATURE GUIDANCE');
  });

  it('tells AI about report triggers', () => {
    expect(enhancedAgent).toContain('रिपोर्ट');
    expect(enhancedAgent).toContain('हिसाब');
    expect(enhancedAgent).toContain('PDF');
  });

  it('sends generating message before report generation', () => {
    expect(enhancedAgent).toContain('रिपोर्ट बना रहा हूँ');
  });
});
