/**
 * Property-Based Test: Voice Transcription Across Languages
 * 
 * **Validates: Requirements 2.1, 4.1, 9.1**
 * 
 * Property 4: Voice Transcription Across Languages
 * For any voice note in Hindi, Marathi, or English, the system should 
 * successfully transcribe it to text using Amazon Transcribe and correctly 
 * detect the source language.
 * 
 * This test verifies:
 * 1. Voice notes in Hindi (hi-IN) are successfully transcribed
 * 2. Voice notes in Marathi (mr-IN) are successfully transcribed
 * 3. Voice notes in English (en-IN) are successfully transcribed
 * 4. Language detection correctly identifies the source language
 * 5. Transcription confidence scores are within valid range (0.0 to 1.0)
 * 6. Transcription job completes successfully
 * 7. Automatic language detection works when language code is not provided
 */

import fc from 'fast-check';
import { handler as transcribeVoice } from '../../src/lambdas/voice-transcription';
import { mockClient } from 'aws-sdk-client-mock';
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  DeleteTranscriptionJobCommand,
  type TranscriptionJob,
} from '@aws-sdk/client-transcribe';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import {
  VoiceTranscriptionRequest,
  SupportedLanguage,
} from '../../src/models/voice';

const transcribeMock = mockClient(TranscribeClient);
const s3Mock = mockClient(S3Client);

// Mock environment variables
process.env.AWS_REGION = 'ap-south-1';

// Helper function to create mock S3 stream with transformToString method
function createMockS3Stream(data: any): any {
  const mockStream = Readable.from([JSON.stringify(data)]);
  (mockStream as any).transformToString = async () => JSON.stringify(data);
  return mockStream;
}

