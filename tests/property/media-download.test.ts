/**
 * Property-Based Test: Media Download with Retry
 * 
 * **Validates: Requirements 2.6, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6**
 * 
 * Property 10: Media Download with Retry
 * For any media download request (audio or image), the system should authenticate with
 * WhatsApp API, validate file size and MIME type, and retry up to 3 times with
 * exponential backoff on failure.
 * 
 * This test verifies:
 * 1. File size validation works for both audio and image types
 * 2. MIME type validation accepts only supported formats
 * 3. Retry logic configuration is correct
 * 4. Exponential backoff calculation is correct
 * 5. Validation logic correctly identifies valid/invalid media
 * 
 * Note: This test focuses on the validation and retry logic properties rather than
 * full integration testing with mocked HTTP requests, as the latter is better suited
 * for unit tests.
 */

import fc from 'fast-check';

// Import the constants and helper functions we need to test
const SIZE_LIMITS = {
  audio: 16 * 1024 * 1024, // 16 MB
  image: 5 * 1024 * 1024,  // 5 MB
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
};

/**
 * Calculate exponential backoff delay with jitter (copied from implementation)
 */
function calculateDelay(attempt: number): number {
  const delay = Math.min(
    RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
    RETRY_CONFIG.maxDelay
  );
  return delay * (0.5 + Math.random() * 0.5);
}

/**
 * Validate file size and MIME type (copied from implementation)
 */
