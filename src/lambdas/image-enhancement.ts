/**
 * Image Enhancement Lambda
 * 
 * This Lambda function enhances product photos using Amazon Titan Image Generator v2
 * with CANNY_EDGE conditioning to preserve product structure while generating
 * professional backgrounds.
 * 
 * Features:
 * - Downloads raw product photos from S3
 * - Encodes images to base64 for Bedrock API
 * - Constructs Titan Image Generator v2 requests with CANNY_EDGE conditioning
 * - Sets positive prompts for professional product photography
 * - Sets negative prompts to avoid label/text modifications
 * - Sets similarityStrength to 0.8 for high structure preservation
 * - Calls Amazon Bedrock InvokeModel API with Titan Image Generator v2
 * - Decodes generated images from base64
 * - Uploads enhanced images to S3
 * 
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4
 */

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { s3Client, bedrockClient, PRODUCTS_BUCKET_NAME } from '../config/aws-clients';
import { Readable } from 'stream';

/**
 * Titan Image Generator v2 model ID
 */
const TITAN_IMAGE_MODEL_ID = 'amazon.titan-image-generator-v2:0';

/**
 * Request to enhance a product image
 */
export interface ImageEnhancementRequest {
  /**
   * S3 URL or key of the raw product photo
   */
  rawImageUrl: string;

  /**
   * Product name for context in prompt generation
   */
  productName: string;

  /**
   * Product category for context in prompt generation
   */
  productCategory?: string;

  /**
   * Item ID for naming the enhanced image
   */
  itemId: string;

  /**
   * Seller ID for organizing S3 storage
   */
  sellerId: string;
}

/**
 * Response from image enhancement
 */
export interface ImageEnhancementResponse {
  /**
   * Whether enhancement was successful
   */
  success: boolean;

  /**
   * S3 URL of the enhanced image
   */
  enhancedImageUrl?: string;

  /**
   * S3 key of the enhanced image
   */
  enhancedImageKey?: string;

