
export type OnboardingState = 
  | 'NEW'                    
  | 'KYC_PENDING'           
  | 'KYC_PROCESSING'        
  | 'KYC_VERIFIED'          
  | 'GUEST'                 
  | 'CATALOG_VOICE_PENDING' 
  | 'CATALOG_IMAGE_PENDING' 
  | 'CATALOG_CONFIRMING'    
  | 'ACTIVE';               

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

export interface KYCInfo {
  panNumber: string; 
  aadharNumber: string; 
  documentUrls: string[]; 
  verifiedAt: number; 
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
}

export interface ONDCRegistration {
  subscriberId: string; 
  subscriberUrl: string; 
  signingPublicKey: string; 
  encryptionPublicKey: string; 
}

export interface SellerLocation {
  district?: string;       
  state?: string;          
  pincode?: string;        
  latitude?: number;       
  longitude?: number;      
}

export interface SellerProfile {

  PK: string; 
  SK: string; 
  GSI1PK: string; 
  GSI1SK: string; 
  GSI5PK?: string; 
  GSI5SK?: string; 
  entityType: 'SELLER_PROFILE';

  sellerId: string; 
  phone: string; 
  name: string;
  language: 'hi' | 'mr' | 'en'; 
  onboardingState: OnboardingState; 
  pendingCatalog?: PendingCatalogItem; 

  location?: SellerLocation;
  cropsGrown?: string[];    

  upiId?: string; 

  kyc: KYCInfo;

  ondc: ONDCRegistration;

  createdAt: number; 
  updatedAt: number; 
}
