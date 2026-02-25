/**
 * Order Management Data Models
 * 
 * These interfaces define the structure of orders,
 * fulfillment details, and payment information.
 * 
 * Validates: Requirements 1.7, 2.9, 5.6
 */

/**
 * Order item details
 */
export interface OrderItem {
  itemId: string; // Reference to catalog item
  quantity: number;
  price: number; // Price per unit in INR
}

/**
 * Delivery or pickup address
 */
export interface FulfillmentAddress {
  name: string; // Recipient name
  building: string;
  locality: string;
  city: string;
  state: string;
  country: string;
  area_code: string; // Pincode
}

/**
 * Contact information for fulfillment
 */
export interface FulfillmentContact {
  phone: string; // E.164 format
  email?: string;
}

/**
 * Order fulfillment details
 */
export interface OrderFulfillment {
  type: 'Delivery' | 'Pickup';
  address?: FulfillmentAddress; // Required for Delivery
  contact: FulfillmentContact;
}

/**
 * Payment information
 */
export interface OrderPayment {
  type: 'ON-ORDER' | 'ON-FULFILLMENT' | 'POST-FULFILLMENT';
  status: 'PAID' | 'NOT-PAID';
  amount: number; // Total amount in INR
}

/**
 * Valid order status values
 */
export type OrderStatus = 
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'PACKED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

/**
 * Order timeline entry for state tracking
 */
export interface OrderTimelineEntry {
  status: OrderStatus;
  timestamp: number; // Unix timestamp
  actor: 'SELLER' | 'BUYER' | 'SYSTEM';
  notes?: string; // Optional notes about the transition
}

/**
 * Complete order stored in DynamoDB
 * 
 * DynamoDB Keys:
 * - PK: ORDER#<order_id>
 * - SK: METADATA
 * - GSI2PK: SELLER#<seller_id>
 * - GSI2SK: STATUS#<status>#<timestamp>
 */
export interface Order {
  // DynamoDB Keys
  PK: string; // ORDER#<order_id>
  SK: string; // METADATA
  GSI2PK: string; // SELLER#<seller_id>
  GSI2SK: string; // STATUS#<status>#<timestamp>
  entityType: 'ORDER';
  
  // Order Information
  orderId: string; // UUID
  sellerId: string; // UUID
  buyerAppId: string; // BAP subscriber ID
  transactionId: string; // ONDC transaction ID
  
  // Order Details
  items: OrderItem[];
  fulfillment: OrderFulfillment;
  payment: OrderPayment;
  status: OrderStatus;
  timeline: OrderTimelineEntry[];
  
  // Timestamps
  createdAt: number; // Unix timestamp
  updatedAt: number; // Unix timestamp
}

/**
 * Order timeline entry stored separately in DynamoDB
 * for detailed audit trail
 * 
 * DynamoDB Keys:
 * - PK: ORDER#<order_id>
 * - SK: TIMELINE#<timestamp>
 */
export interface OrderTimeline {
  // DynamoDB Keys
  PK: string; // ORDER#<order_id>
  SK: string; // TIMELINE#<timestamp>
  entityType: 'ORDER_TIMELINE';
  
  // Timeline Entry
  orderId: string; // UUID
  status: OrderStatus;
  timestamp: number; // Unix timestamp
  actor: 'SELLER' | 'BUYER' | 'SYSTEM';
  notes?: string;
}

/**
 * Order state transition validation
 */
export interface OrderStateTransition {
  from: OrderStatus;
  to: OrderStatus;
  valid: boolean;
}

/**
 * Valid order state machine transitions
 */
export const VALID_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: ['PACKED', 'CANCELLED'],
  REJECTED: [], // Terminal state
  PACKED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [], // Terminal state
  CANCELLED: [], // Terminal state
};

/**
 * Interactive WhatsApp message for order notification
 */
export interface OrderNotificationMessage {
  orderId: string;
  buyerName: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
  }>;
  totalPrice: number;
  deliveryAddress: string;
  paymentStatus: 'PAID' | 'NOT-PAID';
  language: 'hi' | 'mr' | 'en';
}
