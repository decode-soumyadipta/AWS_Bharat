
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

const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['hi-IN', 'mr-IN', 'en-IN'];

const MAX_POLLING_ATTEMPTS = 60; 

const POLLING_INTERVAL_MS = 1000; 

export const handler = async (
  event: VoiceTranscriptionRequest
): Promise<VoiceTranscriptionResponse> => {
  console.log('Voice transcription request:', JSON.stringify(event, null, 2));

  let jobName = '';
  try {

    if (!event.audioUrl) {
      throw new Error('Audio URL is required');
    }

    const s3Location = parseS3Url(event.audioUrl);
    console.log('S3 location:', s3Location);

    jobName = generateJobName(event.messageId);
    console.log('Starting transcription job:', jobName);

    const jobId = await startTranscriptionJob(
      jobName,
      s3Location,
      event.languageCode
    );

    const transcriptionResult = await pollTranscriptionJob(jobName);

    const { text, confidence, detectedLanguage } = await parseTranscriptionResult(
      transcriptionResult
    );

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

    if (jobName) {
      await cleanupTranscriptionJob(jobName);
    }

    return {
      success: false,
      error: {
        code: error.name || 'TRANSCRIPTION_ERROR',
        message: error.message || 'Failed to transcribe audio',
      },
    };
  }
};

function parseS3Url(url: string): { bucket: string; key: string } {

  if (url.startsWith('s3://')) {
    const parts = url.replace('s3://', '').split('/');
    return {
      bucket: parts[0],
      key: parts.slice(1).join('/'),
    };
  }

  if (url.includes('s3.') && url.includes('.amazonaws.com/') && !url.match(/^https:\/\/[^.]+\.s3\./)) {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.substring(1).split('/'); 
    const bucket = pathParts[0];
    const key = pathParts.slice(1).join('/');
    return { bucket, key };
  }

  if (url.includes('.s3.') && url.includes('.amazonaws.com/')) {
    const urlObj = new URL(url);
    const bucket = urlObj.hostname.split('.')[0];
    const key = urlObj.pathname.substring(1); 
    return { bucket, key };
  }

  if (url.includes('X-Amz-Signature')) {
    const urlObj = new URL(url);
    const bucket = urlObj.hostname.split('.')[0];
    const key = urlObj.pathname.substring(1);
    return { bucket, key };
  }

  throw new Error(`Invalid S3 URL format: ${url}`);
}

function generateJobName(messageId?: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const prefix = messageId ? `msg-${messageId}` : 'voice';
  return `${prefix}-${timestamp}-${random}`;
}

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
    OutputBucketName: s3Location.bucket, 
  };

  if (languageCode) {
    params.LanguageCode = languageCode as LanguageCode;
  } else {

    params.IdentifyLanguage = true;
    params.LanguageOptions = SUPPORTED_LANGUAGES as LanguageCode[];
  }

  params.Settings = {
    ShowSpeakerLabels: false, 
    ChannelIdentification: false,
    ShowAlternatives: false,
  };

  console.log('Starting transcription job with params:', JSON.stringify(params, null, 2));

  const command = new StartTranscriptionJobCommand(params);
  const response = await transcribeClient.send(command);

  if (!response.TranscriptionJob?.TranscriptionJobName) {
    throw new Error('Failed to start transcription job');
  }

  return response.TranscriptionJob.TranscriptionJobName;
}

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

      return 'mp3';
  }
}

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

    await sleep(POLLING_INTERVAL_MS);
    attempts++;
  }

  throw new Error(`Transcription job timed out after ${MAX_POLLING_ATTEMPTS} attempts`);
}

async function cleanupTranscriptionJob(jobName: string): Promise<void> {
  try {
    await deleteTranscriptionJob(jobName);
  } catch {
    // ignore cleanup errors
  }
}

async function parseTranscriptionResult(
  job: TranscriptionJob
): Promise<{ text: string; confidence: number; detectedLanguage?: SupportedLanguage }> {
  if (!job.Transcript?.TranscriptFileUri) {
    throw new Error('Transcription result URI not found');
  }

  const transcriptUri = job.Transcript.TranscriptFileUri;
  console.log('Downloading transcript from:', transcriptUri);

  const transcriptData = await downloadTranscript(transcriptUri);

  const transcript = JSON.parse(transcriptData);

  const text = transcript.results?.transcripts?.[0]?.transcript || '';

  if (!text) {
    throw new Error('No transcription text found in result');
  }

  const items = transcript.results?.items || [];
  const confidences = items
    .filter((item: any) => item.confidence !== undefined)
    .map((item: any) => parseFloat(item.confidence));

  const avgConfidence =
    confidences.length > 0
      ? confidences.reduce((sum: number, conf: number) => sum + conf, 0) / confidences.length
      : 0.0;

  const detectedLanguage = job.LanguageCode as SupportedLanguage | undefined;

  return {
    text: text,
    confidence: avgConfidence,
    detectedLanguage,
  };
}

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

  const bodyContents = await response.Body.transformToString();
  return bodyContents;
}

async function deleteTranscriptionJob(jobName: string): Promise<void> {
  try {
    const command = new DeleteTranscriptionJobCommand({
      TranscriptionJobName: jobName,
    });
    await transcribeClient.send(command);
    console.log('Transcription job deleted:', jobName);
  } catch (error) {

    console.warn('Failed to delete transcription job:', error);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
