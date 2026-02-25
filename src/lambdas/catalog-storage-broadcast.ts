/**
 * Catalog Storage and Broadcast Lambda
 * 
 * This Lambda function handles the complete catalog lifecycle:
 * - Validates catalog object using schema validator
 * - Requests missing information from seller if validation fails
 * - Stores validated catalog item in DynamoDB
 * - Constructs ONDC on_search payload with seller and item details
 * - Broadcasts catalog to ONDC Registry via BPP Adapter
 * - Sends confirmation WhatsApp message to seller
 * 
 * Validates: Requirements 2.7, 2.8, 2.9, 10.4
 */

import { randomUUID } from 'crypto';
import { BecknCatalogItem, ONDCCatalogPayload, CatalogItem } from '../models/catalog';
import { SellerProfile } from '../models/seller';
import { validateCatalogItem, validateONDCCatalogPayload } from '../services/ondc-schema-validator';
import { createCatalogItem, getSellerById } from '../services/dynamodb-repository';

/**
 * Request to store and broadcast catalog
 */
export interface CatalogStorageBroadcastRequest {
  /**
   * Constructed Beckn catalog item
   */
  catalogItem: BecknCatalogItem;

  /**
   * Seller ID
   */
  sellerId: string;

  /**
   * Seller phone number for WhatsApp notifications
   */
  sellerPhone: string;

  /**
   * Seller's preferred language
   */
  language: 'hi' | 'mr' | 'en';

  /**
   * Image URLs (raw and enhanced)
   */
  images?: {
    raw: string;
    enhanced: string;
  };

  /**
   * Message ID for correlation
   */
  messageId?: string;
}

/**
 * Response from catalog storage and broadcast
 */
export interface CatalogStorageBroadcastResponse {
  /**
   * Whether the operation was successful
   */
  success: boolean;

  /**
   * Item ID of stored catalog
   */
  itemId?: string;

  /**
   * Whether catalog was broadcast to ONDC
   */
  broadcast?: boolean;

  /**
   * Whether confirmation was sent to seller
   */
  confirmationSent?: boolean;

  /**
   * Error information (if failed)
   */
  error?: {
    code: string;
    message: string;
    missingFields?: string[];
  };
}

/**
 * Lambda handler for catalog storage and broadcast
 */
export const handler = async (
  event: CatalogStorageBroadcastRequest
): Promise<CatalogStorageBroadcastResponse> => {
  console.log('Catalog storage and broadcast request:', JSON.stringify(event, null, 2));

  try {
    // Step 1: Validate catalog object using schema validator
    console.log('Step 1: Validating catalog object...');
    const validation = validateCatalogItem(event.catalogItem);

    if (!validation.valid) {
      console.error('Catalog validation failed:', validation.errors);

      // Extract missing fields from validation errors
      const missingFields = validation.errors.map((error) => error.field);

      // Request missing information from seller
      await requestMissingInformation(
        event.sellerPhone,
        event.language,
        missingFields,
        validation.errors
      );

      return {
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Catalog validation failed. Requested missing information from seller.',
          missingFields,
        },
      };
    }

    console.log('Catalog validation passed');

    // Step 2: Get seller profile for ONDC payload construction
    console.log('Step 2: Fetching seller profile...');
    const sellerProfile = await getSellerById(event.sellerId);

    if (!sellerProfile) {
      throw new Error(`Seller profile not found: ${event.sellerId}`);
    }

    console.log('Seller profile fetched:', sellerProfile.name);

    // Step 3: Store validated catalog item in DynamoDB
    console.log('Step 3: Storing catalog item in DynamoDB...');
    const catalogItem = await storeCatalogItem(
      event.catalogItem,
      event.sellerId,
      event.images
    );

    console.log('Catalog item stored with ID:', catalogItem.itemId);

    // Step 4: Construct ONDC on_search payload
    console.log('Step 4: Constructing ONDC on_search payload...');
    const ondcPayload = constructONDCPayload(catalogItem, sellerProfile);

    // Validate the complete ONDC payload
    const payloadValidation = validateONDCCatalogPayload(ondcPayload);
    if (!payloadValidation.valid) {
      console.error('ONDC payload validation failed:', payloadValidation.errors);
      throw new Error(
        `ONDC payload validation failed: ${payloadValidation.errors.map((e) => e.message).join(', ')}`
      );
    }

    console.log('ONDC payload constructed and validated');

    // Step 5: Broadcast catalog to ONDC Registry via BPP Adapter
    console.log('Step 5: Broadcasting catalog to ONDC Registry...');
    await broadcastToONDC(ondcPayload);

    console.log('Catalog broadcast successful');

    // Step 6: Send confirmation WhatsApp message to seller
    console.log('Step 6: Sending confirmation to seller...');
    await sendConfirmationMessage(
      event.sellerPhone,
      event.language,
      catalogItem,
      sellerProfile
    );

    console.log('Confirmation sent to seller');

    return {
      success: true,
      itemId: catalogItem.itemId,
      broadcast: true,
      confirmationSent: true,
    };
  } catch (error: any) {
    console.error('Catalog storage and broadcast failed:', error);

    return {
      success: false,
      error: {
        code: error.name || 'CATALOG_STORAGE_BROADCAST_ERROR',
        message: error.message || 'Failed to store and broadcast catalog',
      },
    };
  }
};

