
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { s3Client, bedrockClient, PRODUCTS_BUCKET_NAME } from '../config/aws-clients';
import { Readable } from 'stream';
import * as zlib from 'zlib';

const TITAN_IMAGE_MODEL_ID = 'amazon.titan-image-generator-v2:0';

export interface ImageEnhancementRequest {

  rawImageUrl: string;

  productName: string;

  productCategory?: string;

  itemId: string;

  sellerId: string;
}

export interface ImageEnhancementResponse {

  success: boolean;

  enhancedImageUrl?: string;

  enhancedImageKey?: string;

  error?: {
    code: string;
    message: string;
  };
}

interface TitanBackgroundRemovalRequest {
  taskType: 'BACKGROUND_REMOVAL';
  backgroundRemovalParams: {
    image: string; 
  };
}

interface TitanInpaintingRequest {
  taskType: 'INPAINTING';
  inPaintingParams: {
    image: string; 
    text: string; 
    negativeText?: string;
    maskPrompt: string; 
  };
  imageGenerationConfig: {
    quality: 'standard' | 'premium';
    numberOfImages: number;
    height: number;
    width: number;
    cfgScale: number;
  };
}

interface TitanImageResponse {
  images: string[]; 
  error?: string;
}

export const handler = async (
  event: ImageEnhancementRequest
): Promise<ImageEnhancementResponse> => {
  console.log('Image enhancement request:', JSON.stringify(event, null, 2));

  try {

    validateImageEnhancementRequest(event);

    console.log('Downloading raw image from S3...');
    const rawImageBuffer = await downloadImageFromS3(event.rawImageUrl);
    console.log(`Downloaded image: ${rawImageBuffer.length} bytes`);

    const base64Image = rawImageBuffer.toString('base64');
    console.log(`Encoded image to base64: ${base64Image.length} characters`);

    let enhancedImageBuffer: Buffer | undefined;
    let whiteBackgroundApplied = false;

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

      const cutoutBuffer = Buffer.from(cutoutBase64, 'base64');
      const compositedBuffer = compositeOnWhiteBackground(cutoutBuffer);

      if (compositedBuffer !== cutoutBuffer) {
        enhancedImageBuffer = compositedBuffer;
        whiteBackgroundApplied = true;
        console.log(`White background composite SUCCESS: ${enhancedImageBuffer.length} bytes`);
      } else {
        console.warn('White compositing skipped (non-RGBA format from Titan), falling through to INPAINTING...');

      }
    } catch (bgRemovalError: any) {
      console.warn('BACKGROUND_REMOVAL failed, falling back to INPAINTING:', bgRemovalError.message);
    }

    if (!whiteBackgroundApplied) {
      try {
        console.log('Step 2: Applying INPAINTING for white background...');
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
            cfgScale: 10.0, 
          },
        };

        const inpaintBase64 = await invokeTitanImageGenerator(inpaintRequest);
        enhancedImageBuffer = Buffer.from(inpaintBase64, 'base64');
        console.log(`INPAINTING result: ${enhancedImageBuffer.length} bytes`);
      } catch (inpaintError: any) {
        console.error('INPAINTING also failed:', inpaintError.message);
        throw new Error(`Both BACKGROUND_REMOVAL and INPAINTING failed. Last error: ${inpaintError.message}`);
      }
    }

    if (!enhancedImageBuffer) {
      throw new Error('No enhanced image produced (should not happen)');
    }

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

async function downloadImageFromS3(imageUrl: string): Promise<Buffer> {

  const s3Location = parseS3Url(imageUrl);

  const command = new GetObjectCommand({
    Bucket: s3Location.bucket,
    Key: s3Location.key,
  });

  const response = await s3Client.send(command);

  if (!response.Body) {
    throw new Error('Empty response body from S3');
  }

  return streamToBuffer(response.Body as Readable);
}

