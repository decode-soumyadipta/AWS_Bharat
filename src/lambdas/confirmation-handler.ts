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
 * Clean, concise format with actionable buttons
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */
export async function generateConfirmation(
  phone: string,
  partialData: PartialCatalogItem,
  language?: SupportedLanguage
): Promise<ConfirmationMessage> {
  const lang = getLanguagePreference(language);
  
  // Generate concise product summary - no verbose instructions
  const productName = partialData.productName || 'Product';
  const price = partialData.price ? `₹${partialData.price}` : '—';
  const unit = partialData.unit || 'unit';
  const quantity = partialData.quantity ? `${partialData.quantity} ${unit}` : '—';
  const category = partialData.category || '—';
  
  // Fetch today's market price for the product
  let marketPriceLine = '';
  let marketVoiceLine = '';
  try {
    const { getLocalMarketPrice } = await import('../tools/web-search');
    const marketPrice = getLocalMarketPrice(productName);
    if (marketPrice.found) {
      if (lang === 'hi-IN') {
        marketPriceLine = `\n📈 आज का बाज़ार भाव: ${marketPrice.priceInfo}\n🔗 ${marketPrice.sourceName}: ${marketPrice.sourceUrl}`;
        marketVoiceLine = `, आज बाज़ार भाव ${marketPrice.priceInfo}`;
      } else if (lang === 'mr-IN') {
        marketPriceLine = `\n📈 आजचा बाजार भाव: ${marketPrice.priceInfo}\n🔗 ${marketPrice.sourceName}: ${marketPrice.sourceUrl}`;
        marketVoiceLine = `, आज बाजार भाव ${marketPrice.priceInfo}`;
      } else {
        marketPriceLine = `\n📈 Today's market: ${marketPrice.priceInfo}\n🔗 ${marketPrice.sourceName}: ${marketPrice.sourceUrl}`;
        marketVoiceLine = `, today's market price ${marketPrice.priceInfo}`;
      }
    }
  } catch (err) {
    console.warn('Market price fetch failed for confirmation:', err);
  }
  
  // Clean, formatted confirmation text with market price
  let textSummary: string;
  if (lang === 'hi-IN') {
    textSummary = `📦 *${productName}*\n\n💰 कीमत: ${price}/${unit}\n📊 मात्रा: ${quantity}\n🏷️ श्रेणी: ${category}${marketPriceLine}\n\n✅ सही है? बटन दबाएं या बोलकर बदलें`;
  } else if (lang === 'mr-IN') {
    textSummary = `📦 *${productName}*\n\n💰 किंमत: ${price}/${unit}\n📊 प्रमाण: ${quantity}\n🏷️ श्रेणी: ${category}${marketPriceLine}\n\n✅ बरोबर आहे? बटण दाबा किंवा बोलून बदला`;
  } else {
    textSummary = `📦 *${productName}*\n\n💰 Price: ${price}/${unit}\n📊 Qty: ${quantity}\n🏷️ Category: ${category}${marketPriceLine}\n\n✅ Correct? Tap button or say to change`;
  }
  
  console.log('Generated concise confirmation with market price:', textSummary);

  // Generate voice confirmation - brief and friendly, includes market price
  let voiceUrl: string | undefined;
  try {
    const voiceText = lang === 'hi-IN'
      ? `${productName}, कीमत ${price} प्रति ${unit}, मात्रा ${quantity}${marketVoiceLine}। सही है तो ठीक है बटन दबाएं, या बोलकर बदलें।`
      : lang === 'mr-IN'
      ? `${productName}, किंमत ${price} प्रति ${unit}, प्रमाण ${quantity}${marketVoiceLine}। बरोबर असल्यास स्वीकार करा बटण दाबा, किंवा बोलून बदला.`
      : `${productName}, price ${price} per ${unit}, quantity ${quantity}${marketVoiceLine}. Tap approve if correct, or say what to change.`;
    
    voiceUrl = await convertToSpeech(voiceText, lang);
    console.log('Voice confirmation generated');
  } catch (error: any) {
    console.error('Voice confirmation failed:', error.message);
    voiceUrl = undefined;
  }

  // Action buttons - clear and concise
  const buttons = [
    {
      id: 'approve',
      title: lang === 'hi-IN' ? '✅ ठीक है' : lang === 'mr-IN' ? '✅ चालेल' : '✅ Approve',
    },
    {
      id: 'edit_quantity',
      title: lang === 'hi-IN' ? '✏️ बदलें' : lang === 'mr-IN' ? '✏️ बदला' : '✏️ Edit',
    },
    {
      id: 'view_products',
      title: lang === 'hi-IN' ? '📋 मेरे उत्पाद' : lang === 'mr-IN' ? '📋 माझी उत्पादने' : '📋 My Products',
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
 * Clean text for voice synthesis and produce SSML output
 * - Remove emojis and special characters
 * - Use <prosody rate="slow"> for comfortable listening speed
 * - Use <say-as> for proper number/ID pronunciation
 * - Use <break> tags for natural pauses
 * - XML-escape text before wrapping in SSML
 */
function cleanTextForVoice(text: string): string {
  // Remove all emojis
  let cleaned = text.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F000}-\u{1F02F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2300}-\u{23FF}]|[\u{2B50}]|[\u{2B55}]|[\u{231A}]|[\u{231B}]|[\u{23E9}-\u{23EC}]|[\u{23F0}]|[\u{23F3}]|[\u{25FD}]|[\u{25FE}]|[\u{2614}]|[\u{2615}]|[\u{2648}-\u{2653}]|[\u{267F}]|[\u{2693}]|[\u{26A1}]|[\u{26AA}]|[\u{26AB}]|[\u{26BD}]|[\u{26BE}]|[\u{26C4}]|[\u{26C5}]|[\u{26CE}]|[\u{26D4}]|[\u{26EA}]|[\u{26F2}]|[\u{26F3}]|[\u{26F5}]|[\u{26FA}]|[\u{26FD}]|[\u{2705}]|[\u{270A}]|[\u{270B}]|[\u{2728}]|[\u{274C}]|[\u{274E}]|[\u{2753}-\u{2755}]|[\u{2757}]|[\u{2795}-\u{2797}]|[\u{27B0}]|[\u{27BF}]|[\u{2B1B}]|[\u{2B1C}]|[\u{3030}]|[\u{303D}]|[\u{3297}]|[\u{3299}]/gu, '');
  
  // Remove special symbols that sound weird when read aloud
  cleaned = cleaned.replace(/[✅❌💡💰📸📋✏️⚠️•\*#_~`|]/g, '');
  
  // Remove markdown formatting (bold, italic)
  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '$1');
  cleaned = cleaned.replace(/\*(.*?)\*/g, '$1');
  
  // Remove dashes used as list separators
  cleaned = cleaned.replace(/^[\s]*[-–—]+\s*/gm, '');
  cleaned = cleaned.replace(/\s[-–—]{2,}\s/g, ' ');
  
  // Replace currency symbols with spoken words
  cleaned = cleaned.replace(/₹\s*/g, 'रुपये ');
  cleaned = cleaned.replace(/\$/g, 'dollars ');
  
  // Replace colons and newlines with pause markers (will become <break> later)
  cleaned = cleaned.replace(/:\s*/g, '। ');
  cleaned = cleaned.replace(/\n\n+/g, '। ');
  cleaned = cleaned.replace(/\n/g, '। ');
  
  // Clean up multiple spaces and periods
  cleaned = cleaned.replace(/।\s*।/g, '।');
  cleaned = cleaned.replace(/\s+/g, ' ');
  cleaned = cleaned.trim();
  
  if (!cleaned || cleaned.length < 2) {
    return '';
  }
  
  // XML-escape the text BEFORE adding SSML tags
  cleaned = cleaned
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  
  // Replace PAN-like IDs (e.g., ABCDE1234F) with character-by-character reading
  cleaned = cleaned.replace(/\b([A-Z]{5}\d{4}[A-Z])\b/g, '<say-as interpret-as="characters">$1</say-as>');
  
  // Replace phone numbers (10+ digit sequences) with digit-by-digit reading
  cleaned = cleaned.replace(/\b(\d{10,})\b/g, '<say-as interpret-as="digits">$1</say-as>');
  
  // Replace UPI IDs with character reading (e.g., name@upi)
  cleaned = cleaned.replace(/(\S+@\S+)/g, '<say-as interpret-as="characters">$1</say-as>');
  
  // Add natural pauses at sentence boundaries (।)
  cleaned = cleaned.replace(/।\s*/g, '<break time="500ms"/>');
  
  // Add small pause after commas
  cleaned = cleaned.replace(/,\s*/g, '<break time="300ms"/>');
  
  // Wrap in SSML with slow prosody for comfortable listening
  return `<speak><prosody rate="slow">${cleaned}</prosody></speak>`;
}

/**
 * Convert text to speech using Amazon Polly
 * 
 * Requirements: 6.2
 */
async function convertToSpeech(text: string, language: SupportedLanguage): Promise<string> {
  const voiceId = VOICE_IDS[language];
  
  // Clean text for voice synthesis
  const cleanedText = cleanTextForVoice(text);
  
  console.log('Starting Polly synthesis:', {
    voiceId,
    language,
    originalLength: text.length,
    cleanedLength: cleanedText.length,
  });
  
  try {
    // Map language codes to Polly language codes
    const pollyLanguageCode = language === 'mr-IN' ? 'hi-IN' : language; // Marathi uses Hindi voice
    
    // Synthesize speech with SSML for natural pacing and pronunciation
    const command = new SynthesizeSpeechCommand({
      Text: cleanedText,
      OutputFormat: 'mp3',
      VoiceId: voiceId as any,
      Engine: 'neural',
      LanguageCode: pollyLanguageCode as any,
      TextType: 'ssml',
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
    // Generate price recommendation before publishing
    try {
      const { suggestOptimalPrice } = await import('../services/price-recommendation');
      const priceRecommendation = await suggestOptimalPrice(
        partialData.productName || 'product',
        partialData.category || 'other',
        partialData.quantity || 0,
        partialData.unit || 'unit',
        partialData.price || 0,
        lang
      );
      
      console.log('Price recommendation:', priceRecommendation);
      
      // Send price advice if not competitive
      if (priceRecommendation.competitive !== 'good' && priceRecommendation.marketData.sampleSize > 0) {
        const priceAdviceEmoji = priceRecommendation.competitive === 'too_high' ? '⚠️' : '💡';
        const priceAdvice = `${priceAdviceEmoji} मूल्य सुझाव:\n\n${priceRecommendation.reasoning}\n\n💰 सुझाई गई कीमत: ₹${priceRecommendation.recommendedMin} - ₹${priceRecommendation.recommendedMax}\n\n💡 ${priceRecommendation.tip}`;
        
        const { sendTextWithVoice } = await import('./whatsapp-message-sender');
        await sendTextWithVoice(phone, priceAdvice, lang.split('-')[0] as 'hi' | 'mr' | 'en');
        
        // Wait 2 seconds before publishing
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error('Price recommendation failed, continuing without it:', error);
      // Continue without price recommendation
    }

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

    // Send success message with voice
    const successMessage = translateMessage('CATALOG_SUCCESS', lang);
    const { sendTextWithVoice } = await import('./whatsapp-message-sender');
    await sendTextWithVoice(phone, successMessage, lang.split('-')[0] as 'hi' | 'mr' | 'en');
    console.log('Sent success message with voice');

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
  
  // Query DynamoDB for seller's catalog items
  try {
    const { getCatalogItemsBySeller } = await import('../services/dynamodb-repository');
    const items = await getCatalogItemsBySeller(phone);
    
    if (!items || items.length === 0) {
      const emptyMsg = lang === 'hi-IN'
        ? 'आपने अभी कोई उत्पाद नहीं जोड़ा है। वॉइस मैसेज से बताएं क्या बेचना है — जैसे "टमाटर 50 रुपये किलो"।'
        : lang === 'mr-IN'
        ? 'तुम्ही अजून कोणतेही उत्पादन जोडलेले नाही. व्हॉइस मेसेजने सांगा काय विकायचे आहे.'
        : 'You haven\'t added any products yet. Send a voice message to add — like "tomato 50 rupees per kilo".';
      await sendTextMessage(phone, emptyMsg, lang.split('-')[0] as 'hi' | 'mr' | 'en');
      return;
    }

    // Build a clean numbered product list
    const productLines = items.map((item: any, index: number) => {
      const name = item.becknItem?.descriptor?.name || item.productName || 'Product';
      const price = item.becknItem?.price?.value || item.price || '—';
      const unit = item.becknItem?.price?.currency === 'INR' ? (item.unit || 'unit') : (item.unit || 'unit');
      const qty = item.quantity || item.becknItem?.quantity?.available?.count || '—';
      return `${index + 1}. *${name}* — ₹${price}/${unit}, ${qty} ${unit} in stock`;
    });

    const header = lang === 'hi-IN'
      ? `*आपके उत्पाद (${items.length}):*\n`
      : lang === 'mr-IN'
      ? `*तुमची उत्पादने (${items.length}):*\n`
      : `*Your Products (${items.length}):*\n`;

    const footer = lang === 'hi-IN'
      ? '\n\nनया उत्पाद जोड़ने के लिए वॉइस मैसेज भेजें।'
      : lang === 'mr-IN'
      ? '\n\nनवीन उत्पादन जोडण्यासाठी व्हॉइस मेसेज पाठवा.'
      : '\n\nSend a voice message to add a new product.';

    const fullMessage = header + productLines.join('\n') + footer;
    
    const { sendTextWithVoice } = await import('./whatsapp-message-sender');
    await sendTextWithVoice(phone, fullMessage, lang.split('-')[0] as 'hi' | 'mr' | 'en');
    
    console.log(`Sent product list: ${items.length} items for seller ${phone}`);
  } catch (error: any) {
    console.error('Error fetching products:', error);
    const errMsg = lang === 'hi-IN'
      ? '⚠️ उत्पाद लोड करने में समस्या हुई। कृपया दुबारा कोशिश करें।'
      : lang === 'mr-IN'
      ? '⚠️ उत्पादने लोड करताना समस्या आली. कृपया पुन्हा प्रयत्न करा.'
      : '⚠️ Trouble loading products. Please try again.';
    await sendTextMessage(phone, errMsg, lang.split('-')[0] as 'hi' | 'mr' | 'en');
  }
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
