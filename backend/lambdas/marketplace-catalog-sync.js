/**
 * Marketplace Catalog Sync Lambda
 * 
 * Syncs catalog items from Vyapar Vaani DynamoDB table to Marketplace Products table
 * Triggered by catalog.created events from EventBridge
 * 
 * Transforms Beckn catalog format to marketplace product format
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

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
    const { detail } = event;
    const { catalogItem, sellerId, itemId } = detail;

    if (!catalogItem || !sellerId || !itemId) {
      throw new Error('Missing required fields: catalogItem, sellerId, itemId');
    }

    // Get seller information from Vyapar Vaani table
    const sellerInfo = await getSellerInfo(sellerId);

    // Transform Beckn catalog item to marketplace product format
    const marketplaceProduct = transformToMarketplaceProduct(
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
 * Get seller information from Vyapar Vaani table
 */
async function getSellerInfo(sellerId) {
  try {
    const command = new GetCommand({
      TableName: VYAPAR_VAANI_TABLE,
      Key: {
        PK: `SELLER#${sellerId}`,
        SK: 'PROFILE',
      },
    });

    const response = await docClient.send(command);

    if (response.Item) {
      return {
        name: response.Item.name || `Seller ${sellerId}`,
        phone: response.Item.phone || sellerId,
        language: response.Item.language || 'en',
      };
    }

    // Return default if seller not found
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
function transformToMarketplaceProduct(catalogItem, sellerId, sellerInfo) {
  const now = new Date().toISOString();

  return {
    productId: catalogItem.id,
    name: catalogItem.descriptor.name,
    description: catalogItem.descriptor.long_desc || catalogItem.descriptor.short_desc || '',
    price: parseFloat(catalogItem.price.value),
    quantity: catalogItem.quantity.available.count,
    unit: extractUnit(catalogItem.descriptor.short_desc) || 'piece',
    category: catalogItem.category_id || 'Other',
    imageUrl: catalogItem.descriptor.symbol || (catalogItem.descriptor.images && catalogItem.descriptor.images[0]) || '',
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
 * Extract unit from product description
 */
function extractUnit(description) {
  if (!description) return 'piece';

  const lowerDesc = description.toLowerCase();

  if (lowerDesc.includes('kg')) return 'kg';
  if (lowerDesc.includes('gram') || lowerDesc.includes('gm')) return 'gram';
  if (lowerDesc.includes('liter') || lowerDesc.includes('litre')) return 'liter';
  if (lowerDesc.includes('dozen')) return 'dozen';
  if (lowerDesc.includes('box')) return 'box';

  return 'piece';
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