/**
 * Store catalog item in DynamoDB
 */
async function storeCatalogItem(
  becknItem: BecknCatalogItem,
  sellerId: string,
  images?: { raw: string; enhanced: string }
): Promise<CatalogItem> {
  const itemId = becknItem.id;
  const timestamp = Date.now();

  const catalogItem: CatalogItem = {
    PK: `SELLER#${sellerId}`,
    SK: `ITEM#${itemId}`,
    GSI3PK: `CATEGORY#${becknItem.category_id}`,
    GSI3SK: `ITEM#${itemId}`,
    entityType: 'CATALOG_ITEM',
    itemId,
    sellerId,
    becknItem,
    images: images || {
      raw: becknItem.descriptor.symbol || '',
      enhanced: becknItem.descriptor.symbol || '',
    },
    status: 'ACTIVE',
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
  };

  await createCatalogItem(catalogItem);
  return catalogItem;
}

/**
 * Construct ONDC on_search payload
 */
function constructONDCPayload(
  catalogItem: CatalogItem,
  sellerProfile: SellerProfile
): ONDCCatalogPayload {
  const transactionId = randomUUID();
  const messageId = randomUUID();
  const timestamp = new Date().toISOString();

  // For this implementation, we use default location data
  // In production, this would come from seller profile
  const defaultLocation = {
    id: sellerProfile.sellerId,
    gps: '19.0760,72.8777', // Mumbai coordinates as default
    address: {
      locality: 'Default Locality',
      street: 'Default Street',
      city: 'Mumbai',
      state: 'Maharashtra',
      country: 'IND' as const,
      area_code: '400001',
    },
  };

  const payload: ONDCCatalogPayload = {
    context: {
      domain: 'nic2004:52110', // Retail domain
      country: 'IND',
      city: '*', // All cities
      action: 'on_search',
      core_version: '1.2.0',
      bap_id: 'buyer-app.ondc.in', // This would come from the search request
      bap_uri: 'https://api.buyer-app.ondc.in',
      bpp_id: sellerProfile.ondc.subscriberId,
      bpp_uri: sellerProfile.ondc.subscriberUrl,
      transaction_id: transactionId,
      message_id: messageId,
      timestamp,
    },
    message: {
      catalog: {
        'bpp/descriptor': {
          name: 'Vyapar Vaani',
          symbol: 'https://vyapar-vaani.in/logo.png',
          short_desc: 'Rural Merchant Network',
          long_desc: 'Empowering rural merchants through voice-first commerce',
          images: ['https://vyapar-vaani.in/banner.png'],
        },
        'bpp/providers': [
          {
            id: sellerProfile.sellerId,
            descriptor: {
              name: sellerProfile.name,
              short_desc: `Products from ${sellerProfile.name}`,
              long_desc: `Quality products from rural merchant ${sellerProfile.name}`,
              images: [],
            },
            locations: [defaultLocation],
            items: [catalogItem.becknItem],
          },
        ],
      },
    },
  };

  return payload;
}

