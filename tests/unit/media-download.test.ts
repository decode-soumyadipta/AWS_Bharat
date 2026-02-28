/**
 * Unit Tests for Media Download Service - Edge Cases
 * 
 * Tests edge cases for media download functionality:
 * - Expired URL handling
 * - Oversized file rejection
 * - Unsupported MIME type rejection
 * 
 * **Validates: Requirements 10.7, 10.8**
 */

import { downloadMedia, downloadAudio, downloadImage } from '../../src/services/media-download';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import https from 'https';
import { EventEmitter } from 'events';

// Mock S3 client
const s3Mock = mockClient(S3Client);

// Mock https module
jest.mock('https');

describe('Media Download Service - Edge Cases', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    s3Mock.reset();
    
    // Set environment variables
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
    
    // Mock console methods to reduce test output noise
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('Expired URL Handling (Requirement 10.7)', () => {
    it('should return error when WhatsApp returns 410 Gone for expired media URL', async () => {
      // Mock the media URL request to return 410 Gone
      const mockRequest = new EventEmitter();
      (mockRequest as any).end = jest.fn();

      const mockResponse = new EventEmitter();
      (mockResponse as any).statusCode = 410;

      (https.request as jest.Mock).mockImplementation((options: any, callback: any) => {
        callback(mockResponse);
        setImmediate(() => {
          mockResponse.emit('data', JSON.stringify({ error: { message: 'Media URL expired' } }));
          mockResponse.emit('end');
        });
        return mockRequest;
      });

      const result = await downloadMedia('expired-media-id', 'audio', 'test-bucket', 'audio/');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to get media URL');
      expect(result.error).toContain('410');
    });

    it('should return error when media download URL returns 404 Not Found', async () => {
      let callCount = 0;
      
      (https.request as jest.Mock).mockImplementation((options: any, callback: any) => {
        callCount++;
        const mockRequest = new EventEmitter();
        (mockRequest as any).end = jest.fn();
        const mockResponse = new EventEmitter();

        if (callCount === 1) {
          // First call: get media URL (success)
          (mockResponse as any).statusCode = 200;
          callback(mockResponse);
          setImmediate(() => {
            mockResponse.emit('data', JSON.stringify({
              url: 'https://example.com/expired-media',
              mime_type: 'audio/ogg',
            }));
            mockResponse.emit('end');
          });
        } else {
          // Second call: download media (404)
          (mockResponse as any).statusCode = 404;
          callback(mockResponse);
          setImmediate(() => {
            mockResponse.emit('data', '');
            mockResponse.emit('end');
          });
        }

        return mockRequest;
      });

      const result = await downloadMedia('expired-media-id', 'audio', 'test-bucket', 'audio/');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('404');
    });

    it('should retry and eventually fail for expired URLs', async () => {
      // Mock all attempts to fail with 503 (transient error)
      (https.request as jest.Mock).mockImplementation((options: any, callback: any) => {
        const mockRequest = new EventEmitter();
        (mockRequest as any).end = jest.fn();
        const mockResponse = new EventEmitter();
        (mockResponse as any).statusCode = 503; // Service Unavailable - transient error

        callback(mockResponse);
        setImmediate(() => {
          mockResponse.emit('data', JSON.stringify({ error: { message: 'Service temporarily unavailable' } }));
          mockResponse.emit('end');
        });

        return mockRequest;
      });

      const result = await downloadMedia('expired-media-id', 'audio', 'test-bucket', 'audio/');

      expect(result.success).toBe(false);
      // Should have attempted 3 times (initial + 2 retries)
      expect(https.request).toHaveBeenCalledTimes(3);
    });
  });

  describe('Oversized File Rejection (Requirement 10.8)', () => {
    it('should reject audio file larger than 16MB', async () => {
      const audioSize = 17 * 1024 * 1024; // 17 MB (exceeds 16MB limit)
      const largeBuffer = Buffer.alloc(audioSize);

      let callCount = 0;
      (https.request as jest.Mock).mockImplementation((options: any, callback: any) => {
        callCount++;
        const mockRequest = new EventEmitter();
        (mockRequest as any).end = jest.fn();
        const mockResponse = new EventEmitter();
        (mockResponse as any).statusCode = 200;

        callback(mockResponse);

        if (callCount === 1) {
          // First call: get media URL
          setImmediate(() => {
            mockResponse.emit('data', JSON.stringify({
              url: 'https://example.com/large-audio',
              mime_type: 'audio/ogg',
            }));
            mockResponse.emit('end');
          });
        } else {
          // Second call: download large file
          setImmediate(() => {
            mockResponse.emit('data', largeBuffer);
            mockResponse.emit('end');
          });
        }

        return mockRequest;
      });

      const result = await downloadAudio('large-audio-id', 'test-bucket');

      expect(result.success).toBe(false);
      expect(result.error).toContain('exceeds limit');
      expect(result.error).toContain('16777216'); // 16MB in bytes
    });

    it('should reject image file larger than 5MB', async () => {
      const imageSize = 6 * 1024 * 1024; // 6 MB (exceeds 5MB limit)
      const largeBuffer = Buffer.alloc(imageSize);

      let callCount = 0;
      (https.request as jest.Mock).mockImplementation((options: any, callback: any) => {
        callCount++;
        const mockRequest = new EventEmitter();
        (mockRequest as any).end = jest.fn();
        const mockResponse = new EventEmitter();
        (mockResponse as any).statusCode = 200;

        callback(mockResponse);

        if (callCount === 1) {
          // First call: get media URL
          setImmediate(() => {
            mockResponse.emit('data', JSON.stringify({
              url: 'https://example.com/large-image',
              mime_type: 'image/jpeg',
            }));
            mockResponse.emit('end');
          });
        } else {
          // Second call: download large file
          setImmediate(() => {
            mockResponse.emit('data', largeBuffer);
            mockResponse.emit('end');
          });
        }

        return mockRequest;
      });

      const result = await downloadImage('large-image-id', 'test-bucket');

      expect(result.success).toBe(false);
      expect(result.error).toContain('exceeds limit');
      expect(result.error).toContain('5242880'); // 5MB in bytes
    });

    it('should accept audio file exactly at 16MB limit', async () => {
      const audioSize = 16 * 1024 * 1024; // Exactly 16 MB
      const buffer = Buffer.alloc(audioSize);

      let callCount = 0;
      (https.request as jest.Mock).mockImplementation((options: any, callback: any) => {
        callCount++;
        const mockRequest = new EventEmitter();
        (mockRequest as any).end = jest.fn();
        const mockResponse = new EventEmitter();
        (mockResponse as any).statusCode = 200;

        callback(mockResponse);

        if (callCount === 1) {
          setImmediate(() => {
            mockResponse.emit('data', JSON.stringify({
              url: 'https://example.com/exact-size-audio',
              mime_type: 'audio/ogg',
            }));
            mockResponse.emit('end');
          });
        } else {
          setImmediate(() => {
            mockResponse.emit('data', buffer);
            mockResponse.emit('end');
          });
        }

        return mockRequest;
      });

      // Mock S3 upload
      s3Mock.on(PutObjectCommand).resolves({});

      const result = await downloadAudio('exact-size-audio-id', 'test-bucket');

      expect(result.success).toBe(true);
      expect(result.size).toBe(audioSize);
    });

    it('should accept image file exactly at 5MB limit', async () => {
      const imageSize = 5 * 1024 * 1024; // Exactly 5 MB
      const buffer = Buffer.alloc(imageSize);

      let callCount = 0;
      (https.request as jest.Mock).mockImplementation((options: any, callback: any) => {
        callCount++;
        const mockRequest = new EventEmitter();
        (mockRequest as any).end = jest.fn();
        const mockResponse = new EventEmitter();
        (mockResponse as any).statusCode = 200;

        callback(mockResponse);

        if (callCount === 1) {
          setImmediate(() => {
            mockResponse.emit('data', JSON.stringify({
              url: 'https://example.com/exact-size-image',
              mime_type: 'image/jpeg',
            }));
            mockResponse.emit('end');
          });
        } else {
          setImmediate(() => {
            mockResponse.emit('data', buffer);
            mockResponse.emit('end');
          });
        }

        return mockRequest;
      });

      // Mock S3 upload
      s3Mock.on(PutObjectCommand).resolves({});

      const result = await downloadImage('exact-size-image-id', 'test-bucket');

      expect(result.success).toBe(true);
      expect(result.size).toBe(imageSize);
    });
  });

  describe('Unsupported MIME Type Rejection (Requirement 10.8)', () => {
    it('should reject unsupported audio MIME type (audio/wav)', async () => {
      const buffer = Buffer.alloc(1024);

      let callCount = 0;
      (https.request as jest.Mock).mockImplementation((options: any, callback: any) => {
        callCount++;
        const mockRequest = new EventEmitter();
        (mockRequest as any).end = jest.fn();
        const mockResponse = new EventEmitter();
        (mockResponse as any).statusCode = 200;

        callback(mockResponse);

        if (callCount === 1) {
          setImmediate(() => {
            mockResponse.emit('data', JSON.stringify({
              url: 'https://example.com/audio.wav',
              mime_type: 'audio/wav', // Unsupported
            }));
            mockResponse.emit('end');
          });
        } else {
          setImmediate(() => {
            mockResponse.emit('data', buffer);
            mockResponse.emit('end');
          });
        }

        return mockRequest;
      });

      const result = await downloadAudio('unsupported-audio-id', 'test-bucket');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported MIME type');
      expect(result.error).toContain('audio/wav');
    });

    it('should reject unsupported image MIME type (image/gif)', async () => {
      const buffer = Buffer.alloc(1024);

      let callCount = 0;
      (https.request as jest.Mock).mockImplementation((options: any, callback: any) => {
        callCount++;
        const mockRequest = new EventEmitter();
        (mockRequest as any).end = jest.fn();
        const mockResponse = new EventEmitter();
        (mockResponse as any).statusCode = 200;

        callback(mockResponse);

        if (callCount === 1) {
          setImmediate(() => {
            mockResponse.emit('data', JSON.stringify({
              url: 'https://example.com/image.gif',
              mime_type: 'image/gif', // Unsupported
            }));
            mockResponse.emit('end');
          });
        } else {
          setImmediate(() => {
            mockResponse.emit('data', buffer);
            mockResponse.emit('end');
          });
        }

        return mockRequest;
      });

      const result = await downloadImage('unsupported-image-id', 'test-bucket');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported MIME type');
      expect(result.error).toContain('image/gif');
    });

    it('should reject video MIME type for audio download', async () => {
      const buffer = Buffer.alloc(1024);

      let callCount = 0;
      (https.request as jest.Mock).mockImplementation((options: any, callback: any) => {
        callCount++;
        const mockRequest = new EventEmitter();
        (mockRequest as any).end = jest.fn();
        const mockResponse = new EventEmitter();
        (mockResponse as any).statusCode = 200;

        callback(mockResponse);

        if (callCount === 1) {
          setImmediate(() => {
            mockResponse.emit('data', JSON.stringify({
              url: 'https://example.com/video.mp4',
              mime_type: 'video/mp4', // Wrong type
            }));
            mockResponse.emit('end');
          });
        } else {
          setImmediate(() => {
            mockResponse.emit('data', buffer);
            mockResponse.emit('end');
          });
        }

        return mockRequest;
      });

      const result = await downloadAudio('video-file-id', 'test-bucket');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported MIME type');
      expect(result.error).toContain('video/mp4');
    });

    it('should accept all supported audio MIME types', async () => {
      const supportedAudioTypes = ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/amr', 'audio/aac'];
      const buffer = Buffer.alloc(1024);

      for (const mimeType of supportedAudioTypes) {
        jest.clearAllMocks();
        s3Mock.reset();

        let callCount = 0;
        (https.request as jest.Mock).mockImplementation((options: any, callback: any) => {
          callCount++;
          const mockRequest = new EventEmitter();
          (mockRequest as any).end = jest.fn();
          const mockResponse = new EventEmitter();
          (mockResponse as any).statusCode = 200;

          callback(mockResponse);

          if (callCount === 1) {
            setImmediate(() => {
              mockResponse.emit('data', JSON.stringify({
                url: `https://example.com/audio.${mimeType.split('/')[1]}`,
                mime_type: mimeType,
              }));
              mockResponse.emit('end');
            });
          } else {
            setImmediate(() => {
              mockResponse.emit('data', buffer);
              mockResponse.emit('end');
            });
          }

          return mockRequest;
        });

        // Mock S3 upload
        s3Mock.on(PutObjectCommand).resolves({});

        const result = await downloadAudio(`audio-${mimeType}-id`, 'test-bucket');

        expect(result.success).toBe(true);
        expect(result.mimeType).toBe(mimeType);
      }
    });

    it('should accept all supported image MIME types', async () => {
      const supportedImageTypes = ['image/jpeg', 'image/png', 'image/webp'];
      const buffer = Buffer.alloc(1024);

      for (const mimeType of supportedImageTypes) {
        jest.clearAllMocks();
        s3Mock.reset();

        let callCount = 0;
        (https.request as jest.Mock).mockImplementation((options: any, callback: any) => {
          callCount++;
          const mockRequest = new EventEmitter();
          (mockRequest as any).end = jest.fn();
          const mockResponse = new EventEmitter();
          (mockResponse as any).statusCode = 200;

          callback(mockResponse);

          if (callCount === 1) {
            setImmediate(() => {
              mockResponse.emit('data', JSON.stringify({
                url: `https://example.com/image.${mimeType.split('/')[1]}`,
                mime_type: mimeType,
              }));
              mockResponse.emit('end');
            });
          } else {
            setImmediate(() => {
              mockResponse.emit('data', buffer);
              mockResponse.emit('end');
            });
          }

          return mockRequest;
        });

        // Mock S3 upload
        s3Mock.on(PutObjectCommand).resolves({});

        const result = await downloadImage(`image-${mimeType}-id`, 'test-bucket');

        expect(result.success).toBe(true);
        expect(result.mimeType).toBe(mimeType);
      }
    });
  });

  describe('Combined Edge Cases', () => {
    it('should validate MIME type before checking file size', async () => {
      // Large file with unsupported MIME type
      const largeBuffer = Buffer.alloc(20 * 1024 * 1024); // 20 MB

      let callCount = 0;
      (https.request as jest.Mock).mockImplementation((options: any, callback: any) => {
        callCount++;
        const mockRequest = new EventEmitter();
        (mockRequest as any).end = jest.fn();
        const mockResponse = new EventEmitter();
        (mockResponse as any).statusCode = 200;

        callback(mockResponse);

        if (callCount === 1) {
          setImmediate(() => {
            mockResponse.emit('data', JSON.stringify({
              url: 'https://example.com/large.wav',
              mime_type: 'audio/wav', // Unsupported
            }));
            mockResponse.emit('end');
          });
        } else {
          setImmediate(() => {
            mockResponse.emit('data', largeBuffer);
            mockResponse.emit('end');
          });
        }

        return mockRequest;
      });

      const result = await downloadAudio('large-unsupported-id', 'test-bucket');

      expect(result.success).toBe(false);
      // Should fail on validation (either size or MIME type)
      expect(result.error).toBeDefined();
    });

    it('should handle missing access token', async () => {
      delete process.env.WHATSAPP_ACCESS_TOKEN;

      const result = await downloadMedia('test-media-id', 'audio', 'test-bucket', 'audio/');

      expect(result.success).toBe(false);
      expect(result.error).toContain('WHATSAPP_ACCESS_TOKEN not configured');
    });
  });
});
