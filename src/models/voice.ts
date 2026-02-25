/**
 * Voice Transcription Models
 * 
 * Type definitions for voice transcription requests and responses.
 * Supports Hindi (hi-IN), Marathi (mr-IN), and English (en-IN) languages.
 */

/**
 * Supported languages for voice transcription
 */
export type SupportedLanguage = 'hi-IN' | 'mr-IN' | 'en-IN';

/**
 * Voice transcription request
 */
export interface VoiceTranscriptionRequest {
  /**
   * S3 URL of the audio file to transcribe
   */
  audioUrl: string;
  
  /**
   * Optional language code hint
   * If not provided, automatic language detection will be used
   */
  languageCode?: SupportedLanguage;
  
  /**
   * Seller ID for tracking purposes
   */
  sellerId?: string;
  
  /**
   * Message ID for correlation
   */
  messageId?: string;
}

/**
 * Voice transcription response
 */
export interface VoiceTranscriptionResponse {
  /**
   * Whether transcription was successful
   */
  success: boolean;
  
  /**
   * Transcribed text (if successful)
   */
  transcription?: string;
  
  /**
   * Detected language code
   */
  detectedLanguage?: SupportedLanguage;
  
  /**
   * Confidence score for the transcription (0.0 to 1.0)
   */
  confidence?: number;
  
  /**
   * Transcription job ID for tracking
   */
  jobId?: string;
  
  /**
   * Error information (if failed)
   */
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Transcription job status
 */
export type TranscriptionJobStatus = 
  | 'QUEUED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED';

/**
 * Internal transcription job state
 */
export interface TranscriptionJobState {
  jobId: string;
  status: TranscriptionJobStatus;
  audioUrl: string;
  languageCode?: SupportedLanguage;
  startTime: number;
  endTime?: number;
}