describe('Property 4: Voice Transcription Across Languages', () => {
  beforeEach(() => {
    transcribeMock.reset();
    s3Mock.reset();
    jest.clearAllMocks();
  });

  it('should successfully transcribe voice notes in all supported languages', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          language: fc.constantFrom<SupportedLanguage>('hi-IN', 'mr-IN', 'en-IN'),
          audioUrl: fc.constantFrom(
            's3://test-bucket/audio/voice-note-1.mp3',
            's3://test-bucket/audio/voice-note-2.ogg',
            'https://test-bucket.s3.ap-south-1.amazonaws.com/audio/voice-note-3.wav'
          ),
          messageId: fc.uuid(),
          sellerId: fc.uuid(),
          transcriptionText: fc.string({ minLength: 10, maxLength: 200 })
            .filter(s => s.trim().length >= 10),
          confidence: fc.integer({ min: 70, max: 99 }).map(c => c / 100),
        }),
        async ({ language, audioUrl, messageId, sellerId, transcriptionText, confidence }) => {
          // Reset mocks for each iteration
          transcribeMock.reset();
          s3Mock.reset();

          // Mock StartTranscriptionJob
          const jobName = `msg-${messageId}-${Date.now()}-abc123`;
          transcribeMock.on(StartTranscriptionJobCommand).resolves({
            TranscriptionJob: {
              TranscriptionJobName: jobName,
              TranscriptionJobStatus: 'IN_PROGRESS',
              LanguageCode: language,
            },
          });

          // Mock GetTranscriptionJob - first call returns IN_PROGRESS, second returns COMPLETED
          let getJobCallCount = 0;
          transcribeMock.on(GetTranscriptionJobCommand).callsFake(() => {
            getJobCallCount++;
            
            if (getJobCallCount === 1) {
              return Promise.resolve({
                TranscriptionJob: {
                  TranscriptionJobName: jobName,
                  TranscriptionJobStatus: 'IN_PROGRESS',
                  LanguageCode: language,
                },
              });
            } else {
              return Promise.resolve({
                TranscriptionJob: {
                  TranscriptionJobName: jobName,
                  TranscriptionJobStatus: 'COMPLETED',
                  LanguageCode: language,
                  Transcript: {
                    TranscriptFileUri: `s3://test-bucket/transcripts/${jobName}.json`,
                  },
                } as TranscriptionJob,
              });
            }
          });

          // Mock S3 GetObject for transcript download
          const mockTranscriptData = {
            jobName,
            accountId: '123456789012',
            results: {
              transcripts: [{ transcript: transcriptionText }],
              items: [
                {
                  start_time: '0.0',
                  end_time: '0.5',
                  alternatives: [
                    {
                      confidence: confidence.toString(),
                      content: transcriptionText.split(' ')[0] || 'word',
                    },
                  ],
                  type: 'pronunciation',
                  confidence: confidence.toString(),
                },
              ],
            },
            status: 'COMPLETED',
          };

          s3Mock.on(GetObjectCommand).resolves({
            Body: createMockS3Stream(mockTranscriptData),
          });

          // Mock DeleteTranscriptionJob
          transcribeMock.on(DeleteTranscriptionJobCommand).resolves({});

          // Execute transcription
          const request: VoiceTranscriptionRequest = {
            audioUrl,
            languageCode: language,
            messageId,
            sellerId,
          };

          const response = await transcribeVoice(request);

          // Verify transcription succeeded
          expect(response.success).toBe(true);
          expect(response.transcription).toBeDefined();
          expect(response.transcription).toBe(transcriptionText);

          // Verify language detection
          expect(response.detectedLanguage).toBe(language);

          // Verify confidence score is within valid range
          expect(response.confidence).toBeDefined();
          expect(response.confidence).toBeGreaterThanOrEqual(0.0);
          expect(response.confidence).toBeLessThanOrEqual(1.0);

          // Verify job ID is returned
          expect(response.jobId).toBeDefined();
          expect(response.jobId).toBe(jobName);

          // Verify no error
          expect(response.error).toBeUndefined();
        }
      ),
      { numRuns: 5 }
    );
  }, 120000); // 120 second timeout for property-based test

  it('should successfully use automatic language detection when language code is not provided', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          detectedLanguage: fc.constantFrom<SupportedLanguage>('hi-IN', 'mr-IN', 'en-IN'),
          audioUrl: fc.constantFrom(
            's3://test-bucket/audio/unknown-lang-1.mp3',
            's3://test-bucket/audio/unknown-lang-2.ogg'
          ),
          messageId: fc.uuid(),
          transcriptionText: fc.string({ minLength: 10, maxLength: 200 })
            .filter(s => s.trim().length >= 10),
          confidence: fc.integer({ min: 70, max: 99 }).map(c => c / 100),
        }),
        async ({ detectedLanguage, audioUrl, messageId, transcriptionText, confidence }) => {
          // Reset mocks for each iteration
          transcribeMock.reset();
          s3Mock.reset();

          const jobName = `msg-${messageId}-${Date.now()}-xyz789`;

          // Mock StartTranscriptionJob with IdentifyLanguage enabled
          transcribeMock.on(StartTranscriptionJobCommand).callsFake((input) => {
            // Verify automatic language detection parameters
            expect(input.IdentifyLanguage).toBe(true);
            expect(input.LanguageOptions).toBeDefined();
            expect(input.LanguageOptions).toContain('hi-IN');
            expect(input.LanguageOptions).toContain('mr-IN');
            expect(input.LanguageOptions).toContain('en-IN');

            return Promise.resolve({
              TranscriptionJob: {
                TranscriptionJobName: jobName,
                TranscriptionJobStatus: 'IN_PROGRESS',
              },
            });
          });

          // Mock GetTranscriptionJob
          let getJobCallCount = 0;
          transcribeMock.on(GetTranscriptionJobCommand).callsFake(() => {
            getJobCallCount++;
            
            if (getJobCallCount === 1) {
              return Promise.resolve({
                TranscriptionJob: {
                  TranscriptionJobName: jobName,
                  TranscriptionJobStatus: 'IN_PROGRESS',
                },
              });
            } else {
              return Promise.resolve({
                TranscriptionJob: {
                  TranscriptionJobName: jobName,
                  TranscriptionJobStatus: 'COMPLETED',
                  LanguageCode: detectedLanguage,
                  Transcript: {
                    TranscriptFileUri: `s3://test-bucket/transcripts/${jobName}.json`,
                  },
                } as TranscriptionJob,
              });
            }
          });

          // Mock transcript download
          const mockTranscriptData = {
            jobName,
            results: {
              transcripts: [{ transcript: transcriptionText }],
              items: [
                {
                  alternatives: [{ confidence: confidence.toString(), content: 'word' }],
                  type: 'pronunciation',
                  confidence: confidence.toString(),
                },
              ],
            },
            status: 'COMPLETED',
          };

          s3Mock.on(GetObjectCommand).resolves({
            Body: createMockS3Stream(mockTranscriptData),
          });

          transcribeMock.on(DeleteTranscriptionJobCommand).resolves({});

          // Execute transcription WITHOUT language code
          const request: VoiceTranscriptionRequest = {
            audioUrl,
            messageId,
          };

          const response = await transcribeVoice(request);

          // Verify transcription succeeded
          expect(response.success).toBe(true);
          expect(response.transcription).toBe(transcriptionText);

          // Verify language was automatically detected
          expect(response.detectedLanguage).toBe(detectedLanguage);
          expect(response.detectedLanguage).toMatch(/^(hi-IN|mr-IN|en-IN)$/);

          // Verify confidence score
          expect(response.confidence).toBeDefined();
          expect(response.confidence).toBeGreaterThanOrEqual(0.0);
          expect(response.confidence).toBeLessThanOrEqual(1.0);
        }
      ),
      { numRuns: 5 }
    );
  }, 120000); // 120 second timeout

  it('should handle different audio formats correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          language: fc.constantFrom<SupportedLanguage>('hi-IN', 'mr-IN', 'en-IN'),
          audioFormat: fc.constantFrom('mp3', 'mp4', 'wav', 'ogg', 'amr', 'webm', 'flac'),
          messageId: fc.uuid(),
          transcriptionText: fc.string({ minLength: 10, maxLength: 100 })
            .filter(s => s.trim().length >= 10),
          confidence: fc.integer({ min: 70, max: 99 }).map(c => c / 100),
        }),
        async ({ language, audioFormat, messageId, transcriptionText, confidence }) => {
          // Reset mocks for each iteration
          transcribeMock.reset();
          s3Mock.reset();

          const audioUrl = `s3://test-bucket/audio/voice-note.${audioFormat}`;
          const jobName = `msg-${messageId}-${Date.now()}-fmt`;

          // Mock Transcribe operations
          transcribeMock.on(StartTranscriptionJobCommand).callsFake((input) => {
            // Verify media format is correctly detected
            expect(input.MediaFormat).toBeDefined();
            
            return Promise.resolve({
              TranscriptionJob: {
                TranscriptionJobName: jobName,
                TranscriptionJobStatus: 'IN_PROGRESS',
                LanguageCode: language,
              },
            });
          });

          let getJobCallCount = 0;
          transcribeMock.on(GetTranscriptionJobCommand).callsFake(() => {
            getJobCallCount++;
            
            if (getJobCallCount === 1) {
              return Promise.resolve({
                TranscriptionJob: {
                  TranscriptionJobName: jobName,
                  TranscriptionJobStatus: 'IN_PROGRESS',
                  LanguageCode: language,
                },
              });
            } else {
              return Promise.resolve({
                TranscriptionJob: {
                  TranscriptionJobName: jobName,
                  TranscriptionJobStatus: 'COMPLETED',
                  LanguageCode: language,
                  Transcript: {
                    TranscriptFileUri: `s3://test-bucket/transcripts/${jobName}.json`,
                  },
                } as TranscriptionJob,
              });
            }
          });

          const mockTranscriptData = {
            jobName,
            results: {
              transcripts: [{ transcript: transcriptionText }],
              items: [
                {
                  alternatives: [{ confidence: confidence.toString(), content: 'word' }],
                  type: 'pronunciation',
                  confidence: confidence.toString(),
                },
              ],
            },
          };

          s3Mock.on(GetObjectCommand).resolves({
            Body: createMockS3Stream(mockTranscriptData),
          });

          transcribeMock.on(DeleteTranscriptionJobCommand).resolves({});

          // Execute transcription
          const request: VoiceTranscriptionRequest = {
            audioUrl,
            languageCode: language,
            messageId,
          };

          const response = await transcribeVoice(request);

          // Verify transcription succeeded for all audio formats
          expect(response.success).toBe(true);
          expect(response.transcription).toBe(transcriptionText);
          expect(response.detectedLanguage).toBe(language);
        }
      ),
      { numRuns: 5 }
    );
  }, 120000); // 120 second timeout

  it('should return error when transcription job fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          language: fc.constantFrom<SupportedLanguage>('hi-IN', 'mr-IN', 'en-IN'),
          audioUrl: fc.constantFrom('s3://test-bucket/audio/bad-audio.mp3'),
          messageId: fc.uuid(),
          failureReason: fc.constantFrom(
            'Audio quality too low',
            'Unsupported audio format',
            'Audio file corrupted',
            'No speech detected'
          ),
        }),
        async ({ language, audioUrl, messageId, failureReason }) => {
          // Reset mocks for each iteration
          transcribeMock.reset();
          s3Mock.reset();

          const jobName = `msg-${messageId}-${Date.now()}-fail`;

          // Mock StartTranscriptionJob
          transcribeMock.on(StartTranscriptionJobCommand).resolves({
            TranscriptionJob: {
              TranscriptionJobName: jobName,
              TranscriptionJobStatus: 'IN_PROGRESS',
              LanguageCode: language,
            },
          });

          // Mock GetTranscriptionJob - return FAILED status
          transcribeMock.on(GetTranscriptionJobCommand).resolves({
            TranscriptionJob: {
              TranscriptionJobName: jobName,
              TranscriptionJobStatus: 'FAILED',
              LanguageCode: language,
              FailureReason: failureReason,
            } as TranscriptionJob,
          });

          transcribeMock.on(DeleteTranscriptionJobCommand).resolves({});

          // Execute transcription
          const request: VoiceTranscriptionRequest = {
            audioUrl,
            languageCode: language,
            messageId,
          };

          const response = await transcribeVoice(request);

          // Verify transcription failed
          expect(response.success).toBe(false);
          expect(response.error).toBeDefined();
          expect(response.error?.message).toContain('failed');
          expect(response.transcription).toBeUndefined();
        }
      ),
      { numRuns: 5 }
    );
  }, 120000); // 120 second timeout

  it('should return error when audio URL is invalid', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          invalidUrl: fc.constantFrom(
            '',
            'not-a-url',
            'http://invalid-protocol.com/audio.mp3',
            'ftp://invalid-protocol.com/audio.mp3'
          ),
          messageId: fc.uuid(),
        }),
        async ({ invalidUrl, messageId }) => {
          // Execute transcription with invalid URL
          const request: VoiceTranscriptionRequest = {
            audioUrl: invalidUrl,
            messageId,
          };

          const response = await transcribeVoice(request);

          // Verify transcription failed
          expect(response.success).toBe(false);
          expect(response.error).toBeDefined();
          expect(response.transcription).toBeUndefined();
        }
      ),
      { numRuns: 5 }
    );
  }, 120000); // 120 second timeout
});
