
export interface OrderItem {
  itemId: string; 
  quantity: number;
  price: number; 
}

interface FulfillmentAddress {
  name: string; 
  building: string;
  locality: string;
  city: string;
  state: string;
  country: string;
  area_code: string; 
}

interface FulfillmentContact {
  phone: string; 
  email?: string;
}

export interface OrderFulfillment {
  type: 'Delivery' | 'Pickup';
  address?: FulfillmentAddress; 
  contact: FulfillmentContact;
}

type PaymentMethod = 'UPI' | 'COD';

type PaymentVerifiedBy = 'SCREENSHOT_AI' | 'SELLER_CONFIRMED' | 'MANUAL_REF' | 'SYSTEM';

export interface OrderPayment {
  type: 'ON-ORDER' | 'ON-FULFILLMENT' | 'POST-FULFILLMENT';
  status: 'PAID' | 'NOT-PAID' | 'PENDING_VERIFICATION';
  amount: number; 
  method: PaymentMethod; 
  upiTransactionRef?: string; 
  upiId?: string; 
  paidAt?: number; 
  verifiedBy?: PaymentVerifiedBy; 
  screenshotS3Key?: string; 
}

export type OrderStatus = 
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'PACKED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

export interface OrderTimelineEntry {
  status: OrderStatus;
  timestamp: number; 
  actor: 'SELLER' | 'BUYER' | 'SYSTEM';
  notes?: string; 
}

export interface Order {

  PK: string; 
  SK: string; 
  GSI2PK: string; 
  GSI2SK: string; 
  entityType: 'ORDER';

  orderId: string; 
  sellerId: string; 
  buyerAppId: string; 
  transactionId: string; 

  items: OrderItem[];
  fulfillment: OrderFulfillment;
  payment: OrderPayment;
  status: OrderStatus;
  timeline: OrderTimelineEntry[];

  createdAt: number; 
  updatedAt: number; 
}

interface OrderTimeline {

  PK: string; 
  SK: string; 
  entityType: 'ORDER_TIMELINE';

  orderId: string; 
  status: OrderStatus;
  timestamp: number; 
  actor: 'SELLER' | 'BUYER' | 'SYSTEM';
  notes?: string;
}

interface OrderStateTransition {
  from: OrderStatus;
  to: OrderStatus;
  valid: boolean;
}

export const VALID_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: ['PACKED', 'CANCELLED'],
  REJECTED: [], 
  PACKED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [], 
  CANCELLED: [], 
};

interface OrderNotificationMessage {
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
