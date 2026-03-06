
import { InvokeCommand } from '@aws-sdk/client-lambda';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { lambdaClient, s3Client, KYC_BUCKET_NAME, KMS_KEY_ID } from '../config/aws-clients';
import { downloadImage } from '../services/media-download';
import { getUserState, updateUserState, updateUserSellerId } from '../services/state-manager';
import { translateMessage, getLanguagePreference } from '../services/language-manager';
import { DocumentExtractionResponse, ExtractedKYCData } from '../models/kyc';
import { SellerRegistrationRequest, SellerRegistrationResponse } from './seller-registration';
import { withErrorHandling, logStructured, ErrorCodes } from '../utils/error-handler';
import { trackOperation } from '../utils/monitoring';
import { withXRayTracing, Annotations, Metadata, traceSubsegment } from '../utils/xray-config';

export interface KYCHandlerRequest {
  phone: string; 
  mediaId: string; 
  messageId?: string; 
}

interface KYCHandlerResponse {
  success: boolean;
  sellerId?: string;
  error?: string;
}

const PAN_REGEX = /[A-Z]{5}[0-9]{4}[A-Z]/;

export const handler = withXRayTracing(async (
  event: any, 
  context: any
): Promise<KYCHandlerResponse> => {

  const detail = event.detail || event;
  const phone = detail.phone;
  const mediaId = detail.content?.mediaUrl; 
  const messageId = detail.messageId;

  logStructured('INFO', 'KYC handler invoked', {
    phone,
    mediaId,
    requestId: context.requestId,
  });

  Annotations.setUser(phone);
  Annotations.setOperation('kyc_processing');

  return trackOperation(
    'kyc_processing',
    async () => {
      return withErrorHandling(
        async () => {

          const userState = await traceSubsegment('getUserState', async () => {
            return getUserState(phone);
          });

          if (!userState) {
            throw new Error('User state not found');
          }

          Annotations.setState(userState.state);

          if (userState.state !== 'NEW' && userState.state !== 'KYC_PENDING' && userState.state !== 'GUEST_ACTIVE') {
            throw new Error(`Invalid state for KYC: ${userState.state}`);
          }

          const language = getLanguagePreference(userState.language);

          const { sendTypingIndicator, setLastMessageId } = await import('./whatsapp-message-sender');
          if (detail?.messageId) { setLastMessageId(phone, detail.messageId); }
          await sendTypingIndicator(phone, detail?.messageId);

          logStructured('INFO', 'Downloading image from WhatsApp', { mediaId });
          const downloadResult = await traceSubsegment('downloadImage', async () => {
            return downloadImage(mediaId, KYC_BUCKET_NAME);
          });

          if (!downloadResult.success || !downloadResult.s3Url) {
            logStructured('ERROR', 'Failed to download image', {
              error: downloadResult.error,
              mediaId: mediaId,
            }, ErrorCodes.MEDIA_DOWNLOAD_FAILED);

            await sendErrorMessage(phone, 'DOCUMENT_UNCLEAR', language);

            Annotations.setSuccess(false);
            Annotations.setErrorCode(ErrorCodes.MEDIA_DOWNLOAD_FAILED);

            return {
              success: false,
              error: downloadResult.error || 'Failed to download image',
            };
          }

          logStructured('INFO', 'Image downloaded successfully', { s3Url: downloadResult.s3Url });

          const kycImageKey = `kyc-documents/${phone}/${Date.now()}-${mediaId}.jpg`;

          if (downloadResult.buffer) {
            await traceSubsegment('uploadToS3WithKMS', async () => {
              await s3Client.send(new PutObjectCommand({
                Bucket: KYC_BUCKET_NAME,
                Key: kycImageKey,
                Body: downloadResult.buffer,
                ContentType: downloadResult.mimeType || 'image/jpeg',
                ServerSideEncryption: 'aws:kms',
                SSEKMSKeyId: KMS_KEY_ID,
              }));
            });

            logStructured('INFO', 'Image uploaded with KMS encryption', { key: kycImageKey });
          }

          const kycImageUrl = `s3://${KYC_BUCKET_NAME}/${kycImageKey}`;

          logStructured('INFO', 'Calling document-extraction Lambda');
          const extractionResult = await traceSubsegment('documentExtraction', async () => {
            return callDocumentExtraction(kycImageUrl, phone);
          });

          if (!extractionResult.success || !extractionResult.data) {
            logStructured('ERROR', 'Document extraction failed', {
              error: extractionResult.error,
            }, ErrorCodes.DOCUMENT_EXTRACTION_FAILED);

            await sendErrorMessage(phone, 'DOCUMENT_UNCLEAR', language);

            Annotations.setSuccess(false);
            Annotations.setErrorCode(ErrorCodes.DOCUMENT_EXTRACTION_FAILED);

            return {
              success: false,
              error: extractionResult.error?.message || 'Document extraction failed',
            };
          }

          const extractedData = extractionResult.data;
          logStructured('INFO', 'Document extraction successful', {
            documentType: extractedData.documentType,
            hasPAN: !!extractedData.panNumber,
            hasAadhaar: !!extractedData.aadharNumber,
          });

          await sendTypingIndicator(phone);

          await new Promise(resolve => setTimeout(resolve, 500));

          const validation = validateKYCData(extractedData);
          if (!validation.valid) {
            logStructured('ERROR', 'KYC validation failed', {
              error: validation.error,
            }, validation.error || ErrorCodes.INVALID_PAN_FORMAT);

            await sendErrorMessage(
              phone,
              (validation.error === 'INVALID_PAN' || validation.error === 'NOT_PAN_CARD') ? 'KYC_INVALID_DOCUMENT' : 'KYC_ERROR',
              language
            );

            Annotations.setSuccess(false);
            Annotations.setErrorCode(validation.error || ErrorCodes.INVALID_PAN_FORMAT);

            return {
              success: false,
              error: validation.error,
            };
          }

          await sendTypingIndicator(phone);

          logStructured('INFO', 'Calling seller-registration Lambda');
          const registrationResult = await traceSubsegment('sellerRegistration', async () => {
            return callSellerRegistration({
              extractedData,
              phone: phone,
              language: language.split('-')[0] as 'hi' | 'mr' | 'en',
              documentUrls: [kycImageUrl],
            });
          });

          if (!registrationResult.success || !registrationResult.sellerId) {
            logStructured('ERROR', 'Seller registration failed', {
              error: registrationResult.error,
            }, ErrorCodes.KYC_REGISTRATION_FAILED);

            await sendErrorMessage(phone, 'KYC_ERROR', language);

            Annotations.setSuccess(false);
            Annotations.setErrorCode(ErrorCodes.KYC_REGISTRATION_FAILED);

            return {
              success: false,
              error: registrationResult.error?.message || 'Seller registration failed',
            };
          }

          logStructured('INFO', 'Seller registration successful', {
            sellerId: registrationResult.sellerId,
          });

          await traceSubsegment('updateUserState', async () => {
            await updateUserState(phone, 'KYC_VERIFIED');
            await updateUserSellerId(phone, registrationResult.sellerId!);
          });

          logStructured('INFO', 'User state updated to KYC_VERIFIED');

          await new Promise(resolve => setTimeout(resolve, 1000));
          const extractedName = extractedData.name?.value || '';
          await sendSuccessMessage(phone, language, extractedName, extractedData.panNumber?.value || '');
          logStructured('INFO', 'Success message sent');

          try {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const { sendOnboardingGuide } = await import('../services/onboarding-guide');
            await sendOnboardingGuide(phone, language);

            await updateUserState(phone, 'KYC_VERIFIED', { guideSent: true });
            logStructured('INFO', 'Onboarding guide sent');
          } catch (guideError: any) {
            logStructured('WARN', 'Onboarding guide failed (non-fatal, KYC already verified)', {
              error: guideError.message,
            });
          }

          Annotations.setSuccess(true);
          Metadata.setResponseDetails({
            sellerId: registrationResult.sellerId,
            state: 'KYC_VERIFIED',
          });

          return {
            success: true,
            sellerId: registrationResult.sellerId,
          };
        },
        'KYC_HANDLER',
        { phone: phone, mediaId: mediaId }
      );
    },
    { phone: phone }
  ).catch(async (error: any) => {
    logStructured('CRITICAL', 'KYC handler error', {
      phone: phone,
      error: error.message,
      stack: error.stack,
    }, error.code || ErrorCodes.UNEXPECTED_ERROR);

    Annotations.setSuccess(false);
    Annotations.setErrorCode(error.code || ErrorCodes.UNEXPECTED_ERROR);
    Metadata.setErrorDetails(error);

    try {
      const userState = await getUserState(phone);
      if (userState?.state !== 'KYC_VERIFIED') {
        const language = getLanguagePreference(userState?.language);
        await sendErrorMessage(phone, 'KYC_ERROR', language);
      } else {
        logStructured('WARN', 'Skipping KYC_ERROR message — user already KYC_VERIFIED', { phone });
      }
    } catch (msgError) {
      logStructured('ERROR', 'Failed to send error message', {
        error: msgError,
      });
    }

    return {
      success: false,
      error: error.message || 'Unknown error during KYC processing',
    };
  });
});

