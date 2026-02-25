/**
 * Unit Tests for Voice Transcription Lambda
 * 
 * Tests voice transcription functionality including:
 * - Transcription for each supported language
 * - Automatic language detection
 * - Transcription failure handling
 * 
 * Validates: Requirements 2.1, 4.1, 9.1, 12.1
 */

import { mockClient } from 'aws-sdk-client-mock';
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  DeleteTranscriptionJobCommand,
} from '@aws-sdk/client-transcribe';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { handler } from '../../src/lambdas/voice-transcription';
import { VoiceTranscriptionRequest } from '../../src/models/voice';

// Create mocks
const transcribeMock = mockClient(TranscribeClient);
const s3Mock = mockClient(S3Client);

/**
 * Helper function to create mock S3 Body with transformToString method
 */
function createMockS3Body(data: string) {
  return {
    transformToString: jest.fn().mockResolvedValue(data),
  };
}

describe('Voice Transcription Lambda', () => {
  beforeEach(() => {
    // Reset mocks before each test
    transcribeMock.reset();
    s3Mock.reset();
    
    // Mock console methods to reduce test output noise
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Successful Transcription', () => {
    it('should transcribe Hindi voice note successfully', async () => {
      const request: VoiceTranscriptionRequest = {
        audioUrl: 's3://test-bucket/audio/hindi-voice.mp3',
        languageCode: 'hi-IN',
        sellerId: 'seller-123',
        messageId: 'msg-456',
      };

      // Mock StartTranscriptionJob
      transcribeMock.on(StartTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job-123',
          TranscriptionJobStatus: 'IN_PROGRESS',
        },
      });

      // Mock GetTranscriptionJob - return COMPLETED on first call
      transcribeMock.on(GetTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job-123',
          TranscriptionJobStatus: 'COMPLETED',
          LanguageCode: 'hi-IN',
          Transcript: {
            TranscriptFileUri: 's3://test-bucket/transcripts/test-job-123.json',
          },
        },
      });

      // Mock S3 GetObject for transcript download
      const transcriptData = JSON.stringify({
        results: {
          transcripts: [
            {
              transcript: 'मैं 5 किलो आम का अचार 200 रुपये में बेचना चाहता हूं',
            },
          ],
          items: [
            { confidence: '0.95' },
            { confidence: '0.92' },
            { confidence: '0.98' },
          ],
        },
      });

      const mockBody = {
        transformToString: jest.fn().mockResolvedValue(transcriptData),
      };

      s3Mock.on(GetObjectCommand).resolves({
        Body: mockBody as any,
      });

      // Mock DeleteTranscriptionJob
      transcribeMock.on(DeleteTranscriptionJobCommand).resolves({});

      const result = await handler(request);

      expect(result.success).toBe(true);
      expect(result.transcription).toBe('मैं 5 किलो आम का अचार 200 रुपये में बेचना चाहता हूं');
      expect(result.detectedLanguage).toBe('hi-IN');
      expect(result.confidence).toBeGreaterThan(0.9);
      expect(result.jobId).toBeDefined();
    });

    it('should transcribe Marathi voice note successfully', async () => {
      const request: VoiceTranscriptionRequest = {
        audioUrl: 's3://test-bucket/audio/marathi-voice.mp3',
        languageCode: 'mr-IN',
        sellerId: 'seller-123',
      };

      transcribeMock.on(StartTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job-456',
          TranscriptionJobStatus: 'IN_PROGRESS',
        },
      });

      transcribeMock.on(GetTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job-456',
          TranscriptionJobStatus: 'COMPLETED',
          LanguageCode: 'mr-IN',
          Transcript: {
            TranscriptFileUri: 's3://test-bucket/transcripts/test-job-456.json',
          },
        },
      });

      const transcriptData = JSON.stringify({
        results: {
          transcripts: [
            {
              transcript: 'मला आंब्याचा लोणचा विकायचा आहे',
            },
          ],
          items: [
            { confidence: '0.93' },
            { confidence: '0.91' },
          ],
        },
      });

      const mockBody = {
        transformToString: jest.fn().mockResolvedValue(transcriptData),
      };

      s3Mock.on(GetObjectCommand).resolves({
        Body: mockBody as any,
      });

      transcribeMock.on(DeleteTranscriptionJobCommand).resolves({});

      const result = await handler(request);

      expect(result.success).toBe(true);
      expect(result.transcription).toBe('मला आंब्याचा लोणचा विकायचा आहे');
      expect(result.detectedLanguage).toBe('mr-IN');
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('should transcribe English voice note successfully', async () => {
      const request: VoiceTranscriptionRequest = {
        audioUrl: 's3://test-bucket/audio/english-voice.mp3',
        languageCode: 'en-IN',
      };

      transcribeMock.on(StartTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job-789',
          TranscriptionJobStatus: 'IN_PROGRESS',
        },
      });

      transcribeMock.on(GetTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job-789',
          TranscriptionJobStatus: 'COMPLETED',
          LanguageCode: 'en-IN',
          Transcript: {
            TranscriptFileUri: 's3://test-bucket/transcripts/test-job-789.json',
          },
        },
      });

      const transcriptData = JSON.stringify({
        results: {
          transcripts: [
            {
              transcript: 'I want to sell mango pickle for 200 rupees',
            },
          ],
          items: [
            { confidence: '0.97' },
            { confidence: '0.96' },
            { confidence: '0.98' },
          ],
        },
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockS3Body(transcriptData) as any,
      });

      transcribeMock.on(DeleteTranscriptionJobCommand).resolves({});

      const result = await handler(request);

      expect(result.success).toBe(true);
      expect(result.transcription).toBe('I want to sell mango pickle for 200 rupees');
      expect(result.detectedLanguage).toBe('en-IN');
      expect(result.confidence).toBeGreaterThan(0.95);
    });
  });

  describe('Automatic Language Detection', () => {
    it('should detect language automatically when not specified', async () => {
      const request: VoiceTranscriptionRequest = {
        audioUrl: 's3://test-bucket/audio/unknown-language.mp3',
        sellerId: 'seller-123',
      };

      transcribeMock.on(StartTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job-auto',
          TranscriptionJobStatus: 'IN_PROGRESS',
        },
      });

      transcribeMock.on(GetTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job-auto',
          TranscriptionJobStatus: 'COMPLETED',
          LanguageCode: 'hi-IN', // Detected as Hindi
          Transcript: {
            TranscriptFileUri: 's3://test-bucket/transcripts/test-job-auto.json',
          },
        },
      });

      const transcriptData = JSON.stringify({
        results: {
          transcripts: [
            {
              transcript: 'नमस्ते',
            },
          ],
          items: [
            { confidence: '0.94' },
          ],
        },
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockS3Body(transcriptData) as any,
      });

      transcribeMock.on(DeleteTranscriptionJobCommand).resolves({});

      const result = await handler(request);

      expect(result.success).toBe(true);
      expect(result.detectedLanguage).toBe('hi-IN');
      expect(result.transcription).toBe('नमस्ते');
    });

    it('should use IdentifyLanguage parameter when language not specified', async () => {
      const request: VoiceTranscriptionRequest = {
        audioUrl: 's3://test-bucket/audio/test.mp3',
      };

      transcribeMock.on(StartTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job',
          TranscriptionJobStatus: 'IN_PROGRESS',
        },
      });

      transcribeMock.on(GetTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job',
          TranscriptionJobStatus: 'COMPLETED',
          LanguageCode: 'mr-IN',
          Transcript: {
            TranscriptFileUri: 's3://test-bucket/transcripts/test-job.json',
          },
        },
      });

      const transcriptData = JSON.stringify({
        results: {
          transcripts: [{ transcript: 'test' }],
          items: [{ confidence: '0.9' }],
        },
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockS3Body(transcriptData) as any,
      });

      transcribeMock.on(DeleteTranscriptionJobCommand).resolves({});

      await handler(request);

      // Verify that StartTranscriptionJob was called with IdentifyLanguage
      const startJobCalls = transcribeMock.commandCalls(StartTranscriptionJobCommand);
      expect(startJobCalls.length).toBe(1);
      expect(startJobCalls[0].args[0].input.IdentifyLanguage).toBe(true);
      expect(startJobCalls[0].args[0].input.LanguageOptions).toEqual(['hi-IN', 'mr-IN', 'en-IN']);
    });
  });

  describe('Error Handling', () => {
    it('should handle transcription job failure', async () => {
      const request: VoiceTranscriptionRequest = {
        audioUrl: 's3://test-bucket/audio/bad-audio.mp3',
        languageCode: 'hi-IN',
      };

      transcribeMock.on(StartTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job-fail',
          TranscriptionJobStatus: 'IN_PROGRESS',
        },
      });

      transcribeMock.on(GetTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job-fail',
          TranscriptionJobStatus: 'FAILED',
          FailureReason: 'Audio quality too poor',
        },
      });

      const result = await handler(request);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Audio quality too poor');
    });

    it('should handle missing audio URL', async () => {
      const request: VoiceTranscriptionRequest = {
        audioUrl: '',
      };

      const result = await handler(request);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Audio URL is required');
    });

    it('should handle invalid S3 URL format', async () => {
      const request: VoiceTranscriptionRequest = {
        audioUrl: 'invalid-url',
      };

      const result = await handler(request);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Invalid S3 URL format');
    });

    it('should handle AWS service errors', async () => {
      const request: VoiceTranscriptionRequest = {
        audioUrl: 's3://test-bucket/audio/test.mp3',
        languageCode: 'hi-IN',
      };

      transcribeMock.on(StartTranscriptionJobCommand).rejects(
        new Error('Service unavailable')
      );

      const result = await handler(request);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Service unavailable');
    });

    it('should handle empty transcription result', async () => {
      const request: VoiceTranscriptionRequest = {
        audioUrl: 's3://test-bucket/audio/silent.mp3',
        languageCode: 'hi-IN',
      };

      transcribeMock.on(StartTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job-empty',
          TranscriptionJobStatus: 'IN_PROGRESS',
        },
      });

      transcribeMock.on(GetTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job-empty',
          TranscriptionJobStatus: 'COMPLETED',
          LanguageCode: 'hi-IN',
          Transcript: {
            TranscriptFileUri: 's3://test-bucket/transcripts/test-job-empty.json',
          },
        },
      });

      const transcriptData = JSON.stringify({
        results: {
          transcripts: [
            {
              transcript: '',
            },
          ],
          items: [],
        },
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockS3Body(transcriptData) as any,
      });

      transcribeMock.on(DeleteTranscriptionJobCommand).resolves({});

      const result = await handler(request);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('No transcription text found');
    });
  });

  describe('URL Parsing', () => {
    it('should parse s3:// URL format', async () => {
      const request: VoiceTranscriptionRequest = {
        audioUrl: 's3://my-bucket/path/to/audio.mp3',
        languageCode: 'hi-IN',
      };

      transcribeMock.on(StartTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job',
          TranscriptionJobStatus: 'IN_PROGRESS',
        },
      });

      transcribeMock.on(GetTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job',
          TranscriptionJobStatus: 'COMPLETED',
          LanguageCode: 'hi-IN',
          Transcript: {
            TranscriptFileUri: 's3://my-bucket/transcripts/test-job.json',
          },
        },
      });

      const transcriptData = JSON.stringify({
        results: {
          transcripts: [{ transcript: 'test' }],
          items: [{ confidence: '0.9' }],
        },
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockS3Body(transcriptData) as any,
      });

      transcribeMock.on(DeleteTranscriptionJobCommand).resolves({});

      const result = await handler(request);

      expect(result.success).toBe(true);
    });

    it('should parse HTTPS S3 URL format', async () => {
      const request: VoiceTranscriptionRequest = {
        audioUrl: 'https://my-bucket.s3.ap-south-1.amazonaws.com/audio/test.mp3',
        languageCode: 'hi-IN',
      };

      transcribeMock.on(StartTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job',
          TranscriptionJobStatus: 'IN_PROGRESS',
        },
      });

      transcribeMock.on(GetTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job',
          TranscriptionJobStatus: 'COMPLETED',
          LanguageCode: 'hi-IN',
          Transcript: {
            TranscriptFileUri: 's3://my-bucket/transcripts/test-job.json',
          },
        },
      });

      const transcriptData = JSON.stringify({
        results: {
          transcripts: [{ transcript: 'test' }],
          items: [{ confidence: '0.9' }],
        },
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockS3Body(transcriptData) as any,
      });

      transcribeMock.on(DeleteTranscriptionJobCommand).resolves({});

      const result = await handler(request);

      expect(result.success).toBe(true);
    });
  });

  describe('Media Format Detection', () => {
    it('should detect MP3 format', async () => {
      const request: VoiceTranscriptionRequest = {
        audioUrl: 's3://test-bucket/audio/voice.mp3',
        languageCode: 'hi-IN',
      };

      transcribeMock.on(StartTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job',
          TranscriptionJobStatus: 'IN_PROGRESS',
        },
      });

      transcribeMock.on(GetTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job',
          TranscriptionJobStatus: 'COMPLETED',
          LanguageCode: 'hi-IN',
          Transcript: {
            TranscriptFileUri: 's3://test-bucket/transcripts/test-job.json',
          },
        },
      });

      const transcriptData = JSON.stringify({
        results: {
          transcripts: [{ transcript: 'test' }],
          items: [{ confidence: '0.9' }],
        },
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockS3Body(transcriptData) as any,
      });

      transcribeMock.on(DeleteTranscriptionJobCommand).resolves({});

      await handler(request);

      const startJobCalls = transcribeMock.commandCalls(StartTranscriptionJobCommand);
      expect(startJobCalls[0].args[0].input.MediaFormat).toBe('mp3');
    });

    it('should detect WAV format', async () => {
      const request: VoiceTranscriptionRequest = {
        audioUrl: 's3://test-bucket/audio/voice.wav',
        languageCode: 'hi-IN',
      };

      transcribeMock.on(StartTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job',
          TranscriptionJobStatus: 'IN_PROGRESS',
        },
      });

      transcribeMock.on(GetTranscriptionJobCommand).resolves({
        TranscriptionJob: {
          TranscriptionJobName: 'test-job',
          TranscriptionJobStatus: 'COMPLETED',
          LanguageCode: 'hi-IN',
          Transcript: {
            TranscriptFileUri: 's3://test-bucket/transcripts/test-job.json',
          },
        },
      });

      const transcriptData = JSON.stringify({
        results: {
          transcripts: [{ transcript: 'test' }],
          items: [{ confidence: '0.9' }],
        },
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockS3Body(transcriptData) as any,
      });

      transcribeMock.on(DeleteTranscriptionJobCommand).resolves({});

      await handler(request);

      const startJobCalls = transcribeMock.commandCalls(StartTranscriptionJobCommand);
      expect(startJobCalls[0].args[0].input.MediaFormat).toBe('wav');
    });
  });
});