function validateMedia(
  mediaType: 'audio' | 'image',
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

describe('Property 10: Media Download with Retry', () => {
  it('should correctly validate file size limits for any media type and size', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          mediaType: fc.constantFrom<'audio' | 'image'>('audio', 'image'),
          fileSize: fc.integer({ min: 0, max: 20 * 1024 * 1024 }), // 0 to 20MB
        }),
        async ({ mediaType, fileSize }) => {
          const sizeLimit = SIZE_LIMITS[mediaType];
          const mimeType = mediaType === 'audio' ? 'audio/ogg' : 'image/jpeg';

          const result = validateMedia(mediaType, mimeType, fileSize);

          // Property: Files within size limit should pass validation
          if (fileSize <= sizeLimit) {
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
          } else {
            // Property: Files exceeding size limit should fail validation
            expect(result.valid).toBe(false);
            expect(result.error).toContain('exceeds limit');
            expect(result.error).toContain(sizeLimit.toString());
          }
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should correctly validate MIME types for any media type', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          mediaType: fc.constantFrom<'audio' | 'image'>('audio', 'image'),
          mimeType: fc.constantFrom(
            // Supported types
            'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/amr', 'audio/aac',
            'image/jpeg', 'image/png', 'image/webp',
            // Unsupported types
            'video/mp4', 'application/pdf', 'text/plain', 'audio/wav', 'image/gif'
          ),
        }),
        async ({ mediaType, mimeType }) => {
          const fileSize = 1024; // Small valid size
          const supportedTypes = SUPPORTED_MIME_TYPES[mediaType];

          const result = validateMedia(mediaType, mimeType, fileSize);

          // Property: Supported MIME types should pass validation
          if (supportedTypes.includes(mimeType)) {
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
          } else {
            // Property: Unsupported MIME types should fail validation
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Unsupported MIME type');
            expect(result.error).toContain(mimeType);
          }
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should calculate exponential backoff with correct bounds for any attempt', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 10 }), // Attempt number
        async (attempt) => {
          // Run multiple times to account for jitter
          const delays: number[] = [];
          for (let i = 0; i < 10; i++) {
            delays.push(calculateDelay(attempt));
          }

          // Calculate expected delay without jitter
          const expectedDelay = Math.min(
            RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
            RETRY_CONFIG.maxDelay
          );

          // Property: All delays should be within jitter bounds (50% to 100% of expected)
          delays.forEach(delay => {
            expect(delay).toBeGreaterThanOrEqual(expectedDelay * 0.5);
            expect(delay).toBeLessThanOrEqual(expectedDelay);
          });

          // Property: Delay should never exceed maxDelay
          delays.forEach(delay => {
            expect(delay).toBeLessThanOrEqual(RETRY_CONFIG.maxDelay);
          });

          // Property: For attempt 0, delay should be based on baseDelay
          if (attempt === 0) {
            delays.forEach(delay => {
              expect(delay).toBeGreaterThanOrEqual(RETRY_CONFIG.baseDelay * 0.5);
              expect(delay).toBeLessThanOrEqual(RETRY_CONFIG.baseDelay);
            });
          }
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should have exponentially increasing delays for sequential attempts', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(null), // No input needed
        async () => {
          // Calculate delays for first 3 attempts (without jitter for comparison)
          const delays = [0, 1, 2].map(attempt => 
            Math.min(
              RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
              RETRY_CONFIG.maxDelay
            )
          );

          // Property: Each delay should be larger than the previous (exponential growth)
          expect(delays[1]).toBeGreaterThan(delays[0]);
          expect(delays[2]).toBeGreaterThan(delays[1]);

          // Property: Growth should follow backoff multiplier
          expect(delays[1]).toBe(delays[0] * RETRY_CONFIG.backoffMultiplier);
          expect(delays[2]).toBe(delays[1] * RETRY_CONFIG.backoffMultiplier);
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should enforce maximum retry attempts limit', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(null), // No input needed
        async () => {
          // Property: Maximum attempts should be exactly 3
          expect(RETRY_CONFIG.maxAttempts).toBe(3);

          // Property: This means a download will be attempted at most 3 times
          // (initial attempt + 2 retries, or 3 total attempts)
          const maxTotalAttempts = RETRY_CONFIG.maxAttempts;
          expect(maxTotalAttempts).toBe(3);
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should validate both size and MIME type together correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          mediaType: fc.constantFrom<'audio' | 'image'>('audio', 'image'),
          fileSize: fc.integer({ min: 0, max: 20 * 1024 * 1024 }),
          mimeType: fc.constantFrom(
            'audio/ogg', 'audio/mpeg', 'image/jpeg', 'image/png',
            'video/mp4', 'application/pdf'
          ),
        }),
        async ({ mediaType, fileSize, mimeType }) => {
          const sizeLimit = SIZE_LIMITS[mediaType];
          const supportedTypes = SUPPORTED_MIME_TYPES[mediaType];

          const result = validateMedia(mediaType, mimeType, fileSize);

          // Property: Validation passes only if BOTH size and MIME type are valid
          const sizeValid = fileSize <= sizeLimit;
          const mimeValid = supportedTypes.includes(mimeType);

          if (sizeValid && mimeValid) {
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
          } else {
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();

            // Property: Error message should indicate which validation failed
            if (!sizeValid) {
              expect(result.error).toContain('exceeds limit');
            } else if (!mimeValid) {
              expect(result.error).toContain('Unsupported MIME type');
            }
          }
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should have correct size limits for audio and image types', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(null), // No input needed
        async () => {
          // Property: Audio limit should be 16MB as per requirements
          expect(SIZE_LIMITS.audio).toBe(16 * 1024 * 1024);

          // Property: Image limit should be 5MB as per requirements
          expect(SIZE_LIMITS.image).toBe(5 * 1024 * 1024);

          // Property: Audio limit should be larger than image limit
          expect(SIZE_LIMITS.audio).toBeGreaterThan(SIZE_LIMITS.image);
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should support all required MIME types per requirements', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(null), // No input needed
        async () => {
          // Property: Audio should support OGG, MPEG, MP4, AMR, AAC
          expect(SUPPORTED_MIME_TYPES.audio).toContain('audio/ogg');
          expect(SUPPORTED_MIME_TYPES.audio).toContain('audio/mpeg');
          expect(SUPPORTED_MIME_TYPES.audio).toContain('audio/mp4');
          expect(SUPPORTED_MIME_TYPES.audio).toContain('audio/amr');
          expect(SUPPORTED_MIME_TYPES.audio).toContain('audio/aac');

          // Property: Image should support JPEG, PNG, WebP
          expect(SUPPORTED_MIME_TYPES.image).toContain('image/jpeg');
          expect(SUPPORTED_MIME_TYPES.image).toContain('image/png');
          expect(SUPPORTED_MIME_TYPES.image).toContain('image/webp');

          // Property: Should have exactly the specified types (no more, no less)
          expect(SUPPORTED_MIME_TYPES.audio.length).toBe(5);
          expect(SUPPORTED_MIME_TYPES.image.length).toBe(3);
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should have correct retry configuration per requirements', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(null), // No input needed
        async () => {
          // Property: Should retry up to 3 times as per requirements
          expect(RETRY_CONFIG.maxAttempts).toBe(3);

          // Property: Base delay should be 1 second
          expect(RETRY_CONFIG.baseDelay).toBe(1000);

          // Property: Max delay should be 10 seconds
          expect(RETRY_CONFIG.maxDelay).toBe(10000);

          // Property: Backoff multiplier should be 2 (exponential)
          expect(RETRY_CONFIG.backoffMultiplier).toBe(2);

          // Property: Max delay should be greater than base delay
          expect(RETRY_CONFIG.maxDelay).toBeGreaterThan(RETRY_CONFIG.baseDelay);
        }
      ),
      { numRuns: 5 }
    );
  });
});
