
export interface WhatsAppInboundEvent {
  messageId: string;
  from: string; 
  timestamp: number;
  type: 'text' | 'audio' | 'image' | 'button_reply';
  content: {
    text?: string;
    mediaUrl?: string; 
    mediaId?: string; 
    mimeType?: string;
    buttonPayload?: string; 
    buttonTitle?: string; 
  };
  profile: {
    name: string;
    language?: string; 
  };
}

export interface WhatsAppOutboundMessage {
  to: string; 
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

export interface WhatsAppEventDetail {
  messageId: string;
  sellerId?: string; 
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

  state?: string; 
  handler?: string; 
  language?: string; 
}
