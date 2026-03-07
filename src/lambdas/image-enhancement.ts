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

    let cutoutBase64: string | undefined;
    try {
      console.log('Step 1: Removing background with Titan BACKGROUND_REMOVAL...');
      const bgRemovalRequest: TitanBackgroundRemovalRequest = {
        taskType: 'BACKGROUND_REMOVAL',
        backgroundRemovalParams: { image: base64Image },
      };
      cutoutBase64 = await invokeTitanImageGenerator(bgRemovalRequest);
      console.log('Background removed successfully. Compositing on white canvas...');
    } catch (bgRemovalError: any) {
      console.warn('BACKGROUND_REMOVAL failed:', bgRemovalError.message);
    }

    if (cutoutBase64) {
      try {
        const cutoutBuffer = Buffer.from(cutoutBase64, 'base64');
        const compositeResult = compositeOnWhiteBackground(cutoutBuffer);

        if (compositeResult.composited) {
          enhancedImageBuffer = compositeResult.buffer;
          console.log(`White background composite SUCCESS: ${enhancedImageBuffer.length} bytes`);
        } else {
          console.warn('Cutout has no alpha channel — falling through to INPAINTING');
        }
      } catch (compositeError: any) {
        console.warn('Composite failed:', compositeError.message);
      }
    }

    if (!enhancedImageBuffer) {
      const inpaintSourceBase64 = cutoutBase64 ?? base64Image;
      const sourceLabel = cutoutBase64 ? 'bg-removed cutout' : 'original image';
      console.log(`Step 2: Applying INPAINTING on ${sourceLabel}...`);

      try {
        const inpaintRequest: TitanInpaintingRequest = {
          taskType: 'INPAINTING',
          inPaintingParams: {
            image: inpaintSourceBase64,
            text: 'pure solid white background, bright white studio backdrop, clean plain white, professional product photography, even white illumination, no shadows',
            negativeText:
              'color, pattern, texture, gradient, dark, shadow, floor, table, wall, clutter, objects, text, watermark, blur, noise',
            maskPrompt:
              'background, wall, floor, table, surface, surroundings, everything behind and around the main product, backdrop, environment, shadow',
          },
          imageGenerationConfig: {
            quality: 'premium',
            numberOfImages: 1,
            height: 1024,
            width: 1024,
            cfgScale: 8.0,
          },
        };

        const inpaintBase64 = await invokeTitanImageGenerator(inpaintRequest);
        enhancedImageBuffer = Buffer.from(inpaintBase64, 'base64');
        console.log(`INPAINTING result: ${enhancedImageBuffer.length} bytes`);
      } catch (inpaintError: any) {
        console.error('INPAINTING also failed:', inpaintError.message);
        throw new Error(
          `Both BACKGROUND_REMOVAL and INPAINTING failed. Last error: ${inpaintError.message}`
        );
      }
    }

    if (!enhancedImageBuffer) {
      throw new Error('No enhanced image produced');
    }

    console.log('Uploading enhanced image to S3...');
    const enhancedImageKey = generateEnhancedImageKey(event.sellerId, event.itemId);
    const enhancedImageUrl = await uploadImageToS3(enhancedImageBuffer, enhancedImageKey);
    console.log('Enhanced image uploaded:', enhancedImageUrl);

    return { success: true, enhancedImageUrl, enhancedImageKey };
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

// ── Helpers ─────────────────────────────────────────────────────────────────

function validateImageEnhancementRequest(request: ImageEnhancementRequest): void {
  if (!request.rawImageUrl) throw new Error('Raw image URL is required');
  if (!request.productName) throw new Error('Product name is required');
  if (!request.itemId) throw new Error('Item ID is required');
  if (!request.sellerId) throw new Error('Seller ID is required');
}

async function downloadImageFromS3(imageUrl: string): Promise<Buffer> {
  const s3Location = parseS3Url(imageUrl);
  const command = new GetObjectCommand({
    Bucket: s3Location.bucket,
    Key: s3Location.key,
  });
  const response = await s3Client.send(command);
  if (!response.Body) throw new Error('Empty response body from S3');
  return streamToBuffer(response.Body as Readable);
}

