/**
 * Image Enhancement Lambda
 * 
 * This Lambda function enhances product photos using Amazon Titan Image Generator v2
 * with INPAINTING and maskPrompt to preserve exact product details while creating professional backgrounds.
 * 
 * Approach: INPAINTING with maskPrompt
 * - Uses maskPrompt to target ONLY the background
 * - Product remains 100% untouched (labels, text, colors, shape)
 * - Replaces background with solid professional color
 * - Improves lighting and overall presentation
 * 
 * Features:
 * - Downloads raw product photos from S3
 * - Uses maskPrompt to identify and modify only background
 * - Preserves ALL product details exactly as photographed
 * - Creates professional e-commerce product photography
 * - Uploads enhanced images to S3
 * 
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4
 */

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { s3Client, bedrockClient, PRODUCTS_BUCKET_NAME } from '../config/aws-clients';
import { Readable } from 'stream';
import * as zlib from 'zlib';

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
 * Titan Image Generator v2 request structures
 */
interface TitanBackgroundRemovalRequest {
  taskType: 'BACKGROUND_REMOVAL';
  backgroundRemovalParams: {
    image: string; // Base64 encoded image
  };
}

interface TitanInpaintingRequest {
  taskType: 'INPAINTING';
  inPaintingParams: {
    image: string; // Base64 encoded image
    text: string; // What to generate in masked area
    negativeText?: string;
    maskPrompt: string; // What to mask
  };
  imageGenerationConfig: {
    quality: 'standard' | 'premium';
    numberOfImages: number;
    height: number;
    width: number;
    cfgScale: number;
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
 * 
 * Two-step process for clean white professional background:
 * Step 1: BACKGROUND_REMOVAL - isolates product with transparent background
 * Step 2: Composite onto pure white canvas for professional e-commerce look
 * Fallback: INPAINTING with aggressive white background prompt
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

    let enhancedImageBuffer: Buffer;

    // Step 1: Try BACKGROUND_REMOVAL for clean cutout
    try {
      console.log('Step 1: Removing background with Titan BACKGROUND_REMOVAL...');
      const bgRemovalRequest: TitanBackgroundRemovalRequest = {
        taskType: 'BACKGROUND_REMOVAL',
        backgroundRemovalParams: {
          image: base64Image,
        },
      };

      const cutoutBase64 = await invokeTitanImageGenerator(bgRemovalRequest);
      console.log('Background removed successfully, compositing on white canvas...');

      // Step 2: Composite the cutout onto pure white background
      enhancedImageBuffer = compositeOnWhiteBackground(Buffer.from(cutoutBase64, 'base64'));
      console.log(`White background composite: ${enhancedImageBuffer.length} bytes`);
    } catch (bgRemovalError: any) {
      console.warn('BACKGROUND_REMOVAL failed, falling back to INPAINTING:', bgRemovalError.message);
      
      // Fallback: Use INPAINTING with aggressive white background prompt
      const inpaintRequest: TitanInpaintingRequest = {
        taskType: 'INPAINTING',
        inPaintingParams: {
          image: base64Image,
          text: 'pure solid white background, bright white studio backdrop, clean plain white, professional product photography, even white illumination, no shadows, bright white everywhere',
          negativeText: 'color, pattern, texture, gradient, dark, shadow, floor, table, wall, clutter, objects, text, watermark, blur, noise',
          maskPrompt: 'background, wall, floor, table, surface, surroundings, everything behind and around the main product, backdrop, environment, shadow',
        },
        imageGenerationConfig: {
          quality: 'premium',
          numberOfImages: 1,
          height: 1024,
          width: 1024,
          cfgScale: 10.0, // High CFG for strict white background adherence
        },
      };

      const inpaintBase64 = await invokeTitanImageGenerator(inpaintRequest);
      enhancedImageBuffer = Buffer.from(inpaintBase64, 'base64');
      console.log(`INPAINTING fallback result: ${enhancedImageBuffer.length} bytes`);
    }

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
 * Composite a PNG with transparent background onto pure white canvas
 * Processes raw PNG pixel data: alpha-blends each pixel onto white (255,255,255)
 * Result: RGBA PNG where all transparent areas are solid white, product colors preserved
 */
function compositeOnWhiteBackground(imageBuffer: Buffer): Buffer {
  // Check if it's a PNG (starts with PNG signature: 137 80 78 71)
  const isPng = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 && 
                imageBuffer[2] === 0x4E && imageBuffer[3] === 0x47;
  
  if (!isPng) {
    console.log('Image is not PNG, returning as-is');
    return imageBuffer;
  }

  try {
    // Parse PNG chunks to extract image data
    const { width, height, bitDepth, colorType, rawPixels } = decodePng(imageBuffer);
    
    // Only process if RGBA (colorType 6) — has alpha channel
    if (colorType !== 6 || bitDepth !== 8) {
      console.log(`PNG colorType=${colorType}, bitDepth=${bitDepth} - no alpha compositing needed`);
      return imageBuffer;
    }
    
    console.log(`Compositing ${width}x${height} RGBA PNG onto white background`);
    
    // Alpha-blend each pixel onto white background
    // Formula: out = fg * alpha + bg * (1 - alpha), where bg = 255 (white)
    for (let i = 0; i < rawPixels.length; i += 4) {
      const r = rawPixels[i];
      const g = rawPixels[i + 1];
      const b = rawPixels[i + 2];
      const a = rawPixels[i + 3];
      
      if (a === 0) {
        // Fully transparent → white
        rawPixels[i] = 255;
        rawPixels[i + 1] = 255;
        rawPixels[i + 2] = 255;
        rawPixels[i + 3] = 255;
      } else if (a < 255) {
        // Semi-transparent → blend with white
        const alpha = a / 255;
        const invAlpha = 1 - alpha;
        rawPixels[i] = Math.round(r * alpha + 255 * invAlpha);
        rawPixels[i + 1] = Math.round(g * alpha + 255 * invAlpha);
        rawPixels[i + 2] = Math.round(b * alpha + 255 * invAlpha);
        rawPixels[i + 3] = 255; // Fully opaque
      }
      // a === 255: fully opaque, keep as-is (product pixels untouched)
    }
    
    // Re-encode as PNG
    const result = encodePng(width, height, rawPixels);
    console.log(`White background composite complete: ${result.length} bytes`);
    return result;
  } catch (error: any) {
    console.warn('PNG compositing failed, returning original:', error.message);
    return imageBuffer;
  }
}

/**
 * Minimal PNG decoder - extracts raw RGBA pixel data
 * Only supports 8-bit RGBA (colorType 6) which is what Titan outputs
 */
function decodePng(buffer: Buffer): { width: number; height: number; bitDepth: number; colorType: number; rawPixels: Buffer } {
  // Verify PNG signature
  if (buffer.readUInt32BE(0) !== 0x89504E47 || buffer.readUInt32BE(4) !== 0x0D0A1A0A) {
    throw new Error('Not a valid PNG');
  }
  
  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idatChunks: Buffer[] = [];
  
  while (offset < buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString('ascii', offset + 4, offset + 8);
    const chunkData = buffer.subarray(offset + 8, offset + 8 + chunkLength);
    
    if (chunkType === 'IHDR') {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8];
      colorType = chunkData[9];
    } else if (chunkType === 'IDAT') {
      idatChunks.push(chunkData);
    } else if (chunkType === 'IEND') {
      break;
    }
    
    offset += 12 + chunkLength; // 4 length + 4 type + data + 4 crc
  }
  
  if (!width || !height) {
    throw new Error('PNG IHDR not found');
  }
  
  // Decompress concatenated IDAT data
  const compressedData = Buffer.concat(idatChunks);
  const decompressed = zlib.inflateSync(compressedData);
  
  // Un-filter scanlines (each row starts with a filter byte)
  const bpp = 4; // bytes per pixel for RGBA
  const rowBytes = width * bpp;
  const rawPixels = Buffer.alloc(width * height * bpp);
  
  for (let y = 0; y < height; y++) {
    const filterType = decompressed[y * (rowBytes + 1)];
    const scanlineStart = y * (rowBytes + 1) + 1;
    const outStart = y * rowBytes;
    
    for (let x = 0; x < rowBytes; x++) {
      const raw = decompressed[scanlineStart + x];
      let val = raw;
      
      switch (filterType) {
        case 0: // None
          val = raw;
          break;
        case 1: // Sub
          val = (raw + (x >= bpp ? rawPixels[outStart + x - bpp] : 0)) & 0xFF;
          break;
        case 2: // Up
          val = (raw + (y > 0 ? rawPixels[outStart - rowBytes + x] : 0)) & 0xFF;
          break;
        case 3: // Average
          const left = x >= bpp ? rawPixels[outStart + x - bpp] : 0;
          const up = y > 0 ? rawPixels[outStart - rowBytes + x] : 0;
          val = (raw + Math.floor((left + up) / 2)) & 0xFF;
          break;
        case 4: // Paeth
          const pLeft = x >= bpp ? rawPixels[outStart + x - bpp] : 0;
          const pUp = y > 0 ? rawPixels[outStart - rowBytes + x] : 0;
          const pUpLeft = (x >= bpp && y > 0) ? rawPixels[outStart - rowBytes + x - bpp] : 0;
          val = (raw + paethPredictor(pLeft, pUp, pUpLeft)) & 0xFF;
          break;
      }
      
      rawPixels[outStart + x] = val;
    }
  }
  
  return { width, height, bitDepth, colorType, rawPixels };
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Minimal PNG encoder - creates valid PNG from raw RGBA pixel data
 * Uses filter type 0 (None) for simplicity + best compression for processed images
 */
function encodePng(width: number, height: number, rawPixels: Buffer): Buffer {
  const bpp = 4;
  const rowBytes = width * bpp;
  
  // Add filter byte (0 = None) to each scanline
  const filtered = Buffer.alloc(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    filtered[y * (rowBytes + 1)] = 0; // filter type None
    rawPixels.copy(filtered, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  
  // Compress with zlib
  const compressed = zlib.deflateSync(filtered, { level: 9 });
  
  // Build PNG file
  const chunks: Buffer[] = [];
  
  // Signature
  chunks.push(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
  
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bitDepth
  ihdr[9] = 6; // colorType RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  chunks.push(createPngChunk('IHDR', ihdr));
  
  // IDAT
  chunks.push(createPngChunk('IDAT', compressed));
  
  // IEND
  chunks.push(createPngChunk('IEND', Buffer.alloc(0)));
  
  return Buffer.concat(chunks);
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  
  // CRC covers type + data
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);
  
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

/**
 * CRC-32 for PNG chunk verification
 */
function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Invoke Titan Image Generator v2 via Bedrock
 * Supports both BACKGROUND_REMOVAL and INPAINTING task types
 */
async function invokeTitanImageGenerator(
  request: TitanBackgroundRemovalRequest | TitanInpaintingRequest
): Promise<string> {
  // Prepare the request body
  const requestBody = JSON.stringify(request);

  console.log('Titan request:', { taskType: request.taskType, bodySize: requestBody.length });

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
  console.log('Titan response received for', request.taskType);

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
  return `products/enhanced/${sellerId}/${itemId}_${timestamp}.png`;
}

/**
 * Upload image to S3
 */
async function uploadImageToS3(
  imageBuffer: Buffer,
  key: string
): Promise<string> {
  // Detect content type from buffer
  const isPng = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50;
  const contentType = isPng ? 'image/png' : 'image/jpeg';
  
  const command = new PutObjectCommand({
    Bucket: PRODUCTS_BUCKET_NAME,
    Key: key,
    Body: imageBuffer,
    ContentType: contentType,
  });

  await s3Client.send(command);

  // Return S3 URL
  const region = process.env.AWS_REGION || 'us-east-1';
  return `https://${PRODUCTS_BUCKET_NAME}.s3.${region}.amazonaws.com/${key}`;
}
