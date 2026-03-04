/**
 * Marketplace Catalog Sync Lambda
 *
 * Syncs catalog items from Vyapar Vaani DynamoDB table to Marketplace Products table.
 * Triggered by catalog.created / catalog.deleted events from EventBridge.
 *
 * Transforms Beckn catalog format to marketplace product format and stores it so
 * the buyer-facing marketplace SPA (marketplace/app.js) can display it correctly.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);
const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });

const VYAPAR_VAANI_TABLE = process.env.TABLE_NAME || 'vyapar-vaani-data';
const MARKETPLACE_PRODUCTS_TABLE = process.env.MARKETPLACE_PRODUCTS_TABLE || 'marketplace-products';

/**
 * Lambda handler — routes catalog.created / catalog.deleted EventBridge events.
 */
export const handler = async (event: any): Promise<any> => {
  console.log('Catalog sync event:', JSON.stringify(event, null, 2));

  try {
    const detailType: string = event['detail-type'] || event.detailType || '';
    const { detail } = event;

    // Handle catalog.deleted events
    if (detailType === 'catalog.deleted') {
      return await handleCatalogDeleted(detail);
    }

    // Handle catalog.created events (default)
    const { catalogItem, sellerId, itemId } = detail;

    if (!catalogItem || !sellerId || !itemId) {
      throw new Error('Missing required fields: catalogItem, sellerId, itemId');
    }

    // Get seller information from Vyapar Vaani table
    const sellerInfo = await getSellerInfo(sellerId);

    // Transform Beckn catalog item to marketplace product format
    const marketplaceProduct = await transformToMarketplaceProduct(catalogItem, sellerId, sellerInfo);

    // AI quality scoring (non-blocking, enriches the product record)
    const qualityScore = await scoreProductQuality(marketplaceProduct);
    (marketplaceProduct as any).qualityScore = qualityScore;

    // Store in marketplace products table
    await storeMarketplaceProduct(marketplaceProduct);

    console.log('✅ Synced product to marketplace:', {
      productId: marketplaceProduct.productId,
      name: marketplaceProduct.name,
      sellerId,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, productId: marketplaceProduct.productId }),
    };
  } catch (error: any) {
    console.error('Catalog sync failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};

/**
 * Handle catalog.deleted event — remove product from marketplace.
 */
async function handleCatalogDeleted(detail: any): Promise<any> {
  const { itemId, sellerId, productName } = detail;
  console.log('Handling catalog.deleted:', { itemId, sellerId, productName });

  // Direct delete by itemId first
  try {
    await docClient.send(new DeleteCommand({
      TableName: MARKETPLACE_PRODUCTS_TABLE,
      Key: { productId: itemId },
    }));
    console.log('Deleted product from marketplace by itemId:', itemId);
  } catch (error: any) {
    console.warn('Direct delete by itemId failed, trying scan:', error.message);
  }

  // Also scan for products matching this seller + name (in case productId differs)
  try {
    const scanResult = await docClient.send(new ScanCommand({
      TableName: MARKETPLACE_PRODUCTS_TABLE,
      FilterExpression: '#s.#p = :phone',
      ExpressionAttributeNames: { '#s': 'seller', '#p': 'phone' },
      ExpressionAttributeValues: { ':phone': sellerId },
    }));

    const items = scanResult.Items || [];
    for (const item of items) {
      const nameLower = (item.name || '').toLowerCase();
      const searchName = (productName || '').toLowerCase();
      if (
        nameLower.includes(searchName) ||
        searchName.includes(nameLower) ||
        item.productId === itemId
      ) {
        await docClient.send(new DeleteCommand({
          TableName: MARKETPLACE_PRODUCTS_TABLE,
          Key: { productId: item.productId },
        }));
        console.log('Deleted marketplace product:', item.productId, item.name);
      }
    }
  } catch (error: any) {
    console.error('Scan-based deletion failed:', error);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      message: `Product ${productName || itemId} deleted from marketplace`,
    }),
  };
}

/**
 * Get seller information from Vyapar Vaani table.
 * Tries KYC PAN card name → GSI1 (phone → PROFILE) → direct PK lookup.
 */