async function callDocumentExtraction(
  documentUrl: string,
  sellerId: string
): Promise<DocumentExtractionResponse> {
  const payload = {
    documentUrl,
    sellerId,
  };

  const command = new InvokeCommand({
    FunctionName: process.env.DOCUMENT_EXTRACTION_LAMBDA_NAME || 'vyapar-vaani-document-extraction',
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify(payload),
  });

  const response = await lambdaClient.send(command);

  if (!response.Payload) {
    throw new Error('No response from document-extraction Lambda');
  }

  const result = JSON.parse(Buffer.from(response.Payload).toString());
  return result as DocumentExtractionResponse;
}

function validateKYCData(data: ExtractedKYCData): { valid: boolean; error?: string } {

  if (data.documentType === 'UNKNOWN') {
    return {
      valid: false,
      error: 'NOT_PAN_CARD',
    };
  }

  if (!data.panNumber || !data.panNumber.value) {
    return {
      valid: false,
      error: 'NOT_PAN_CARD',
    };
  }

  if (!PAN_REGEX.test(data.panNumber.value)) {
    return {
      valid: false,
      error: 'INVALID_PAN',
    };
  }

  if (!data.aadharNumber || !data.aadharNumber.value) {
    logStructured('WARN', 'Aadhaar not found - proceeding with PAN only', {
      panNumber: data.panNumber.value,
    });
  }

  if (data.overallConfidence < 0.5) {
    return {
      valid: false,
      error: 'LOW_CONFIDENCE',
    };
  }

  return { valid: true };
}

