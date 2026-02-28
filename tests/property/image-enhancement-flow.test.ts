/**
 * Property-Based Test: Image Enhancement Flow
 * 
 * **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.8**
 * 
 * Property 7: Image Enhancement Flow
 * For any product image received when user is in IMAGE_PENDING state, the system 
 * should download the image, enhance it using Titan, store both original and 
 * enhanced images in S3, associate URLs with partial data, and transition to 
 * CONFIRMATION_PENDING.
 * 
 * This test verifies:
 * 1. Images are downloaded from WhatsApp when user is in IMAGE_PENDING state
 * 2. Original images are stored in S3
 * 3. Images are enhanced using Titan (or fallback to original on failure)
 * 4. Both original and enhanced URLs are stored in partial data
 * 5. User state transitions to CONFIRMATION_PENDING
 * 6. Confirmation message is sent to user
 */

import fc from 'fast-check';
import { handler as processImage } from '../../src/lambdas/image-handler';
import * as stateManager from '../../src/services/state-manager';
import * as partialDataStore from '../../src/services/partial-data-store';
import * as mediaDownload from '../../src/services/media-download';
import * as whatsappSender from '../../src/lambdas/whatsapp-message-sender';
import { LambdaClient } from '@aws-sdk/client-lambda';

// Mock dependencies
jest.mock('../../src/services/state-manager');
jest.mock('../../src/services/partial-data-store');
jest.mock('../../src/services/media-download');
jest.mock('../../src/lambdas/whatsapp-message-sender');
jest.mock('@aws-sdk/client-lambda');

