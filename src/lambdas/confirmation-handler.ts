/**
 * Confirmation Handler Lambda
 * 
 * Handles the confirmation workflow for catalog items in the voice-first workflow.
 * Generates text and voice confirmations, sends interactive buttons, and processes
 * user approval or edit requests.
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 6.8, 6.9
 */

import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { eventBridgeClient, s3Client, PRODUCTS_BUCKET_NAME } from '../config/aws-clients';
import { EVENT_SOURCES, INTERNAL_EVENT_TYPES } from '../config/event-patterns';
import { PartialCatalogItem, getPartialData, deletePartialData } from '../services/partial-data-store';
import { getUserState, updateUserState } from '../services/state-manager';
import { formatCatalogDetails, translateMessage, getLanguagePreference, type SupportedLanguage } from '../services/language-manager';
import { sendInteractiveMessage, sendTextMessage } from './whatsapp-message-sender';

/**
 * Polly client for text-to-speech
 */
const pollyClient = new PollyClient({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Voice IDs for each language
 */
const VOICE_IDS: Record<SupportedLanguage, string> = {
  'hi-IN': process.env.POLLY_VOICE_ID_HINDI || 'Kajal',
  'mr-IN': process.env.POLLY_VOICE_ID_MARATHI || 'Aditi',
  'en-IN': process.env.POLLY_VOICE_ID_ENGLISH || 'Joanna',
};

/**
 * Confirmation message structure
 */
export interface ConfirmationMessage {
  textSummary: string;
  voiceUrl?: string;
  buttons: Array<{ id: string; title: string }>;
}

/**
 * Approval result
 */
export interface ApprovalResult {
  success: boolean;
  catalogId?: string;
  error?: string;
}

/**
 * Lambda handler for confirmation workflow
 */
export const handler = async (event: any): Promise<any> => {
  console.log('Confirmation handler invoked:', JSON.stringify(event, null, 2));

  try {
    const eventDetail = event.detail || event;
    const { phone, action, field } = eventDetail;

    if (!phone) {
      throw new Error('Phone number is required');
    }

    // Get user state and partial data
    const userState = await getUserState(phone);
    if (!userState) {
      throw new Error('User state not found');
    }

    const partialData = await getPartialData(phone);
    if (!partialData) {
      throw new Error('Partial catalog data not found');
    }

    // Handle different actions
    switch (action) {
      case 'generate':
        return await generateConfirmation(phone, partialData, userState.language);
      
      case 'approve':
        return await processApproval(phone, partialData, userState.language);
      
      case 'edit':
        return await processEdit(phone, field, userState.language);
      
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error: any) {
    console.error('Confirmation handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
      }),
    };
  }
};

/**
 * Generate confirmation message with text and voice
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */
export async function generateConfirmation(
  phone: string,
  partialData: PartialCatalogItem,
  language?: SupportedLanguage
): Promise<ConfirmationMessage> {
  const lang = getLanguagePreference(language);
  
  // Generate text summary
  const details = formatCatalogDetails(partialData, lang);
  const textSummary = translateMessage('CONFIRMATION_TEXT', lang, { details });
  
  console.log('Generated text summary:', textSummary);

  // Generate voice confirmation
  let voiceUrl: string | undefined;
  try {
    voiceUrl = await convertToSpeech(textSummary, lang);
    console.log('Generated voice confirmation:', voiceUrl);
  } catch (error) {
    console.error('Failed to generate voice confirmation:', error);
    // Continue without voice - text is sufficient
  }

  // Create interactive buttons with 3 action options
  const buttons = [
    {
      id: 'approve',
      title: lang === 'hi-IN' ? '✅ स्वीकार करें' : lang === 'mr-IN' ? '✅ स्वीकार करा' : '✅ Approve',
    },
    {
      id: 'edit_quantity',
      title: lang === 'hi-IN' ? '✏️ मात्रा बदलें' : lang === 'mr-IN' ? '✏️ प्रमाण बदला' : '✏️ Edit Quantity',
    },
    {
      id: 'view_products',
      title: lang === 'hi-IN' ? '📋 उत्पाद देखें' : lang === 'mr-IN' ? '📋 उत्पादन पहा' : '📋 View Products',
    },
  ];

  // Send enhanced image with caption FIRST
  const { sendImageMessage } = await import('./whatsapp-message-sender');
  const imageUrl = partialData.enhancedImageUrl || partialData.originalImageUrl;
  
  if (imageUrl) {
    // Generate pre-signed URL for S3 images
    let publicImageUrl = imageUrl;
    
    if (imageUrl.startsWith('s3://')) {
      // Extract bucket and key from s3:// URL
      const s3Match = imageUrl.match(/s3:\/\/([^\/]+)\/(.+)/);
      if (s3Match) {
        const bucket = s3Match[1];
        const key = s3Match[2];
        // Generate pre-signed URL (valid for 1 hour)
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
        const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
        const command = new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        });
        publicImageUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        console.log('Generated pre-signed URL for S3 image');
      }
    } else if (imageUrl.startsWith('https://') && imageUrl.includes('.s3.')) {
      // HTTPS S3 URL - generate pre-signed URL
      const urlMatch = imageUrl.match(/https:\/\/([^.]+)\.s3\.[^.]+\.amazonaws\.com\/(.+)/);
      if (urlMatch) {
        const bucket = urlMatch[1];
        const key = decodeURIComponent(urlMatch[2]);
        // Generate pre-signed URL (valid for 1 hour)
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
        const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
        const command = new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        });
        publicImageUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        console.log('Generated pre-signed URL for HTTPS S3 image');
      }
    }
    
    console.log('Sending image with URL:', publicImageUrl.substring(0, 100) + '...');
    
    // Send image first
    await sendImageMessage(
      phone,
      publicImageUrl,
      textSummary,
      lang.split('-')[0] as 'hi' | 'mr' | 'en'
    );
    
    // Then send interactive buttons below the image
    await sendInteractiveMessage(
      phone,
      lang === 'hi-IN' 
        ? 'कृपया एक विकल्प चुनें:' 
        : lang === 'mr-IN'
        ? 'कृपया एक पर्याय निवडा:'
        : 'Please choose an option:',
      buttons,
      lang.split('-')[0] as 'hi' | 'mr' | 'en'
    );
  } else {
    // No image - send text with interactive buttons
    await sendTextMessage(phone, textSummary, lang.split('-')[0] as 'hi' | 'mr' | 'en');
    
    // Then send interactive buttons
    await sendInteractiveMessage(
      phone,
      lang === 'hi-IN' 
        ? 'कृपया एक विकल्प चुनें:' 
        : lang === 'mr-IN'
        ? 'कृपया एक पर्याय निवडा:'
        : 'Please choose an option:',
      buttons,
      lang.split('-')[0] as 'hi' | 'mr' | 'en'
    );
  }

  // Update user state to CONFIRMATION_PENDING
  await updateUserState(phone, 'CONFIRMATION_PENDING');

  return {
    textSummary,
    voiceUrl,
    buttons,
  };
}

