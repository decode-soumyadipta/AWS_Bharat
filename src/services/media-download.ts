
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

type MediaType = 'audio' | 'image';

interface MediaDownloadResult {
  success: boolean;
  buffer?: Buffer;
  mimeType?: string;
  size?: number;
  s3Url?: string;
  error?: string;
}

const SIZE_LIMITS = {
  audio: parseInt(process.env.MAX_AUDIO_SIZE_MB || '16', 10) * 1024 * 1024,
  image: parseInt(process.env.MAX_IMAGE_SIZE_MB || '5', 10) * 1024 * 1024,
};

const SUPPORTED_MIME_TYPES = {
  audio: ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/amr', 'audio/aac'],
  image: ['image/jpeg', 'image/png', 'image/webp'],
};

const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  jitter: true,
};

async function downloadFromWhatsApp(
  mediaId: string,
  accessToken: string
): Promise<{ buffer: Buffer; mimeType: string; size: number }> {

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

function validateMedia(
  mediaType: MediaType,
  mimeType: string,
  size: number
): { valid: boolean; error?: string } {

  if (size > SIZE_LIMITS[mediaType]) {
    return {
      valid: false,
      error: `File size ${size} bytes exceeds limit of ${SIZE_LIMITS[mediaType]} bytes`,
    };
  }

  if (!SUPPORTED_MIME_TYPES[mediaType].includes(mimeType)) {
    return {
      valid: false,
      error: `Unsupported MIME type: ${mimeType}. Supported types: ${SUPPORTED_MIME_TYPES[mediaType].join(', ')}`,
    };
  }

  return { valid: true };
}

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

          const { buffer, mimeType, size } = await downloadFromWhatsApp(mediaId, accessToken);

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

          const timestamp = Date.now();
          const extension = mimeType.split('/')[1];
          const key = `${keyPrefix}${timestamp}-${mediaId}.${extension}`;

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

export async function downloadAudio(
  mediaId: string,
  bucketName: string
): Promise<MediaDownloadResult> {
  return downloadMedia(mediaId, 'audio', bucketName, 'audio/');
}

export async function downloadImage(
  mediaId: string,
  bucketName: string
): Promise<MediaDownloadResult> {
  return downloadMedia(mediaId, 'image', bucketName, 'images/');
}
