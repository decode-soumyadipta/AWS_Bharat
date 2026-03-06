
import { randomUUID } from 'crypto';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { BecknCatalogItem } from '../models/catalog';
import { CatalogEntities } from '../models/intent';
import { SellerProfile } from '../models/seller';
import { validateCatalogItem, ValidationResult } from '../services/ondc-schema-validator';
import { eventBridgeClient } from '../config/aws-clients';
import { EVENT_SOURCES, INTERNAL_EVENT_TYPES } from '../config/event-patterns';
import { generateProductDescription, ProductInfo, validateDescription } from '../services/ai-description-generator';

export interface CatalogBuilderRequest {

  entities: CatalogEntities;

  sellerProfile: SellerProfile;

  imageUrl?: string;

  messageId?: string;
}

interface CatalogBuilderResponse {

  success: boolean;

  catalogItem?: BecknCatalogItem;

  itemId?: string;

  validation?: ValidationResult;

  error?: {
    code: string;
    message: string;
  };
}

const CATEGORY_MAPPING: Record<string, string> = {
  food: 'Grocery',
  grocery: 'Grocery',
  handicraft: 'Home & Decor',
  textile: 'Fashion',
  other: 'Grocery', 
};

export const handler = async (
  event: any
): Promise<CatalogBuilderResponse> => {
  console.log('Catalog builder request:', JSON.stringify(event, null, 2));

  try {

    const eventDetail = event.detail || event;
    const { entities, phone, messageId, intent, language, imageUrl } = eventDetail;

    const sellerProfile: Partial<SellerProfile> = {
      sellerId: phone || 'unknown',
      phone: phone || '',
      name: `Seller ${phone}`,
      language: (language as 'hi' | 'mr' | 'en') || 'en',
    };

    if (!entities) {
      throw new Error('Entities are required');
    }

    if (!entities.product_name) {
      throw new Error('Product name is required');
    }
    if (!entities.price && entities.price !== 0) {
      throw new Error('Price is required');
    }
    if (!entities.quantity && entities.quantity !== 0) {
      throw new Error('Quantity is required');
    }

    const itemId = randomUUID();
    console.log('Generated item ID:', itemId);

    const catalogItem = await constructBecknCatalogItem(
      itemId,
      entities,
      phone || 'unknown',
      language || 'hi-IN',
      imageUrl 
    );

    console.log('Constructed catalog item:', JSON.stringify(catalogItem, null, 2));

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

    await publishCatalogCreatedEvent({
      catalogItem,
      itemId,
      sellerId: phone || 'unknown',
      messageId: messageId,
    });

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

function validateCatalogBuilderRequest(request: CatalogBuilderRequest): void {
  if (!request.entities) {
    throw new Error('Entities are required');
  }

  if (!request.sellerProfile) {
    throw new Error('Seller profile is required');
  }

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

async function constructBecknCatalogItem(
  itemId: string,
  entities: CatalogEntities,
  sellerId: string,
  language: string,
  imageUrl?: string
): Promise<BecknCatalogItem> {

  const ondcCategory = mapCategoryToONDC(entities.category!);

  const priceValue = formatPrice(entities.price!);

  let shortDesc: string;
  let longDesc: string;
  let aiGenerated = false;

  try {
    console.log('Generating AI-powered product description...');

    const productInfo: ProductInfo = {
      name: entities.product_name!,
      price: entities.price!,
      quantity: entities.quantity!,
      unit: entities.unit!,
      category: entities.category!,
      language: language || 'hi-IN',
      imageUrl,
    };

    const aiDescription = await generateProductDescription(productInfo);

    const validation = validateDescription(aiDescription);

    if (validation.valid && aiDescription.confidence > 0.5) {
      shortDesc = aiDescription.shortDescription;
      longDesc = aiDescription.longDescription;
      aiGenerated = true;
      console.log('✅ Using AI-generated description (confidence:', aiDescription.confidence, ')');
    } else {
      console.warn('⚠️ AI description validation failed or low confidence, using fallback');
      shortDesc = generateShortDescription(entities);
      longDesc = generateLongDescription(entities);
    }
  } catch (error) {
    console.error('AI description generation failed, using fallback:', error);
    shortDesc = generateShortDescription(entities);
    longDesc = generateLongDescription(entities);
  }

  const fulfillmentId = 'F1';
  const locationId = sellerId;

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
        count: Math.min(entities.quantity!, 10),
      },
      unitized: {
        measure: {
          unit: entities.unit!,
          value: '1',
        },
      },
    },
    category_id: ondcCategory,
    fulfillment_id: fulfillmentId,
    location_id: locationId,
    time: {
      label: 'enable',
      timestamp: new Date().toISOString(),
    },
    tags: [
      ...(aiGenerated ? [{
        code: 'ai_enhanced',
        list: [{ code: 'description', value: 'true' }]
      }] : []),
      {
        code: 'unit',
        list: [{ code: 'value', value: entities.unit! }]
      }
    ],
    '@ondc/org/returnable': false,
    '@ondc/org/cancellable': true,
    '@ondc/org/return_window': 'P0D',
    '@ondc/org/seller_pickup_return': false,
    '@ondc/org/time_to_ship': 'P2D',
    '@ondc/org/available_on_cod': true,
    '@ondc/org/contact_details_consumer_care': `${sellerId},support@vyapar-vaani.in`,
  };

  return catalogItem;
}

function mapCategoryToONDC(category: string): string {
  const normalizedCategory = category.toLowerCase();
  return CATEGORY_MAPPING[normalizedCategory] || CATEGORY_MAPPING.other;
}

function formatPrice(price: number): string {
  return price.toFixed(2);
}

function generateShortDescription(entities: CatalogEntities): string {
  const { product_name, quantity, unit } = entities;
  return `${product_name} - ${quantity} ${unit}`;
}

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

async function publishCatalogCreatedEvent(data: {
  catalogItem: BecknCatalogItem;
  itemId: string;
  sellerId: string;
  messageId?: string;
}): Promise<void> {
  const eventBusName = process.env.EVENT_BUS_NAME;
  if (!eventBusName) {
    console.warn('EVENT_BUS_NAME not configured - skipping event publication');
    return;
  }

  const command = new PutEventsCommand({
    Entries: [
      {
        Source: EVENT_SOURCES.INTERNAL,
        DetailType: INTERNAL_EVENT_TYPES.CATALOG_CREATED,
        Detail: JSON.stringify({
          itemId: data.itemId,
          sellerId: data.sellerId,
          catalogItem: data.catalogItem,
          messageId: data.messageId,
          timestamp: new Date().toISOString(),
        }),
        EventBusName: eventBusName,
      },
    ],
  });

  const response = await eventBridgeClient.send(command);
  console.log('Published catalog.created event:', {
    itemId: data.itemId,
    sellerId: data.sellerId,
    eventId: response.Entries?.[0]?.EventId,
  });
}
