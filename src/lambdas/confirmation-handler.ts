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
    // Parse event detail with multiple fallback paths
    const eventDetail = event.detail || event;
    let { phone, action, field } = eventDetail;

    console.log('Parsed event detail:', {
      phone,
      action,
      field,
      hasContent: !!eventDetail.content,
      hasButtonPayload: !!eventDetail.content?.buttonPayload,
      messageType: eventDetail.messageType,
      state: eventDetail.state,
      handler: eventDetail.handler,
    });

    // Extract button payload with robust fallback parsing
    // Try multiple event structures to handle different EventBridge formats
    let buttonPayload: string | undefined;
    
    if (eventDetail.content?.buttonPayload) {
      buttonPayload = eventDetail.content.buttonPayload;
      console.log('Button payload found in eventDetail.content.buttonPayload:', buttonPayload);
    } else if (eventDetail.buttonPayload) {
      buttonPayload = eventDetail.buttonPayload;
      console.log('Button payload found in eventDetail.buttonPayload:', buttonPayload);
    } else if (event.content?.buttonPayload) {
      buttonPayload = event.content.buttonPayload;
      console.log('Button payload found in event.content.buttonPayload:', buttonPayload);
    }

    // Map button payload to action if found
    if (buttonPayload) {
      console.log('Processing button click:', buttonPayload);
      
      if (buttonPayload === 'approve') {
        action = 'approve';
        console.log('Mapped button to action: approve');
      } else if (buttonPayload === 'edit_quantity') {
        action = 'edit';
        field = 'quantity';
        console.log('Mapped button to action: edit (quantity)');
      } else if (buttonPayload === 'view_products') {
        action = 'view_products';
        console.log('Mapped button to action: view_products');
      } else if (buttonPayload === 'continue_current') {
        action = 'continue_current';
        console.log('Mapped button to action: continue_current (keep existing order)');
      } else if (buttonPayload === 'start_new') {
        action = 'start_new';
        console.log('Mapped button to action: start_new (cancel and start new order)');
      } else {
        console.warn('Unknown button payload:', buttonPayload);
        // Continue with the action from event if available
      }
    }

    // Validate required fields
    if (!phone) {
      console.error('Missing phone number in event:', JSON.stringify(event, null, 2));
      throw new Error('Phone number is required');
    }

    if (!action) {
      console.error('Missing action in event (no action or button payload found):', JSON.stringify(event, null, 2));
      throw new Error('Action is required (either explicit action or button payload)');
    }

    console.log('Processing confirmation action:', { phone, action, field });

    // Get user state and partial data
    const userState = await getUserState(phone);
    if (!userState) {
      console.error('User state not found for phone:', phone);
      throw new Error('User state not found');
    }

    console.log('Retrieved user state:', {
      phone,
      state: userState.state,
      language: userState.language,
    });

    const partialData = await getPartialData(phone);
    if (!partialData) {
      console.error('Partial catalog data not found for phone:', phone);
      throw new Error('Partial catalog data not found');
    }

    console.log('Retrieved partial data:', {
      phone,
      hasProductName: !!partialData.productName,
      hasPrice: !!partialData.price,
      hasQuantity: !!partialData.quantity,
    });

    // Handle different actions
    console.log('Dispatching to action handler:', action);
    
    switch (action) {
      case 'generate':
        return await generateConfirmation(phone, partialData, userState.language);
      
      case 'approve':
        return await processApproval(phone, partialData, userState.language);
      
      case 'edit':
        return await processEdit(phone, field, userState.language);
      
      case 'view_products':
        return await viewProducts(phone, userState.language);
      
      case 'continue_current':
        return await continueCurrentOrder(phone, userState.language);
      
      case 'start_new':
        return await startNewOrder(phone, partialData, userState.language);
      
      default:
        console.error('Unknown action:', action);
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error: any) {
    console.error('Confirmation handler error:', error);
    console.error('Error stack:', error.stack);
    console.error('Full event that caused error:', JSON.stringify(event, null, 2));
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
        details: 'Check CloudWatch logs for full error details',
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
  
  // Add voice instructions for updates
  const voiceInstructions = lang === 'hi-IN'
    ? '\n\n💬 आवाज़ में बोलें:\n• कीमत बदलने के लिए: "कीमत 600 रुपये करें"\n• मात्रा बदलने के लिए: "मात्रा 50 करें"'
    : lang === 'mr-IN'
    ? '\n\n💬 आवाजात बोला:\n• किंमत बदलण्यासाठी: "किंमत 600 रुपये करा"\n• प्रमाण बदलण्यासाठी: "प्रमाण 50 करा"'
    : '\n\n💬 Say in voice:\n• To change price: "change price to 600"\n• To change quantity: "change quantity to 50"';
  
  const textSummary = translateMessage('CONFIRMATION_TEXT', lang, { details }) + voiceInstructions;
  
  console.log('Generated text summary:', textSummary);

  // Generate voice confirmation
  let voiceUrl: string | undefined;
  try {
    console.log('Attempting to generate voice confirmation');
    voiceUrl = await convertToSpeech(textSummary, lang);
    console.log('Voice confirmation generated successfully:', voiceUrl);
  } catch (error: any) {
    console.error('Failed to generate voice confirmation, falling back to text-only:', {
      error: error.message,
      code: error.code,
      language: lang,
    });
    // Continue without voice - text is sufficient
    voiceUrl = undefined;
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
  const { sendImageMessage, sendAudioMessage, sendTypingIndicator, markMessageAsRead } = await import('./whatsapp-message-sender');
  const imageUrl = partialData.enhancedImageUrl || partialData.originalImageUrl;
  
  if (imageUrl) {
    // Show typing indicator immediately to indicate processing
    await sendTypingIndicator(phone);
    
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
    console.log('[Message Ordering] Sending image with caption...');
    
    // Send image first
    await sendImageMessage(
      phone,
      publicImageUrl,
      textSummary,
      lang.split('-')[0] as 'hi' | 'mr' | 'en'
    );
    
    console.log('[Message Ordering] Image sent, waiting 2 seconds...');
    // Wait 2 seconds to ensure image is delivered first
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Send voice confirmation if available
    if (voiceUrl) {
      console.log('Sending voice confirmation audio message');
      await sendAudioMessage(
        phone,
        voiceUrl,
        lang.split('-')[0] as 'hi' | 'mr' | 'en'
      );
      
      // Wait 1 second before sending buttons
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('[Message Ordering] Sending interactive buttons...');
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
    // No image - show typing indicator then send text with interactive buttons
    await sendTypingIndicator(phone);
    
    await sendTextMessage(phone, textSummary, lang.split('-')[0] as 'hi' | 'mr' | 'en');
    
    // Send voice confirmation if available
    if (voiceUrl) {
      console.log('Sending voice confirmation audio message (no image)');
      await sendAudioMessage(
        phone,
        voiceUrl,
        lang.split('-')[0] as 'hi' | 'mr' | 'en'
      );
      
      // Wait 1 second before sending buttons
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('[Message Ordering] Sending interactive buttons (no image case)...');
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
  
  console.log('Starting Polly synthesis:', {
    voiceId,
    language,
    textLength: text.length,
  });
  
  try {
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
      console.error('Polly synthesis failed: No audio stream returned');
      throw new Error('No audio stream returned from Polly');
    }

    console.log('Polly synthesis successful, converting stream to buffer');

    // Convert stream to buffer
    const audioBuffer = await streamToBuffer(response.AudioStream);
    
    console.log('Audio buffer created, size:', audioBuffer.length, 'bytes');

    // Upload to S3
    const key = `voice-confirmations/${Date.now()}-${Math.random().toString(36).substring(7)}.mp3`;
    
    console.log('Uploading audio to S3:', {
      bucket: PRODUCTS_BUCKET_NAME,
      key,
    });
    
    await s3Client.send(
      new PutObjectCommand({
        Bucket: PRODUCTS_BUCKET_NAME,
        Key: key,
        Body: audioBuffer,
        ContentType: 'audio/mpeg',
      })
    );

    // Generate presigned URL (valid for 1 hour)
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const getObjectCommand = new GetObjectCommand({
      Bucket: PRODUCTS_BUCKET_NAME,
      Key: key,
    });
    const presignedUrl = await getSignedUrl(s3Client, getObjectCommand, { expiresIn: 3600 });
    
    console.log('Voice confirmation uploaded successfully with presigned URL');
    
    return presignedUrl;
  } catch (error: any) {
    console.error('Voice generation failed:', {
      error: error.message,
      code: error.code,
      voiceId,
      language,
      stack: error.stack,
    });
    
    // Re-throw to be caught by generateConfirmation
    throw new Error(`Voice generation failed: ${error.message}`);
  }
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
    const eventBusName = process.env.EVENT_BUS_NAME;
    if (!eventBusName) {
      throw new Error('EVENT_BUS_NAME environment variable not configured');
    }

    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
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
            EventBusName: eventBusName,
          },
        ],
      })
    );

    console.log('Published catalog build event to event bus:', eventBusName);

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

