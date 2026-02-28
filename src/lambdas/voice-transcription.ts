/**
 * Voice Transcription Lambda
 * 
 * This Lambda function transcribes voice notes using Amazon Transcribe.
 * It supports Hindi (hi-IN), Marathi (mr-IN), and English (en-IN) languages
 * with automatic language detection.
 * 
 * Features:
 * - Downloads audio file from S3
 * - Calls Amazon Transcribe StartTranscriptionJob API
 * - Supports automatic language detection
 * - Polls for transcription job completion
 * - Parses transcription result and extracts text
 * - Returns transcribed text with detected language and confidence
 * 
 * Validates: Requirements 2.1, 4.1, 9.1
 */

import {
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  DeleteTranscriptionJobCommand,
  type StartTranscriptionJobCommandInput,
  type GetTranscriptionJobCommandInput,
  TranscriptionJob,
  LanguageCode,
} from '@aws-sdk/client-transcribe';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { transcribeClient, s3Client } from '../config/aws-clients';
import {
  VoiceTranscriptionRequest,
  VoiceTranscriptionResponse,
  SupportedLanguage,
} from '../models/voice';

/**
 * Supported language codes for Amazon Transcribe
 */
const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['hi-IN', 'mr-IN', 'en-IN'];

/**
 * Maximum polling attempts for transcription job completion
 */
const MAX_POLLING_ATTEMPTS = 60; // 60 attempts * 2 seconds = 2 minutes max

/**
 * Polling interval in milliseconds
 */
const POLLING_INTERVAL_MS = 2000; // 2 seconds

/**
 * Lambda handler for voice transcription
 */
export const handler = async (
  event: VoiceTranscriptionRequest
): Promise<VoiceTranscriptionResponse> => {
  console.log('Voice transcription request:', JSON.stringify(event, null, 2));

  try {
    // Validate audio URL
    if (!event.audioUrl) {
      throw new Error('Audio URL is required');
    }

    // Parse S3 location from audio URL
    const s3Location = parseS3Url(event.audioUrl);
    console.log('S3 location:', s3Location);

    // Generate unique job name
    const jobName = generateJobName(event.messageId);
    console.log('Starting transcription job:', jobName);

    // Start transcription job
    const jobId = await startTranscriptionJob(
      jobName,
      s3Location,
      event.languageCode
    );

    // Poll for job completion
    const transcriptionResult = await pollTranscriptionJob(jobName);

    // Parse and extract transcription text
    const { text, confidence, detectedLanguage } = await parseTranscriptionResult(
      transcriptionResult
    );

    // Clean up: delete the transcription job
    await deleteTranscriptionJob(jobName);

    console.log('Transcription successful:', {
      text: text.substring(0, 100),
      detectedLanguage,
      confidence,
    });

    return {
      success: true,
      transcription: text,
      detectedLanguage,
      confidence,
      jobId,
    };
  } catch (error: any) {
    console.error('Voice transcription failed:', error);

    return {
      success: false,
      error: {
        code: error.name || 'TRANSCRIPTION_ERROR',
        message: error.message || 'Failed to transcribe audio',
      },
    };
  }
};

/**
 * Parse S3 URL to extract bucket and key
 */
function parseS3Url(url: string): { bucket: string; key: string } {
  // Handle s3:// URLs
  if (url.startsWith('s3://')) {
    const parts = url.replace('s3://', '').split('/');
    return {
      bucket: parts[0],
      key: parts.slice(1).join('/'),
    };
  }

  // Handle https://s3.region.amazonaws.com/bucket/key URLs (Amazon Transcribe format)
  if (url.includes('s3.') && url.includes('.amazonaws.com/') && !url.match(/^https:\/\/[^.]+\.s3\./)) {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.substring(1).split('/'); // Remove leading / and split
    const bucket = pathParts[0];
    const key = pathParts.slice(1).join('/');
    return { bucket, key };
  }

  // Handle https://bucket.s3.region.amazonaws.com/key URLs
  if (url.includes('.s3.') && url.includes('.amazonaws.com/')) {
    const urlObj = new URL(url);
    const bucket = urlObj.hostname.split('.')[0];
    const key = urlObj.pathname.substring(1); // Remove leading /
    return { bucket, key };
  }

  // Handle pre-signed URLs
  if (url.includes('X-Amz-Signature')) {
    const urlObj = new URL(url);
    const bucket = urlObj.hostname.split('.')[0];
    const key = urlObj.pathname.substring(1);
    return { bucket, key };
  }

  throw new Error(`Invalid S3 URL format: ${url}`);
}

/**
 * Generate unique job name for transcription
 */
