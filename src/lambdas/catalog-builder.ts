/**
 * Catalog Builder Lambda
 * 
 * This Lambda function constructs Beckn-compliant catalog objects from
 * extracted product entities.
 * 
 * Features:
 * - Maps extracted entities to BecknCatalogItem interface
 * - Generates unique item ID (UUID)
 * - Sets descriptor fields (name, short_desc, long_desc)
 * - Sets price fields (currency: INR, value as decimal string)
 * - Sets quantity fields (available count, maximum count)
 * - Maps product category to ONDC category taxonomy
 * - Adds ONDC-specific tags (@ondc/org/returnable, @ondc/org/cancellable, etc.)
 * - Sets fulfillment_id and location_id from seller profile
 * 
 * Validates: Requirements 2.5, 2.6, 4.5
 */

import { randomUUID } from 'crypto';
import { BecknCatalogItem } from '../models/catalog';
import { CatalogEntities } from '../models/intent';
import { SellerProfile } from '../models/seller';
import { validateCatalogItem, ValidationResult } from '../services/ondc-schema-validator';

/**
 * Request to build a catalog item
 */
export interface CatalogBuilderRequest {
  /**
   * Extracted product entities from voice note
   */
  entities: CatalogEntities;

  /**
   * Seller profile containing fulfillment and location info
   */
  sellerProfile: SellerProfile;

  /**
   * Optional image URL (enhanced or raw)
   */
  imageUrl?: string;

  /**
   * Message ID for correlation
   */
  messageId?: string;
}

/**
 * Response from catalog builder
 */
export interface CatalogBuilderResponse {
  /**
   * Whether construction was successful
   */
  success: boolean;

  /**
   * Constructed Beckn catalog item
   */
  catalogItem?: BecknCatalogItem;

  /**
   * Generated item ID
   */
  itemId?: string;

  /**
   * Validation result from ONDC schema validator
   */
  validation?: ValidationResult;

  /**
   * Error information (if failed)
   */
  error?: {
    code: string;
    message: string;
  };
}

/**
 * ONDC category taxonomy mapping
 */
const CATEGORY_MAPPING: Record<string, string> = {
  food: 'Grocery',
  grocery: 'Grocery',
  handicraft: 'Home & Decor',
  textile: 'Fashion',
  other: 'Grocery', // Default fallback
};

/**
 * Lambda handler for catalog builder
 */
export const handler = async (
  event: CatalogBuilderRequest
): Promise<CatalogBuilderResponse> => {
  console.log('Catalog builder request:', JSON.stringify(event, null, 2));

  try {
    // Validate input
    validateCatalogBuilderRequest(event);

    // Generate unique item ID
    const itemId = randomUUID();
    console.log('Generated item ID:', itemId);

    // Construct Beckn catalog item
    const catalogItem = constructBecknCatalogItem(
      itemId,
      event.entities,
      event.sellerProfile,
      event.imageUrl
    );

    console.log('Constructed catalog item:', JSON.stringify(catalogItem, null, 2));

    // Validate against ONDC schema
    const validation = validateCatalogItem(catalogItem);
    console.log('ONDC schema validation result:', JSON.stringify(validation, null, 2));

    if (!validation.valid) {
      console.error('ONDC schema validation failed:', validation.errors);
      return {
        success: false,
        validation,
        error: {
          code: 'SCHEMA_VALIDATION_FAILED',
          message: `Catalog item failed ONDC schema validation: ${validation.errors.map(e => e.message).join(', ')}`,
        },
      };
    }

    return {
      success: true,
      catalogItem,
      itemId,
      validation,
    };
  } catch (error: any) {
    console.error('Catalog builder failed:', error);

    return {
      success: false,
      error: {
        code: error.name || 'CATALOG_BUILD_ERROR',
        message: error.message || 'Failed to construct catalog item',
      },
    };
  }
};

/**
 * Validate catalog builder request
 */
