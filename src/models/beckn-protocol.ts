
export interface BecknContext {
  domain: string;               
  country: string;              
  city: string;                 
  action: BecknAction;
  core_version: '1.2.0';
  bap_id: string;               
  bap_uri: string;              
  bpp_id: string;               
  bpp_uri: string;              
  transaction_id: string;       
  message_id: string;           
  timestamp: string;            
  ttl?: string;                 
  key?: string;                 
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
  gps: string;                  
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
    area_code: string;          
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
  '@ondc/org/TAT'?: string;     
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

export interface BecknRequest<T = any> {
  context: BecknContext;
  message: T;
}

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

export interface UpdateMessage {
  update_target: 'fulfillment' | 'item' | 'order';
  order: Partial<BecknOrder> & { id: string };
}

export interface OnUpdateMessage {
  order: BecknOrder & { id: string; state: string };
}

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

export interface RatingMessage {
  ratings: Array<{
    id: string;
    rating_category: string;
    value: string;      
    feedback_form?: Array<{ question: string; answer: string }>;
  }>;
}

export interface OnRatingMessage {
  feedback_ack: boolean;
  rating_ack: boolean;
}

export interface SupportMessage {
  ref_id: string;       
}

export interface OnSupportMessage {
  phone?: string;
  email?: string;
  url?: string;
}

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
