/**
 * ONDC Seller Onboarding — Unit Tests
 * 
 * Tests the WhatsApp-based ONDC seller profile collection,
 * AI field extraction, business category inference, and pincode lookup.
 */

const mockSend = jest.fn();

// Mock the Bedrock Runtime SDK — the service creates its own client instance
jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  InvokeModelCommand: jest.fn().mockImplementation((input) => input),
}));

import {
  createDefaultONDCDetails,
  checkONDCProfileStatus,
  generatePromptForField,
  extractONDCDetailsFromMessage,
  inferBusinessCategory,
  lookupPincode,
  ONDCSelllerDetails,
} from '../../src/services/ondc-seller-onboarding';

// Mock fetch for India Post API
global.fetch = jest.fn() as jest.Mock;

/** Helper: build a full ONDCSelllerDetails with overrides */
function makeDetails(overrides: Partial<ONDCSelllerDetails> = {}): ONDCSelllerDetails {
  return {
    businessName: 'Ramesh Kirana Store',
    businessCategory: 'ONDC:RET10',
    fulfillmentTypes: ['Delivery', 'Self-Pickup'],
    upiId: 'ramesh@paytm',
    location: { pincode: '411001', city: 'Pune', state: 'Maharashtra' },
    timeToShip: 'P2D',
    returnable: false,
    returnWindow: 'P0D',
    cancellable: true,
    availableOnCOD: true,
    consumerCareContact: '919876543210,support@vyaparvaani.in',
    ...overrides,
  };
}

