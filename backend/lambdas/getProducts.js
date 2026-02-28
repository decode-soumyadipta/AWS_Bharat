/**
 * Lambda function to retrieve products from DynamoDB
 * GET /products
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.PRODUCTS_TABLE_NAME || 'marketplace-products';

exports.handler = async (event) => {
    console.log('GetProducts Lambda invoked', { event });

    try {
        // Scan DynamoDB table for all products
        const command = new ScanCommand({
            TableName: TABLE_NAME
        });

        const response = await docClient.send(command);
        
        // Sort products by createdAt descending (newest first)
        const products = (response.Items || []).sort((a, b) => {
            const dateA = new Date(a.createdAt || 0);
            const dateB = new Date(b.createdAt || 0);
            return dateB - dateA;
        });

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, OPTIONS'
            },
            body: JSON.stringify({
                success: true,
                products
            })
        };
    } catch (error) {
        console.error('Error fetching products:', error);
        
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
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