  /**
   * Error information (if failed)
   */
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Titan Image Generator v2 request structure
 */
interface TitanImageRequest {
  taskType: 'IMAGE_VARIATION' | 'BACKGROUND_REMOVAL';
  imageVariationParams?: {
    images: string[]; // Base64 encoded images
    text: string; // Positive prompt
    negativeText: string; // Negative prompt
    similarityStrength: number; // 0.0-1.0, higher = more preservation
  };
  backgroundRemovalParams?: {
    image: string; // Base64 encoded image
  };
  imageGenerationConfig: {
    numberOfImages: number;
    quality: 'standard' | 'premium';
    height: number;
    width: number;
    cfgScale?: number; // Guidance scale
    seed?: number; // For reproducibility
  };
}

/**
 * Titan Image Generator v2 response structure
 */
interface TitanImageResponse {
  images: string[]; // Base64 encoded images
  error?: string;
}

/**
 * Lambda handler for image enhancement
 */
export const handler = async (
  event: ImageEnhancementRequest
): Promise<ImageEnhancementResponse> => {
  console.log('Image enhancement request:', JSON.stringify(event, null, 2));

  try {
    // Validate input
    validateImageEnhancementRequest(event);

    // Download raw image from S3
    console.log('Downloading raw image from S3...');
    const rawImageBuffer = await downloadImageFromS3(event.rawImageUrl);
    console.log(`Downloaded image: ${rawImageBuffer.length} bytes`);

    // Encode image to base64
    const base64Image = rawImageBuffer.toString('base64');
    console.log(`Encoded image to base64: ${base64Image.length} characters`);

    // Generate prompts based on product information
    const positivePrompt = generatePositivePrompt(
      event.productName,
      event.productCategory
    );
    const negativePrompt = generateNegativePrompt();

    console.log('Positive prompt:', positivePrompt);
    console.log('Negative prompt:', negativePrompt);

    // Use IMAGE_VARIATION to transform background to solid professional color
    const titanRequest: TitanImageRequest = {
      taskType: 'IMAGE_VARIATION',
      imageVariationParams: {
        images: [base64Image],
        text: positivePrompt,
        negativeText: negativePrompt,
        similarityStrength: 0.95, // Maximum preservation - only change background
      },
      imageGenerationConfig: {
        numberOfImages: 1,
        quality: 'premium',
        height: 1024,
        width: 1024,
      },
    };

    // Call Bedrock InvokeModel API
    console.log('Calling Titan Image Generator v2...');
    const enhancedImageBase64 = await invokeTitanImageGenerator(titanRequest);
    console.log(`Generated enhanced image: ${enhancedImageBase64.length} characters`);

    // Decode generated image from base64
    const enhancedImageBuffer = Buffer.from(enhancedImageBase64, 'base64');
    console.log(`Decoded enhanced image: ${enhancedImageBuffer.length} bytes`);

    // Upload enhanced image to S3
    console.log('Uploading enhanced image to S3...');
    const enhancedImageKey = generateEnhancedImageKey(
      event.sellerId,
      event.itemId
    );
    const enhancedImageUrl = await uploadImageToS3(
      enhancedImageBuffer,
      enhancedImageKey
    );
    console.log('Enhanced image uploaded:', enhancedImageUrl);

    return {
      success: true,
      enhancedImageUrl,
      enhancedImageKey,
    };
  } catch (error: any) {
    console.error('Image enhancement failed:', error);

    return {
      success: false,
      error: {
        code: error.name || 'IMAGE_ENHANCEMENT_ERROR',
        message: error.message || 'Failed to enhance product image',
      },
    };
  }
};

/**
 * Validate image enhancement request
 */
function validateImageEnhancementRequest(request: ImageEnhancementRequest): void {
  if (!request.rawImageUrl) {
    throw new Error('Raw image URL is required');
  }

  if (!request.productName) {
    throw new Error('Product name is required');
  }

  if (!request.itemId) {
    throw new Error('Item ID is required');
  }

  if (!request.sellerId) {
    throw new Error('Seller ID is required');
  }
}

/**
 * Download image from S3
 */
async function downloadImageFromS3(imageUrl: string): Promise<Buffer> {
  // Parse S3 location from URL
  const s3Location = parseS3Url(imageUrl);

  // Get object from S3
  const command = new GetObjectCommand({
    Bucket: s3Location.bucket,
    Key: s3Location.key,
  });

  const response = await s3Client.send(command);

  if (!response.Body) {
    throw new Error('Empty response body from S3');
  }

  // Convert stream to buffer
  return streamToBuffer(response.Body as Readable);
}

/**
 * Parse S3 URL to extract bucket and key
 */
function parseS3Url(url: string): { bucket: string; key: string } {
  // Handle s3:// URLs
  if (url.startsWith('s3://')) {
    const parts = url.replace('s3://', '').split('/');
    return {
      bucket: parts[0],
      key: parts.slice(1).join('/'),
    };
  }

  // Handle https://bucket.s3.region.amazonaws.com/key URLs
  if (url.includes('.s3.') && url.includes('.amazonaws.com/')) {
    const urlObj = new URL(url);
    const bucket = urlObj.hostname.split('.')[0];
    const key = urlObj.pathname.substring(1); // Remove leading /
    return { bucket, key };
  }

  // Handle pre-signed URLs
  if (url.includes('X-Amz-Signature')) {
    const urlObj = new URL(url);
    const bucket = urlObj.hostname.split('.')[0];
    const key = urlObj.pathname.substring(1);
    return { bucket, key };
  }

  // If it's just a key, use the products bucket
  if (!url.includes('://')) {
    return {
      bucket: PRODUCTS_BUCKET_NAME,
      key: url,
    };
  }

  throw new Error(`Invalid S3 URL format: ${url}`);
}

/**
 * Convert stream to buffer
 */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * Generate positive prompt for professional product photography
 * CRITICAL: ONLY change background, preserve product 100% exactly as-is
 */
function generatePositivePrompt(
  productName: string,
  productCategory?: string
): string {
  // Category-specific solid color backgrounds
  let backgroundPrompt = '';
  
  if (productCategory) {
    const category = productCategory.toLowerCase();
    if (category.includes('food') || category.includes('grocery')) {
      backgroundPrompt = 'solid white background';
    } else if (category.includes('handicraft') || category.includes('textile')) {
      backgroundPrompt = 'solid beige background';
    } else {
      backgroundPrompt = 'solid light gray background';
    }
  } else {
    backgroundPrompt = 'solid light gray background';
  }

  // Minimal prompt - only specify background change
  const prompt = `${backgroundPrompt}, keep product exactly as is, professional studio lighting`;

  return prompt;
}

/**
 * Generate negative prompt to prevent ANY product modifications
 * CRITICAL: Prevent ALL changes to product, labels, text, colors, shape
 * MAX LENGTH: 512 characters for Titan Image Generator v2
 */
function generateNegativePrompt(): string {
  // Shortened to fit 512 char limit while preserving key constraints
  return 'modified product, altered product, changed labels, modified text, blurred text, removed text, different colors, distorted shape, fake appearance, unrealistic, cartoon, illustration, painting, artistic, changed packaging, modified branding, extra objects, watermarks, blurry, low quality, deformed, changed features, altered appearance, modified surface, different material, changed size, modified proportions, pattern background, textured background, busy background';
}

/**
 * Invoke Titan Image Generator v2 via Bedrock
 */
async function invokeTitanImageGenerator(
  request: TitanImageRequest
): Promise<string> {
  // Prepare the request body
  const requestBody = JSON.stringify(request);

  console.log('Titan request body size:', requestBody.length, 'bytes');

  // Create InvokeModel command
  const command = new InvokeModelCommand({
    modelId: TITAN_IMAGE_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: requestBody,
  });

  // Invoke the model
  const response = await bedrockClient.send(command);

  if (!response.body) {
    throw new Error('Empty response body from Bedrock');
  }

  // Parse response
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  console.log('Titan response received');

  // Check for errors
  if (responseBody.error) {
    throw new Error(`Titan Image Generator error: ${responseBody.error}`);
  }

  // Extract generated image
  const titanResponse = responseBody as TitanImageResponse;
  
  if (!titanResponse.images || titanResponse.images.length === 0) {
    throw new Error('No images generated by Titan');
  }

  return titanResponse.images[0];
}

/**
 * Generate S3 key for enhanced image
 */
function generateEnhancedImageKey(sellerId: string, itemId: string): string {
  const timestamp = Date.now();
  return `products/enhanced/${sellerId}/${itemId}_${timestamp}.jpg`;
}

/**
 * Upload image to S3
 */
async function uploadImageToS3(
  imageBuffer: Buffer,
  key: string
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: PRODUCTS_BUCKET_NAME,
    Key: key,
    Body: imageBuffer,
    ContentType: 'image/jpeg',
  });

  await s3Client.send(command);

  // Return S3 URL
  const region = process.env.AWS_REGION || 'ap-south-1';
  return `https://${PRODUCTS_BUCKET_NAME}.s3.${region}.amazonaws.com/${key}`;
}