function parseS3Url(url: string): { bucket: string; key: string } {
  if (url.startsWith('s3://')) {
    const parts = url.replace('s3://', '').split('/');
    return { bucket: parts[0], key: parts.slice(1).join('/') };
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
    return { bucket: PRODUCTS_BUCKET_NAME, key: url };
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
  if (!response.body) throw new Error('Empty response body from Bedrock');

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

async function uploadImageToS3(imageBuffer: Buffer, key: string): Promise<string> {
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

function compositeOnWhiteBackground(imageBuffer: Buffer): { buffer: Buffer; composited: boolean } {
  const isPng = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 &&
                imageBuffer[2] === 0x4E && imageBuffer[3] === 0x47;

  if (!isPng) {
    console.log('Image is not PNG, cannot composite');
    return { buffer: imageBuffer, composited: false };
  }

  try {
    const { width, height, bitDepth, colorType, rawPixels } = decodePng(imageBuffer);

    if (bitDepth !== 8) {
      console.log(`PNG bitDepth=${bitDepth} (not 8) — cannot process`);
      return { buffer: imageBuffer, composited: false };
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
          const inv = 1 - alpha;
          rgbaPixels[dstIdx] = Math.round(r * alpha + 255 * inv);
          rgbaPixels[dstIdx + 1] = Math.round(g * alpha + 255 * inv);
          rgbaPixels[dstIdx + 2] = Math.round(b * alpha + 255 * inv);
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
      return { buffer: result, composited: true };
    }

    if (colorType === 4) {
      console.log(`Compositing ${width}x${height} Grayscale+Alpha PNG onto white background`);
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
      return { buffer: result, composited: true };
    }

    console.log(`PNG colorType=${colorType} — no alpha channel, cannot composite`);
    return { buffer: imageBuffer, composited: false };
  } catch (error: any) {
    console.warn('PNG compositing failed:', error.message);
    return { buffer: imageBuffer, composited: false };
  }
}

function decodePng(buffer: Buffer): {
  width: number; height: number; bitDepth: number;
  colorType: number; rawPixels: Buffer; bpp: number;
} {
  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const dataChunks: Buffer[] = [];

  while (offset < buffer.length) {
    const chunkLen = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString('ascii', offset + 4, offset + 8);

    if (chunkType === 'IHDR') {
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
      bitDepth = buffer[offset + 16];
      colorType = buffer[offset + 17];
    } else if (chunkType === 'IDAT') {
      dataChunks.push(buffer.subarray(offset + 8, offset + 8 + chunkLen));
    } else if (chunkType === 'IEND') {
      break;
    }

    offset += 12 + chunkLen;
  }

  const compressed = Buffer.concat(dataChunks);
  const decompressed = zlib.inflateSync(compressed);

  const bppMap: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const bpp = bppMap[colorType] || 4;
  const stride = width * bpp;
  const rawPixels = Buffer.alloc(width * height * bpp);

  let srcOffset = 0;
  let prevRow = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filterType = decompressed[srcOffset++];
    const currentRow = decompressed.subarray(srcOffset, srcOffset + stride);
    const unfilteredRow = Buffer.alloc(stride);

    for (let x = 0; x < stride; x++) {
      const raw = currentRow[x];
      const a = x >= bpp ? unfilteredRow[x - bpp] : 0;
      const b = prevRow[x];
      const c = x >= bpp ? prevRow[x - bpp] : 0;

      let val: number;
      switch (filterType) {
        case 0: val = raw; break;
        case 1: val = (raw + a) & 0xff; break;
        case 2: val = (raw + b) & 0xff; break;
        case 3: val = (raw + Math.floor((a + b) / 2)) & 0xff; break;
        case 4: val = (raw + paethPredictor(a, b, c)) & 0xff; break;
        default: val = raw;
      }
      unfilteredRow[x] = val;
    }

    unfilteredRow.copy(rawPixels, y * stride, 0, stride);
    prevRow = unfilteredRow;
    srcOffset += stride;
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

function encodePng(width: number, height: number, rgbaPixels: Buffer): Buffer {
  const stride = width * 4;
  const rawData = Buffer.alloc(height * (1 + stride));

  for (let y = 0; y < height; y++) {
    rawData[y * (1 + stride)] = 0;
    rgbaPixels.copy(rawData, y * (1 + stride) + 1, y * stride, y * stride + stride);
  }

  const compressed = zlib.deflateSync(rawData);

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = 6;
  ihdr[18] = 0;
  ihdr[19] = 0;
  ihdr[20] = 0;
  const ihdrCrc = crc32(ihdr.subarray(4, 21));
  ihdr.writeInt32BE(ihdrCrc, 21);

  const idatHeader = Buffer.alloc(8);
  idatHeader.writeUInt32BE(compressed.length, 0);
  idatHeader.write('IDAT', 4);
  const idatCrc = crc32(Buffer.concat([idatHeader.subarray(4, 8), compressed]));
  const idatCrcBuf = Buffer.alloc(4);
  idatCrcBuf.writeInt32BE(idatCrc, 0);

  const iend = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 0xAE, 0x42, 0x60, 0x82]);

  return Buffer.concat([signature, ihdr, idatHeader, compressed, idatCrcBuf, iend]);
}

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crc32Table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) | 0;
}