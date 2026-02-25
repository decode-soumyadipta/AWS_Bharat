/**
 * KYC Document Processing Data Models
 * 
 * These interfaces define the structure for KYC document extraction,
 * including document types, extracted fields, and confidence scores.
 * 
 * Validates: Requirements 1.1, 1.2
 */

/**
 * Document type identification
 */
export type DocumentType = 'PAN' | 'AADHAR' | 'UNKNOWN';

/**
 * Extracted KYC field with confidence score
 */
export interface ExtractedField {
  value: string;
  confidence: number; // 0.0 to 1.0
}

/**
 * Structured KYC data extracted from documents
 */
export interface ExtractedKYCData {
  documentType: DocumentType;
  
  // PAN-specific fields
  panNumber?: ExtractedField;
  
  // Aadhar-specific fields
  aadharNumber?: ExtractedField;
  
  // Common fields
  name?: ExtractedField;
  dateOfBirth?: ExtractedField;
  address?: ExtractedField;
  
  // Overall extraction quality
  overallConfidence: number; // Average confidence across all fields
  
  // Raw Textract response for debugging
  rawFields: Record<string, ExtractedField>;
}

/**
 * Document extraction request
 */
export interface DocumentExtractionRequest {
  documentUrl: string; // S3 URL or pre-signed URL
  sellerId: string; // For tracking and logging
  messageId?: string; // WhatsApp message ID for correlation
}

/**
 * Document extraction response
 */
export interface DocumentExtractionResponse {
  success: boolean;
  data?: ExtractedKYCData;
  error?: {
    code: string;
    message: string;
  };
}