describe('ONDC Seller Onboarding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createDefaultONDCDetails', () => {
    test('creates complete default ONDC details with correct shape', () => {
      const defaults = createDefaultONDCDetails('Test Seller', '919876543210');

      expect(defaults.businessName).toBe('Test Seller');
      expect(defaults.businessCategory).toBe('ONDC:RET10');
      expect(defaults.fulfillmentTypes).toContain('Delivery');
      expect(defaults.fulfillmentTypes).toContain('Self-Pickup');
      expect(defaults.returnable).toBe(false);
      expect(defaults.cancellable).toBe(true);
      expect(defaults.availableOnCOD).toBe(true);
      expect(defaults.timeToShip).toBe('P2D');
    });

    test('creates sensible defaults for rural merchants', () => {
      const defaults = createDefaultONDCDetails('Ramesh', '919999999999');

      // Rural merchants typically:
      // - Don't accept returns (perishable goods)
      // - Accept COD (limited digital payment access)
      // - Both delivery and pickup
      expect(defaults.returnable).toBe(false);
      expect(defaults.availableOnCOD).toBe(true);
      expect(defaults.consumerCareContact).toContain('919999999999');
    });

    test('sets empty location for later pincode-based population', () => {
      const defaults = createDefaultONDCDetails('Test', '911234567890');

      expect(defaults.location.pincode).toBe('');
      expect(defaults.location.city).toBe('');
      expect(defaults.location.state).toBe('');
    });
  });

  describe('checkONDCProfileStatus', () => {
    test('identifies missing essential fields', () => {
      const partial = makeDetails({
        businessName: 'Ramesh Store',
        upiId: undefined,
        location: { pincode: '', city: '', state: '' },
      });

      const status = checkONDCProfileStatus(partial);

      expect(status.complete).toBe(false);
      expect(status.missingFields.length).toBeGreaterThan(0);
      expect(status.missingFields).toContain('pincode');
      expect(status.missingFields).toContain('upiId');
    });

    test('marks complete profile as ready', () => {
      const complete = makeDetails();

      const status = checkONDCProfileStatus(complete);
      expect(status.complete).toBe(true);
      expect(status.missingFields).toHaveLength(0);
      expect(status.completionPercent).toBe(100);
    });

    test('skips non-essential fields like GSTIN and FSSAI', () => {
      // Only 4 essential fields: businessName, pincode, upiId, fulfillmentType
      const profile = makeDetails();

      const status = checkONDCProfileStatus(profile);
      expect(status.complete).toBe(true);
    });

    test('generates next prompt for first missing field', () => {
      const partial = makeDetails({
        location: { pincode: '', city: '', state: '' },
        upiId: undefined,
      });

      const status = checkONDCProfileStatus(partial);
      expect(status.nextPrompt).toBeDefined();
      expect(status.nextPrompt!.field).toBe('pincode');
    });

    test('returns correct completion percentage', () => {
      // Missing 2 of 4 → 50%
      const half = makeDetails({
        location: { pincode: '', city: '', state: '' },
        upiId: undefined,
      });

      const status = checkONDCProfileStatus(half);
      expect(status.completionPercent).toBe(50);
    });

    test('detects missing fulfillmentTypes', () => {
      const noFulfillment = makeDetails({ fulfillmentTypes: [] });
      const status = checkONDCProfileStatus(noFulfillment);
      expect(status.complete).toBe(false);
      expect(status.missingFields).toContain('fulfillmentType');
    });
  });

  describe('generatePromptForField', () => {
    test('generates multilingual voice prompt for businessName', () => {
      const prompt = generatePromptForField('businessName');

      expect(prompt).toBeDefined();
      expect(prompt!.field).toBe('businessName');
      expect(prompt!.type).toBe('voice');
      expect(prompt!.voicePrompt.hi).toBeTruthy();
      expect(prompt!.voicePrompt.en).toBeTruthy();
      expect(prompt!.voicePrompt.mr).toBeTruthy();
    });

    test('generates voice prompt for pincode', () => {
      const prompt = generatePromptForField('pincode');

      expect(prompt).toBeDefined();
      expect(prompt!.field).toBe('pincode');
      expect(prompt!.voicePrompt.en).toContain('pincode');
    });

    test('generates voice prompt for upiId', () => {
      const prompt = generatePromptForField('upiId');

      expect(prompt).toBeDefined();
      expect(prompt!.field).toBe('upiId');
      expect(prompt!.voicePrompt.en).toContain('UPI');
    });

    test('generates button prompt for fulfillmentType', () => {
      const prompt = generatePromptForField('fulfillmentType');

      expect(prompt).toBeDefined();
      expect(prompt!.type).toBe('button');
      expect(prompt!.options).toBeDefined();
      expect(prompt!.options!.length).toBe(3);
    });

    test('generates prompts for all essential fields', () => {
      const fields = ['businessName', 'pincode', 'upiId', 'fulfillmentType'];

      fields.forEach((field) => {
        const prompt = generatePromptForField(field);
        expect(prompt).toBeDefined();
        expect(prompt!.voicePrompt).toBeDefined();
        // Every prompt has Hindi, English, and Marathi
        expect(Object.keys(prompt!.voicePrompt).length).toBeGreaterThanOrEqual(3);
      });
    });

    test('falls back to businessName for unknown field', () => {
      const prompt = generatePromptForField('unknownField');
      expect(prompt).toBeDefined();
      expect(prompt!.field).toBe('businessName');
    });
  });

  describe('extractONDCDetailsFromMessage', () => {
    test('extracts pincode from Hindi message', async () => {
      mockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({
          output: {
            message: {
              content: [{ text: '{"value": "411001", "confidence": 0.95}' }],
            },
          },
        })),
      });

      const result = await extractONDCDetailsFromMessage(
        'mera pincode 411001 hai',
        'pincode',
        'hi'
      );

      expect(result).toBeDefined();
      expect(result!.field).toBe('pincode');
      expect(result!.value).toBe('411001');
      expect(result!.confidence).toBeGreaterThanOrEqual(0.9);
    });

    test('extracts UPI ID from message', async () => {
      mockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({
          output: {
            message: {
              content: [{ text: '{"value": "ramesh@paytm", "confidence": 0.9}' }],
            },
          },
        })),
      });

      const result = await extractONDCDetailsFromMessage(
        'mera upi id hai ramesh@paytm',
        'upiId',
        'hi'
      );

      expect(result).toBeDefined();
      expect(result!.field).toBe('upiId');
      expect(result!.value).toBe('ramesh@paytm');
    });

    test('extracts business name from message', async () => {
      mockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({
          output: {
            message: {
              content: [{ text: '{"value": "Ramesh Kirana Store", "confidence": 0.88}' }],
            },
          },
        })),
      });

      const result = await extractONDCDetailsFromMessage(
        'mera dukan ka naam Ramesh Kirana Store hai',
        'businessName',
        'hi'
      );

      expect(result).toBeDefined();
      expect(result!.field).toBe('businessName');
      expect(result!.value).toBe('Ramesh Kirana Store');
    });

    test('falls back to direct extraction on AI error', async () => {
      mockSend.mockRejectedValue(new Error('Bedrock timeout'));

      // Direct extraction should still find the 6-digit pincode
      const result = await extractONDCDetailsFromMessage(
        'pincode is 411001',
        'pincode',
        'en'
      );

      expect(result).toBeDefined();
      expect(result!.value).toBe('411001');
      expect(result!.confidence).toBeGreaterThanOrEqual(0.9);
    });

    test('falls back to direct extraction for UPI on AI error', async () => {
      mockSend.mockRejectedValue(new Error('timeout'));

      const result = await extractONDCDetailsFromMessage(
        'my upi is shop@ybl',
        'upiId',
        'en'
      );

      expect(result).toBeDefined();
      expect(result!.value).toBe('shop@ybl');
    });
  });

  describe('inferBusinessCategory', () => {
    test('infers grocery category from products', async () => {
      mockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({
          output: {
            message: {
              content: [{ text: '{"domain": "ONDC:RET10", "category": "Grocery", "confidence": 0.92}' }],
            },
          },
        })),
      });

      const result = await inferBusinessCategory([
        'rice', 'dal', 'sugar', 'oil',
      ]);

      expect(result).toBeDefined();
      expect(result.domain).toBe('ONDC:RET10');
      expect(result.category).toBe('Grocery');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    test('returns default for empty product list', async () => {
      const result = await inferBusinessCategory([]);

      expect(result.domain).toBe('ONDC:RET10');
      expect(result.category).toBe('Grocery');
      expect(result.confidence).toBe(0.5);
    });

    test('falls back to grocery on AI error', async () => {
      mockSend.mockRejectedValue(new Error('AI error'));

      const result = await inferBusinessCategory(['shirt', 'jeans']);

      expect(result.domain).toBe('ONDC:RET10');
      expect(result.category).toBe('Grocery');
      expect(result.confidence).toBe(0.5);
    });
  });

  describe('lookupPincode', () => {
    test('looks up valid Indian pincode', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([{
          Status: 'Success',
          PostOffice: [{
            Name: 'Shivajinagar',
            Block: 'Pune',
            Division: 'Pune',
            Region: 'Pune',
            District: 'Pune',
            State: 'Maharashtra',
            Country: 'India',
          }],
        }]),
      });

      const result = await lookupPincode('411005');

      expect(result).toBeDefined();
      expect(result?.city).toBe('Pune');
      expect(result?.state).toBe('Maharashtra');
      expect(result?.district).toBe('Pune');
    });

    test('returns null for invalid pincode', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([{
          Status: 'Error',
          Message: 'No records found',
          PostOffice: null,
        }]),
      });

      const result = await lookupPincode('000000');
      expect(result).toBeNull();
    });

    test('handles API timeout gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network timeout'));

      const result = await lookupPincode('411001');
      expect(result).toBeNull();
    });

    test('returns null for non-ok HTTP response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
      });

      const result = await lookupPincode('411001');
      expect(result).toBeNull();
    });
  });
});
