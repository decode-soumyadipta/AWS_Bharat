/**
 * Unit Tests for Image Handler Lambda
 * 
 * Tests image processing error handling scenarios.
 * 
 * Validates: Requirements 5.6, 5.7
 */

import { handler } from '../../src/lambdas/image-handler';
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

describe('Image Handler Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    process.env.AWS_REGION = 'ap-south-1';
    process.env.PRODUCTS_BUCKET_NAME = 'test-products-bucket';
  });

  describe('Error Handling', () => {
    it('should handle image download failure', async () => {
      const request = {
        phone: '+919876543210',
        mediaId: 'test-media-id',
        messageId: 'test-message-id',
      };

      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: request.phone,
        state: 'IMAGE_PENDING',
        language: 'hi',
        metadata: {},
        updatedAt: Date.now(),
      });

      (partialDataStore.getPartialData as jest.Mock).mockResolvedValue({
        itemId: 'test-item',
        productName: 'Test Product',
        price: 100,
        quantity: 1,
        unit: 'kg',
        metadata: {},
      });

      // Mock download failure
      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Network timeout',
      });

      (whatsappSender.sendTextMessage as jest.Mock).mockResolvedValue({ success: true });

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('DOWNLOAD_FAILED');
      expect(whatsappSender.sendTextMessage).toHaveBeenCalledWith(
        request.phone,
        expect.stringContaining('त्रुटि'),
        'hi'
      );
    });

    it('should handle invalid image format', async () => {
      const request = {
        phone: '+919876543210',
        mediaId: 'test-media-id',
        messageId: 'test-message-id',
      };

      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: request.phone,
        state: 'IMAGE_PENDING',
        language: 'hi',
        metadata: {},
        updatedAt: Date.now(),
      });

      (partialDataStore.getPartialData as jest.Mock).mockResolvedValue({
        itemId: 'test-item',
        productName: 'Test Product',
        price: 100,
        quantity: 1,
        unit: 'kg',
        metadata: {},
      });

      // Mock unsupported MIME type
      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Unsupported MIME type: image/gif',
      });

      (whatsappSender.sendTextMessage as jest.Mock).mockResolvedValue({ success: true });

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error?.message).toContain('Unsupported MIME type');
    });

    it('should handle oversized image rejection', async () => {
      const request = {
        phone: '+919876543210',
        mediaId: 'test-media-id',
        messageId: 'test-message-id',
      };

      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: request.phone,
        state: 'IMAGE_PENDING',
        language: 'hi',
        metadata: {},
        updatedAt: Date.now(),
      });

      (partialDataStore.getPartialData as jest.Mock).mockResolvedValue({
        itemId: 'test-item',
        productName: 'Test Product',
        price: 100,
        quantity: 1,
        unit: 'kg',
        metadata: {},
      });

      // Mock file size exceeded
      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: false,
        error: 'File size 6291456 bytes exceeds limit of 5242880 bytes',
      });

      (whatsappSender.sendTextMessage as jest.Mock).mockResolvedValue({ success: true });

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error?.message).toContain('exceeds limit');
    });

    it('should handle missing partial data', async () => {
      const request = {
        phone: '+919876543210',
        mediaId: 'test-media-id',
        messageId: 'test-message-id',
      };

      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: request.phone,
        state: 'IMAGE_PENDING',
        language: 'hi',
        metadata: {},
        updatedAt: Date.now(),
      });

      // No partial data found
      (partialDataStore.getPartialData as jest.Mock).mockResolvedValue(null);

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error?.message).toContain('No partial data found');
    });

    it('should handle missing required fields', async () => {
      const request = {
        phone: '',
        mediaId: '',
        messageId: 'test-message-id',
      };

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error?.message).toContain('required');
    });
  });

  describe('Enhancement Fallback', () => {
    it('should use original image when enhancement fails', async () => {
      const request = {
        phone: '+919876543210',
        mediaId: 'test-media-id',
        messageId: 'test-message-id',
      };

      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: request.phone,
        state: 'IMAGE_PENDING',
        language: 'hi',
        metadata: {},
        updatedAt: Date.now(),
      });

      (partialDataStore.getPartialData as jest.Mock).mockResolvedValue({
        itemId: 'test-item',
        productName: 'Test Product',
        price: 100,
        quantity: 1,
        unit: 'kg',
        metadata: {},
      });

      const originalImageUrl = 's3://test-bucket/images/test.jpg';
      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: true,
        s3Url: originalImageUrl,
      });

      // Mock enhancement failure
      (LambdaClient.prototype.send as jest.Mock).mockRejectedValue(
        new Error('Titan service unavailable')
      );

      (whatsappSender.sendTextMessage as jest.Mock).mockResolvedValue({ success: true });
      (partialDataStore.savePartialData as jest.Mock).mockResolvedValue(undefined);
      (stateManager.updateUserState as jest.Mock).mockResolvedValue(undefined);

      const response = await handler(request);

      // Should succeed with original image
      expect(response.success).toBe(true);
      expect(response.originalImageUrl).toBe(originalImageUrl);
      expect(response.enhancedImageUrl).toBe(originalImageUrl);

      // Should still update partial data and state
      expect(partialDataStore.savePartialData).toHaveBeenCalled();
      expect(stateManager.updateUserState).toHaveBeenCalledWith(
        request.phone,
        'CONFIRMATION_PENDING',
        expect.any(Object)
      );
    });
  });

  describe('State Validation', () => {
    it('should reject image when user is in wrong state', async () => {
      const request = {
        phone: '+919876543210',
        mediaId: 'test-media-id',
        messageId: 'test-message-id',
      };

      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: request.phone,
        state: 'KYC_VERIFIED',
        language: 'hi',
        metadata: {},
        updatedAt: Date.now(),
      });

      (whatsappSender.sendTextMessage as jest.Mock).mockResolvedValue({ success: true });

      const response = await handler(request);

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('INVALID_STATE');
      expect(whatsappSender.sendTextMessage).toHaveBeenCalledWith(
        request.phone,
        expect.stringContaining('जानकारी'),
        'hi'
      );
    });
  });

  describe('Successful Processing', () => {
    it('should process image successfully', async () => {
      const request = {
        phone: '+919876543210',
        mediaId: 'test-media-id',
        messageId: 'test-message-id',
      };

      (stateManager.getUserState as jest.Mock).mockResolvedValue({
        phone: request.phone,
        state: 'IMAGE_PENDING',
        language: 'hi',
        metadata: {},
        updatedAt: Date.now(),
      });

      const partialData = {
        itemId: 'test-item',
        productName: 'आम अचार',
        price: 200,
        quantity: 5,
        unit: 'kg',
        metadata: {},
      };

      (partialDataStore.getPartialData as jest.Mock).mockResolvedValue(partialData);

      const originalImageUrl = 's3://test-bucket/images/test.jpg';
      const enhancedImageUrl = 's3://test-bucket/enhanced/test.jpg';

      (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
        success: true,
        s3Url: originalImageUrl,
      });

      (LambdaClient.prototype.send as jest.Mock).mockResolvedValue({
        Payload: new TextEncoder().encode(JSON.stringify({
          success: true,
          enhancedImageUrl,
        })),
      });

      (whatsappSender.sendTextMessage as jest.Mock).mockResolvedValue({ success: true });
      (partialDataStore.savePartialData as jest.Mock).mockResolvedValue(undefined);
      (stateManager.updateUserState as jest.Mock).mockResolvedValue(undefined);

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.originalImageUrl).toBe(originalImageUrl);
      expect(response.enhancedImageUrl).toBe(enhancedImageUrl);

      // Verify partial data was updated with image URLs
      expect(partialDataStore.savePartialData).toHaveBeenCalledWith(
        request.phone,
        expect.objectContaining({
          originalImageUrl: originalImageUrl,
          enhancedImageUrl: enhancedImageUrl,
        })
      );

      // Verify state transition with image URLs
      expect(stateManager.updateUserState).toHaveBeenCalledWith(
        request.phone,
        'CONFIRMATION_PENDING',
        expect.objectContaining({
          enhancedImageUrl: enhancedImageUrl,
          originalImageUrl: originalImageUrl,
        })
      );

      // Verify progress message was sent
      expect(whatsappSender.sendTextMessage).toHaveBeenCalledWith(
        request.phone,
        expect.stringContaining('छवि प्राप्त हुई'),
        'hi'
      );
      
      // Verify confirmation handler was called (which sends image with details)
      expect(LambdaClient.prototype.send).toHaveBeenCalled();
    });
  });
});