async function callSellerRegistration(
  request: SellerRegistrationRequest
): Promise<SellerRegistrationResponse> {
  const command = new InvokeCommand({
    FunctionName: process.env.SELLER_REGISTRATION_LAMBDA_NAME || 'vyapar-vaani-seller-registration',
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify(request),
  });

  const response = await lambdaClient.send(command);

  if (!response.Payload) {
    throw new Error('No response from seller-registration Lambda');
  }

  const result = JSON.parse(Buffer.from(response.Payload).toString());
  return result as SellerRegistrationResponse;
}

async function sendFeedbackMessage(
  phone: string,
  messageKey: 'DOCUMENT_RECEIVED' | 'DOCUMENT_VERIFIED' | 'REGISTERING_SELLER',
  language: 'hi-IN' | 'mr-IN' | 'en-IN'
): Promise<void> {
  const message = translateMessage(messageKey, language);
  const langCode = language.split('-')[0] as 'hi' | 'mr' | 'en';

  const { sendVoiceOnly, sendTypingIndicator } = await import('./whatsapp-message-sender');

  await sendTypingIndicator(phone);

  await sendVoiceOnly(phone, message, langCode);
}

async function sendSuccessMessage(
  phone: string,
  language: 'hi-IN' | 'mr-IN' | 'en-IN',
  extractedName: string,
  panNumber: string
): Promise<void> {
  const langCode = language.split('-')[0] as 'hi' | 'mr' | 'en';
  const { sendTextMessage, sendVoiceOnly, sendTypingIndicator } = await import('./whatsapp-message-sender');

  await sendTypingIndicator(phone);

  const panDisplay = panNumber ? `${panNumber.slice(0, 3)}****${panNumber.slice(-1)}` : '';
  const nameBlock = extractedName ? `\nनाम: ${extractedName}` : '';
  const nameBlockMr = extractedName ? `\nनाव: ${extractedName}` : '';
  const nameBlockEn = extractedName ? `\nName: ${extractedName}` : '';
  const textData: Record<string, string> = {
    'hi-IN': `✅ वेरिफिकेशन सफल!${nameBlock}\nPAN: ${panDisplay}\nस्टेटस: Verified`,
    'mr-IN': `✅ व्हेरिफिकेशन यशस्वी!${nameBlockMr}\nPAN: ${panDisplay}\nस्टेटस: Verified`,
    'en-IN': `✅ Verification successful!${nameBlockEn}\nPAN: ${panDisplay}\nStatus: Verified`,
  };
  await sendTextMessage(phone, textData[language] || textData['hi-IN']);

  const nameJi = extractedName ? `${extractedName} ji` : '';
  const voiceMsg: Record<string, string> = {
    'hi-IN': `${nameJi ? nameJi + ', ' : ''}aapka PAN card verify ho gaya hai. Ab aap apne products add kar sakte hain. Bas apne product ka naam, daam aur photo bhejiye. Ya phir UPI ID bhejiye taaki customers seedha payment kar sakein.`,
    'mr-IN': `${nameJi ? nameJi + ', ' : ''}tumcha PAN card verify zala aahe. Aata tumhi tumche products add karu shakta. Phakta tumchya product che naav, kimmat aani photo pathva. Kinva UPI ID pathva mhanje customers direct payment karu shakatil.`,
    'en-IN': `${nameJi ? nameJi + ', ' : ''}your PAN card has been verified. You can now add your products. Just send the product name, price and photo. Or send your UPI ID so customers can pay you directly.`,
  };

  await new Promise(resolve => setTimeout(resolve, 1000));
  await sendVoiceOnly(phone, voiceMsg[language] || voiceMsg['hi-IN'], langCode);
}

