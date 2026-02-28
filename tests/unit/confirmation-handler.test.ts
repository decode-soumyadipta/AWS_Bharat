/**
 * Unit tests for Confirmation Handler Lambda
 * 
 * Tests the confirmation workflow including:
 * - Confirmation message generation
 * - Text-to-speech conversion
 * - Approval processing
 * - Edit flow handling
 */

import { handler, generateConfirmation, processApproval, processEdit } from '../../src/lambdas/confirmation-handler';
import * as stateManager from '../../src/services/state-manager';
import * as partialDataStore from '../../src/services/partial-data-store';
import * as whatsappSender from '../../src/lambdas/whatsapp-message-sender';
import { PartialCatalogItem } from '../../src/services/partial-data-store';
import { UserState } from '../../src/services/state-manager';

// Mock dependencies
jest.mock('../../src/services/state-manager');
jest.mock('../../src/services/partial-data-store');
jest.mock('../../src/lambdas/whatsapp-message-sender');
jest.mock('../../src/config/aws-clients', () => ({
  eventBridgeClient: {
    send: jest.fn().mockResolvedValue({}),
  },
  s3Client: {
    send: jest.fn().mockResolvedValue({}),
  },
  PRODUCTS_BUCKET_NAME: 'test-bucket',
}));

// Mock Polly client
jest.mock('@aws-sdk/client-polly', () => ({
  PollyClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({
      AudioStream: {
        async *[Symbol.asyncIterator]() {
          yield Buffer.from('mock audio data');
        },
      },
    }),
  })),
  SynthesizeSpeechCommand: jest.fn(),
}));