/**
 * View existing products
 */
export async function viewProducts(
  phone: string,
  language?: SupportedLanguage
): Promise<void> {
  const lang = getLanguagePreference(language);
  
  // TODO: Implement product listing from DynamoDB
  const message = lang === 'hi-IN'
    ? '📋 आपके उत्पाद जल्द ही दिखाए जाएंगे।'
    : lang === 'mr-IN'
    ? '📋 तुमची उत्पादने लवकरच दाखवली जातील.'
    : '📋 Your products will be shown soon.';
  
  await sendTextMessage(phone, message, lang.split('-')[0] as 'hi' | 'mr' | 'en');
  
  console.log('Sent view products message');
}

/**
 * Continue with current order (ignore new product mention)
 */
export async function continueCurrentOrder(
  phone: string,
  language?: SupportedLanguage
): Promise<void> {
  const lang = getLanguagePreference(language);
  
  // Clear the pending product switch from description
  const partialData = await getPartialData(phone);
  if (partialData && partialData.description?.startsWith('pending_product_switch:')) {
    const { mergePartialData } = await import('../services/partial-data-store');
    await mergePartialData(phone, {
      description: undefined,
      source: 'voice',
    });
  }
  
  // Send confirmation message
  const message = lang === 'hi-IN'
    ? '✅ ठीक है, मौजूदा ऑर्डर जारी रखते हैं। कृपया बाकी जानकारी भेजें।'
    : lang === 'mr-IN'
    ? '✅ ठीक आहे, सध्याचा ऑर्डर सुरू ठेवतो. कृपया उर्वरित माहिती पाठवा.'
    : '✅ Okay, continuing with current order. Please send the remaining information.';
  
  const { sendTextWithVoice } = await import('./whatsapp-message-sender');
  await sendTextWithVoice(phone, message, lang.split('-')[0] as 'hi' | 'mr' | 'en');
  
  console.log('User chose to continue current order');
}

