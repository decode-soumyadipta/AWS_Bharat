
export type IntentType =
  | 'CREATE_CATALOG'
  | 'UPDATE_PRICE'
  | 'UPDATE_QUANTITY'
  | 'UPDATE_INVENTORY'
  | 'ACCEPT_ORDER'
  | 'REJECT_ORDER'
  | 'UPDATE_FULFILLMENT'
  | 'QUERY_STATUS'
  | 'CONFIRM_CATALOG'
  | 'CANCEL_ORDER';

export interface IntentClassificationRequest {

  transcribedText: string;

  language?: 'hi-IN' | 'mr-IN' | 'en-IN';

  sellerId?: string;

  messageId?: string;
}

export interface IntentClassificationResponse {

  success: boolean;

  intent?: IntentType;

  confidence?: number;

  language?: 'hi' | 'mr' | 'en';

  needsClarification?: boolean;

  error?: {
    code: string;
    message: string;
  };
}

export interface ClaudeIntentResponse {
  intent: IntentType;
  confidence: number;
  language: 'hi' | 'mr' | 'en';
}

export interface EntityExtractionRequest {

  transcribedText: string;

  intent: IntentType;

  language?: 'hi' | 'mr' | 'en';

  sellerId?: string;

  messageId?: string;
}

export interface EntityExtractionResponse {

  success: boolean;

  entities?: Record<string, any>;

  missingFields?: string[];

  needsClarification?: boolean;

  error?: {
    code: string;
    message: string;
  };
}

export interface CatalogEntities {
  product_name: string | null;
  price: number | null;
  price_per_unit?: boolean | null;
  quantity: number | null;
  unit: string | null;
  description?: string | null;
  category: string | null;
}

export interface InventoryEntities {
  product_identifier: string | null;
  new_quantity: number | null;
  operation: 'SET' | 'INCREMENT' | 'DECREMENT' | null;
}

export interface OrderEntities {
  order_id: string | null;
  action: string | null;
  reason?: string | null;
}

export interface PriceUpdateEntities {
  new_price: number | null;
  product_name?: string | null;
}

export interface QuantityUpdateEntities {
  new_quantity: number | null;
  product_name?: string | null;
}
