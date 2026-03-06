
export type SupportedLanguage = 'hi-IN' | 'mr-IN' | 'en-IN';

export interface VoiceTranscriptionRequest {

  audioUrl: string;

  languageCode?: SupportedLanguage;

  sellerId?: string;

  messageId?: string;
}

export interface VoiceTranscriptionResponse {

  success: boolean;

  transcription?: string;

  detectedLanguage?: SupportedLanguage;

  confidence?: number;

  jobId?: string;

  error?: {
    code: string;
    message: string;
  };
}

type TranscriptionJobStatus = 
  | 'QUEUED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED';

interface TranscriptionJobState {
  jobId: string;
  status: TranscriptionJobStatus;
  audioUrl: string;
  languageCode?: SupportedLanguage;
  startTime: number;
  endTime?: number;
}
