/**
 * Seller Profile Data Models
 * 
 * These interfaces define the structure of seller profiles,
 * including KYC information and ONDC registration details.
 * 
 * Validates: Requirements 1.7, 2.9, 5.6
 */

/**
 * KYC (Know Your Customer) information for seller verification
 */
export interface KYCInfo {
  panNumber: string; // Format: AAAAA9999A
  aadharNumber: string; // Encrypted, Format: 9999 9999 9999
  documentUrls: string[]; // S3 URLs for uploaded documents
  verifiedAt: number; // Unix timestamp
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
}

/**
 * ONDC network participant registration details
 */
export interface ONDCRegistration {
  subscriberId: string; // Unique ONDC subscriber ID
  subscriberUrl: string; // BPP endpoint URL
  signingPublicKey: string; // Ed25519 public key for Beckn signing
  encryptionPublicKey: string; // Public key for encryption
}

/**
 * Complete seller profile stored in DynamoDB
 * 
 * DynamoDB Keys:
 * - PK: SELLER#<seller_id>
 * - SK: PROFILE
 * - GSI1PK: <phone_number>
 * - GSI1SK: PROFILE
 */
export interface SellerProfile {
  // DynamoDB Keys
  PK: string; // SELLER#<seller_id>
  SK: string; // PROFILE
  GSI1PK: string; // <phone_number>
  GSI1SK: string; // PROFILE
  entityType: 'SELLER_PROFILE';
  
  // Seller Information
  sellerId: string; // UUID
  phone: string; // E.164 format
  name: string;
  language: 'hi' | 'mr' | 'en'; // Preferred language
  
  // KYC Details
  kyc: KYCInfo;
  
  // ONDC Registration
  ondc: ONDCRegistration;
  
  // Timestamps
  createdAt: number; // Unix timestamp
  updatedAt: number; // Unix timestamp
}