function parseS3Url(url: string): { bucket: string; key: string } {

  if (url.startsWith('s3://')) {
    const parts = url.replace('s3://', '').split('/');
    return {
      bucket: parts[0],
      key: parts.slice(1).join('/'),
    };
  }

  if (url.includes('.s3.') && url.includes('.amazonaws.com/')) {
    const urlObj = new URL(url);
    const bucket = urlObj.hostname.split('.')[0];
    const key = urlObj.pathname.substring(1); 
    return { bucket, key };
  }

  if (url.includes('X-Amz-Signature')) {
    const urlObj = new URL(url);
    const bucket = urlObj.hostname.split('.')[0];
    const key = urlObj.pathname.substring(1);
    return { bucket, key };
  }

  if (!url.includes('://')) {
    return {
      bucket: PRODUCTS_BUCKET_NAME,
      key: url,
    };
  }

  throw new Error(`Invalid S3 URL format: ${url}`);
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function compositeOnWhiteBackground(imageBuffer: Buffer): Buffer {

  const isPng = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 && 
                imageBuffer[2] === 0x4E && imageBuffer[3] === 0x47;

  if (!isPng) {
    console.log('Image is not PNG, returning as-is (same ref)');
    return imageBuffer;
  }

  try {

    const { width, height, bitDepth, colorType, rawPixels, bpp } = decodePng(imageBuffer);

    if (bitDepth !== 8) {
      console.log(`PNG bitDepth=${bitDepth} (not 8) - cannot process, returning as-is`);
      return imageBuffer;
    }

    if (colorType === 6) {
      console.log(`Compositing ${width}x${height} RGBA PNG onto white background`);

      const rgbaPixels = Buffer.alloc(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        const srcIdx = i * 4;
        const dstIdx = i * 4;
        const r = rawPixels[srcIdx];
        const g = rawPixels[srcIdx + 1];
        const b = rawPixels[srcIdx + 2];
        const a = rawPixels[srcIdx + 3];

        if (a === 0) {

          rgbaPixels[dstIdx] = 255;
          rgbaPixels[dstIdx + 1] = 255;
          rgbaPixels[dstIdx + 2] = 255;
          rgbaPixels[dstIdx + 3] = 255;
        } else if (a < 255) {

          const alpha = a / 255;
          const invAlpha = 1 - alpha;
          rgbaPixels[dstIdx] = Math.round(r * alpha + 255 * invAlpha);
          rgbaPixels[dstIdx + 1] = Math.round(g * alpha + 255 * invAlpha);
          rgbaPixels[dstIdx + 2] = Math.round(b * alpha + 255 * invAlpha);
          rgbaPixels[dstIdx + 3] = 255;
        } else {

          rgbaPixels[dstIdx] = r;
          rgbaPixels[dstIdx + 1] = g;
          rgbaPixels[dstIdx + 2] = b;
          rgbaPixels[dstIdx + 3] = 255;
        }
      }

      const result = encodePng(width, height, rgbaPixels);
      console.log(`White background composite complete: ${result.length} bytes`);
      return result;
    }

    if (colorType === 2) {
      console.log(`Converting ${width}x${height} RGB PNG to RGBA with white bg check`);
      const rgbaPixels = Buffer.alloc(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        const srcIdx = i * 3;
        const dstIdx = i * 4;
        rgbaPixels[dstIdx] = rawPixels[srcIdx];
        rgbaPixels[dstIdx + 1] = rawPixels[srcIdx + 1];
        rgbaPixels[dstIdx + 2] = rawPixels[srcIdx + 2];
        rgbaPixels[dstIdx + 3] = 255; 
      }
      const result = encodePng(width, height, rgbaPixels);
      console.log(`RGB→RGBA conversion complete: ${result.length} bytes`);
      return result;
    }

    if (colorType === 4) {
      console.log(`Converting ${width}x${height} Grayscale+Alpha PNG onto white background`);
      const rgbaPixels = Buffer.alloc(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        const srcIdx = i * 2;
        const dstIdx = i * 4;
        const gray = rawPixels[srcIdx];
        const a = rawPixels[srcIdx + 1];

        if (a === 0) {
          rgbaPixels[dstIdx] = 255;
          rgbaPixels[dstIdx + 1] = 255;
          rgbaPixels[dstIdx + 2] = 255;
          rgbaPixels[dstIdx + 3] = 255;
        } else if (a < 255) {
          const alpha = a / 255;
          const blended = Math.round(gray * alpha + 255 * (1 - alpha));
          rgbaPixels[dstIdx] = blended;
          rgbaPixels[dstIdx + 1] = blended;
          rgbaPixels[dstIdx + 2] = blended;
          rgbaPixels[dstIdx + 3] = 255;
        } else {
          rgbaPixels[dstIdx] = gray;
          rgbaPixels[dstIdx + 1] = gray;
          rgbaPixels[dstIdx + 2] = gray;
          rgbaPixels[dstIdx + 3] = 255;
        }
      }
      const result = encodePng(width, height, rgbaPixels);
      console.log(`Grayscale+Alpha→RGBA conversion complete: ${result.length} bytes`);
      return result;
    }

    console.log(`PNG colorType=${colorType} - unsupported, returning as-is`);
    return imageBuffer;
  } catch (error: any) {
    console.warn('PNG compositing failed, returning original:', error.message);
    return imageBuffer;
  }
}

function decodePng(buffer: Buffer): { width: number; height: number; bitDepth: number; colorType: number; rawPixels: Buffer; bpp: number } {

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

    offset += 12 + chunkLength; 
  }

  if (!width || !height) {
    throw new Error('PNG IHDR not found');
  }

  const compressedData = Buffer.concat(idatChunks);
  const decompressed = zlib.inflateSync(compressedData);

  let bpp: number;
  switch (colorType) {
    case 0: bpp = 1; break;
    case 2: bpp = 3; break;
    case 4: bpp = 2; break;
    case 6: bpp = 4; break;
    default: throw new Error(`Unsupported PNG colorType: ${colorType}`);
  }

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
        case 0: 
          val = raw;
          break;
        case 1: 
          val = (raw + (x >= bpp ? rawPixels[outStart + x - bpp] : 0)) & 0xFF;
          break;
        case 2: 
          val = (raw + (y > 0 ? rawPixels[outStart - rowBytes + x] : 0)) & 0xFF;
          break;
        case 3: 
          const left = x >= bpp ? rawPixels[outStart + x - bpp] : 0;
          const up = y > 0 ? rawPixels[outStart - rowBytes + x] : 0;
          val = (raw + Math.floor((left + up) / 2)) & 0xFF;
          break;
        case 4: 
          const pLeft = x >= bpp ? rawPixels[outStart + x - bpp] : 0;
          const pUp = y > 0 ? rawPixels[outStart - rowBytes + x] : 0;
          const pUpLeft = (x >= bpp && y > 0) ? rawPixels[outStart - rowBytes + x - bpp] : 0;
          val = (raw + paethPredictor(pLeft, pUp, pUpLeft)) & 0xFF;
          break;
      }

      rawPixels[outStart + x] = val;
    }
  }

  return { width, height, bitDepth, colorType, rawPixels, bpp };
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

