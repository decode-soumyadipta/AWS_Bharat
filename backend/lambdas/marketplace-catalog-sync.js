/**
 * Marketplace Catalog Sync Lambda
 * 
 * Syncs catalog items from Vyapar Vaani DynamoDB table to Marketplace Products table
 * Triggered by catalog.created events from EventBridge
 * 
 * Transforms Beckn catalog format to marketplace product format
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, ScanCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });

const VYAPAR_VAANI_TABLE = process.env.VYAPAR_VAANI_TABLE || 'vyapar-vaani-data';
const MARKETPLACE_PRODUCTS_TABLE = process.env.MARKETPLACE_PRODUCTS_TABLE || 'marketplace-products';

/**
 * Lambda handler
 */
exports.handler = async (event) => {
  console.log('Catalog sync event:', JSON.stringify(event, null, 2));

  try {
    const detailType = event['detail-type'] || event.detailType;
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
    const marketplaceProduct = await transformToMarketplaceProduct(
      catalogItem,
      sellerId,
      sellerInfo
    );

    // AI quality scoring (non-blocking, enriches the product record)
    const qualityScore = await scoreProductQuality(marketplaceProduct);
    marketplaceProduct.qualityScore = qualityScore;

    // Store in marketplace products table
    await storeMarketplaceProduct(marketplaceProduct);

    console.log('Successfully synced product to marketplace:', {
      productId: marketplaceProduct.productId,
      name: marketplaceProduct.name,
      sellerId,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        productId: marketplaceProduct.productId,
      }),
    };
  } catch (error) {
    console.error('Catalog sync failed:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
      }),
    };
  }
};

/**
 * Handle catalog.deleted event — remove product from marketplace
 */
