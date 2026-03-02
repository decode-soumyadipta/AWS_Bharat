/**
 * Beckn Protocol v1.2.0 Complete Type Definitions
 * 
 * Full type system for all Beckn transaction APIs used in ONDC.
 * Covers: search, select, init, confirm, status, track, cancel, update, rating, support
 * and their on_* callback counterparts.
 */

// ============================================================================
// CORE BECKN TYPES
// ============================================================================

/**
 * Beckn Context — present in every request/response
 */
export interface BecknContext {
  domain: string;               // e.g., 'ONDC:RET10' (Grocery)
  country: string;              // 'IND'
  city: string;                 // e.g., 'std:080' (Bangalore)
  action: BecknAction;
  core_version: '1.2.0';
  bap_id: string;               // Buyer App subscriber ID
  bap_uri: string;              // Buyer App callback URI
  bpp_id: string;               // Seller Platform subscriber ID
  bpp_uri: string;              // Seller Platform callback URI
  transaction_id: string;       // UUID — unique per transaction
  message_id: string;           // UUID — unique per message
  timestamp: string;            // ISO 8601
  ttl?: string;                 // ISO 8601 Duration (e.g., 'PT30S')
  key?: string;                 // Encryption key
}

export type BecknAction =
  | 'search' | 'on_search'
  | 'select' | 'on_select'
  | 'init' | 'on_init'
  | 'confirm' | 'on_confirm'
  | 'status' | 'on_status'
  | 'track' | 'on_track'
  | 'cancel' | 'on_cancel'
  | 'update' | 'on_update'
  | 'rating' | 'on_rating'
  | 'support' | 'on_support';

// ============================================================================
// BECKN ENTITIES
// ============================================================================

export interface BecknDescriptorFull {
  name: string;
  code?: string;
  symbol?: string;
  short_desc?: string;
  long_desc?: string;
  images?: Array<{ url: string; size_type?: string }>;
  audio?: string;
  '3d_render'?: string;
}

export interface BecknLocation {
  id: string;
  gps: string;                  // 'lat,long'
  address?: {
    door?: string;
    name?: string;
    building?: string;
    street?: string;
    locality: string;
    ward?: string;
    city: string;
    state: string;
    country: string;
    area_code: string;          // Pincode
  };
  circle?: {
    gps: string;
    radius: { type: string; value: string };
  };
  time?: {
    label?: string;
    timestamp?: string;
    duration?: string;
    range?: { start: string; end: string };
    days?: string;
    schedule?: { frequency?: string; holidays?: string[]; times?: string[] };
  };
}

export interface BecknFulfillment {
  id: string;
  type: 'Delivery' | 'Self-Pickup';
  '@ondc/org/category'?: string;
  '@ondc/org/TAT'?: string;     // ISO 8601 Duration (e.g., 'P2D')
  provider_id?: string;
  tracking?: boolean;
  state?: {
    descriptor: { code: string; name?: string };
  };
  start?: {
    location?: BecknLocation;
    time?: { range?: { start: string; end: string }; timestamp?: string };
    contact?: { phone: string; email?: string };
    person?: { name: string };
    instructions?: { code: string; name: string; short_desc?: string; long_desc?: string };
  };
  end?: {
    location?: BecknLocation;
    time?: { range?: { start: string; end: string }; timestamp?: string };
    contact?: { phone: string; email?: string };
    person?: { name: string };
    instructions?: { code: string; name: string; short_desc?: string; long_desc?: string };
  };
  tags?: BecknTagGroup[];
}

export interface BecknTagGroup {
  code: string;
  list: Array<{ code: string; value: string }>;
}

export interface BecknPayment {
  uri?: string;
  tl_method?: string;
  params?: {
    currency?: string;
    transaction_id?: string;
    amount?: string;
  };
  type: 'PRE-FULFILLMENT' | 'ON-FULFILLMENT' | 'POST-FULFILLMENT' | 'ON-ORDER';
  status: 'PAID' | 'NOT-PAID';
  collected_by?: 'BAP' | 'BPP';
  '@ondc/org/buyer_app_finder_fee_type'?: 'percent' | 'amount';
  '@ondc/org/buyer_app_finder_fee_amount'?: string;
  '@ondc/org/settlement_basis'?: string;
  '@ondc/org/settlement_window'?: string;
  '@ondc/org/withholding_amount'?: string;
  '@ondc/org/settlement_details'?: Array<{
    settlement_counterparty: string;
    settlement_phase: string;
    settlement_type: string;
    settlement_bank_account_no?: string;
    settlement_ifsc_code?: string;
    upi_address?: string;
    bank_name?: string;
    branch_name?: string;
    beneficiary_name?: string;
  }>;
}