/**
 * Convert text to speech using Amazon Polly
 * 
 * Requirements: 6.2
 */
async function convertToSpeech(text: string, language: SupportedLanguage): Promise<string> {
  const voiceId = VOICE_IDS[language];
  
  // Map language codes to Polly language codes
  const pollyLanguageCode = language === 'mr-IN' ? 'hi-IN' : language; // Marathi uses Hindi voice
  
  // Synthesize speech
  const command = new SynthesizeSpeechCommand({
    Text: text,
    OutputFormat: 'mp3',
    VoiceId: voiceId as any, // Type assertion needed for custom voice IDs
    Engine: 'neural',
    LanguageCode: pollyLanguageCode as any,
  });

  const response = await pollyClient.send(command);
  
  if (!response.AudioStream) {
    throw new Error('No audio stream returned from Polly');
  }

  // Convert stream to buffer
  const audioBuffer = await streamToBuffer(response.AudioStream);

  // Upload to S3
  const key = `voice-confirmations/${Date.now()}-${Math.random().toString(36).substring(7)}.mp3`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: PRODUCTS_BUCKET_NAME,
      Key: key,
      Body: audioBuffer,
      ContentType: 'audio/mpeg',
    })
  );

  // Return S3 URL
  const url = `https://${PRODUCTS_BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
  return url;
}

/**
 * Convert stream to buffer
 */
async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Process approval and create catalog entry
 * 
 * Requirements: 6.6, 6.8, 6.9
 */
export async function processApproval(
  phone: string,
  partialData: PartialCatalogItem,
  language?: SupportedLanguage
): Promise<ApprovalResult> {
  const lang = getLanguagePreference(language);
  
  try {
    // Call catalog-builder Lambda via EventBridge
    const catalogBuilderEvent = {
      Source: EVENT_SOURCES.INTERNAL,
      DetailType: INTERNAL_EVENT_TYPES.CATALOG_BUILD_REQUESTED,
      Detail: JSON.stringify({
        entities: {
          product_name: partialData.productName,
          price: partialData.price,
          quantity: partialData.quantity,
          unit: partialData.unit,
          category: partialData.category || 'other',
          description: partialData.description,
        },
        phone,
        language: lang,
        imageUrl: partialData.enhancedImageUrl || partialData.originalImageUrl,
      }),
      EventBusName: process.env.EVENT_BUS_NAME,
    };

    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [catalogBuilderEvent],
      })
    );

    console.log('Published catalog build event');

    // Update user state to ACTIVE
    await updateUserState(phone, 'ACTIVE');
    console.log('Updated user state to ACTIVE');

    // Delete partial data
    await deletePartialData(phone);
    console.log('Deleted partial data');

    // Send success message
    const successMessage = translateMessage('CATALOG_SUCCESS', lang);
    await sendTextMessage(phone, successMessage, lang.split('-')[0] as 'hi' | 'mr' | 'en');
    console.log('Sent success message');

    return {
      success: true,
      catalogId: `CATALOG-${Date.now()}`,
    };
  } catch (error: any) {
    console.error('Approval processing failed:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Process edit request
 * 
 * Requirements: 6.7
 */
export async function processEdit(
  phone: string,
  field?: string,
  language?: SupportedLanguage
): Promise<void> {
  const lang = getLanguagePreference(language);
  
  // Send edit prompt
  const editPrompt = translateMessage('EDIT_PROMPT', lang);
  await sendTextMessage(phone, editPrompt, lang.split('-')[0] as 'hi' | 'mr' | 'en');

  // Update user state back to VOICE_RECEIVED to allow re-entry of information
  await updateUserState(phone, 'VOICE_RECEIVED', {
    editingField: field,
  });

  console.log('Sent edit prompt and updated state to VOICE_RECEIVED');
}
