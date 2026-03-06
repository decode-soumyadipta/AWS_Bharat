
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { eventBridgeClient, s3Client, PRODUCTS_BUCKET_NAME } from '../config/aws-clients';
import { EVENT_SOURCES, INTERNAL_EVENT_TYPES } from '../config/event-patterns';
import { PartialCatalogItem, getPartialData, deletePartialData, mergePartialData } from '../services/partial-data-store';
import { getUserState, updateUserState } from '../services/state-manager';
import { formatCatalogDetails, translateMessage, getLanguagePreference, type SupportedLanguage } from '../services/language-manager';
import { sendInteractiveMessage, sendTextMessage } from './whatsapp-message-sender';

const pollyClient = new PollyClient({ region: process.env.AWS_REGION || 'us-east-1' });

const VOICE_IDS: Record<SupportedLanguage, string> = {
  'hi-IN': process.env.POLLY_VOICE_ID_HINDI || 'Kajal',
  'mr-IN': process.env.POLLY_VOICE_ID_MARATHI || 'Aditi',
  'en-IN': process.env.POLLY_VOICE_ID_ENGLISH || 'Joanna',
};

interface ConfirmationMessage {
  textSummary: string;
  voiceUrl?: string;
  buttons: Array<{ id: string; title: string }>;
}

interface ApprovalResult {
  success: boolean;
  catalogId?: string;
  error?: string;
}

