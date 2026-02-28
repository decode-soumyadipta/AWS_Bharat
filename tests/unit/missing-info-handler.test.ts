/**
 * Unit Tests for Missing Info Handler
 * 
 * Tests validation, prompt generation, and voice synthesis for missing information handling.
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import { mockClient } from 'aws-sdk-client-mock';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  validateRequiredFields,
  generateAndSendVoicePrompt,
  processMissingInfo,
} from '../../src/services/missing-info-handler';
import type { PartialCatalogItem } from '../../src/services/partial-data-store';
import * as stateManager from '../../src/services/state-manager';

// Mock AWS clients
const pollyMock = mockClient(PollyClient);
const s3Mock = mockClient(S3Client);

// Mock state manager
jest.mock('../../src/services/state-manager', () => ({
  updateUserState: jest.fn(),
}));

describe('Missing Info Handler', () => {
  beforeEach(() => {
    pollyMock.reset();
    s3Mock.reset();
    jest.clearAllMocks();
  });

  describe('validateRequiredFields', () => {
    it('should identify all missing required fields', () => {
      const partialData: Partial<PartialCatalogItem> = {
        phone: '+919876543210',
      };

      const result = validateRequiredFields(partialData);

      expect(result.missingFields).toEqual(['productName', 'price', 'quantity', 'unit']);
      expect(result.isComplete).toBe(false);
    });

    it('should identify some missing fields', () => {
      const partialData: Partial<PartialCatalogItem> = {
        phone: '+919876543210',
        productName: 'Mango Pickle',
        price: 500,
      };

      const result = validateRequiredFields(partialData);

      expect(result.missingFields).toEqual(['quantity', 'unit']);
      expect(result.isComplete).toBe(false);
    });

    it('should return no missing fields when all required fields are present', () => {
      const partialData: Partial<PartialCatalogItem> = {
        phone: '+919876543210',
        productName: 'Mango Pickle',
        price: 500,
        quantity: 5,
        unit: 'kg',
      };

      const result = validateRequiredFields(partialData);

      expect(result.missingFields).toEqual([]);
      expect(result.isComplete).toBe(true);
    });

    it('should handle missing productName', () => {
      const partialData: Partial<PartialCatalogItem> = {
        phone: '+919876543210',
        price: 500,
        quantity: 5,
        unit: 'kg',
      };

      const result = validateRequiredFields(partialData);

      expect(result.missingFields).toContain('productName');
      expect(result.isComplete).toBe(false);
    });

    it('should handle missing price', () => {
      const partialData: Partial<PartialCatalogItem> = {
        phone: '+919876543210',
        productName: 'Mango Pickle',
        quantity: 5,
        unit: 'kg',
      };

      const result = validateRequiredFields(partialData);

      expect(result.missingFields).toContain('price');
      expect(result.isComplete).toBe(false);
    });
  });

  describe('generateAndSendVoicePrompt', () => {
    it('should generate voice prompt in Hindi', async () => {
      // Mock Polly response
      const audioStream = Buffer.from('mock-audio-data');
      pollyMock.on(SynthesizeSpeechCommand).resolves({
        AudioStream: {
          [Symbol.asyncIterator]: async function* () {
            yield audioStream;
          },
        } as any,
      });

      // Mock S3 upload
      s3Mock.on(PutObjectCommand).resolves({});

      const result = await generateAndSendVoicePrompt(
        '+919876543210',
        ['productName', 'price'],
        'hi-IN'
      );

      expect(result.success).toBe(true);
      expect(result.audioUrl).toBeDefined();
      expect(result.audioUrl).toContain('voice-prompts/+919876543210/');
      expect(result.audioUrl).toContain('.mp3');

      // Verify Polly was called with correct parameters
      const pollyCalls = pollyMock.commandCalls(SynthesizeSpeechCommand);
      expect(pollyCalls.length).toBe(1);
      expect(pollyCalls[0].args[0].input).toMatchObject({
        OutputFormat: 'mp3',
        VoiceId: 'Kajal',
        Engine: 'neural',
        LanguageCode: 'hi-IN',
      });

      // Verify the prompt text contains Hindi prompts for both fields
      const promptText = pollyCalls[0].args[0].input.Text;
      expect(promptText).toContain('कृपया उत्पाद का नाम बताएं');
      expect(promptText).toContain('कीमत क्या है?');

      // Verify state was updated
      expect(stateManager.updateUserState).toHaveBeenCalledWith(
        '+919876543210',
        'VOICE_RECEIVED',
        expect.objectContaining({
          pendingFields: ['productName', 'price'],
        })
      );
    });

    it('should generate voice prompt in Marathi', async () => {
      const audioStream = Buffer.from('mock-audio-data');
      pollyMock.on(SynthesizeSpeechCommand).resolves({
        AudioStream: {
          [Symbol.asyncIterator]: async function* () {
            yield audioStream;
          },
        } as any,
      });

      s3Mock.on(PutObjectCommand).resolves({});

      const result = await generateAndSendVoicePrompt(
        '+919876543210',
        ['quantity', 'unit'],
        'mr-IN'
      );

      expect(result.success).toBe(true);

      const pollyCalls = pollyMock.commandCalls(SynthesizeSpeechCommand);
      expect(pollyCalls[0].args[0].input).toMatchObject({
        VoiceId: 'Aditi',
        LanguageCode: 'mr-IN',
      });

      // Verify the prompt text contains Marathi prompts for both fields
      const promptText = pollyCalls[0].args[0].input.Text;
      expect(promptText).toContain('किती प्रमाण आहे?');
      expect(promptText).toContain('एकक काय आहे? जसे किलो, लिटर, पीस.');
    });

    it('should generate voice prompt in English', async () => {
      const audioStream = Buffer.from('mock-audio-data');
      pollyMock.on(SynthesizeSpeechCommand).resolves({
        AudioStream: {
          [Symbol.asyncIterator]: async function* () {
            yield audioStream;
          },
        } as any,
      });

      s3Mock.on(PutObjectCommand).resolves({});

      const result = await generateAndSendVoicePrompt(
        '+919876543210',
        ['price'],
        'en-IN'
      );

      expect(result.success).toBe(true);

      const pollyCalls = pollyMock.commandCalls(SynthesizeSpeechCommand);
      expect(pollyCalls[0].args[0].input).toMatchObject({
        VoiceId: 'Joanna',
        LanguageCode: 'en-IN',
      });

      // Verify the prompt text contains English prompt
      const promptText = pollyCalls[0].args[0].input.Text;
      expect(promptText).toContain('What is the price?');
    });

    it('should default to Hindi when no language specified', async () => {
      const audioStream = Buffer.from('mock-audio-data');
      pollyMock.on(SynthesizeSpeechCommand).resolves({
        AudioStream: {
          [Symbol.asyncIterator]: async function* () {
            yield audioStream;
          },
        } as any,
      });

      s3Mock.on(PutObjectCommand).resolves({});

      const result = await generateAndSendVoicePrompt(
        '+919876543210',
        ['productName']
      );

      expect(result.success).toBe(true);

      const pollyCalls = pollyMock.commandCalls(SynthesizeSpeechCommand);
      expect(pollyCalls[0].args[0].input).toMatchObject({
        VoiceId: 'Kajal',
        LanguageCode: 'hi-IN',
      });
    });

    it('should handle Polly errors gracefully', async () => {
      pollyMock.on(SynthesizeSpeechCommand).rejects(new Error('Polly service error'));

      const result = await generateAndSendVoicePrompt(
        '+919876543210',
        ['productName'],
        'hi-IN'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Polly service error');
      expect(result.audioUrl).toBeUndefined();
    });

    it('should handle S3 upload errors gracefully', async () => {
      const audioStream = Buffer.from('mock-audio-data');
      pollyMock.on(SynthesizeSpeechCommand).resolves({
        AudioStream: {
          [Symbol.asyncIterator]: async function* () {
            yield audioStream;
          },
        } as any,
      });

      s3Mock.on(PutObjectCommand).rejects(new Error('S3 upload failed'));

      const result = await generateAndSendVoicePrompt(
        '+919876543210',
        ['productName'],
        'hi-IN'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('S3 upload failed');
    });

    it('should handle empty missing fields array', async () => {
      const result = await generateAndSendVoicePrompt(
        '+919876543210',
        [],
        'hi-IN'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to generate prompt text');
    });

    // Test individual field prompts in all languages
    describe('field-specific prompts', () => {
      beforeEach(() => {
        const audioStream = Buffer.from('mock-audio-data');
        pollyMock.on(SynthesizeSpeechCommand).resolves({
          AudioStream: {
            [Symbol.asyncIterator]: async function* () {
              yield audioStream;
            },
          } as any,
        });
        s3Mock.on(PutObjectCommand).resolves({});
      });

      it('should generate productName prompt in Hindi', async () => {
        await generateAndSendVoicePrompt('+919876543210', ['productName'], 'hi-IN');
        
        const pollyCalls = pollyMock.commandCalls(SynthesizeSpeechCommand);
        const promptText = pollyCalls[0].args[0].input.Text;
        expect(promptText).toBe('कृपया उत्पाद का नाम बताएं।');
      });

      it('should generate productName prompt in Marathi', async () => {
        await generateAndSendVoicePrompt('+919876543210', ['productName'], 'mr-IN');
        
        const pollyCalls = pollyMock.commandCalls(SynthesizeSpeechCommand);
        const promptText = pollyCalls[0].args[0].input.Text;
        expect(promptText).toBe('कृपया उत्पादाचे नाव सांगा.');
      });

      it('should generate productName prompt in English', async () => {
        await generateAndSendVoicePrompt('+919876543210', ['productName'], 'en-IN');
        
        const pollyCalls = pollyMock.commandCalls(SynthesizeSpeechCommand);
        const promptText = pollyCalls[0].args[0].input.Text;
        expect(promptText).toBe('Please tell the product name.');
      });

      it('should generate price prompt in Hindi', async () => {
        await generateAndSendVoicePrompt('+919876543210', ['price'], 'hi-IN');
        
        const pollyCalls = pollyMock.commandCalls(SynthesizeSpeechCommand);
        const promptText = pollyCalls[0].args[0].input.Text;
        expect(promptText).toBe('कीमत क्या है?');
      });

      it('should generate price prompt in Marathi', async () => {
        await generateAndSendVoicePrompt('+919876543210', ['price'], 'mr-IN');
        
        const pollyCalls = pollyMock.commandCalls(SynthesizeSpeechCommand);
        const promptText = pollyCalls[0].args[0].input.Text;
        expect(promptText).toBe('किंमत काय आहे?');
      });

      it('should generate price prompt in English', async () => {
        await generateAndSendVoicePrompt('+919876543210', ['price'], 'en-IN');
        
        const pollyCalls = pollyMock.commandCalls(SynthesizeSpeechCommand);
        const promptText = pollyCalls[0].args[0].input.Text;
        expect(promptText).toBe('What is the price?');
      });

      it('should generate quantity prompt in Hindi', async () => {
        await generateAndSendVoicePrompt('+919876543210', ['quantity'], 'hi-IN');
        
        const pollyCalls = pollyMock.commandCalls(SynthesizeSpeechCommand);
        const promptText = pollyCalls[0].args[0].input.Text;
        expect(promptText).toBe('कितनी मात्रा है?');
      });

      it('should generate quantity prompt in Marathi', async () => {
        await generateAndSendVoicePrompt('+919876543210', ['quantity'], 'mr-IN');
        
        const pollyCalls = pollyMock.commandCalls(SynthesizeSpeechCommand);
        const promptText = pollyCalls[0].args[0].input.Text;
        expect(promptText).toBe('किती प्रमाण आहे?');
      });

      it('should generate quantity prompt in English', async () => {
        await generateAndSendVoicePrompt('+919876543210', ['quantity'], 'en-IN');
        
        const pollyCalls = pollyMock.commandCalls(SynthesizeSpeechCommand);
        const promptText = pollyCalls[0].args[0].input.Text;
        expect(promptText).toBe('What is the quantity?');
      });

      it('should generate unit prompt in Hindi', async () => {
        await generateAndSendVoicePrompt('+919876543210', ['unit'], 'hi-IN');
        
        const pollyCalls = pollyMock.commandCalls(SynthesizeSpeechCommand);
        const promptText = pollyCalls[0].args[0].input.Text;
        expect(promptText).toBe('इकाई क्या है? जैसे किलो, लीटर, पीस।');
      });

      it('should generate unit prompt in Marathi', async () => {
        await generateAndSendVoicePrompt('+919876543210', ['unit'], 'mr-IN');
        
        const pollyCalls = pollyMock.commandCalls(SynthesizeSpeechCommand);
        const promptText = pollyCalls[0].args[0].input.Text;
        expect(promptText).toBe('एकक काय आहे? जसे किलो, लिटर, पीस.');
      });

      it('should generate unit prompt in English', async () => {
        await generateAndSendVoicePrompt('+919876543210', ['unit'], 'en-IN');
        
        const pollyCalls = pollyMock.commandCalls(SynthesizeSpeechCommand);
        const promptText = pollyCalls[0].args[0].input.Text;
        expect(promptText).toBe('What is the unit? Like kilo, liter, piece.');
      });

      it('should concatenate multiple field prompts correctly in Hindi', async () => {
        await generateAndSendVoicePrompt(
          '+919876543210',
          ['productName', 'price', 'quantity', 'unit'],
          'hi-IN'
        );
        
        const pollyCalls = pollyMock.commandCalls(SynthesizeSpeechCommand);
        const promptText = pollyCalls[0].args[0].input.Text;
        expect(promptText).toContain('कृपया उत्पाद का नाम बताएं');
        expect(promptText).toContain('कीमत क्या है?');
        expect(promptText).toContain('कितनी मात्रा है?');
        expect(promptText).toContain('इकाई क्या है? जैसे किलो, लीटर, पीस');
      });

      it('should concatenate multiple field prompts correctly in Marathi', async () => {
        await generateAndSendVoicePrompt(
          '+919876543210',
          ['productName', 'price', 'quantity', 'unit'],
          'mr-IN'
        );
        
        const pollyCalls = pollyMock.commandCalls(SynthesizeSpeechCommand);
        const promptText = pollyCalls[0].args[0].input.Text;
        expect(promptText).toContain('कृपया उत्पादाचे नाव सांगा');
        expect(promptText).toContain('किंमत काय आहे?');
        expect(promptText).toContain('किती प्रमाण आहे?');
        expect(promptText).toContain('एकक काय आहे? जसे किलो, लिटर, पीस');
      });

      it('should concatenate multiple field prompts correctly in English', async () => {
        await generateAndSendVoicePrompt(
          '+919876543210',
          ['productName', 'price', 'quantity', 'unit'],
          'en-IN'
        );
        
        const pollyCalls = pollyMock.commandCalls(SynthesizeSpeechCommand);
        const promptText = pollyCalls[0].args[0].input.Text;
        expect(promptText).toContain('Please tell the product name');
        expect(promptText).toContain('What is the price?');
        expect(promptText).toContain('What is the quantity?');
        expect(promptText).toContain('What is the unit? Like kilo, liter, piece');
      });
    });
  });

  describe('processMissingInfo', () => {
    it('should request image when all fields are complete', async () => {
      const partialData: PartialCatalogItem = {
        phone: '+919876543210',
        productName: 'Mango Pickle',
        price: 500,
        quantity: 5,
        unit: 'kg',
        missingFields: [],
        source: 'voice',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const result = await processMissingInfo(
        '+919876543210',
        partialData,
        'hi-IN'
      );

      expect(result.action).toBe('REQUEST_IMAGE');
      expect(result.missingFields).toBeUndefined();
      expect(result.audioUrl).toBeUndefined();
    });

    it('should request info when fields are missing', async () => {
      const audioStream = Buffer.from('mock-audio-data');
      pollyMock.on(SynthesizeSpeechCommand).resolves({
        AudioStream: {
          [Symbol.asyncIterator]: async function* () {
            yield audioStream;
          },
        } as any,
      });

      s3Mock.on(PutObjectCommand).resolves({});

      const partialData: PartialCatalogItem = {
        phone: '+919876543210',
        productName: 'Mango Pickle',
        missingFields: ['price', 'quantity', 'unit'],
        source: 'voice',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const result = await processMissingInfo(
        '+919876543210',
        partialData,
        'hi-IN'
      );

      expect(result.action).toBe('REQUEST_INFO');
      expect(result.missingFields).toEqual(['price', 'quantity', 'unit']);
      expect(result.audioUrl).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('should return error when voice generation fails', async () => {
      pollyMock.on(SynthesizeSpeechCommand).rejects(new Error('Service unavailable'));

      const partialData: PartialCatalogItem = {
        phone: '+919876543210',
        productName: 'Mango Pickle',
        missingFields: ['price', 'quantity', 'unit'],
        source: 'voice',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const result = await processMissingInfo(
        '+919876543210',
        partialData,
        'hi-IN'
      );

      expect(result.action).toBe('REQUEST_INFO');
      expect(result.missingFields).toEqual(['price', 'quantity', 'unit']);
      expect(result.error).toBe('Service unavailable');
      expect(result.audioUrl).toBeUndefined();
    });
  });
});