async function sendErrorMessage(
  phone: string,
  messageKey: 'DOCUMENT_UNCLEAR' | 'KYC_INVALID_DOCUMENT' | 'KYC_ERROR',
  language: 'hi-IN' | 'mr-IN' | 'en-IN'
): Promise<void> {
  const langCode = language.split('-')[0] as 'hi' | 'mr' | 'en';

  const errorMessages: Record<string, Record<string, string>> = {
    'DOCUMENT_UNCLEAR': {
      'hi-IN': 'Aapki document photo saaf nahi aayi. Kripya PAN card ki photo dubara bhejiye, acchi roshni mein aur poora card dikhna chahiye.',
      'mr-IN': 'Tumchya document chi photo spasht nahi aali. Krupya PAN card chi photo punha pathva, changlyaa prakashat aani poorna card disayla have.',
      'en-IN': 'Your document photo was not clear. Please send the PAN card photo again, in good lighting with the full card visible.',
    },
    'KYC_INVALID_DOCUMENT': {
      'hi-IN': 'Ye PAN card nahi lag raha. Kripya apne PAN card ki saaf photo bhejiye. PAN number card pe clearly dikhna chahiye.',
      'mr-IN': 'He PAN card nahi disatay. Krupya tumchya PAN card chi spasht photo pathva. PAN number card var clearly disayla have.',
      'en-IN': 'This doesn\'t appear to be a PAN card. Please send a clear photo of your PAN card with the PAN number clearly visible.',
    },
    'KYC_ERROR': {
      'hi-IN': 'Document check karne mein thodi dikkat hui. Kripya ek baar phir se PAN card ki photo bhejiye. Ya "skip" bolke guest mode mein shuru kar sakte hain.',
      'mr-IN': 'Document check kartana thodi adchan aali. Krupya ek vela punha PAN card chi photo pathva. Kinva "skip" bolun guest mode madhye suru karu shakta.',
      'en-IN': 'Had some trouble checking your document. Please send the PAN card photo once more. Or say "skip" to start in guest mode.',
    },
  };

  const message = errorMessages[messageKey]?.[language] || errorMessages[messageKey]?.['hi-IN'] || 'Kripya dubara koshish karein.';

  const { sendVoiceOnly, sendTypingIndicator } = await import('./whatsapp-message-sender');
  await sendTypingIndicator(phone);
  await sendVoiceOnly(phone, message, langCode);
}

async function sendUpiNudgeMessage(
  phone: string,
  language: 'hi-IN' | 'mr-IN' | 'en-IN',
  extractedName?: string
): Promise<void> {
  const nameJi = extractedName ? `${extractedName} ji, ` : '';
  const upiNudge: Record<string, string> = {
    'hi-IN': `${nameJi}agar aap apna UPI ID bhej dein toh customers seedha aapko payment kar payenge. Bas apna UPI ID bhejiye, jaise yourname at upi ya phone number at paytm.`,
    'mr-IN': `${nameJi}tumhi tumcha UPI ID pathavla tar customers direct tumhala payment karu shakatil. Tumcha UPI ID pathva, jase yourname at upi kinva phone number at paytm.`,
    'en-IN': `${nameJi}if you send your UPI ID, customers can pay you directly. Just send your UPI ID, like yourname at upi or phone number at paytm.`,
  };

  const message = upiNudge[language] || upiNudge['hi-IN'];
  const langCode = language.split('-')[0] as 'hi' | 'mr' | 'en';

  const { sendVoiceOnly, sendTypingIndicator } = await import('./whatsapp-message-sender');
  await sendTypingIndicator(phone);
  await sendVoiceOnly(phone, message, langCode);
}