function encodePng(width: number, height: number, rawPixels: Buffer): Buffer {
  const bpp = 4;
  const rowBytes = width * bpp;

  const filtered = Buffer.alloc(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    filtered[y * (rowBytes + 1)] = 0; 
    rawPixels.copy(filtered, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes);
  }

  const compressed = zlib.deflateSync(filtered, { level: 9 });

  const chunks: Buffer[] = [];

  chunks.push(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; 
  ihdr[9] = 6; 
  ihdr[10] = 0; 
  ihdr[11] = 0; 
  ihdr[12] = 0; 
  chunks.push(createPngChunk('IHDR', ihdr));

  chunks.push(createPngChunk('IDAT', compressed));

  chunks.push(createPngChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

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

async function invokeTitanImageGenerator(
  request: TitanBackgroundRemovalRequest | TitanInpaintingRequest
): Promise<string> {

  const requestBody = JSON.stringify(request);

  console.log('Titan request:', { taskType: request.taskType, bodySize: requestBody.length });

  const command = new InvokeModelCommand({
    modelId: TITAN_IMAGE_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: requestBody,
  });

  const response = await bedrockClient.send(command);

  if (!response.body) {
    throw new Error('Empty response body from Bedrock');
  }

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  console.log('Titan response received for', request.taskType);

  if (responseBody.error) {
    throw new Error(`Titan Image Generator error: ${responseBody.error}`);
  }

  const titanResponse = responseBody as TitanImageResponse;

  if (!titanResponse.images || titanResponse.images.length === 0) {
    throw new Error('No images generated by Titan');
  }

  return titanResponse.images[0];
}

function generateEnhancedImageKey(sellerId: string, itemId: string): string {
  const timestamp = Date.now();
  return `products/enhanced/${sellerId}/${itemId}_${timestamp}.png`;
}

async function uploadImageToS3(
  imageBuffer: Buffer,
  key: string
): Promise<string> {

  const isPng = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50;
  const contentType = isPng ? 'image/png' : 'image/jpeg';

  const command = new PutObjectCommand({
    Bucket: PRODUCTS_BUCKET_NAME,
    Key: key,
    Body: imageBuffer,
    ContentType: contentType,
  });

  await s3Client.send(command);

  const region = process.env.AWS_REGION || 'us-east-1';
  return `https://${PRODUCTS_BUCKET_NAME}.s3.${region}.amazonaws.com/${key}`;
}
