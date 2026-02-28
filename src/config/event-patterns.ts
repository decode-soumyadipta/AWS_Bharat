/**
 * EventBridge Event Patterns for Vyapar-Vaani
 * 
 * These patterns define the event routing rules for the system.
 * Events are routed based on source and detail-type.
 */

export const EVENT_SOURCES = {
  WHATSAPP: 'vyapar.vaani.whatsapp',
  ONDC: 'vyapar.vaani.ondc',
  INTERNAL: 'vyapar.vaani.internal',
} as const;

export const WHATSAPP_EVENT_TYPES = {
  MESSAGE_RECEIVED_VOICE: 'message.received.voice',
  MESSAGE_RECEIVED_IMAGE: 'message.received.image',
  MESSAGE_RECEIVED_TEXT: 'message.received.text',
  BUTTON_CLICKED: 'button.clicked',
} as const;

export const ONDC_EVENT_TYPES = {
  ORDER_CONFIRM_RECEIVED: 'order.confirm.received',
  ORDER_STATUS_REQUESTED: 'order.status.requested',
  ORDER_CANCEL_RECEIVED: 'order.cancel.received',
  ORDER_UPDATE_RECEIVED: 'order.update.received',
  SEARCH_RECEIVED: 'search.received',
  SELECT_RECEIVED: 'select.received',
  INIT_RECEIVED: 'init.received',
} as const;

export const INTERNAL_EVENT_TYPES = {
  KYC_DOCUMENT_UPLOADED: 'kyc.document.uploaded',
  KYC_VALIDATION_COMPLETE: 'kyc.validation.complete',
  VOICE_TRANSCRIPTION_COMPLETE: 'voice.transcription.complete',
  INTENT_CLASSIFIED: 'intent.classified',
  ENTITIES_EXTRACTED: 'entities.extracted',
  CATALOG_BUILD_REQUESTED: 'catalog.build.requested',
  CATALOG_CREATED: 'catalog.created',
  IMAGE_ENHANCEMENT_COMPLETE: 'image.enhancement.complete',
  INVENTORY_UPDATED: 'inventory.updated',
  ORDER_STATE_CHANGED: 'order.state.changed',
} as const;

/**
 * Event pattern for WhatsApp voice messages
 */
export const WHATSAPP_VOICE_PATTERN = {
  source: [EVENT_SOURCES.WHATSAPP],
  'detail-type': [WHATSAPP_EVENT_TYPES.MESSAGE_RECEIVED_VOICE],
};

/**
 * Event pattern for WhatsApp image messages
 */
export const WHATSAPP_IMAGE_PATTERN = {
  source: [EVENT_SOURCES.WHATSAPP],
  'detail-type': [WHATSAPP_EVENT_TYPES.MESSAGE_RECEIVED_IMAGE],
};

/**
 * Event pattern for WhatsApp text messages
 */
export const WHATSAPP_TEXT_PATTERN = {
  source: [EVENT_SOURCES.WHATSAPP],
  'detail-type': [WHATSAPP_EVENT_TYPES.MESSAGE_RECEIVED_TEXT],
};

/**
 * Event pattern for WhatsApp button clicks
 */
export const WHATSAPP_BUTTON_PATTERN = {
  source: [EVENT_SOURCES.WHATSAPP],
  'detail-type': [WHATSAPP_EVENT_TYPES.BUTTON_CLICKED],
};

/**
 * Event pattern for ONDC order confirmations
 */
export const ONDC_ORDER_CONFIRM_PATTERN = {
  source: [EVENT_SOURCES.ONDC],
  'detail-type': [ONDC_EVENT_TYPES.ORDER_CONFIRM_RECEIVED],
};

/**
 * Event pattern for ONDC order status requests
 */
export const ONDC_ORDER_STATUS_PATTERN = {
  source: [EVENT_SOURCES.ONDC],
  'detail-type': [ONDC_EVENT_TYPES.ORDER_STATUS_REQUESTED],
};

/**
 * Event pattern for ONDC order cancellations
 */
export const ONDC_ORDER_CANCEL_PATTERN = {
  source: [EVENT_SOURCES.ONDC],
  'detail-type': [ONDC_EVENT_TYPES.ORDER_CANCEL_RECEIVED],
};

/**
 * Event pattern for KYC document uploads
 */
export const KYC_DOCUMENT_PATTERN = {
  source: [EVENT_SOURCES.INTERNAL],
  'detail-type': [INTERNAL_EVENT_TYPES.KYC_DOCUMENT_UPLOADED],
};

/**
 * Event pattern for catalog creation
 */
export const CATALOG_CREATION_PATTERN = {
  source: [EVENT_SOURCES.INTERNAL],
  'detail-type': [INTERNAL_EVENT_TYPES.ENTITIES_EXTRACTED],
  detail: {
    intent: ['CREATE_CATALOG'],
  },
};

/**
 * Event pattern for inventory updates
 */
export const INVENTORY_UPDATE_PATTERN = {
  source: [EVENT_SOURCES.INTERNAL],
  'detail-type': [INTERNAL_EVENT_TYPES.ENTITIES_EXTRACTED],
  detail: {
    intent: ['UPDATE_INVENTORY'],
  },
};

/**
 * Event pattern for order management
 */
export const ORDER_MANAGEMENT_PATTERN = {
  source: [EVENT_SOURCES.INTERNAL],
  'detail-type': [INTERNAL_EVENT_TYPES.ENTITIES_EXTRACTED],
  detail: {
    intent: ['ACCEPT_ORDER', 'REJECT_ORDER', 'UPDATE_FULFILLMENT'],
  },
};
