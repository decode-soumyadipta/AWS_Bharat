/**
 * Seller Profile Data Models
 * 
 * These interfaces define the structure of seller profiles,
 * including KYC information and ONDC registration details.
 * 
 * Validates: Requirements 1.7, 2.9, 5.6
 */

/**
 * Seller onboarding state tracking
 */
export type OnboardingState = 
  | 'NEW'                    // New user, needs KYC
  | 'KYC_PENDING'           // Waiting for PAN card photo
  | 'KYC_PROCESSING'        // Processing KYC documents
  | 'KYC_VERIFIED'          // KYC complete, can create catalog
  | 'GUEST'                 // Skipped KYC, using as guest
  | 'CATALOG_VOICE_PENDING' // Waiting for voice message about product
  | 'CATALOG_IMAGE_PENDING' // Waiting for product photo
  | 'CATALOG_CONFIRMING'    // Waiting for user confirmation
  | 'ACTIVE';               // Fully onboarded, normal operations

/**
 * Pending catalog item awaiting confirmation
 */
export interface PendingCatalogItem {
  productName: string;
  price: number;
  quantity: number;
  unit: string;
  category: string;
  description?: string;
  language: 'hi' | 'mr' | 'en';
  voiceNoteUrl?: string;
  rawImageUrl?: string;
  enhancedImageUrl?: string;
  createdAt: number;
}

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
  onboardingState: OnboardingState; // Current state in onboarding flow
  pendingCatalog?: PendingCatalogItem; // Catalog item awaiting confirmation
  
  // UPI Payment
  upiId?: string; // Seller's UPI ID for receiving payments (e.g., name@paytm)
  
  // KYC Details
  kyc: KYCInfo;
  
  // ONDC Registration
  ondc: ONDCRegistration;
  
  // Timestamps
  createdAt: number; // Unix timestamp
  updatedAt: number; // Unix timestamp
}