describe('Property 7: Image Enhancement Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock environment variables
    process.env.AWS_REGION = 'ap-south-1';
    process.env.PRODUCTS_BUCKET_NAME = 'test-products-bucket';
  });

  it('should process any image when user is in IMAGE_PENDING state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.slice(0, 10)}`),
          mediaId: fc.uuid(),
          messageId: fc.uuid(),
          productName: fc.string({ minLength: 3, maxLength: 50 }),
          price: fc.integer({ min: 10, max: 10000 }),
          quantity: fc.integer({ min: 1, max: 1000 }),
          unit: fc.constantFrom('kg', 'litre', 'piece', 'dozen'),
          language: fc.constantFrom('hi', 'mr', 'en'),
        }),
        async ({ phone, mediaId, messageId, productName, price, quantity, unit, language }) => {
          // Setup: User is in IMAGE_PENDING state with partial data
          (stateManager.getUserState as jest.Mock).mockResolvedValue({
            phone,
            state: 'IMAGE_PENDING',
            language,
            metadata: {},
            updatedAt: Date.now(),
          });

          const partialData = {
            itemId: `item-${Date.now()}`,
            productName,
            price,
            quantity,
            unit,
            metadata: {},
          };

          (partialDataStore.getPartialData as jest.Mock).mockResolvedValue(partialData);
          (partialDataStore.savePartialData as jest.Mock).mockResolvedValue(undefined);

          // Mock successful image download
          const originalImageUrl = `s3://test-bucket/images/${Date.now()}-${mediaId}.jpg`;
          (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
            success: true,
            s3Url: originalImageUrl,
            mimeType: 'image/jpeg',
            size: 1024 * 1024, // 1MB
          });

          // Mock image enhancement Lambda
          const enhancedImageUrl = `s3://test-bucket/enhanced/${Date.now()}-${mediaId}.jpg`;
          (LambdaClient.prototype.send as jest.Mock).mockResolvedValue({
            Payload: new TextEncoder().encode(JSON.stringify({
              success: true,
              enhancedImageUrl,
            })),
          });

          // Mock WhatsApp message sender
          (whatsappSender.sendTextMessage as jest.Mock).mockResolvedValue({
            success: true,
          });

          (stateManager.updateUserState as jest.Mock).mockResolvedValue(undefined);

          // Execute
          const request = { phone, mediaId, messageId };
          const response = await processImage(request);

          // Property 1: Processing succeeds
          expect(response.success).toBe(true);

          // Property 2: Original image URL is returned
          expect(response.originalImageUrl).toBeDefined();
          expect(response.originalImageUrl).toContain('s3://');

          // Property 3: Enhanced image URL is returned
          expect(response.enhancedImageUrl).toBeDefined();
          expect(response.enhancedImageUrl).toContain('s3://');

          // Property 4: Image is downloaded from WhatsApp
          expect(mediaDownload.downloadImage).toHaveBeenCalledWith(
            mediaId,
            expect.any(String)
          );

          // Property 5: Partial data is updated with image URLs
          expect(partialDataStore.savePartialData).toHaveBeenCalledWith(
            phone,
            expect.objectContaining({
              images: expect.arrayContaining([
                expect.objectContaining({
                  url: expect.stringContaining('s3://'),
                }),
              ]),
            })
          );

          // Property 6: State transitions to CONFIRMATION_PENDING
          expect(stateManager.updateUserState).toHaveBeenCalledWith(
            phone,
            'CONFIRMATION_PENDING',
            expect.any(Object)
          );

          // Property 7: Confirmation message is sent
          expect(whatsappSender.sendTextMessage).toHaveBeenCalledWith(
            phone,
            expect.stringContaining(productName),
            language
          );
        }
      ),
      { numRuns: 5 }
    );
  }, 30000);

  it('should handle image enhancement failure gracefully', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.slice(0, 10)}`),
          mediaId: fc.uuid(),
          messageId: fc.uuid(),
          productName: fc.string({ minLength: 3, maxLength: 50 }),
        }),
        async ({ phone, mediaId, messageId, productName }) => {
          // Setup
          (stateManager.getUserState as jest.Mock).mockResolvedValue({
            phone,
            state: 'IMAGE_PENDING',
            language: 'hi',
            metadata: {},
            updatedAt: Date.now(),
          });

          (partialDataStore.getPartialData as jest.Mock).mockResolvedValue({
            itemId: `item-${Date.now()}`,
            productName,
            price: 100,
            quantity: 1,
            unit: 'kg',
            metadata: {},
          });

          const originalImageUrl = `s3://test-bucket/images/${Date.now()}-${mediaId}.jpg`;
          (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
            success: true,
            s3Url: originalImageUrl,
          });

          // Mock image enhancement failure
          (LambdaClient.prototype.send as jest.Mock).mockResolvedValue({
            Payload: new TextEncoder().encode(JSON.stringify({
              success: false,
              error: { code: 'ENHANCEMENT_FAILED', message: 'Titan error' },
            })),
          });

          (whatsappSender.sendTextMessage as jest.Mock).mockResolvedValue({ success: true });
          (partialDataStore.savePartialData as jest.Mock).mockResolvedValue(undefined);
          (stateManager.updateUserState as jest.Mock).mockResolvedValue(undefined);

          // Execute
          const response = await processImage({ phone, mediaId, messageId });

          // Property: System falls back to original image on enhancement failure
          expect(response.success).toBe(true);
          expect(response.originalImageUrl).toBe(response.enhancedImageUrl);

          // Property: Workflow continues despite enhancement failure
          expect(stateManager.updateUserState).toHaveBeenCalledWith(
            phone,
            'CONFIRMATION_PENDING',
            expect.any(Object)
          );
        }
      ),
      { numRuns: 5 }
    );
  }, 30000);

  it('should reject images when user is not in IMAGE_PENDING state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: fc.string({ minLength: 10, maxLength: 15 }).map(s => `+91${s.slice(0, 10)}`),
          mediaId: fc.uuid(),
          state: fc.constantFrom('NEW', 'KYC_PENDING', 'KYC_VERIFIED', 'VOICE_RECEIVED', 'CONFIRMATION_PENDING', 'ACTIVE'),
        }),
        async ({ phone, mediaId, state }) => {
          // Setup: User is NOT in IMAGE_PENDING state
          (stateManager.getUserState as jest.Mock).mockResolvedValue({
            phone,
            state: state as any,
            language: 'hi',
            metadata: {},
            updatedAt: Date.now(),
          });

          (whatsappSender.sendTextMessage as jest.Mock).mockResolvedValue({ success: true });

          // Execute
          const response = await processImage({ phone, mediaId, messageId: 'test' });

          // Property: Processing fails with invalid state error
          expect(response.success).toBe(false);
          expect(response.error?.code).toBe('INVALID_STATE');

          // Property: User receives guidance message
          expect(whatsappSender.sendTextMessage).toHaveBeenCalled();

          // Property: State is not changed
          expect(stateManager.updateUserState).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 5 }
    );
  }, 30000);
});
