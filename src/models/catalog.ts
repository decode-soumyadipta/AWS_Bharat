
export interface BecknDescriptor {
  name: string; 
  code?: string; 
  symbol?: string; 
  short_desc: string;
  long_desc: string;
  images: string[]; 
}

export interface BecknPrice {
  currency: 'INR'; 
  value: string; 
  maximum_value?: string; 
}

export interface BecknQuantity {
  available: {
    count: number;
  };
  maximum: {
    count: number;
  };
  unitized?: {
    measure: {
      unit: string; 
      value: string; 
    };
  };
}

export interface BecknTime {
  label: 'enable' | 'disable';
  timestamp: string; 
}

export interface BecknTag {
  code: string;
  list: Array<{
    code: string;
    value: string;
  }>;
}

export interface BecknCatalogItem {
  id: string; 
  descriptor: BecknDescriptor;
  price: BecknPrice;
  quantity: BecknQuantity;
  category_id: string; 
  fulfillment_id: string;
  location_id: string;
  time: BecknTime;
  tags: BecknTag[];

  '@ondc/org/returnable'?: boolean;
  '@ondc/org/cancellable'?: boolean;
  '@ondc/org/return_window'?: string; 
  '@ondc/org/seller_pickup_return'?: boolean;
  '@ondc/org/time_to_ship'?: string; 
  '@ondc/org/available_on_cod'?: boolean;
  '@ondc/org/contact_details_consumer_care'?: string; 
}

export interface ProductImages {
  raw: string; 
  enhanced: string; 
}

export interface CatalogItem {

  PK: string; 
  SK: string; 
  GSI3PK: string; 
  GSI3SK: string; 
  entityType: 'CATALOG_ITEM';

  itemId: string; 
  sellerId: string; 
  becknItem: BecknCatalogItem; 
  images: ProductImages;
  status: 'DRAFT' | 'ACTIVE' | 'OUT_OF_STOCK' | 'ARCHIVED';

  createdAt: number; 
  updatedAt: number; 
  version: number; 
}

export interface ONDCCatalogPayload {
  context: {
    domain: string; 
    country: 'IND';
    city: string;
    action: 'on_search';
    core_version: '1.2.0';
    bap_id: string;
    bap_uri: string;
    bpp_id: string;
    bpp_uri: string;
    transaction_id: string; 
    message_id: string; 
    timestamp: string; 
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
        id: string; 
        descriptor: BecknDescriptor;
        locations: Array<{
          id: string;
          gps: string; 
          address: {
            locality: string;
            street: string;
            city: string;
            state: string;
            country: 'IND';
            area_code: string; 
          };
        }>;
        items: BecknCatalogItem[];
      }>;
    };
  };
}
