/**
 * Catalog and Product Data Models
 * 
 * These interfaces define the structure of product catalogs
 * conforming to ONDC/Beckn Protocol v1.2.0 specifications.
 * 
 * Validates: Requirements 1.7, 2.9, 5.6
 */

/**
 * Beckn Protocol descriptor for catalog items
 */
export interface BecknDescriptor {
  name: string; // Product name (can be in vernacular)
  code?: string; // Optional: HSN/SAC code
  symbol?: string; // Image URL
  short_desc: string;
  long_desc: string;
  images: string[]; // Array of image URLs
}

/**
 * Beckn Protocol price structure
 */
export interface BecknPrice {
  currency: 'INR'; // ISO 4217 currency code
  value: string; // Decimal string (e.g., "200.00")
  maximum_value?: string; // Optional maximum price
}

/**
 * Beckn Protocol quantity structure
 */
export interface BecknQuantity {
  available: {
    count: number;
  };
  maximum: {
    count: number;
  };
}

/**
 * Beckn Protocol time structure
 */
export interface BecknTime {
  label: 'enable' | 'disable';
  timestamp: string; // ISO 8601 format
}

/**
 * Beckn Protocol tag structure for ONDC-specific fields
 */
export interface BecknTag {
  code: string;
  list: Array<{
    code: string;
    value: string;
  }>;
}

/**
 * Complete Beckn Catalog Item conforming to ONDC v1.2.0
 */
export interface BecknCatalogItem {
  id: string; // UUID
  descriptor: BecknDescriptor;
  price: BecknPrice;
  quantity: BecknQuantity;
  category_id: string; // ONDC category taxonomy
  fulfillment_id: string;
  location_id: string;
  time: BecknTime;
  tags: BecknTag[];
  
  // ONDC-specific fields (using @ prefix as per spec)
  '@ondc/org/returnable'?: boolean;
  '@ondc/org/cancellable'?: boolean;
  '@ondc/org/return_window'?: string; // ISO 8601 duration (e.g., "P0D")
  '@ondc/org/seller_pickup_return'?: boolean;
  '@ondc/org/time_to_ship'?: string; // ISO 8601 duration (e.g., "P2D")
  '@ondc/org/available_on_cod'?: boolean;
  '@ondc/org/contact_details_consumer_care'?: string; // Format: "phone,email"
}

/**
 * Product image references
 */
export interface ProductImages {
  raw: string; // S3 URL for original uploaded image
  enhanced: string; // S3 URL for AI-enhanced image
}

/**
 * Catalog item stored in DynamoDB
 * 
 * DynamoDB Keys:
 * - PK: SELLER#<seller_id>
 * - SK: ITEM#<item_id>
 * - GSI3PK: CATEGORY#<category>
 * - GSI3SK: ITEM#<item_id>
 */
export interface CatalogItem {
  // DynamoDB Keys
  PK: string; // SELLER#<seller_id>
  SK: string; // ITEM#<item_id>
  GSI3PK: string; // CATEGORY#<category>
  GSI3SK: string; // ITEM#<item_id>
  entityType: 'CATALOG_ITEM';
  
  // Item Information
  itemId: string; // UUID
  sellerId: string; // UUID
  becknItem: BecknCatalogItem; // Complete Beckn-compliant item structure
  images: ProductImages;
  status: 'DRAFT' | 'ACTIVE' | 'OUT_OF_STOCK' | 'ARCHIVED';
  
  // Timestamps and versioning
  createdAt: number; // Unix timestamp
  updatedAt: number; // Unix timestamp
  version: number; // For optimistic locking
}

/**
 * ONDC on_search catalog payload structure
 */
export interface ONDCCatalogPayload {
  context: {
    domain: string; // e.g., "nic2004:52110"
    country: 'IND';
    city: string;
    action: 'on_search';
    core_version: '1.2.0';
    bap_id: string;
    bap_uri: string;
    bpp_id: string;
    bpp_uri: string;
    transaction_id: string; // UUID
    message_id: string; // UUID
    timestamp: string; // ISO 8601
  };
  message: {
    catalog: {
      'bpp/descriptor': {
        name: string;
        symbol: string;
        short_desc: string;
        long_desc: string;
        images: string[];
      };
      'bpp/providers': Array<{
        id: string; // seller_id
        descriptor: BecknDescriptor;
        locations: Array<{
          id: string;
          gps: string; // Format: "lat,long"
          address: {
            locality: string;
            street: string;
            city: string;
            state: string;
            country: 'IND';
            area_code: string; // Pincode
          };
        }>;
        items: BecknCatalogItem[];
      }>;
    };
  };
}