/**
 * Broadcast catalog to ONDC Registry via BPP Adapter
 * 
 * In production, this would call the BPP Adapter Lambda or API
 * For now, we simulate the broadcast
 */
async function broadcastToONDC(payload: ONDCCatalogPayload): Promise<void> {
  // TODO: Implement actual BPP Adapter call
  // This would involve:
  // 1. Signing the payload with BPP private key
  // 2. Sending HTTP POST to ONDC Registry
  // 3. Handling response and retries
  
  console.log('Broadcasting to ONDC Registry (simulated):', {
    bpp_id: payload.context.bpp_id,
    transaction_id: payload.context.transaction_id,
    items_count: payload.message.catalog['bpp/providers'][0].items.length,
  });

  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 100));

  console.log('Broadcast successful (simulated)');
}

/**
 * Request missing information from seller via WhatsApp
 */
async function requestMissingInformation(
  phone: string,
  language: 'hi' | 'mr' | 'en',
  missingFields: string[],
  errors: Array<{ field: string; message: string }>
): Promise<void> {
  // TODO: Implement WhatsApp message sending
  // This would call the WhatsApp message sender Lambda
  
  const messages = {
    hi: {
      title: '❌ कैटलॉग में कुछ जानकारी गायब है',
      fields: 'कृपया निम्नलिखित जानकारी प्रदान करें:',
      retry: 'कृपया फिर से प्रयास करें।',
    },
    mr: {
      title: '❌ कॅटलॉगमध्ये काही माहिती गहाळ आहे',
      fields: 'कृपया खालील माहिती प्रदान करा:',
      retry: 'कृपया पुन्हा प्रयत्न करा.',
    },
    en: {
      title: '❌ Some information is missing from the catalog',
      fields: 'Please provide the following information:',
      retry: 'Please try again.',
    },
  };

  const msg = messages[language];
  const fieldList = errors.map((e) => `• ${e.message}`).join('\n');
  const text = `${msg.title}\n\n${msg.fields}\n${fieldList}\n\n${msg.retry}`;

  console.log('Requesting missing information from seller (simulated):', {
    phone,
    language,
    missingFields,
    text,
  });

  // Simulate sending message
  await new Promise((resolve) => setTimeout(resolve, 50));
}

/**
 * Send confirmation WhatsApp message to seller
 */
async function sendConfirmationMessage(
  phone: string,
  language: 'hi' | 'mr' | 'en',
  catalogItem: CatalogItem,
  sellerProfile: SellerProfile
): Promise<void> {
  // TODO: Implement WhatsApp message sending
  // This would call the WhatsApp message sender Lambda
  
  const messages = {
    hi: {
      title: '✅ उत्पाद सफलतापूर्वक जोड़ा गया!',
      product: 'उत्पाद',
      price: 'कीमत',
      quantity: 'मात्रा',
      status: 'स्थिति: ONDC नेटवर्क पर सक्रिय',
      footer: 'आपका उत्पाद अब खरीदारों को दिखाई देगा।',
    },
    mr: {
      title: '✅ उत्पादन यशस्वीरित्या जोडले!',
      product: 'उत्पादन',
      price: 'किंमत',
      quantity: 'प्रमाण',
      status: 'स्थिती: ONDC नेटवर्कवर सक्रिय',
      footer: 'तुमचे उत्पादन आता खरेदीदारांना दिसेल.',
    },
    en: {
      title: '✅ Product added successfully!',
      product: 'Product',
      price: 'Price',
      quantity: 'Quantity',
      status: 'Status: Active on ONDC Network',
      footer: 'Your product is now visible to buyers.',
    },
  };

  const msg = messages[language];
  const item = catalogItem.becknItem;
  
  const text = `${msg.title}\n\n${msg.product}: ${item.descriptor.name}\n${msg.price}: ₹${item.price.value}\n${msg.quantity}: ${item.quantity.available.count}\n\n${msg.status}\n\n${msg.footer}`;

  console.log('Sending confirmation to seller (simulated):', {
    phone,
    language,
    itemId: catalogItem.itemId,
    text,
  });

  // Simulate sending message
  await new Promise((resolve) => setTimeout(resolve, 50));
}