export const handler = async (event: any): Promise<any> => {
  console.log('Confirmation handler invoked:', JSON.stringify(event, null, 2));

  try {

    const eventDetail = event.detail || event;
    const { phone } = eventDetail;
    let { action, field } = eventDetail;

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

      }
    }

    if (!phone) {
      console.error('Missing phone number in event:', JSON.stringify(event, null, 2));
      throw new Error('Phone number is required');
    }

    if (!action) {
      console.error('Missing action in event (no action or button payload found):', JSON.stringify(event, null, 2));
      throw new Error('Action is required (either explicit action or button payload)');
    }

    console.log('Processing confirmation action:', { phone, action, field });

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

    console.log('Dispatching to action handler:', action);

    switch (action) {
      case 'generate': {

        if (userState.state === 'ACTIVE') {
          console.warn('⚠️ Skipping confirmation generate — state is already ACTIVE (product already saved)');
          return { success: false, reason: 'already_active' };
        }

        const placeholders = ['product', 'item', 'goods', 'unknown', 'na', 'n/a', 'product name', 'any product'];
        const nameCheck = (partialData.productName || '').toLowerCase().trim();
        if (!partialData.productName || placeholders.includes(nameCheck) || nameCheck.length < 2) {
          console.warn('⚠️ Skipping confirmation generate — placeholder/missing product name:', partialData.productName);
          const lang = (userState.language?.split('-')[0] || 'hi') as 'hi' | 'mr' | 'en';
          const askName: Record<string, string> = {
            hi: 'आपके प्रोडक्ट का नाम क्या है? जैसे "टमाटर" या "आलू" — वॉइस में बताएं।',
            mr: 'तुमच्या उत्पादाचे नाव काय आहे? जसे "टोमॅटो" — व्हॉइस मेसेजमध्ये सांगा.',
            en: 'What is the product name? e.g. "tomatoes" — send a voice message.',
          };
          const { sendTextWithVoice } = await import('./whatsapp-message-sender');
          await sendTextWithVoice(phone, askName[lang] || askName.hi, lang);
          return { success: false, reason: 'placeholder_product_name' };
        }

        const msgIdForTyping = eventDetail.messageId;
        if (msgIdForTyping) {
          try {
            const { setLastMessageId, markMessageAsRead } = await import('./whatsapp-message-sender');
            setLastMessageId(phone, msgIdForTyping);
            await markMessageAsRead(msgIdForTyping, true);
            console.log('✅ Typing indicator set at confirmation generate start');
          } catch (typingErr) {
            console.warn('Typing indicator in confirmation handler failed (non-fatal):', typingErr);
          }
        }
        return await generateConfirmation(phone, partialData, userState.language);
      }

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

export async function generateConfirmation(
  phone: string,
  partialData: PartialCatalogItem,
  language?: SupportedLanguage
): Promise<ConfirmationMessage> {
  const lang = getLanguagePreference(language);

  const productName = partialData.productName || 'Product';
  const price = partialData.price ? `₹${partialData.price}` : '—';
  const unit = partialData.unit || 'unit';
  const quantity = partialData.quantity ? `${partialData.quantity} ${unit}` : '—';
  const category = partialData.category || '—';

  let marketPriceLine = '';
  let marketVoiceLine = '';
  try {
    const { fetchLiveMarketPrice, getLocalMarketPrice } = await import('../tools/web-search');
    let marketPrice;
    try {

      const liveResult = await fetchLiveMarketPrice(productName);
      if (liveResult.found) {
        marketPrice = liveResult;
      }
    } catch (liveErr) {
      console.warn('Live market price fetch failed, using fallback:', liveErr);
    }

    if (!marketPrice) {
      const fallback = getLocalMarketPrice(productName);
      if (fallback.found) {
        marketPrice = { found: true, priceInfo: fallback.priceInfo, sourceName: fallback.sourceName, sourceUrl: fallback.sourceUrl, isLive: false };
      }
    }

    if (marketPrice && marketPrice.found && marketPrice.isLive) {
      try {
        await mergePartialData(phone, {
          cachedMarketPrice: {
            priceInfo: marketPrice.priceInfo,
            sourceName: marketPrice.sourceName,
            sourceUrl: marketPrice.sourceUrl,
            isLive: true,
            cachedAt: Date.now(),
          },
        } as any);
        console.log('💾 Cached live market price in DynamoDB');
      } catch (cacheErr) {
        console.warn('Failed to cache market price (non-fatal):', cacheErr);
      }
    }

    if (marketPrice && marketPrice.found && !marketPrice.isLive && partialData.cachedMarketPrice) {
      const cacheAge = Date.now() - (partialData.cachedMarketPrice.cachedAt || 0);
      if (cacheAge < 24 * 60 * 60 * 1000) {
        console.log('✅ Using cached LIVE market price (age:', Math.round(cacheAge / 60000), 'min)');
        marketPrice = { ...marketPrice, ...partialData.cachedMarketPrice };
      }
    }

    if (marketPrice && marketPrice.found) {
      const liveTag = marketPrice.isLive ? '🟢 LIVE' : '📊';
      if (lang === 'hi-IN') {
        marketPriceLine = `\n${liveTag} आज का बाज़ार भाव: ${marketPrice.priceInfo}\n🔗 ${marketPrice.sourceName}`;
        marketVoiceLine = `, आज बाज़ार भाव ${marketPrice.priceInfo}`;
      } else if (lang === 'mr-IN') {
        marketPriceLine = `\n${liveTag} आजचा बाजार भाव: ${marketPrice.priceInfo}\n🔗 ${marketPrice.sourceName}`;
        marketVoiceLine = `, आज बाजार भाव ${marketPrice.priceInfo}`;
      } else {
        marketPriceLine = `\n${liveTag} Today's market: ${marketPrice.priceInfo}\n🔗 ${marketPrice.sourceName}`;
        marketVoiceLine = `, today's market price ${marketPrice.priceInfo}`;
      }
    }
  } catch (err) {
    console.warn('Market price fetch failed for confirmation:', err);
  }

  let textSummary: string;
  if (lang === 'hi-IN') {
    textSummary = `📦 *${productName}*\n\n💰 कीमत: ${price}/${unit}\n📊 मात्रा: ${quantity}\n🏷️ श्रेणी: ${category}${marketPriceLine}\n\n✅ सही है? बटन दबाएं या बोलकर बदलें`;
  } else if (lang === 'mr-IN') {
    textSummary = `📦 *${productName}*\n\n💰 किंमत: ${price}/${unit}\n📊 प्रमाण: ${quantity}\n🏷️ श्रेणी: ${category}${marketPriceLine}\n\n✅ बरोबर आहे? बटण दाबा किंवा बोलून बदला`;
  } else {
    textSummary = `📦 *${productName}*\n\n💰 Price: ${price}/${unit}\n📊 Qty: ${quantity}\n🏷️ Category: ${category}${marketPriceLine}\n\n✅ Correct? Tap button or say to change`;
  }

  console.log('Generated concise confirmation with market price:', textSummary);

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

  const { sendImageMessage, sendAudioMessage, sendTypingIndicator, markMessageAsRead } = await import('./whatsapp-message-sender');
  const imageUrl = partialData.enhancedImageUrl || partialData.originalImageUrl;

  if (imageUrl) {

    await sendTypingIndicator(phone);

    let publicImageUrl = imageUrl;

    if (imageUrl.startsWith('s3://')) {

      const s3Match = imageUrl.match(/s3:\/\/([^\/]+)\/(.+)/);
      if (s3Match) {
        const bucket = s3Match[1];
        const key = s3Match[2];

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

      const urlMatch = imageUrl.match(/https:\/\/([^.]+)\.s3\.[^.]+\.amazonaws\.com\/(.+)/);
      if (urlMatch) {
        const bucket = urlMatch[1];
        const key = decodeURIComponent(urlMatch[2]);

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

    await sendImageMessage(
      phone,
      publicImageUrl,
      textSummary,
      lang.split('-')[0] as 'hi' | 'mr' | 'en'
    );

    console.log('[Message Ordering] Image sent, waiting 2 seconds...');

    await new Promise(resolve => setTimeout(resolve, 2000));

    if (voiceUrl) {
      console.log('Sending voice confirmation audio message');
      await sendAudioMessage(
        phone,
        voiceUrl,
        lang.split('-')[0] as 'hi' | 'mr' | 'en'
      );

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('[Message Ordering] Sending interactive buttons...');

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

    await sendTypingIndicator(phone);

    await sendTextMessage(phone, textSummary, lang.split('-')[0] as 'hi' | 'mr' | 'en');

    if (voiceUrl) {
      console.log('Sending voice confirmation audio message (no image)');
      await sendAudioMessage(
        phone,
        voiceUrl,
        lang.split('-')[0] as 'hi' | 'mr' | 'en'
      );

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('[Message Ordering] Sending interactive buttons (no image case)...');

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

  await updateUserState(phone, 'CONFIRMATION_PENDING');

  return {
    textSummary,
    voiceUrl,
    buttons,
  };
}

function cleanTextForVoice(text: string): string {

  let cleaned = text.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F000}-\u{1F02F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2300}-\u{23FF}]|[\u{2B50}]|[\u{2B55}]|[\u{231A}]|[\u{231B}]|[\u{23E9}-\u{23EC}]|[\u{23F0}]|[\u{23F3}]|[\u{25FD}]|[\u{25FE}]|[\u{2614}]|[\u{2615}]|[\u{2648}-\u{2653}]|[\u{267F}]|[\u{2693}]|[\u{26A1}]|[\u{26AA}]|[\u{26AB}]|[\u{26BD}]|[\u{26BE}]|[\u{26C4}]|[\u{26C5}]|[\u{26CE}]|[\u{26D4}]|[\u{26EA}]|[\u{26F2}]|[\u{26F3}]|[\u{26F5}]|[\u{26FA}]|[\u{26FD}]|[\u{2705}]|[\u{270A}]|[\u{270B}]|[\u{2728}]|[\u{274C}]|[\u{274E}]|[\u{2753}-\u{2755}]|[\u{2757}]|[\u{2795}-\u{2797}]|[\u{27B0}]|[\u{27BF}]|[\u{2B1B}]|[\u{2B1C}]|[\u{3030}]|[\u{303D}]|[\u{3297}]|[\u{3299}]/gu, '');

  cleaned = cleaned.replace(/[✅❌💡💰📸📋✏️⚠️•\*#_~`|]/g, '');

  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '$1');
  cleaned = cleaned.replace(/\*(.*?)\*/g, '$1');

  cleaned = cleaned.replace(/^[\s]*[-–—]+\s*/gm, '');
  cleaned = cleaned.replace(/\s[-–—]{2,}\s/g, ' ');

  cleaned = cleaned.replace(/₹\s*/g, 'रुपये ');
  cleaned = cleaned.replace(/\$/g, 'dollars ');

  cleaned = cleaned.replace(/:\s*/g, '। ');
  cleaned = cleaned.replace(/\n\n+/g, '। ');
  cleaned = cleaned.replace(/\n/g, '। ');

  cleaned = cleaned.replace(/।\s*।/g, '।');
  cleaned = cleaned.replace(/\s+/g, ' ');
  cleaned = cleaned.trim();

  if (!cleaned || cleaned.length < 2) {
    return '';
  }

  cleaned = cleaned
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  cleaned = cleaned.replace(/\b([A-Z]{5}\d{4}[A-Z])\b/g, '<say-as interpret-as="characters">$1</say-as>');

  cleaned = cleaned.replace(/\b(\d{10,})\b/g, '<say-as interpret-as="digits">$1</say-as>');

  cleaned = cleaned.replace(/(\S+@\S+)/g, '<say-as interpret-as="characters">$1</say-as>');

  cleaned = cleaned.replace(/।\s*/g, '<break time="500ms"/>');

  cleaned = cleaned.replace(/,\s*/g, '<break time="300ms"/>');

  return `<speak><prosody rate="slow">${cleaned}</prosody></speak>`;
}

async function convertToSpeech(text: string, language: SupportedLanguage): Promise<string> {
  const voiceId = VOICE_IDS[language];

  const cleanedText = cleanTextForVoice(text);

  console.log('Starting Polly synthesis:', {
    voiceId,
    language,
    originalLength: text.length,
    cleanedLength: cleanedText.length,
  });

  try {

    const pollyLanguageCode = language === 'mr-IN' ? 'hi-IN' : language; 

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

    const audioBuffer = await streamToBuffer(response.AudioStream);

    console.log('Audio buffer created, size:', audioBuffer.length, 'bytes');

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

    throw new Error(`Voice generation failed: ${error.message}`);
  }
}

async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function processApproval(
  phone: string,
  partialData: PartialCatalogItem,
  language?: SupportedLanguage
): Promise<ApprovalResult> {
  const lang = getLanguagePreference(language);

  try {

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

      if (priceRecommendation.competitive !== 'good' && priceRecommendation.marketData.sampleSize > 0) {
        const priceAdviceEmoji = priceRecommendation.competitive === 'too_high' ? '⚠️' : '💡';
        const priceAdvice = `${priceAdviceEmoji} मूल्य सुझाव:\n\n${priceRecommendation.reasoning}\n\n💰 सुझाई गई कीमत: ₹${priceRecommendation.recommendedMin} - ₹${priceRecommendation.recommendedMax}\n\n💡 ${priceRecommendation.tip}`;

        const { sendTextWithVoice } = await import('./whatsapp-message-sender');
        await sendTextWithVoice(phone, priceAdvice, lang.split('-')[0] as 'hi' | 'mr' | 'en');

        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error('Price recommendation failed, continuing without it:', error);

    }

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

    await updateUserState(phone, 'ACTIVE');
    console.log('Updated user state to ACTIVE');

    try {
      const { getSellerByPhone, updateSellerProfile } = await import('../services/dynamodb-repository');
      const seller = await getSellerByPhone(phone);
      if (seller) {
        const profileUpdates: Record<string, any> = { onboardingState: 'ACTIVE' };
        if (partialData?.productName) {
          const existingCrops = seller.cropsGrown || [];
          const newCrop = partialData.productName.toLowerCase().trim();
          if (!existingCrops.some((c: string) => c.toLowerCase() === newCrop)) {
            profileUpdates.cropsGrown = [...existingCrops, partialData.productName.trim()];
          }
        }
        await updateSellerProfile(seller.sellerId, profileUpdates);
        console.log('Seller profile marked ACTIVE with GSI5 + cropsGrown');
      }
    } catch (e) {
      console.warn('Non-critical: failed to update seller profile', e);
    }

    await deletePartialData(phone);
    console.log('Deleted partial data');

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

export async function processEdit(
  phone: string,
  field?: string,
  language?: SupportedLanguage
): Promise<void> {
  const lang = getLanguagePreference(language);

  const editPrompt = translateMessage('EDIT_PROMPT', lang);
  await sendTextMessage(phone, editPrompt, lang.split('-')[0] as 'hi' | 'mr' | 'en');

  await updateUserState(phone, 'VOICE_RECEIVED', {
    editingField: field,
  });

  console.log('Sent edit prompt and updated state to VOICE_RECEIVED');
}

async function viewProducts(
  phone: string,
  language?: SupportedLanguage
): Promise<void> {
  const lang = getLanguagePreference(language);

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

async function continueCurrentOrder(
  phone: string,
  language?: SupportedLanguage
): Promise<void> {
  const lang = getLanguagePreference(language);

  const partialData = await getPartialData(phone);
  if (partialData && partialData.description?.startsWith('pending_product_switch:')) {
    const { mergePartialData } = await import('../services/partial-data-store');
    await mergePartialData(phone, {
      description: undefined,
      source: 'voice',
    });
  }

  const message = lang === 'hi-IN'
    ? '✅ ठीक है, मौजूदा ऑर्डर जारी रखते हैं। कृपया बाकी जानकारी भेजें।'
    : lang === 'mr-IN'
    ? '✅ ठीक आहे, सध्याचा ऑर्डर सुरू ठेवतो. कृपया उर्वरित माहिती पाठवा.'
    : '✅ Okay, continuing with current order. Please send the remaining information.';

  const { sendTextWithVoice } = await import('./whatsapp-message-sender');
  await sendTextWithVoice(phone, message, lang.split('-')[0] as 'hi' | 'mr' | 'en');

  console.log('User chose to continue current order');
}

async function startNewOrder(
  phone: string,
  partialData: PartialCatalogItem,
  language?: SupportedLanguage
): Promise<void> {
  const lang = getLanguagePreference(language);

  let newProductName: string | undefined;
  if (partialData.description?.startsWith('pending_product_switch:')) {
    newProductName = partialData.description.replace('pending_product_switch:', '');
  }

  await deletePartialData(phone);

  if (newProductName) {
    const { savePartialData } = await import('../services/partial-data-store');
    await savePartialData(phone, {
      productName: newProductName,
      source: 'voice',
    });
  }

  await updateUserState(phone, 'ACTIVE');

  const message = lang === 'hi-IN'
    ? `✅ ठीक है, पुराना ऑर्डर रद्द कर दिया गया। ${newProductName ? `${newProductName} के लिए नया ऑर्डर शुरू करते हैं।` : 'नया ऑर्डर शुरू करें।'} कृपया जानकारी भेजें।`
    : lang === 'mr-IN'
    ? `✅ ठीक आहे, जुना ऑर्डर रद्द केला. ${newProductName ? `${newProductName} साठी नवीन ऑर्डर सुरू करतो.` : 'नवीन ऑर्डर सुरू करा.'} कृपया माहिती पाठवा.`
    : `✅ Okay, canceled previous order. ${newProductName ? `Starting new order for ${newProductName}.` : 'Start new order.'} Please send information.`;

  const { sendTextWithVoice } = await import('./whatsapp-message-sender');
  await sendTextWithVoice(phone, message, lang.split('-')[0] as 'hi' | 'mr' | 'en');

  console.log('User chose to start new order, old order canceled');
}
