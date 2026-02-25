import {
  EVENT_SOURCES,
  WHATSAPP_EVENT_TYPES,
  ONDC_EVENT_TYPES,
  INTERNAL_EVENT_TYPES,
  WHATSAPP_VOICE_PATTERN,
  WHATSAPP_IMAGE_PATTERN,
  WHATSAPP_TEXT_PATTERN,
  WHATSAPP_BUTTON_PATTERN,
  ONDC_ORDER_CONFIRM_PATTERN,
  ONDC_ORDER_STATUS_PATTERN,
  ONDC_ORDER_CANCEL_PATTERN,
  KYC_DOCUMENT_PATTERN,
  CATALOG_CREATION_PATTERN,
  INVENTORY_UPDATE_PATTERN,
  ORDER_MANAGEMENT_PATTERN,
} from '../../src/config/event-patterns';

describe('Event Patterns Configuration', () => {
  describe('Event Sources', () => {
    it('should define WhatsApp event source', () => {
      expect(EVENT_SOURCES.WHATSAPP).toBe('vyapar.vaani.whatsapp');
    });

    it('should define ONDC event source', () => {
      expect(EVENT_SOURCES.ONDC).toBe('vyapar.vaani.ondc');
    });

    it('should define internal event source', () => {
      expect(EVENT_SOURCES.INTERNAL).toBe('vyapar.vaani.internal');
    });
  });

  describe('WhatsApp Event Types', () => {
    it('should define voice message event type', () => {
      expect(WHATSAPP_EVENT_TYPES.MESSAGE_RECEIVED_VOICE).toBe('message.received.voice');
    });

    it('should define image message event type', () => {
      expect(WHATSAPP_EVENT_TYPES.MESSAGE_RECEIVED_IMAGE).toBe('message.received.image');
    });

    it('should define text message event type', () => {
      expect(WHATSAPP_EVENT_TYPES.MESSAGE_RECEIVED_TEXT).toBe('message.received.text');
    });

    it('should define button clicked event type', () => {
      expect(WHATSAPP_EVENT_TYPES.BUTTON_CLICKED).toBe('button.clicked');
    });
  });

  describe('ONDC Event Types', () => {
    it('should define order confirm event type', () => {
      expect(ONDC_EVENT_TYPES.ORDER_CONFIRM_RECEIVED).toBe('order.confirm.received');
    });

    it('should define order status event type', () => {
      expect(ONDC_EVENT_TYPES.ORDER_STATUS_REQUESTED).toBe('order.status.requested');
    });

    it('should define order cancel event type', () => {
      expect(ONDC_EVENT_TYPES.ORDER_CANCEL_RECEIVED).toBe('order.cancel.received');
    });
  });

  describe('Internal Event Types', () => {
    it('should define KYC document uploaded event type', () => {
      expect(INTERNAL_EVENT_TYPES.KYC_DOCUMENT_UPLOADED).toBe('kyc.document.uploaded');
    });

    it('should define intent classified event type', () => {
      expect(INTERNAL_EVENT_TYPES.INTENT_CLASSIFIED).toBe('intent.classified');
    });

    it('should define entities extracted event type', () => {
      expect(INTERNAL_EVENT_TYPES.ENTITIES_EXTRACTED).toBe('entities.extracted');
    });
  });

  describe('Event Patterns', () => {
    it('should create WhatsApp voice pattern', () => {
      expect(WHATSAPP_VOICE_PATTERN).toEqual({
        source: ['vyapar.vaani.whatsapp'],
        'detail-type': ['message.received.voice'],
      });
    });

    it('should create WhatsApp image pattern', () => {
      expect(WHATSAPP_IMAGE_PATTERN).toEqual({
        source: ['vyapar.vaani.whatsapp'],
        'detail-type': ['message.received.image'],
      });
    });

    it('should create ONDC order confirm pattern', () => {
      expect(ONDC_ORDER_CONFIRM_PATTERN).toEqual({
        source: ['vyapar.vaani.ondc'],
        'detail-type': ['order.confirm.received'],
      });
    });

    it('should create catalog creation pattern with intent filter', () => {
      expect(CATALOG_CREATION_PATTERN).toEqual({
        source: ['vyapar.vaani.internal'],
        'detail-type': ['entities.extracted'],
        detail: {
          intent: ['CREATE_CATALOG'],
        },
      });
    });

    it('should create inventory update pattern with intent filter', () => {
      expect(INVENTORY_UPDATE_PATTERN).toEqual({
        source: ['vyapar.vaani.internal'],
        'detail-type': ['entities.extracted'],
        detail: {
          intent: ['UPDATE_INVENTORY'],
        },
      });
    });

    it('should create order management pattern with multiple intents', () => {
      expect(ORDER_MANAGEMENT_PATTERN).toEqual({
        source: ['vyapar.vaani.internal'],
        'detail-type': ['entities.extracted'],
        detail: {
          intent: ['ACCEPT_ORDER', 'REJECT_ORDER', 'UPDATE_FULFILLMENT'],
        },
      });
    });
  });
});
