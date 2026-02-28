/**
 * Missing Info Handler Service
 * 
 * Handles detection of missing required fields and generates voice prompts
 * to request missing information from users in their preferred language.
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import { 
  PollyClient, 
  SynthesizeSpeechCommand, 
  type SynthesizeSpeechCommandInput,
  VoiceId,
  Engine,
  OutputFormat,
  LanguageCode
} from '@aws-sdk/client-polly';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, PRODUCTS_BUCKET_NAME } from '../config/aws-clients';
import { generateMissingFieldsPrompt, type SupportedLanguage } from './language-manager';
import { updateUserState } from './state-manager';
import type { PartialCatalogItem } from './partial-data-store';

// Initialize Polly client
const AWS_REGION = process.env.AWS_REGION || 'ap-south-1';
const pollyClient = new PollyClient({ region: AWS_REGION });

/**
 * Voice IDs for each supported language (neural voices)
 */
const VOICE_IDS: Record<SupportedLanguage, VoiceId> = {
  'hi-IN': (process.env.POLLY_VOICE_ID_HINDI || 'Kajal') as VoiceId,
  'mr-IN': (process.env.POLLY_VOICE_ID_MARATHI || 'Aditi') as VoiceId,
  'en-IN': (process.env.POLLY_VOICE_ID_ENGLISH || 'Joanna') as VoiceId,
};

/**
 * Required fields for a complete catalog item
 */
const REQUIRED_FIELDS = ['productName', 'price', 'quantity', 'unit'] as const;

export interface MissingFieldsResult {
  missingFields: string[];
  isComplete: boolean;
}

export interface VoicePromptResult {
  success: boolean;
  audioUrl?: string;
  error?: string;
}

/**
 * Validate required fields and identify missing ones
 * 
 * @param data - Partial catalog item data
 * @returns Missing fields result
 */
export function validateRequiredFields(
  data: Partial<PartialCatalogItem>
): MissingFieldsResult {
  const missingFields = REQUIRED_FIELDS.filter(
    field => !data[field as keyof PartialCatalogItem]
  );

  return {
    missingFields,
    isComplete: missingFields.length === 0,
  };
}

/**
 * Convert text to speech using Amazon Polly
 * 
 * @param text - Text to convert to speech
 * @param language - User's language preference
 * @returns Audio stream from Polly
 */
async function convertTextToSpeech(
  text: string,
  language: SupportedLanguage
): Promise<Buffer> {
  const voiceId = VOICE_IDS[language];

  const params: SynthesizeSpeechCommandInput = {
    Text: text,
    OutputFormat: OutputFormat.MP3,
    VoiceId: voiceId,
    Engine: Engine.NEURAL, // Use neural engine for better quality
    LanguageCode: language as LanguageCode,
  };

  const command = new SynthesizeSpeechCommand(params);
  const response = await pollyClient.send(command);

  if (!response.AudioStream) {
    throw new Error('No audio stream received from Polly');
  }

  // Convert stream to buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.AudioStream as any) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

/**
 * Upload audio to S3
 * 
 * @param audioBuffer - Audio data buffer
 * @param phone - User phone number
 * @returns S3 URL of uploaded audio
 */
async function uploadAudioToS3(
  audioBuffer: Buffer,
  phone: string
): Promise<string> {
  const timestamp = Date.now();
  const key = `voice-prompts/${phone}/${timestamp}.mp3`;

  const command = new PutObjectCommand({
    Bucket: PRODUCTS_BUCKET_NAME,
    Key: key,
    Body: audioBuffer,
    ContentType: 'audio/mpeg',
  });

  await s3Client.send(command);

  // Return S3 URL
  return `https://${PRODUCTS_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${key}`;
}

/**
 * Generate and send voice prompt for missing information
 * 
 * @param phone - User phone number
 * @param missingFields - Array of missing field names
 * @param language - User's language preference
 * @returns Voice prompt result with audio URL
 */
export async function generateAndSendVoicePrompt(
  phone: string,
  missingFields: string[],
  language?: SupportedLanguage
): Promise<VoicePromptResult> {
  try {
    // Generate natural language prompt
    const promptText = generateMissingFieldsPrompt(missingFields, language);

    if (!promptText) {
      return {
        success: false,
        error: 'Failed to generate prompt text',
      };
    }

    // Convert to speech
    const audioBuffer = await convertTextToSpeech(
      promptText,
      language || 'hi-IN'
    );

    // Upload to S3
    const audioUrl = await uploadAudioToS3(audioBuffer, phone);

    // Update user state with pending fields metadata
    await updateUserState(phone, 'VOICE_RECEIVED', {
      pendingFields: missingFields,
      lastPromptTimestamp: Date.now(),
    });

    console.log(`Generated voice prompt for ${phone}:`, {
      missingFields,
      language,
      audioUrl,
    });

    return {
      success: true,
      audioUrl,
    };
  } catch (error: any) {
    console.error('Error generating voice prompt:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Process missing information request
 * 
 * This is the main entry point for the missing info handler.
 * It validates required fields, generates prompts if needed, and returns
 * the appropriate action to take.
 * 
 * @param phone - User phone number
 * @param partialData - Partial catalog item data
 * @param language - User's language preference
 * @returns Processing result with next action
 */
export async function processMissingInfo(
  phone: string,
  partialData: PartialCatalogItem,
  language?: SupportedLanguage
): Promise<{
  action: 'REQUEST_INFO' | 'REQUEST_IMAGE' | 'COMPLETE';
  missingFields?: string[];
  audioUrl?: string;
  error?: string;
}> {
  // Validate required fields
  const validation = validateRequiredFields(partialData);

  if (validation.isComplete) {
    // All required fields present, proceed to image request
    return {
      action: 'REQUEST_IMAGE',
    };
  }

  // Generate and send voice prompt for missing fields
  const promptResult = await generateAndSendVoicePrompt(
    phone,
    validation.missingFields,
    language
  );

  if (!promptResult.success) {
    return {
      action: 'REQUEST_INFO',
      missingFields: validation.missingFields,
      error: promptResult.error,
    };
  }

  return {
    action: 'REQUEST_INFO',
    missingFields: validation.missingFields,
    audioUrl: promptResult.audioUrl,
  };
}