export interface BecknQuotation {
  price: { currency: string; value: string };
  breakup: Array<{
    '@ondc/org/item_id': string;
    '@ondc/org/item_quantity'?: { count: number };
    title: string;
    '@ondc/org/title_type': 'item' | 'delivery' | 'packing' | 'tax' | 'misc' | 'discount';
    price: { currency: string; value: string };
    item?: { price?: { currency: string; value: string } };
  }>;
  ttl?: string;
}

export interface BecknItem {
  id: string;
  fulfillment_id: string;
  quantity: { count: number };
  // Additional fields populated by BPP
  descriptor?: BecknDescriptorFull;
  price?: { currency: string; value: string };
  category_id?: string;
  location_id?: string;
  tags?: BecknTagGroup[];
}

export interface BecknBilling {
  name: string;
  address?: {
    door?: string;
    name?: string;
    building?: string;
    street?: string;
    locality: string;
    city: string;
    state: string;
    country: string;
    area_code: string;
  };
  email?: string;
  phone: string;
  created_at?: string;
  updated_at?: string;
}

export interface BecknOrder {
  id?: string;
  state?: string;
  provider: { id: string; locations?: Array<{ id: string }> };
  items: BecknItem[];
  billing?: BecknBilling;
  fulfillments?: BecknFulfillment[];
  quote?: BecknQuotation;
  payment?: BecknPayment;
  created_at?: string;
  updated_at?: string;
  tags?: BecknTagGroup[];
}