async function getSellerInfo(sellerId: string): Promise<{
  name: string;
  phone: string;
  language: string;
  upiId: string | null;
}> {
  try {
    let sellerName = `Seller ${sellerId}`;
    let sellerLanguage = 'en';
    let upiId: string | null = null;

    // 1. Try KYC data first (has PAN card extracted name)
    try {
      const kycResponse = await docClient.send(new GetCommand({
        TableName: VYAPAR_VAANI_TABLE,
        Key: { PK: `USER#${sellerId}`, SK: 'KYC' },
      }));
      if ((kycResponse.Item as any)?.panCard?.extractedData?.name) {
        sellerName = (kycResponse.Item as any).panCard.extractedData.name;
        sellerLanguage = (kycResponse.Item as any).language || 'en';
        console.log('Found seller name from PAN card:', sellerName);
      }
    } catch (e: any) {
      console.warn('KYC lookup failed (non-critical):', e.message);
    }

    // 2. GSI1 (phone → PROFILE) — handles SELLER#<uuid> PK format
    try {
      const profileRes = await docClient.send(new QueryCommand({
        TableName: VYAPAR_VAANI_TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :phone AND GSI1SK = :sk',
        ExpressionAttributeValues: { ':phone': sellerId, ':sk': 'PROFILE' },
        Limit: 1,
      }));
      if (profileRes.Items && profileRes.Items.length > 0) {
        const profile = profileRes.Items[0] as any;
        upiId = profile.upiId || null;
        if (profile.name && profile.name !== sellerId) {
          sellerName = profile.name;
        }
        sellerLanguage = profile.language || sellerLanguage;
        console.log('Found seller profile via GSI1:', { name: sellerName, upiId });
      }
    } catch (e: any) {
      console.warn('GSI1 profile lookup failed (non-critical):', e.message);
    }

    // 3. Fallback direct PK lookup (old format)
    if (!upiId) {
      try {
        const directRes = await docClient.send(new GetCommand({
          TableName: VYAPAR_VAANI_TABLE,
          Key: { PK: `SELLER#${sellerId}`, SK: 'PROFILE' },
        }));
        if (directRes.Item) {
          upiId = (directRes.Item as any).upiId || null;
          if ((directRes.Item as any).name) {
            sellerName = (directRes.Item as any).name;
          }
        }
      } catch (_e) { /* ignore */ }
    }

    return { name: sellerName, phone: sellerId, language: sellerLanguage, upiId };
  } catch (error: any) {
    console.error('Failed to get seller info:', error);
    return { name: `Seller ${sellerId}`, phone: sellerId, language: 'en', upiId: null };
  }
}

/**
 * Transform a Beckn catalog item into the marketplace product format.
 * Generates a pre-signed URL for S3-hosted images valid for 7 days.
 */
