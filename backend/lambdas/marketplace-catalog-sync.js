/**
 * Marketplace Catalog Sync Lambda
 * 
 * Syncs catalog items from Vyapar Vaani DynamoDB table to Marketplace Products table
 * Triggered by catalog.created events from EventBridge
 * 
 * Transforms Beckn catalog format to marketplace product format
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

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
 * Fetches from KYC data (PAN card) if available, otherwise from seller profile
 */
async function getSellerInfo(sellerId) {
  try {
    // First, try to get KYC data (PAN card has seller name)
    const kycCommand = new GetCommand({
      TableName: VYAPAR_VAANI_TABLE,
      Key: {
        PK: `USER#${sellerId}`,
        SK: 'KYC',
      },
    });

    const kycResponse = await docClient.send(kycCommand);

    if (kycResponse.Item && kycResponse.Item.panCard) {
      // Extract name from PAN card data
      const panData = kycResponse.Item.panCard;
      if (panData.extractedData && panData.extractedData.name) {
        console.log('Found seller name from PAN card:', panData.extractedData.name);
        return {
          name: panData.extractedData.name,
          phone: sellerId,
          language: kycResponse.Item.language || 'en',
        };
      }
    }

    // Fallback: Try to get from seller profile
    const profileCommand = new GetCommand({
      TableName: VYAPAR_VAANI_TABLE,
      Key: {
        PK: `SELLER#${sellerId}`,
        SK: 'PROFILE',
      },
    });

    const profileResponse = await docClient.send(profileCommand);

    if (profileResponse.Item) {
      return {
        name: profileResponse.Item.name || `Seller ${sellerId}`,
        phone: profileResponse.Item.phone || sellerId,
        language: profileResponse.Item.language || 'en',
      };
    }

    // Return default if seller not found
    console.log('No seller info found, using default');
    return {
      name: `Seller ${sellerId}`,
      phone: sellerId,
      language: 'en',
    };
  } catch (error) {
    console.error('Failed to get seller info:', error);
    // Return default on error
    return {
      name: `Seller ${sellerId}`,
      phone: sellerId,
      language: 'en',
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

  return {
    productId: catalogItem.id,
    name: catalogItem.descriptor.name,
    description: catalogItem.descriptor.long_desc || catalogItem.descriptor.short_desc || '',
    price: parseFloat(catalogItem.price.value),
    quantity: catalogItem.quantity.available.count,
    unit: unit,
    category: catalogItem.category_id || 'Other',
    imageUrl: imageUrl,
    imageS3Key: imageS3Key || '',
    imageS3Bucket: imageS3Bucket || '',
    seller: {
      name: sellerInfo.name,
      phone: sellerInfo.phone,
    },
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
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