export interface BecknCancellationTerm {
  fulfillment_state: { descriptor: { code: string } };
  cancellation_fee?: { percentage?: string; amount?: { currency: string; value: string } };
  reason_required?: boolean;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Generic Beckn request wrapper
 */
export interface BecknRequest<T = any> {
  context: BecknContext;
  message: T;
}

/**
 * Generic Beckn response (used for on_* callbacks)
 */
export interface BecknResponse<T = any> {
  context: BecknContext;
  message: T;
  error?: BecknError;
}

export interface BecknError {
  type: string;
  code: string;
  path?: string;
  message: string;
}

// --- search / on_search ---
export interface SearchMessage {
  intent: {
    item?: { descriptor?: { name?: string }; category?: { id?: string }; price?: { minimum_value?: string; maximum_value?: string } };
    fulfillment?: { type?: string; end?: { location?: { gps?: string; area_code?: string } } };
    provider?: { id?: string; descriptor?: { name?: string }; locations?: Array<{ id: string }> };
    category?: { id?: string };
    payment?: { '@ondc/org/buyer_app_finder_fee_type'?: string; '@ondc/org/buyer_app_finder_fee_amount'?: string };
    tags?: BecknTagGroup[];
  };
}

export interface OnSearchMessage {
  catalog: {
    'bpp/descriptor': BecknDescriptorFull;
    'bpp/fulfillments'?: Array<{ id: string; type: string }>;
    'bpp/providers': Array<{
      id: string;
      descriptor: BecknDescriptorFull;
      locations: BecknLocation[];
      items: Array<BecknCatalogItemFull>;
      fulfillments?: Array<{ id: string; type: string; contact?: { phone: string; email?: string } }>;
      categories?: Array<{ id: string; descriptor: BecknDescriptorFull }>;
      offers?: any[];
      tags?: BecknTagGroup[];
      time?: { label: string; timestamp: string };
      ttl?: string;
    }>;
  };
}

export interface BecknCatalogItemFull {
  id: string;
  descriptor: BecknDescriptorFull;
  price: { currency: string; value: string; maximum_value?: string };
  quantity: { available: { count: number }; maximum?: { count: number }; unitized?: { measure: { unit: string; value: string } } };
  category_id: string;
  fulfillment_id: string;
  location_id: string;
  time?: { label: string; timestamp: string };
  tags?: BecknTagGroup[];
  '@ondc/org/returnable'?: boolean;
  '@ondc/org/cancellable'?: boolean;
  '@ondc/org/return_window'?: string;
  '@ondc/org/seller_pickup_return'?: boolean;
  '@ondc/org/time_to_ship'?: string;
  '@ondc/org/available_on_cod'?: boolean;
  '@ondc/org/contact_details_consumer_care'?: string;
  '@ondc/org/statutory_reqs_packaged_commodities'?: BecknTagGroup;
  '@ondc/org/statutory_reqs_prepackaged_food'?: BecknTagGroup;
}

// --- select / on_select ---
export interface SelectMessage {
  order: {
    provider: { id: string; locations?: Array<{ id: string }> };
    items: Array<{ id: string; quantity: { count: number } }>;
    fulfillments?: Array<{ end?: { location?: BecknLocation } }>;
  };
}

export interface OnSelectMessage {
  order: {
    provider: { id: string };
    items: Array<{ id: string; fulfillment_id: string; quantity: { count: number } }>;
    fulfillments: BecknFulfillment[];
    quote: BecknQuotation;
    ttl?: string;
  };
}

// --- init / on_init ---
export interface InitMessage {
  order: {
    provider: { id: string };
    items: Array<{ id: string; quantity: { count: number } }>;
    billing: BecknBilling;
    fulfillments: Array<{
      id: string;
      type: string;
      end: { location: BecknLocation; contact: { phone: string; email?: string }; person?: { name: string } };
    }>;
  };
}

export interface OnInitMessage {
  order: {
    provider: { id: string };
    items: Array<{ id: string; fulfillment_id: string; quantity: { count: number } }>;
    billing: BecknBilling;
    fulfillments: BecknFulfillment[];
    quote: BecknQuotation;
    payment: BecknPayment;
    cancellation_terms?: BecknCancellationTerm[];
    tags?: BecknTagGroup[];
  };
}

// --- confirm / on_confirm ---
export interface ConfirmMessage {
  order: BecknOrder;
}

export interface OnConfirmMessage {
  order: BecknOrder & {
    id: string;
    state: 'Created' | 'Accepted';
    created_at: string;
    updated_at: string;
  };
}

// --- status / on_status ---
export interface StatusMessage {
  order_id: string;
}

export interface OnStatusMessage {
  order: BecknOrder & {
    id: string;
    state: string;
    fulfillments: BecknFulfillment[];
  };
}

// --- cancel / on_cancel ---
export interface CancelMessage {
  order_id: string;
  cancellation_reason_id: string;
  descriptor?: BecknDescriptorFull;
}

export interface OnCancelMessage {
  order: BecknOrder & {
    id: string;
    state: 'Cancelled';
    cancellation?: { cancelled_by: string; reason: { id: string } };
    tags?: BecknTagGroup[];
  };
}

// --- update / on_update ---
export interface UpdateMessage {
  update_target: 'fulfillment' | 'item' | 'order';
  order: Partial<BecknOrder> & { id: string };
}

export interface OnUpdateMessage {
  order: BecknOrder & { id: string; state: string };
}

// --- track / on_track ---
export interface TrackMessage {
  order_id: string;
  callback_url?: string;
}

export interface OnTrackMessage {
  tracking: {
    url?: string;
    status: string;
    location?: { gps: string; time?: { timestamp: string } };
  };
}

// --- rating / on_rating ---
export interface RatingMessage {
  ratings: Array<{
    id: string;
    rating_category: string;
    value: string;      // '1' to '5'
    feedback_form?: Array<{ question: string; answer: string }>;
  }>;
}

export interface OnRatingMessage {
  feedback_ack: boolean;
  rating_ack: boolean;
}

// --- support / on_support ---
export interface SupportMessage {
  ref_id: string;       // order_id or transaction_id
}

export interface OnSupportMessage {
  phone?: string;
  email?: string;
  url?: string;
}

// ============================================================================
// ONDC SPECIFIC CONSTANTS
// ============================================================================

export const ONDC_DOMAINS = {
  GROCERY: 'ONDC:RET10',
  FOOD_BEVERAGE: 'ONDC:RET11',
  FASHION: 'ONDC:RET12',
  BPC: 'ONDC:RET13',
  ELECTRONICS: 'ONDC:RET14',
  APPLIANCES: 'ONDC:RET15',
  HOME_KITCHEN: 'ONDC:RET16',
} as const;

export const ONDC_ORDER_STATES = {
  CREATED: 'Created',
  ACCEPTED: 'Accepted',
  IN_PROGRESS: 'In-progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
} as const;

export const BECKN_CANCELLATION_REASONS = {
  '001': 'Price of one or more items have changed',
  '002': 'One or more items in the Order not available',
  '003': 'Product available at lower than order price',
  '004': 'Order in pending shipment / delivery state for too long',
  '005': 'Merchant rejected the order',
  '006': 'Order not shipped as per delivery schedule',
  '009': 'Buyer wants to modify address',
  '010': 'Buyer not available for delivery',
  '011': 'Buyer refused to accept delivery',
  '012': 'Address not found',
  '013': 'Buyer not reachable',
  '014': 'Buyer refused to accept delivery due to poor product quality',
  '015': 'Buyer unavailable at the time of delivery',
} as const;
