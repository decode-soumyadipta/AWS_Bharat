/**
 * Property-Based Test: Voice Latency Preservation
 * 
 * **Validates: Requirements 3.1**
 * 
 * Property 2: Preservation - Voice Transcription Accuracy Unchanged
 * 
 * For any voice message input where the bug condition does NOT hold (already fast responses < 3 seconds),
 * the fixed voice-handler SHALL produce the same transcription accuracy as the original function,
 * preserving voice processing quality.
 * 
 * This test verifies that after parallelizing Lambda invocations to fix latency issues,
 * the transcription accuracy for voice messages remains unchanged. This is a preservation
 * property that ensures the optimization doesn't break existing functionality.
 * 
 * IMPORTANT: This test runs on UNFIXED code to establish the baseline behavior.
 * After fixes are applied, this same test should still pass, confirming no regressions
 * in transcription accuracy.
 * 
 * Test Strategy:
 * - Test the voice-transcription Lambda directly (not the full voice-handler pipeline)
 * - Generate voice messages with varying characteristics (length, language, content)
 * - Verify transcription accuracy is maintained
 * - Verify detected language is correct
 * - Verify confidence scores are within valid range
 * - Focus on messages that already respond quickly (< 3 seconds)
 */

import fc from 'fast-check';
import { mockClient } from 'aws-sdk-client-mock';
import { TranscribeClient, StartTranscriptionJobCommand, GetTranscriptionJobCommand, DeleteTranscriptionJobCommand } from '@aws-sdk/client-transcribe';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { handler as transcribeVoice } from '../../src/lambdas/voice-transcription';

// Mock AWS clients
const transcribeMock = mockClient(TranscribeClient);
const s3Mock = mockClient(S3Client);

// Mock environment variables
process.env.AWS_REGION = 'ap-south-1';

// Helper function to create mock S3 stream
function createMockS3Stream(data: any): any {
  const mockStream = Readable.from([JSON.stringify(data)]);
  (mockStream as any).transformToString = async () => JSON.stringify(data);
  return mockStream;
}