/**
 * Start new order (cancel current and start with new product)
 */
export async function startNewOrder(
  phone: string,
  partialData: PartialCatalogItem,
  language?: SupportedLanguage
): Promise<void> {
  const lang = getLanguagePreference(language);
  
  // Extract the new product name from description
  let newProductName: string | undefined;
  if (partialData.description?.startsWith('pending_product_switch:')) {
    newProductName = partialData.description.replace('pending_product_switch:', '');
  }
  
  // Delete current partial data
  await deletePartialData(phone);
  
  // Create new partial data with the new product
  if (newProductName) {
    const { savePartialData } = await import('../services/partial-data-store');
    await savePartialData(phone, {
      productName: newProductName,
      source: 'voice',
    });
  }
  
  // Reset state to ACTIVE
  await updateUserState(phone, 'ACTIVE');
  
  // Send confirmation message
  const message = lang === 'hi-IN'
    ? `✅ ठीक है, पुराना ऑर्डर रद्द कर दिया गया। ${newProductName ? `${newProductName} के लिए नया ऑर्डर शुरू करते हैं।` : 'नया ऑर्डर शुरू करें।'} कृपया जानकारी भेजें।`
    : lang === 'mr-IN'
    ? `✅ ठीक आहे, जुना ऑर्डर रद्द केला. ${newProductName ? `${newProductName} साठी नवीन ऑर्डर सुरू करतो.` : 'नवीन ऑर्डर सुरू करा.'} कृपया माहिती पाठवा.`
    : `✅ Okay, canceled previous order. ${newProductName ? `Starting new order for ${newProductName}.` : 'Start new order.'} Please send information.`;
  
  const { sendTextWithVoice } = await import('./whatsapp-message-sender');
  await sendTextWithVoice(phone, message, lang.split('-')[0] as 'hi' | 'mr' | 'en');
  
  console.log('User chose to start new order, old order canceled');
}