describe('Confirmation Handler Lambda', () => {
  const mockPhone = '+919876543210';
  const mockPartialData: PartialCatalogItem = {
    phone: mockPhone,
    productName: 'Mango Pickle',
    price: 500,
    quantity: 5,
    unit: 'kg',
    category: 'food',
    description: 'Homemade mango pickle',
    originalImageUrl: 'https://example.com/original.jpg',
    enhancedImageUrl: 'https://example.com/enhanced.jpg',
    missingFields: [],
    source: 'voice',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const mockUserState: UserState = {
    phone: mockPhone,
    state: 'CONFIRMATION_PENDING',
    language: 'hi-IN',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mocks
    (stateManager.getUserState as jest.Mock).mockResolvedValue(mockUserState);
    (partialDataStore.getPartialData as jest.Mock).mockResolvedValue(mockPartialData);
    (stateManager.updateUserState as jest.Mock).mockResolvedValue(undefined);
    (partialDataStore.deletePartialData as jest.Mock).mockResolvedValue(undefined);
    (whatsappSender.sendInteractiveMessage as jest.Mock).mockResolvedValue({ success: true });
    (whatsappSender.sendTextMessage as jest.Mock).mockResolvedValue({ success: true });
    (whatsappSender.sendImageMessage as jest.Mock).mockResolvedValue({ success: true });
  });

  describe('generateConfirmation', () => {
    it('should generate confirmation message with text summary and buttons', async () => {
      const result = await generateConfirmation(mockPhone, mockPartialData, 'hi-IN');

      expect(result.textSummary).toContain('Mango Pickle');
      expect(result.textSummary).toContain('₹500');
      expect(result.textSummary).toContain('5 kg');
      expect(result.buttons).toHaveLength(3); // Now has 3 buttons: approve, edit_quantity, view_products
      expect(result.buttons[0].id).toBe('approve');
      expect(result.buttons[1].id).toBe('edit_quantity');
      expect(result.buttons[2].id).toBe('view_products');
    });

    it('should send image message with caption (not interactive buttons)', async () => {
      await generateConfirmation(mockPhone, mockPartialData, 'hi-IN');

      // Now sends image with caption instead of interactive message
      expect(whatsappSender.sendImageMessage).toHaveBeenCalled();
    });

    it('should update user state to CONFIRMATION_PENDING', async () => {
      await generateConfirmation(mockPhone, mockPartialData, 'hi-IN');

      expect(stateManager.updateUserState).toHaveBeenCalledWith(
        mockPhone,
        'CONFIRMATION_PENDING'
      );
    });

    it('should handle voice generation failure gracefully', async () => {
      // Mock Polly to fail
      const { PollyClient } = require('@aws-sdk/client-polly');
      PollyClient.mockImplementationOnce(() => ({
        send: jest.fn().mockRejectedValue(new Error('Polly error')),
      }));

      const result = await generateConfirmation(mockPhone, mockPartialData, 'hi-IN');

      // Should still return text summary and buttons
      expect(result.textSummary).toBeDefined();
      expect(result.buttons).toHaveLength(3); // Now has 3 buttons
      // Voice URL may be undefined
    });

    it('should generate confirmation in Marathi', async () => {
      const result = await generateConfirmation(mockPhone, mockPartialData, 'mr-IN');

      expect(result.textSummary).toContain('Mango Pickle');
      expect(result.buttons[0].title).toContain('स्वीकार करा');
    });

    it('should generate confirmation in English', async () => {
      const result = await generateConfirmation(mockPhone, mockPartialData, 'en-IN');

      expect(result.textSummary).toContain('Mango Pickle');
      expect(result.buttons[0].title).toContain('Approve');
    });
  });

  describe('processApproval', () => {
    it('should publish catalog build event', async () => {
      const { eventBridgeClient } = require('../../src/config/aws-clients');
      
      await processApproval(mockPhone, mockPartialData, 'hi-IN');

      expect(eventBridgeClient.send).toHaveBeenCalled();
    });

    it('should update user state to ACTIVE', async () => {
      await processApproval(mockPhone, mockPartialData, 'hi-IN');

      expect(stateManager.updateUserState).toHaveBeenCalledWith(
        mockPhone,
        'ACTIVE'
      );
    });

    it('should delete partial data', async () => {
      await processApproval(mockPhone, mockPartialData, 'hi-IN');

      expect(partialDataStore.deletePartialData).toHaveBeenCalledWith(mockPhone);
    });

    it('should send success message', async () => {
      await processApproval(mockPhone, mockPartialData, 'hi-IN');

      expect(whatsappSender.sendTextMessage).toHaveBeenCalledWith(
        mockPhone,
        expect.stringContaining('सफलतापूर्वक'),
        'hi'
      );
    });

    it('should return success result', async () => {
      const result = await processApproval(mockPhone, mockPartialData, 'hi-IN');

      expect(result.success).toBe(true);
      expect(result.catalogId).toBeDefined();
    });

    it('should handle approval failure', async () => {
      const { eventBridgeClient } = require('../../src/config/aws-clients');
      eventBridgeClient.send.mockRejectedValueOnce(new Error('EventBridge error'));

      const result = await processApproval(mockPhone, mockPartialData, 'hi-IN');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should use enhanced image URL if available', async () => {
      const { eventBridgeClient } = require('../../src/config/aws-clients');
      
      await processApproval(mockPhone, mockPartialData, 'hi-IN');

      const callArgs = eventBridgeClient.send.mock.calls[0][0];
      const eventDetail = JSON.parse(callArgs.input.Entries[0].Detail);
      expect(eventDetail.imageUrl).toBe(mockPartialData.enhancedImageUrl);
    });

    it('should fallback to original image URL if enhanced not available', async () => {
      const { eventBridgeClient } = require('../../src/config/aws-clients');
      const dataWithoutEnhanced = { ...mockPartialData, enhancedImageUrl: undefined };
      
      await processApproval(mockPhone, dataWithoutEnhanced, 'hi-IN');

      const callArgs = eventBridgeClient.send.mock.calls[0][0];
      const eventDetail = JSON.parse(callArgs.input.Entries[0].Detail);
      expect(eventDetail.imageUrl).toBe(mockPartialData.originalImageUrl);
    });
  });

  describe('processEdit', () => {
    it('should send edit prompt message', async () => {
      await processEdit(mockPhone, undefined, 'hi-IN');

      expect(whatsappSender.sendTextMessage).toHaveBeenCalledWith(
        mockPhone,
        expect.stringContaining('बदलनी'),
        'hi'
      );
    });

    it('should update user state to VOICE_RECEIVED', async () => {
      await processEdit(mockPhone, 'price', 'hi-IN');

      expect(stateManager.updateUserState).toHaveBeenCalledWith(
        mockPhone,
        'VOICE_RECEIVED',
        { editingField: 'price' }
      );
    });

    it('should handle edit without specific field', async () => {
      await processEdit(mockPhone, undefined, 'hi-IN');

      expect(stateManager.updateUserState).toHaveBeenCalledWith(
        mockPhone,
        'VOICE_RECEIVED',
        { editingField: undefined }
      );
    });

    it('should send edit prompt in Marathi', async () => {
      await processEdit(mockPhone, undefined, 'mr-IN');

      expect(whatsappSender.sendTextMessage).toHaveBeenCalledWith(
        mockPhone,
        expect.stringContaining('बदलायची'),
        'mr'
      );
    });

    it('should send edit prompt in English', async () => {
      await processEdit(mockPhone, undefined, 'en-IN');

      expect(whatsappSender.sendTextMessage).toHaveBeenCalledWith(
        mockPhone,
        expect.stringContaining('change'),
        'en'
      );
    });
  });

  describe('handler', () => {
    it('should handle generate action', async () => {
      const event = {
        detail: {
          phone: mockPhone,
          action: 'generate',
        },
      };

      const result = await handler(event);

      expect(result.statusCode).not.toBe(500);
      // Now sends image message instead of interactive message
      expect(whatsappSender.sendImageMessage).toHaveBeenCalled();
    });

    it('should handle approve action', async () => {
      const event = {
        detail: {
          phone: mockPhone,
          action: 'approve',
        },
      };

      await handler(event);

      expect(stateManager.updateUserState).toHaveBeenCalledWith(
        mockPhone,
        'ACTIVE'
      );
    });

    it('should handle edit action', async () => {
      const event = {
        detail: {
          phone: mockPhone,
          action: 'edit',
          field: 'price',
        },
      };

      await handler(event);

      expect(stateManager.updateUserState).toHaveBeenCalledWith(
        mockPhone,
        'VOICE_RECEIVED',
        expect.objectContaining({ editingField: 'price' })
      );
    });

    it('should return error for missing phone', async () => {
      const event = {
        detail: {
          action: 'generate',
        },
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).success).toBe(false);
    });

    it('should return error for unknown action', async () => {
      const event = {
        detail: {
          phone: mockPhone,
          action: 'unknown',
        },
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toContain('Unknown action');
    });

    it('should return error when user state not found', async () => {
      (stateManager.getUserState as jest.Mock).mockResolvedValue(null);

      const event = {
        detail: {
          phone: mockPhone,
          action: 'generate',
        },
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toContain('User state not found');
    });

    it('should return error when partial data not found', async () => {
      (partialDataStore.getPartialData as jest.Mock).mockResolvedValue(null);

      const event = {
        detail: {
          phone: mockPhone,
          action: 'generate',
        },
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toContain('Partial catalog data not found');
    });
  });
});