async function transformToMarketplaceProduct(
  catalogItem: any,
  sellerId: string,
  sellerInfo: { name: string; phone: string; language: string; upiId: string | null }
): Promise<any> {
  const now = new Date().toISOString();

  // Extract image URL from descriptor
  let imageUrl: string = '';
  if (catalogItem.descriptor?.symbol) {
    imageUrl = catalogItem.descriptor.symbol;
  } else if (catalogItem.descriptor?.images?.length > 0) {
    imageUrl = catalogItem.descriptor.images[0].url || catalogItem.descriptor.images[0];
  }

  // Convert S3 URL to pre-signed URL for immediate use by the marketplace SPA
  let imageS3Key = '';
  let imageS3Bucket = '';
  if (
    imageUrl &&
    (imageUrl.startsWith('s3://') ||
      (imageUrl.includes('.s3.') && imageUrl.includes('.amazonaws.com/')))
  ) {
    try {
      if (imageUrl.startsWith('s3://')) {
        const s3Match = imageUrl.match(/s3:\/\/([^/]+)\/(.+)/);
        if (s3Match) {
          imageS3Bucket = s3Match[1];
          imageS3Key = s3Match[2];
        }
      } else {
        const httpsMatch = imageUrl.match(/https:\/\/([^.]+)\.s3\.[^.]+\.amazonaws\.com\/(.+)/);
        if (httpsMatch) {
          imageS3Bucket = httpsMatch[1];
          imageS3Key = httpsMatch[2];
        }
      }

      if (imageS3Bucket && imageS3Key) {
        const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
        const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
        const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
        imageUrl = await getSignedUrl(
          s3Client,
          new GetObjectCommand({ Bucket: imageS3Bucket, Key: imageS3Key }),
          { expiresIn: 604800 } // 7 days
        );
        console.log('Generated pre-signed URL for S3 image');
      }
    } catch (error: any) {
      console.error('Failed to generate pre-signed URL:', error);
      // Keep original URL as fallback
    }
  }

  // Extract unit from quantity.unitized or tags
  let unit = 'piece';
  if (catalogItem.quantity?.unitized?.measure?.unit) {
    unit = catalogItem.quantity.unitized.measure.unit;
  } else if (Array.isArray(catalogItem.tags)) {
    const unitTag = catalogItem.tags.find((t: any) => t.code === 'unit');
    if (unitTag?.list) {
      const unitValue = unitTag.list.find((i: any) => i.code === 'value');
      if (unitValue) unit = unitValue.value;
    }
  }

  return {
    productId: catalogItem.id,
    name: catalogItem.descriptor.name,
    description: catalogItem.descriptor.long_desc || catalogItem.descriptor.short_desc || '',
    price: parseFloat(catalogItem.price.value),
    quantity: catalogItem.quantity.available.count,
    unit,
    category: catalogItem.category_id || 'Other',
    imageUrl,
    imageS3Key,
    imageS3Bucket,
    seller: {
      name: sellerInfo.name,
      phone: sellerInfo.phone,
      upiId: sellerInfo.upiId || null,
    },
    ondcDomain: catalogItem.ondcDomain || 'ONDC:RET10',
    fulfillmentType: 'Delivery',
    returnable: catalogItem['@ondc/org/returnable'] ?? false,
    cancellable: catalogItem['@ondc/org/cancellable'] ?? true,
    codAvailable: catalogItem['@ondc/org/available_on_cod'] ?? true,
    provider: {
      id: sellerInfo.phone,
      descriptor: { name: sellerInfo.name },
    },
    beckn: {
      categoryId: catalogItem.category_id,
      priceValue: catalogItem.price.value,
      priceCurrency: catalogItem.price.currency || 'INR',
      quantityUnitized: catalogItem.quantity.unitized || null,
    },
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * AI Product Quality Scoring using Amazon Nova Pro via Bedrock.
 * Non-blocking — enriches the record but never blocks catalog creation on failure.
 */
async function scoreProductQuality(product: any): Promise<any> {
  try {
    const prompt = `You are a marketplace listing quality evaluator for a rural Indian e-commerce platform.

Evaluate this product listing and score it:

Product Name: ${product.name}
Description: ${product.description || 'No description'}
Price: ₹${product.price}
Category: ${product.category}
Unit: ${product.unit}
Has Image: ${product.imageUrl ? 'Yes' : 'No'}

Score these dimensions (0-100):
1. Name Quality: Is it clear, descriptive, searchable?
2. Description Quality: Is it detailed enough for buyers?
3. Price Reasonableness: Is price realistic for this category in rural India?
4. Image: Does listing have an image?
5. Completeness: Are all important fields filled?

Respond in this exact JSON format:
{
  "overallScore": <0-100>,
  "nameScore": <0-100>,
  "descriptionScore": <0-100>,
  "priceScore": <0-100>,
  "imageScore": <0-100>,
  "completenessScore": <0-100>,
  "improvementTips": ["<tip1 in Hindi>", "<tip2 in Hindi>"],
  "badge": "excellent|good|fair|needs_improvement"
}`;

    const response = await bedrockClient.send(new InvokeModelCommand({
      modelId: 'amazon.nova-pro-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 512, temperature: 0.2 },
      }),
    }));

    const result = JSON.parse(new TextDecoder().decode(response.body));
    const text: string = result.output?.message?.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const scoring = JSON.parse(jsonMatch[0]);
      console.log('AI quality score for', product.name, ':', scoring.overallScore);
      return scoring;
    }
  } catch (error: any) {
    console.warn('AI quality scoring failed (non-critical):', error.message);
  }

  return { overallScore: 50, badge: 'fair', improvementTips: [] };
}

/**
 * Persist marketplace product to DynamoDB using PutCommand (full overwrite).
 */
async function storeMarketplaceProduct(product: any): Promise<void> {
  await docClient.send(new PutCommand({
    TableName: MARKETPLACE_PRODUCTS_TABLE,
    Item: product,
  }));
  console.log('Product stored in marketplace table:', product.productId);
}
