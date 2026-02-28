/**
 * Media Download Service
 * 
 * Downloads audio and image files from WhatsApp Media API and uploads to S3.
 * Implements retry logic with exponential backoff and file validation.
 * 
 * Requirements: 2.1, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from '../config/aws-clients';
import { 
  retryWithBackoff, 
  logStructured, 
  ErrorCodes, 
  CategorizedError, 
  ErrorCategory 
} from '../utils/error-handler';
import { trackOperation } from '../utils/monitoring';
import https from 'https';

export type MediaType = 'audio' | 'image';

export interface MediaDownloadResult {
  success: boolean;
  buffer?: Buffer;
  mimeType?: string;
  size?: number;
  s3Url?: string;
  error?: string;
}

/**
 * File size limits in bytes
 * Configurable via environment variables
 */
const SIZE_LIMITS = {
  audio: parseInt(process.env.MAX_AUDIO_SIZE_MB || '16', 10) * 1024 * 1024,
  image: parseInt(process.env.MAX_IMAGE_SIZE_MB || '5', 10) * 1024 * 1024,
};

/**
 * Supported MIME types
 */
const SUPPORTED_MIME_TYPES = {
  audio: ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/amr', 'audio/aac'],
  image: ['image/jpeg', 'image/png', 'image/webp'],
};

/**
 * Retry configuration
 * Now using centralized error handling
 */
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Download media from WhatsApp Media API
 * 
 * @param mediaId - WhatsApp media ID
 * @param accessToken - WhatsApp access token
 * @returns Downloaded media buffer and metadata
 */
async function downloadFromWhatsApp(
  mediaId: string,
  accessToken: string
): Promise<{ buffer: Buffer; mimeType: string; size: number }> {
  // First, get the media URL from WhatsApp
  const mediaUrlResponse = await new Promise<any>((resolve, reject) => {
    const options = {
      hostname: 'graph.facebook.com',
      path: `/v22.0/${mediaId}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`Failed to get media URL: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });

  const mediaUrl = mediaUrlResponse.url;
  const mimeType = mediaUrlResponse.mime_type;

  // Download the actual media file
  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const url = new URL(mediaUrl);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`Failed to download media: ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });

  return {
    buffer,
    mimeType,
    size: buffer.length,
  };
}

/**
 * Validate file size and MIME type
 */
function validateMedia(
  mediaType: MediaType,
  mimeType: string,
  size: number
): { valid: boolean; error?: string } {
  // Check size limit
  if (size > SIZE_LIMITS[mediaType]) {
    return {
      valid: false,
      error: `File size ${size} bytes exceeds limit of ${SIZE_LIMITS[mediaType]} bytes`,
    };
  }

  // Check MIME type
  if (!SUPPORTED_MIME_TYPES[mediaType].includes(mimeType)) {
    return {
      valid: false,
      error: `Unsupported MIME type: ${mimeType}. Supported types: ${SUPPORTED_MIME_TYPES[mediaType].join(', ')}`,
    };
  }

  return { valid: true };
}

/**
 * Upload buffer to S3
 * 
 * @param buffer - File buffer
 * @param key - S3 object key
 * @param contentType - MIME type
 * @param bucketName - S3 bucket name
 * @returns S3 URL
 */
async function uploadToS3(
  buffer: Buffer,
  key: string,
  contentType: string,
  bucketName: string
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3Client.send(command);
  
  return `s3://${bucketName}/${key}`;
}

/**
 * Download media with retry logic
 * 
 * @param mediaId - WhatsApp media ID
 * @param mediaType - Type of media (audio or image)
 * @param bucketName - S3 bucket name for upload
 * @param keyPrefix - S3 key prefix (e.g., 'audio/' or 'images/')
 * @returns Media download result with S3 URL
 */
export async function downloadMedia(
  mediaId: string,
  mediaType: MediaType,
  bucketName: string,
  keyPrefix: string = ''
): Promise<MediaDownloadResult> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  
  if (!accessToken) {
    logStructured('ERROR', 'WHATSAPP_ACCESS_TOKEN not configured', {
      mediaId,
      mediaType,
    });
    return {
      success: false,
      error: 'WHATSAPP_ACCESS_TOKEN not configured',
    };
  }

  return trackOperation(
    'media_download',
    async () => {
      return retryWithBackoff(
        async () => {
          logStructured('INFO', `Downloading ${mediaType} from WhatsApp`, {
            mediaId,
            mediaType,
          });

          // Download from WhatsApp
          const { buffer, mimeType, size } = await downloadFromWhatsApp(mediaId, accessToken);

          // Validate media
          const validation = validateMedia(mediaType, mimeType, size);
          if (!validation.valid) {
            const errorCode = validation.error === 'File size exceeds limit' 
              ? ErrorCodes.MEDIA_TOO_LARGE 
              : ErrorCodes.MEDIA_UNSUPPORTED_TYPE;
            
            throw new CategorizedError(
              validation.error!,
              ErrorCategory.PERMANENT,
              errorCode,
              { mediaId, mediaType, mimeType, size }
            );
          }

          // Generate S3 key
          const timestamp = Date.now();
          const extension = mimeType.split('/')[1];
          const key = `${keyPrefix}${timestamp}-${mediaId}.${extension}`;

          // Upload to S3
          const s3Url = await uploadToS3(buffer, key, mimeType, bucketName);

          logStructured('INFO', `Successfully downloaded and uploaded ${mediaType}`, {
            mediaId,
            size,
            mimeType,
            s3Url,
          });

          return {
            success: true,
            buffer,
            mimeType,
            size,
            s3Url,
          };
        },
        'downloadMedia',
        RETRY_CONFIG,
        { mediaId, mediaType, bucketName }
      );
    },
    { mediaId, mediaType }
  ).catch((error) => {
    logStructured('ERROR', `Failed to download ${mediaType}`, {
      mediaId,
      mediaType,
      error: error.message,
    }, error.code || ErrorCodes.MEDIA_DOWNLOAD_FAILED);
    
    return {
      success: false,
      error: error.message || 'Unknown error during media download',
    };
  });
}

/**
 * Download audio file from WhatsApp and upload to S3
 * 
 * @param mediaId - WhatsApp audio media ID
 * @param bucketName - S3 bucket name
 * @returns Media download result
 */
export async function downloadAudio(
  mediaId: string,
  bucketName: string
): Promise<MediaDownloadResult> {
  return downloadMedia(mediaId, 'audio', bucketName, 'audio/');
}

/**
 * Download image file from WhatsApp and upload to S3
 * 
 * @param mediaId - WhatsApp image media ID
 * @param bucketName - S3 bucket name
 * @returns Media download result
 */
export async function downloadImage(
  mediaId: string,
  bucketName: string
): Promise<MediaDownloadResult> {
  return downloadMedia(mediaId, 'image', bucketName, 'images/');
}