async function handleCatalogDeleted(detail) {
  const { itemId, sellerId, productName } = detail;
  console.log('Handling catalog.deleted:', { itemId, sellerId, productName });

  // The marketplace productId is the same as the itemId from catalog
  // Try direct delete first
  try {
    const deleteCommand = new DeleteCommand({
      TableName: MARKETPLACE_PRODUCTS_TABLE,
      Key: { productId: itemId },
    });
    await docClient.send(deleteCommand);
    console.log('Deleted product from marketplace by itemId:', itemId);
  } catch (error) {
    console.warn('Direct delete by itemId failed, trying scan:', error.message);
  }

  // Also scan for any products matching this seller + product name (in case productId differs)
  try {
    const scanCommand = new ScanCommand({
      TableName: MARKETPLACE_PRODUCTS_TABLE,
      FilterExpression: '#s.#p = :phone',
      ExpressionAttributeNames: {
        '#s': 'seller',
        '#p': 'phone',
      },
      ExpressionAttributeValues: {
        ':phone': sellerId,
      },
    });

    const scanResult = await docClient.send(scanCommand);
    const items = scanResult.Items || [];
    
    // Find and delete matching items by product name
    for (const item of items) {
      const nameLower = (item.name || '').toLowerCase();
      const searchName = (productName || '').toLowerCase();
      if (nameLower.includes(searchName) || searchName.includes(nameLower) || item.productId === itemId) {
        await docClient.send(new DeleteCommand({
          TableName: MARKETPLACE_PRODUCTS_TABLE,
          Key: { productId: item.productId },
        }));
        console.log('Deleted marketplace product:', item.productId, item.name);
      }
    }
  } catch (error) {
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
 * Get seller information from Vyapar Vaani table
 * Uses GSI1 (phone → PROFILE) to find the seller profile regardless of UUID vs phone PK.
 * Falls back to KYC data (PAN card) for seller name.
 */
async function getSellerInfo(sellerId) {
  try {
    let sellerName = `Seller ${sellerId}`;
    let sellerLanguage = 'en';
    let upiId = null;

    // 1. Try KYC data first (has PAN card extracted name)
    try {
      const kycCommand = new GetCommand({
        TableName: VYAPAR_VAANI_TABLE,
        Key: {
          PK: `USER#${sellerId}`,
          SK: 'KYC',
        },
      });
      const kycResponse = await docClient.send(kycCommand);
      if (kycResponse.Item?.panCard?.extractedData?.name) {
        sellerName = kycResponse.Item.panCard.extractedData.name;
        sellerLanguage = kycResponse.Item.language || 'en';
        console.log('Found seller name from PAN card:', sellerName);
      }
    } catch (e) {
      console.warn('KYC lookup failed (non-critical):', e.message);
    }

    // 2. Look up seller profile via GSI1 (phone → PROFILE)
    //    The seller profile PK may be SELLER#<uuid> not SELLER#<phone>
    try {
      const profileQuery = new QueryCommand({
        TableName: VYAPAR_VAANI_TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :phone AND GSI1SK = :sk',
        ExpressionAttributeValues: {
          ':phone': sellerId,
          ':sk': 'PROFILE',
        },
        Limit: 1,
      });
      const profileRes = await docClient.send(profileQuery);
      if (profileRes.Items && profileRes.Items.length > 0) {
        const profile = profileRes.Items[0];
        upiId = profile.upiId || null;
        if (profile.name && profile.name !== sellerId) {
          sellerName = profile.name;
        }
        sellerLanguage = profile.language || sellerLanguage;
        console.log('Found seller profile via GSI1:', { name: sellerName, upiId });
      }
    } catch (e) {
      console.warn('GSI1 profile lookup failed (non-critical):', e.message);
    }

    // 3. Fallback: try direct PK lookup SELLER#<phone>/PROFILE (old format)
    if (!upiId) {
      try {
        const directProfile = new GetCommand({
          TableName: VYAPAR_VAANI_TABLE,
          Key: { PK: `SELLER#${sellerId}`, SK: 'PROFILE' },
        });
        const directRes = await docClient.send(directProfile);
        if (directRes.Item) {
          upiId = directRes.Item.upiId || null;
          if (directRes.Item.name) sellerName = directRes.Item.name;
        }
      } catch (e) { /* ignore */ }
    }

    return {
      name: sellerName,
      phone: sellerId,
      language: sellerLanguage,
      upiId,
    };
  } catch (error) {
    console.error('Failed to get seller info:', error);
    return {
      name: `Seller ${sellerId}`,
      phone: sellerId,
      language: 'en',
      upiId: null,
    };
  }
}

/**
 * Transform Beckn catalog item to marketplace product format
 */
async function transformToMarketplaceProduct(catalogItem, sellerId, sellerInfo) {
  const now = new Date().toISOString();

  // Extract image URL from descriptor
  let imageUrl = '';
  if (catalogItem.descriptor.symbol) {
    imageUrl = catalogItem.descriptor.symbol;
  } else if (catalogItem.descriptor.images && catalogItem.descriptor.images.length > 0) {
    imageUrl = catalogItem.descriptor.images[0];
  }

  // Convert S3 URL to store the S3 key for fresh pre-signed URL generation at read time
  let imageS3Key = '';
  let imageS3Bucket = '';
  if (imageUrl && (imageUrl.startsWith('s3://') || (imageUrl.includes('.s3.') && imageUrl.includes('.amazonaws.com/')))) {
    try {
      // Extract bucket and key from s3:// URL
      if (imageUrl.startsWith('s3://')) {
        const s3Match = imageUrl.match(/s3:\/\/([^\/]+)\/(.+)/);
        if (s3Match) {
          imageS3Bucket = s3Match[1];
          imageS3Key = s3Match[2];
        }
      } else {
        // Extract from HTTPS URL: https://bucket.s3.region.amazonaws.com/key
        const httpsMatch = imageUrl.match(/https:\/\/([^.]+)\.s3\.[^.]+\.amazonaws\.com\/(.+)/);
        if (httpsMatch) {
          imageS3Bucket = httpsMatch[1];
          imageS3Key = httpsMatch[2];
        }
      }
      
      if (imageS3Bucket && imageS3Key) {
        const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
        const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
        const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
        const command = new GetObjectCommand({
          Bucket: imageS3Bucket,
          Key: imageS3Key,
        });
        
        // Generate pre-signed URL valid for 7 days for immediate use
        imageUrl = await getSignedUrl(s3Client, command, { expiresIn: 604800 });
        console.log('Generated pre-signed URL for S3 image');
      }
    } catch (error) {
      console.error('Failed to generate pre-signed URL:', error);
      // Keep original URL as fallback
    }
  }

  // Extract unit from tags or quantity.unitized
  let unit = 'piece';
  let pricePerUnit = false;
  if (catalogItem.quantity && catalogItem.quantity.unitized && catalogItem.quantity.unitized.measure) {
    unit = catalogItem.quantity.unitized.measure.unit;
  } else if (catalogItem.tags) {
    const unitTag = catalogItem.tags.find(tag => tag.code === 'unit');
    if (unitTag && unitTag.list) {
      const unitValue = unitTag.list.find(item => item.code === 'value');
      if (unitValue) {
        unit = unitValue.value;
      }
    }
  }
  if (catalogItem.tags) {
    const ppuTag = catalogItem.tags.find(tag => tag.code === 'price_per_unit');
    if (ppuTag && ppuTag.list) {
      const ppuValue = ppuTag.list.find(item => item.code === 'value');
      if (ppuValue) {
        pricePerUnit = ppuValue.value === 'true';
      }
    }
  }

  return {
    productId: catalogItem.id,
    name: catalogItem.descriptor.name,
    description: catalogItem.descriptor.long_desc || catalogItem.descriptor.short_desc || '',
    price: parseFloat(catalogItem.price.value),
    pricePerUnit: pricePerUnit,
    quantity: catalogItem.quantity.available.count,
    unit: unit,
    category: catalogItem.category_id || 'Other',
    imageUrl: imageUrl,
    imageS3Key: imageS3Key || '',
    imageS3Bucket: imageS3Bucket || '',
    seller: {
      name: sellerInfo.name,
      phone: sellerInfo.phone,
      upiId: sellerInfo.upiId || null,
    },
    // ONDC Beckn Protocol metadata
    ondcDomain: catalogItem.ondcDomain || 'ONDC:RET10',
    fulfillmentType: catalogItem.fulfillment_id ? 'Delivery' : 'Delivery',
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
 * AI Product Quality Scoring using Bedrock Nova Pro
 * Evaluates listing quality and provides improvement suggestions
 */
async function scoreProductQuality(product) {
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
    const text = result.output?.message?.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const scoring = JSON.parse(jsonMatch[0]);
      console.log('AI quality score for', product.name, ':', scoring.overallScore);
      return scoring;
    }
  } catch (error) {
    console.warn('AI quality scoring failed (non-critical):', error.message);
  }

  // Default score if AI fails
  return {
    overallScore: 50,
    badge: 'fair',
    improvementTips: [],
  };
}

/**
 * Store marketplace product in DynamoDB
 */
async function storeMarketplaceProduct(product) {
  const command = new PutCommand({
    TableName: MARKETPLACE_PRODUCTS_TABLE,
    Item: product,
  });

  await docClient.send(command);
  console.log('Product stored in marketplace table:', product.productId);
}