describe('Property 2: Preservation - Voice Transcription Accuracy Unchanged', () => {
  beforeEach(() => {
    transcribeMock.reset();
    s3Mock.reset();
    jest.clearAllMocks();
  });

  it('should preserve transcription accuracy for voice messages across all supported languages', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          audioUrl: fc.constantFrom(
            's3://test-bucket/audio/voice-note-1.mp3',
            's3://test-bucket/audio/voice-note-2.ogg'
          ),
          messageId: fc.uuid(),
          language: fc.constantFrom<'hi-IN' | 'mr-IN' | 'en-IN'>('hi-IN', 'mr-IN', 'en-IN'),
          transcriptionText: fc.string({ minLength: 10, maxLength: 100 })
            .filter(s => s.trim().length >= 10),
          confidence: fc.integer({ min: 70, max: 99 }).map(c => c / 100),
        }),
        async ({ audioUrl, messageId, language, transcriptionText, confidence }) => {
          // Reset mocks for each iteration
          transcribeMock.reset();
          s3Mock.reset();

          const jobName = `msg-${messageId}-${Date.now()}`;

          // Mock transcription job
          transcribeMock.on(StartTranscriptionJobCommand).resolves({
            TranscriptionJob: {
              TranscriptionJobName: jobName,
              TranscriptionJobStatus: 'IN_PROGRESS',
              LanguageCode: language,
            },
          });

          let callCount = 0;
          transcribeMock.on(GetTranscriptionJobCommand).callsFake(() => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve({
                TranscriptionJob: {
                  TranscriptionJobName: jobName,
                  TranscriptionJobStatus: 'IN_PROGRESS',
                },
              });
            }
            return Promise.resolve({
              TranscriptionJob: {
                TranscriptionJobName: jobName,
                TranscriptionJobStatus: 'COMPLETED',
                LanguageCode: language,
                Transcript: {
                  TranscriptFileUri: `s3://test-bucket/transcripts/${jobName}.json`,
                },
              },
            });
          });

          s3Mock.on(GetObjectCommand).resolves({
            Body: createMockS3Stream({
              results: {
                transcripts: [{ transcript: transcriptionText }],
                items: [{
                  alternatives: [{ confidence: confidence.toString(), content: 'word' }],
                  type: 'pronunciation',
                  confidence: confidence.toString(),
                }],
              },
            }),
          });

          transcribeMock.on(DeleteTranscriptionJobCommand).resolves({});

          // Execute transcription
          const response = await transcribeVoice({
            audioUrl,
            languageCode: language,
            messageId,
          });

          // Preservation Property: Transcription accuracy is maintained
          expect(response.success).toBe(true);
          expect(response.transcription).toBe(transcriptionText);
          expect(response.detectedLanguage).toBe(language);
          expect(response.confidence).toBeGreaterThanOrEqual(0.0);
          expect(response.confidence).toBeLessThanOrEqual(1.0);
        }
      ),
      { numRuns: 3 }
    );
  }, 60000);

  it('should preserve transcription quality for short voice messages (fast responses)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          audioUrl: fc.constantFrom(
            's3://test-bucket/audio/short-1.mp3',
            's3://test-bucket/audio/short-2.ogg'
          ),
          messageId: fc.uuid(),
          language: fc.constantFrom<'hi-IN' | 'mr-IN' | 'en-IN'>('hi-IN', 'mr-IN', 'en-IN'),
          // Short transcription (5-15 words) - these typically respond quickly
          transcriptionText: fc.array(
            fc.string({ minLength: 3, maxLength: 10 }),
            { minLength: 5, maxLength: 15 }
          ).map(words => words.join(' ')),
          confidence: fc.integer({ min: 80, max: 99 }).map(c => c / 100),
        }),
        async ({ audioUrl, messageId, language, transcriptionText, confidence }) => {
          // Reset mocks
          transcribeMock.reset();
          s3Mock.reset();

          const jobName = `msg-${messageId}-${Date.now()}`;

          // Mock transcription job
          transcribeMock.on(StartTranscriptionJobCommand).resolves({
            TranscriptionJob: {
              TranscriptionJobName: jobName,
              TranscriptionJobStatus: 'IN_PROGRESS',
              LanguageCode: language,
            },
          });

          let callCount = 0;
          transcribeMock.on(GetTranscriptionJobCommand).callsFake(() => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve({
                TranscriptionJob: {
                  TranscriptionJobName: jobName,
                  TranscriptionJobStatus: 'IN_PROGRESS',
                },
              });
            }
            return Promise.resolve({
              TranscriptionJob: {
                TranscriptionJobName: jobName,
                TranscriptionJobStatus: 'COMPLETED',
                LanguageCode: language,
                Transcript: {
                  TranscriptFileUri: `s3://test-bucket/transcripts/${jobName}.json`,
                },
              },
            });
          });

          s3Mock.on(GetObjectCommand).resolves({
            Body: createMockS3Stream({
              results: {
                transcripts: [{ transcript: transcriptionText }],
                items: [{
                  alternatives: [{ confidence: confidence.toString(), content: 'word' }],
                  type: 'pronunciation',
                  confidence: confidence.toString(),
                }],
              },
            }),
          });

          transcribeMock.on(DeleteTranscriptionJobCommand).resolves({});

          // Execute transcription
          const response = await transcribeVoice({
            audioUrl,
            languageCode: language,
            messageId,
          });

          // Preservation Property: Short messages maintain transcription quality
          expect(response.success).toBe(true);
          expect(response.transcription).toBe(transcriptionText);
          expect(response.detectedLanguage).toBe(language);
          
          // Preservation Property: Confidence is maintained for short messages
          expect(response.confidence).toBeGreaterThanOrEqual(0.7);
          expect(response.confidence).toBeLessThanOrEqual(1.0);
        }
      ),
      { numRuns: 3 }
    );
  }, 60000);

  it('should preserve language detection accuracy', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          audioUrl: fc.constant('s3://test-bucket/audio/multilang.mp3'),
          messageId: fc.uuid(),
          detectedLanguage: fc.constantFrom<'hi-IN' | 'mr-IN' | 'en-IN'>('hi-IN', 'mr-IN', 'en-IN'),
          transcriptionText: fc.string({ minLength: 10, maxLength: 100 })
            .filter(s => s.trim().length >= 10),
          confidence: fc.integer({ min: 70, max: 99 }).map(c => c / 100),
        }),
        async ({ audioUrl, messageId, detectedLanguage, transcriptionText, confidence }) => {
          // Reset mocks
          transcribeMock.reset();
          s3Mock.reset();

          const jobName = `msg-${messageId}-${Date.now()}`;

          // Mock automatic language detection
          transcribeMock.on(StartTranscriptionJobCommand).resolves({
            TranscriptionJob: {
              TranscriptionJobName: jobName,
              TranscriptionJobStatus: 'IN_PROGRESS',
            },
          });

          let callCount = 0;
          transcribeMock.on(GetTranscriptionJobCommand).callsFake(() => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve({
                TranscriptionJob: {
                  TranscriptionJobName: jobName,
                  TranscriptionJobStatus: 'IN_PROGRESS',
                },
              });
            }
            return Promise.resolve({
              TranscriptionJob: {
                TranscriptionJobName: jobName,
                TranscriptionJobStatus: 'COMPLETED',
                LanguageCode: detectedLanguage,
                Transcript: {
                  TranscriptFileUri: `s3://test-bucket/transcripts/${jobName}.json`,
                },
              },
            });
          });

          s3Mock.on(GetObjectCommand).resolves({
            Body: createMockS3Stream({
              results: {
                transcripts: [{ transcript: transcriptionText }],
                items: [{
                  alternatives: [{ confidence: confidence.toString(), content: 'word' }],
                  type: 'pronunciation',
                  confidence: confidence.toString(),
                }],
              },
            }),
          });

          transcribeMock.on(DeleteTranscriptionJobCommand).resolves({});

          // Execute transcription WITHOUT language code (automatic detection)
          const response = await transcribeVoice({
            audioUrl,
            messageId,
          });

          // Preservation Property: Language detection is preserved
          expect(response.success).toBe(true);
          expect(response.detectedLanguage).toBe(detectedLanguage);
          expect(response.transcription).toBe(transcriptionText);
        }
      ),
      { numRuns: 3 }
    );
  }, 60000);
});