function generateJobName(messageId?: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const prefix = messageId ? `msg-${messageId}` : 'voice';
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Start Amazon Transcribe job
 */
async function startTranscriptionJob(
  jobName: string,
  s3Location: { bucket: string; key: string },
  languageCode?: SupportedLanguage
): Promise<string> {
  const params: StartTranscriptionJobCommandInput = {
    TranscriptionJobName: jobName,
    Media: {
      MediaFileUri: `s3://${s3Location.bucket}/${s3Location.key}`,
    },
    MediaFormat: detectMediaFormat(s3Location.key),
    OutputBucketName: s3Location.bucket, // Store output in same bucket
  };

  // If language code is provided, use it; otherwise enable automatic language detection
  if (languageCode) {
    params.LanguageCode = languageCode as LanguageCode;
  } else {
    // Enable automatic language identification
    params.IdentifyLanguage = true;
    params.LanguageOptions = SUPPORTED_LANGUAGES as LanguageCode[];
  }

  // Enable improved transcription settings for better accuracy
  params.Settings = {
    ShowSpeakerLabels: false, // Disable speaker labels since we don't need them
    ChannelIdentification: false,
    ShowAlternatives: false,
    // Enable vocabulary filtering for better Hindi/Marathi transcription
    VocabularyFilterMethod: 'remove' as any,
  };

  console.log('Starting transcription job with params:', JSON.stringify(params, null, 2));

  const command = new StartTranscriptionJobCommand(params);
  const response = await transcribeClient.send(command);

  if (!response.TranscriptionJob?.TranscriptionJobName) {
    throw new Error('Failed to start transcription job');
  }

  return response.TranscriptionJob.TranscriptionJobName;
}

/**
 * Detect media format from file extension
 */
function detectMediaFormat(key: string): 'mp3' | 'mp4' | 'wav' | 'flac' | 'ogg' | 'amr' | 'webm' {
  const extension = key.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'mp3':
      return 'mp3';
    case 'mp4':
    case 'm4a':
      return 'mp4';
    case 'wav':
      return 'wav';
    case 'flac':
      return 'flac';
    case 'ogg':
      return 'ogg';
    case 'amr':
      return 'amr';
    case 'webm':
      return 'webm';
    default:
      // Default to mp3 for WhatsApp audio
      return 'mp3';
  }
}

/**
 * Poll for transcription job completion
 */
async function pollTranscriptionJob(jobName: string): Promise<TranscriptionJob> {
  let attempts = 0;

  while (attempts < MAX_POLLING_ATTEMPTS) {
    const params: GetTranscriptionJobCommandInput = {
      TranscriptionJobName: jobName,
    };

    const command = new GetTranscriptionJobCommand(params);
    const response = await transcribeClient.send(command);

    const job = response.TranscriptionJob;
    const status = job?.TranscriptionJobStatus;

    console.log(`Transcription job status (attempt ${attempts + 1}):`, status);

    if (status === 'COMPLETED') {
      if (!job) {
        throw new Error('Transcription job data is missing');
      }
      return job;
    }

    if (status === 'FAILED') {
      const failureReason = job?.FailureReason || 'Unknown error';
      throw new Error(`Transcription job failed: ${failureReason}`);
    }

    // Wait before next poll
    await sleep(POLLING_INTERVAL_MS);
    attempts++;
  }

  throw new Error(`Transcription job timed out after ${MAX_POLLING_ATTEMPTS} attempts`);
}

/**
 * Parse transcription result and extract text
 */
async function parseTranscriptionResult(
  job: TranscriptionJob
): Promise<{ text: string; confidence: number; detectedLanguage?: SupportedLanguage }> {
  if (!job.Transcript?.TranscriptFileUri) {
    throw new Error('Transcription result URI not found');
  }

  // Download transcription result from S3
  const transcriptUri = job.Transcript.TranscriptFileUri;
  console.log('Downloading transcript from:', transcriptUri);

  const transcriptData = await downloadTranscript(transcriptUri);

  // Parse JSON transcript
  const transcript = JSON.parse(transcriptData);

  // Extract text from results
  const text = transcript.results?.transcripts?.[0]?.transcript || '';

  if (!text) {
    throw new Error('No transcription text found in result');
  }

  // Calculate average confidence from items
  const items = transcript.results?.items || [];
  const confidences = items
    .filter((item: any) => item.confidence !== undefined)
    .map((item: any) => parseFloat(item.confidence));

  const avgConfidence =
    confidences.length > 0
      ? confidences.reduce((sum: number, conf: number) => sum + conf, 0) / confidences.length
      : 0.0;

  // Extract detected language if automatic detection was used
  const detectedLanguage = job.LanguageCode as SupportedLanguage | undefined;

  return {
    text: text,
    confidence: avgConfidence,
    detectedLanguage,
  };
}

/**
 * Download transcript file from S3
 */
async function downloadTranscript(uri: string): Promise<string> {
  const s3Location = parseS3Url(uri);

  const command = new GetObjectCommand({
    Bucket: s3Location.bucket,
    Key: s3Location.key,
  });

  const response = await s3Client.send(command);

  if (!response.Body) {
    throw new Error('Empty transcript file');
  }

  // Convert stream to string
  const bodyContents = await response.Body.transformToString();
  return bodyContents;
}

/**
 * Delete transcription job to clean up resources
 */
async function deleteTranscriptionJob(jobName: string): Promise<void> {
  try {
    const command = new DeleteTranscriptionJobCommand({
      TranscriptionJobName: jobName,
    });
    await transcribeClient.send(command);
    console.log('Transcription job deleted:', jobName);
  } catch (error) {
    // Log but don't fail if cleanup fails
    console.warn('Failed to delete transcription job:', error);
  }
}

/**
 * Sleep utility function
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
