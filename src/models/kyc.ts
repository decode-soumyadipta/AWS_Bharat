
export type DocumentType = 'PAN' | 'AADHAR' | 'UNKNOWN';

export interface ExtractedField {
  value: string;
  confidence: number; 
}

export interface ExtractedKYCData {
  documentType: DocumentType;

  panNumber?: ExtractedField;

  aadharNumber?: ExtractedField;

  name?: ExtractedField;
  dateOfBirth?: ExtractedField;
  address?: ExtractedField;

  overallConfidence: number; 

  rawFields: Record<string, ExtractedField>;
}

export interface DocumentExtractionRequest {
  documentUrl: string; 
  sellerId: string; 
  messageId?: string; 
}

export interface DocumentExtractionResponse {
  success: boolean;
  data?: ExtractedKYCData;
  error?: {
    code: string;
    message: string;
  };
}
