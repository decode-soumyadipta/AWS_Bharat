/**
 * WhatsApp Message Models
 * 
 * These interfaces define the structure of WhatsApp messages
 * received from AWS End User Messaging (Social) and sent to sellers.
 */

/**
 * Incoming WhatsApp message event from AWS End User Messaging
 */
export interface WhatsAppInboundEvent {
  messageId: string;
  from: string; // Phone number in E.164 format
  timestamp: number;
  type: 'text' | 'audio' | 'image' | 'button_reply';
  content: {
    text?: string;
    mediaUrl?: string; // S3 pre-signed URL for audio/image
    mimeType?: string;
    buttonPayload?: string; // For interactive button responses
  };
  profile: {
    name: string;
    language?: string; // Detected or stored preference
  };
}

/**
 * Outgoing WhatsApp message to be sent via AWS End User Messaging
 */
export interface WhatsAppOutboundMessage {
  to: string; // Phone number
  type: 'text' | 'interactive' | 'image';
  content: {
    text?: string;
    imageUrl?: string;
    buttons?: Array<{
      id: string;
      title: string;
    }>;
  };
  language: 'hi' | 'mr' | 'en';
}

/**
 * EventBridge event detail for WhatsApp messages
 */
export interface WhatsAppEventDetail {
  messageId: string;
  sellerId?: string; // Resolved from phone number
  phone: string;
  timestamp: number;
  messageType: 'text' | 'audio' | 'image' | 'button_reply';
  content: {
    text?: string;
    mediaUrl?: string;
    mimeType?: string;
    buttonPayload?: string;
  };
  profile: {
    name: string;
    language?: string;
  };
}
