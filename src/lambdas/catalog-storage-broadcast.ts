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
  event: any
): Promise<CatalogStorageBroadcastResponse> => {
  console.log('Catalog storage and broadcast request:', JSON.stringify(event, null, 2));

  try {
    // Parse EventBridge event format
    const eventDetail = event.detail || event;
    const { catalogItem, sellerId, messageId } = eventDetail;

    if (!catalogItem) {
      throw new Error('Catalog item is required');
    }

    // Step 1: Validate catalog object using schema validator
    console.log('Step 1: Validating catalog object...');
    const validation = validateCatalogItem(catalogItem);

    if (!validation.valid) {
      console.error('Catalog validation failed:', validation.errors);
      return {
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Catalog validation failed',
        },
      };
    }

    console.log('Catalog validation passed');

    // Step 2: Store catalog item in DynamoDB
    console.log('Step 2: Storing catalog item in DynamoDB...');
    const itemId = catalogItem.id;
    
    const catalogItemToStore: CatalogItem = {
      PK: `SELLER#${sellerId}`,
      SK: `ITEM#${itemId}`,
      GSI3PK: `CATEGORY#${catalogItem.category_id}`,
      GSI3SK: `ITEM#${itemId}`,
      entityType: 'CATALOG_ITEM',
      itemId,
      sellerId,
      becknItem: catalogItem,
      images: { raw: '', enhanced: '' },
      status: 'ACTIVE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
    };

    await createCatalogItem(catalogItemToStore);
    console.log('Catalog item stored with ID:', itemId);

    // Step 2.5: Publish catalog.created event for marketplace sync
    console.log('Step 2.5: Publishing catalog.created event...');
    await publishCatalogCreatedEvent(catalogItem, sellerId, itemId);

    // Step 2.6: Broadcast catalog to ONDC network via on_search
    console.log('Step 2.6: Broadcasting catalog to ONDC network...');
    const broadcastResult = await broadcastToONDC(catalogItem, sellerId);

    // Step 3: Send confirmation message to seller
    console.log('Step 3: Sending confirmation message to seller...');
    const confirmationSent = await sendConfirmationToSeller(
      sellerId,
      catalogItem,
      eventDetail.language || 'en'
    );

    return {
      success: true,
      itemId,
      broadcast: broadcastResult,
      confirmationSent,
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
 * Broadcast catalog to ONDC network by publishing an on_search event
 * This makes the catalog item discoverable by BAPs on the ONDC network
 */
async function broadcastToONDC(
  catalogItem: BecknCatalogItem,
  sellerId: string
): Promise<boolean> {
  const eventBusName = process.env.EVENT_BUS_NAME;
  const networkParticipantId = process.env.NETWORK_PARTICIPANT_ID || 'vyapar-vaani.ondc.in';
  const bppBaseUrl = process.env.BPP_BASE_URL || 'https://api.vyapar-vaani.ondc.in';

  if (!eventBusName) {
    console.warn('EVENT_BUS_NAME not configured — skipping ONDC broadcast');
    return false;
  }

  try {
    const { PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
    const { eventBridgeClient } = await import('../config/aws-clients');

    // Construct Beckn on_search payload for ONDC broadcast
    const onSearchPayload = {
      context: {
        domain: catalogItem.category_id?.startsWith('RET') ? `ONDC:${catalogItem.category_id}` : 'ONDC:RET10',
        action: 'on_search',
        core_version: '1.2.0',
        bpp_id: networkParticipantId,
        bpp_uri: bppBaseUrl,
        country: 'IND',
        city: 'std:*',
        timestamp: new Date().toISOString(),
        message_id: randomUUID(),
        transaction_id: randomUUID(),
      },
      message: {
        catalog: {
          'bpp/providers': [{
            id: sellerId,
            items: [{
              id: catalogItem.id,
              descriptor: catalogItem.descriptor,
              price: catalogItem.price,
              quantity: catalogItem.quantity,
              category_id: catalogItem.category_id,
              fulfillment_id: catalogItem.fulfillment_id || 'F1',
              '@ondc/org/returnable': false,
              '@ondc/org/cancellable': true,
              '@ondc/org/available_on_cod': true,
              '@ondc/org/time_to_ship': 'P1D',
            }],
          }],
        },
      },
    };

    const command = new PutEventsCommand({
      Entries: [{
        Source: 'vyapar.vaani.ondc',
        DetailType: 'catalog.broadcast.on_search',
        Detail: JSON.stringify({
          sellerId,
          itemId: catalogItem.id,
          onSearchPayload,
          timestamp: Date.now(),
        }),
        EventBusName: eventBusName,
      }],
    });

    const response = await eventBridgeClient.send(command);
    console.log('ONDC catalog broadcast published:', {
      itemId: catalogItem.id,
      eventId: response.Entries?.[0]?.EventId,
    });

    return true;
  } catch (error) {
    console.error('Failed to broadcast catalog to ONDC:', error);
    // Don't throw — ONDC broadcast failure shouldn't block catalog creation
    return false;
  }
}

/**
 * Publish catalog.created event to EventBridge for marketplace sync
 */
async function publishCatalogCreatedEvent(
  catalogItem: BecknCatalogItem,
  sellerId: string,
  itemId: string
): Promise<void> {
  const eventBusName = process.env.EVENT_BUS_NAME;
  if (!eventBusName) {
    console.warn('EVENT_BUS_NAME not configured - skipping marketplace sync event');
    return;
  }

  try {
    const { PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
    const { eventBridgeClient } = await import('../config/aws-clients');
    const { EVENT_SOURCES } = await import('../config/event-patterns');

    const command = new PutEventsCommand({
      Entries: [
        {
          Source: EVENT_SOURCES.INTERNAL,
          DetailType: 'catalog.created',
          Detail: JSON.stringify({
            catalogItem,
            sellerId,
            itemId,
            timestamp: Date.now(),
          }),
          EventBusName: eventBusName,
        },
      ],
    });

    const response = await eventBridgeClient.send(command);
    console.log('Published catalog.created event:', {
      itemId,
      eventId: response.Entries?.[0]?.EventId,
    });
  } catch (error) {
    console.error('Failed to publish catalog.created event:', error);
    // Don't throw - marketplace sync failure shouldn't block catalog creation
  }
}

/**
 * Send confirmation WhatsApp message to seller via EventBridge
 * Sends a concise message with voice confirmation
 */
async function sendConfirmationToSeller(
  sellerId: string,
  catalogItem: BecknCatalogItem,
  language: 'hi' | 'mr' | 'en'
): Promise<boolean> {
  // Create short, concise message
  const messages = {
    hi: `🎉 बधाई हो! ${catalogItem.descriptor.name} सफलतापूर्वक जोड़ा गया।

₹${catalogItem.price.value} | ${catalogItem.quantity.available.count} ${catalogItem.quantity.unitized?.measure.unit || 'unit'}

आपका उत्पाद अब खरीदारों को दिखाई देगा।`,
    mr: `🎉 अभिनंदन! ${catalogItem.descriptor.name} यशस्वीरित्या जोडले गेले।

₹${catalogItem.price.value} | ${catalogItem.quantity.available.count} ${catalogItem.quantity.unitized?.measure.unit || 'unit'}

तुमचे उत्पादन आता खरेदीदारांना दिसेल.`,
    en: `🎉 Congratulations! ${catalogItem.descriptor.name} added successfully.

₹${catalogItem.price.value} | ${catalogItem.quantity.available.count} ${catalogItem.quantity.unitized?.measure.unit || 'unit'}

Your product is now visible to buyers.`,
  };

  const text = messages[language] || messages.en;

  try {
    // Publish WhatsApp message send event to EventBridge with voice enabled
    const { EventBridgeClient, PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
    const eventBridge = new EventBridgeClient({ region: process.env.AWS_REGION || 'us-east-1' });

    await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'vyapar.vaani.internal',
            DetailType: 'whatsapp.message.send',
            Detail: JSON.stringify({
              to: sellerId, // Using sellerId as phone number
              type: 'text_with_voice', // Enable voice confirmation
              content: {
                text,
              },
              language,
            }),
            EventBusName: process.env.EVENT_BUS_NAME,
          },
        ],
      })
    );

    console.log('Concise confirmation message with voice published to EventBridge');
    return true;
  } catch (error) {
    console.error('Failed to publish confirmation message event:', error);
    return false;
  }
}
