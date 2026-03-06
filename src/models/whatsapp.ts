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
    mediaId?: string; // WhatsApp media ID
    mimeType?: string;
    buttonPayload?: string; // For interactive button responses
    buttonTitle?: string; // Button title for interactive responses
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
  type: 'text' | 'interactive' | 'image' | 'audio' | 'document';
  content: {
    text?: string;
    imageUrl?: string;
    audioUrl?: string;
    documentUrl?: string;
    documentFilename?: string;
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
  // State routing information
  state?: string; // User's current state in the workflow
  handler?: string; // Handler that should process this message
  language?: string; // User's language preference
}
