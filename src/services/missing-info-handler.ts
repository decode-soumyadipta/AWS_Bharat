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
 * Clean text for voice synthesis
 * - Remove emojis
 * - Add pauses for better pacing
 * - Make it sound more natural and friendly
 */
function cleanTextForVoice(text: string): string {
  // Remove all emojis
  let cleaned = text.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F000}-\u{1F02F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2300}-\u{23FF}]|[\u{2B50}]|[\u{2B55}]|[\u{231A}]|[\u{231B}]|[\u{23E9}-\u{23EC}]|[\u{23F0}]|[\u{23F3}]|[\u{25FD}]|[\u{25FE}]|[\u{2614}]|[\u{2615}]|[\u{2648}-\u{2653}]|[\u{267F}]|[\u{2693}]|[\u{26A1}]|[\u{26AA}]|[\u{26AB}]|[\u{26BD}]|[\u{26BE}]|[\u{26C4}]|[\u{26C5}]|[\u{26CE}]|[\u{26D4}]|[\u{26EA}]|[\u{26F2}]|[\u{26F3}]|[\u{26F5}]|[\u{26FA}]|[\u{26FD}]|[\u{2705}]|[\u{270A}]|[\u{270B}]|[\u{2728}]|[\u{274C}]|[\u{274E}]|[\u{2753}-\u{2755}]|[\u{2757}]|[\u{2795}-\u{2797}]|[\u{27B0}]|[\u{27BF}]|[\u{2B1B}]|[\u{2B1C}]|[\u{3030}]|[\u{303D}]|[\u{3297}]|[\u{3299}]/gu, '');
  
  // Remove special symbols that sound weird
  cleaned = cleaned.replace(/[✅❌💡💰📸📋✏️⚠️•]/g, '');
  
  // Replace currency symbols with words
  cleaned = cleaned.replace(/₹/g, 'रुपये ');
  cleaned = cleaned.replace(/\$/g, 'dollars ');
  
  // Add pauses after colons and newlines for better pacing
  cleaned = cleaned.replace(/:/g, ','); // Replace colon with comma for natural pause
  cleaned = cleaned.replace(/\n\n/g, '. '); // Double newline becomes period with pause
  cleaned = cleaned.replace(/\n/g, ', '); // Single newline becomes comma pause
  
  // Add pauses after numbers for clarity
  cleaned = cleaned.replace(/(\d+)/g, '$1 '); // Space after numbers
  
  // Clean up multiple spaces
  cleaned = cleaned.replace(/\s+/g, ' ');
  
  // Trim
  cleaned = cleaned.trim();
  
  // Don't use SSML - Neural engine doesn't support all features
  // Just return plain text
  return cleaned;
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

  // Clean text for voice synthesis
  const cleanedText = cleanTextForVoice(text);

  const params: SynthesizeSpeechCommandInput = {
    Text: cleanedText,
    OutputFormat: OutputFormat.MP3,
    VoiceId: voiceId,
    Engine: Engine.NEURAL, // Use neural engine for better quality
    LanguageCode: language as LanguageCode,
    TextType: 'text', // Use plain text (Neural engine doesn't support all SSML features)
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
