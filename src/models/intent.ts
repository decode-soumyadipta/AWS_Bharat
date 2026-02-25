/**
 * Intent Classification and Entity Extraction Models
 * 
 * Type definitions for AI-powered intent classification and entity extraction
 * using Claude 3.5 Sonnet via Amazon Bedrock.
 * 
 * Validates: Requirements 2.2, 4.2, 4.3, 12.8
 */

/**
 * Supported intent types for voice-to-protocol translation
 */
export type IntentType =
  | 'CREATE_CATALOG'
  | 'UPDATE_INVENTORY'
  | 'ACCEPT_ORDER'
  | 'REJECT_ORDER'
  | 'UPDATE_FULFILLMENT'
  | 'QUERY_STATUS';

/**
 * Intent classification request
 */
export interface IntentClassificationRequest {
  /**
   * Transcribed text from voice note
   */
  transcribedText: string;

  /**
   * Detected language from transcription
   */
  language?: 'hi-IN' | 'mr-IN' | 'en-IN';

  /**
   * Seller ID for context
   */
  sellerId?: string;

  /**
   * Message ID for correlation
   */
  messageId?: string;
}

/**
 * Intent classification response
 */
export interface IntentClassificationResponse {
  /**
   * Whether classification was successful
   */
  success: boolean;

  /**
   * Classified intent type
   */
  intent?: IntentType;

  /**
   * Confidence score (0.0 to 1.0)
   */
  confidence?: number;

  /**
   * Detected language from the text
   */
  language?: 'hi' | 'mr' | 'en';

  /**
   * Whether clarification is needed (confidence < 70%)
   */
  needsClarification?: boolean;

  /**
   * Error information (if failed)
   */
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Claude API response structure for intent classification
 */
export interface ClaudeIntentResponse {
  intent: IntentType;
  confidence: number;
  language: 'hi' | 'mr' | 'en';
}

/**
 * Entity extraction request
 */
export interface EntityExtractionRequest {
  /**
   * Transcribed text from voice note
   */
  transcribedText: string;

  /**
   * Classified intent type
   */
  intent: IntentType;

  /**
   * Detected language
   */
  language?: 'hi' | 'mr' | 'en';

  /**
   * Seller ID for context
   */
  sellerId?: string;

  /**
   * Message ID for correlation
   */
  messageId?: string;
}

/**
 * Entity extraction response
 */
export interface EntityExtractionResponse {
  /**
   * Whether extraction was successful
   */
  success: boolean;

  /**
   * Extracted entities (structure depends on intent)
   */
  entities?: Record<string, any>;

  /**
   * Missing required fields
   */
  missingFields?: string[];

  /**
   * Whether clarification is needed
   */
  needsClarification?: boolean;

  /**
   * Error information (if failed)
   */
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Catalog creation entities
 */
export interface CatalogEntities {
  product_name: string | null;
  price: number | null;
  quantity: number | null;
  unit: string | null;
  description?: string | null;
  category: string | null;
}

/**
 * Inventory update entities
 */
export interface InventoryEntities {
  product_identifier: string | null;
  new_quantity: number | null;
  operation: 'SET' | 'INCREMENT' | 'DECREMENT' | null;
}

/**
 * Order action entities
 */
export interface OrderEntities {
  order_id: string | null;
  action: string | null;
  reason?: string | null;
}