function validateCatalogBuilderRequest(request: CatalogBuilderRequest): void {
  if (!request.entities) {
    throw new Error('Entities are required');
  }

  if (!request.sellerProfile) {
    throw new Error('Seller profile is required');
  }

  // Validate required entity fields
  const { product_name, price, quantity, unit, category } = request.entities;

  if (!product_name) {
    throw new Error('Product name is required');
  }

  if (price === null || price === undefined) {
    throw new Error('Price is required');
  }

  if (quantity === null || quantity === undefined) {
    throw new Error('Quantity is required');
  }

  if (!unit) {
    throw new Error('Unit is required');
  }

  if (!category) {
    throw new Error('Category is required');
  }
}

/**
 * Construct Beckn catalog item from entities
 */
function constructBecknCatalogItem(
  itemId: string,
  entities: CatalogEntities,
  sellerProfile: SellerProfile,
  imageUrl?: string
): BecknCatalogItem {
  // Map category to ONDC taxonomy
  const ondcCategory = mapCategoryToONDC(entities.category!);

  // Format price as decimal string
  const priceValue = formatPrice(entities.price!);

  // Generate short and long descriptions
  const shortDesc = generateShortDescription(entities);
  const longDesc = generateLongDescription(entities);

  // Get default fulfillment and location IDs
  // In a real implementation, these would come from seller profile
  // For now, we use default values
  const fulfillmentId = 'F1';
  const locationId = sellerProfile.sellerId; // Use seller ID as location ID

  // Construct the catalog item
  const catalogItem: BecknCatalogItem = {
    id: itemId,
    descriptor: {
      name: entities.product_name!,
      symbol: imageUrl,
      short_desc: shortDesc,
      long_desc: longDesc,
      images: imageUrl ? [imageUrl] : [],
    },
    price: {
      currency: 'INR',
      value: priceValue,
      maximum_value: priceValue,
    },
    quantity: {
      available: {
        count: entities.quantity!,
      },
      maximum: {
        count: Math.min(entities.quantity!, 10), // Max order quantity per transaction
      },
    },
    category_id: ondcCategory,
    fulfillment_id: fulfillmentId,
    location_id: locationId,
    time: {
      label: 'enable',
      timestamp: new Date().toISOString(),
    },
    tags: [],
    // ONDC-specific fields
    '@ondc/org/returnable': false, // Food items typically not returnable
    '@ondc/org/cancellable': true,
    '@ondc/org/return_window': 'P0D', // 0 days return window
    '@ondc/org/seller_pickup_return': false,
    '@ondc/org/time_to_ship': 'P2D', // 2 days to ship
    '@ondc/org/available_on_cod': true, // Cash on delivery available
    '@ondc/org/contact_details_consumer_care': `${sellerProfile.phone},support@vyapar-vaani.in`,
  };

  return catalogItem;
}

/**
 * Map product category to ONDC category taxonomy
 */
function mapCategoryToONDC(category: string): string {
  const normalizedCategory = category.toLowerCase();
  return CATEGORY_MAPPING[normalizedCategory] || CATEGORY_MAPPING.other;
}

/**
 * Format price as decimal string with 2 decimal places
 */
function formatPrice(price: number): string {
  return price.toFixed(2);
}

/**
 * Generate short description from entities
 */
function generateShortDescription(entities: CatalogEntities): string {
  const { product_name, quantity, unit } = entities;
  return `${product_name} - ${quantity} ${unit}`;
}

/**
 * Generate long description from entities
 */
function generateLongDescription(entities: CatalogEntities): string {
  const { product_name, description, quantity, unit, category } = entities;

  let longDesc = `${product_name}`;

  if (description) {
    longDesc += `. ${description}`;
  }

  longDesc += `. Available quantity: ${quantity} ${unit}.`;

  if (category) {
    longDesc += ` Category: ${category}.`;
  }

  return longDesc;
}
