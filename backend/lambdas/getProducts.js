/**
 * Lambda function to retrieve products from DynamoDB
 * GET /products
 * Generates fresh pre-signed URLs for product images on every request
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

const TABLE_NAME = process.env.PRODUCTS_TABLE_NAME || 'marketplace-products';

/**
 * Generate fresh pre-signed URL for a product image
 */
async function refreshImageUrl(product) {
    // If we have S3 key and bucket stored, generate a fresh pre-signed URL
    if (product.imageS3Key && product.imageS3Bucket) {
        try {
            const command = new GetObjectCommand({
                Bucket: product.imageS3Bucket,
                Key: product.imageS3Key,
            });
            product.imageUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour
        } catch (error) {
            console.warn('Failed to refresh pre-signed URL for', product.productId, error.message);
        }
    }
    // If existing imageUrl is an S3 URL, try to refresh it
    else if (product.imageUrl && (product.imageUrl.includes('.s3.') || product.imageUrl.startsWith('s3://'))) {
        try {
            let bucket, key;
            if (product.imageUrl.startsWith('s3://')) {
                const match = product.imageUrl.match(/s3:\/\/([^\/]+)\/(.+)/);
                if (match) { bucket = match[1]; key = match[2]; }
            } else {
                const match = product.imageUrl.match(/https:\/\/([^.]+)\.s3\.[^.]+\.amazonaws\.com\/([^?]+)/);
                if (match) { bucket = match[1]; key = match[2]; }
            }
            if (bucket && key) {
                const command = new GetObjectCommand({ Bucket: bucket, Key: key });
                product.imageUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
            }
        } catch (error) {
            console.warn('Failed to refresh image URL for', product.productId, error.message);
        }
    }
    return product;
}

exports.handler = async (event) => {
    console.log('GetProducts Lambda invoked', { event });

    try {
        // Scan with pagination to get all products
        let allItems = [];
        let lastEvaluatedKey = undefined;

        do {
            const command = new ScanCommand({
                TableName: TABLE_NAME,
                ExclusiveStartKey: lastEvaluatedKey,
            });
            const response = await docClient.send(command);
            allItems = allItems.concat(response.Items || []);
            lastEvaluatedKey = response.LastEvaluatedKey;
        } while (lastEvaluatedKey);

        // Sort products by createdAt descending (newest first)
        const products = allItems.sort((a, b) => {
            const dateA = new Date(a.createdAt || 0);
            const dateB = new Date(b.createdAt || 0);
            return dateB - dateA;
        });

        // Refresh pre-signed URLs for all products
        const refreshedProducts = await Promise.all(
            products.map(product => refreshImageUrl(product))
        );

        // Enrich products with ONDC-compliant metadata
        const ondcProducts = refreshedProducts.map(p => ({
            ...p,
            // ONDC Beckn fields (pass-through from catalog sync)
            ondcDomain: p.ondcDomain || 'ONDC:RET10',
            fulfillmentType: p.fulfillmentType || 'Delivery',
            returnable: p.returnable ?? false,
            cancellable: p.cancellable ?? true,
            codAvailable: p.codAvailable ?? true,
            // Beckn-compliant provider info
            provider: p.provider || {
                id: p.seller?.phone || '',
                descriptor: { name: p.seller?.name || '' },
            },
        }));

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, x-api-key, Authorization',
                'Access-Control-Allow-Methods': 'GET, OPTIONS'
            },
            body: JSON.stringify({
                success: true,
                products: ondcProducts,
                network: {
                    protocol: 'Beckn v1.2.0',
                    registry: 'ONDC',
                    bppId: process.env.NETWORK_PARTICIPANT_ID || 'vyapar-vaani.ondc.in',
                },
            })
        };
    } catch (error) {
        console.error('Error fetching products:', error);
        
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, x-api-key, Authorization',
                'Access-Control-Allow-Methods': 'GET, OPTIONS'
            },
            body: JSON.stringify({
                success: false,
                error: {
                    code: 'FETCH_PRODUCTS_ERROR',
                    message: 'Failed to fetch products',
                    details: error.message
                }
            })
        };
    }
};
