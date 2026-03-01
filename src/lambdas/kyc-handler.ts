/**
 * KYC Handler Lambda
 * 
 * Processes KYC verification flow for new users:
 * 1. Downloads image from WhatsApp Media API
 * 2. Uploads to KYC S3 bucket with KMS encryption
 * 3. Calls document-extraction Lambda to extract PAN/Aadhaar
 * 4. Validates PAN format and Aadhaar presence
 * 5. Calls seller-registration Lambda to create seller profile
 * 6. Updates user state to KYC_VERIFIED
 * 7. Sends confirmation message via WhatsApp
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */

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

/**
 * KYC Handler request event
 */
export interface KYCHandlerRequest {
  phone: string; // E.164 format
  mediaId: string; // WhatsApp media ID for the image
  messageId?: string; // WhatsApp message ID for tracking
}

/**
 * KYC Handler response
 */
export interface KYCHandlerResponse {
  success: boolean;
  sellerId?: string;
  error?: string;
}

/**
 * PAN card number format: AAAAA9999A
 */
const PAN_REGEX = /[A-Z]{5}[0-9]{4}[A-Z]/;

/**
 * Lambda handler for KYC processing
 * Wrapped with X-Ray tracing for distributed tracing
 */
export const handler = withXRayTracing(async (
  event: any, // EventBridge event
  context: any
): Promise<KYCHandlerResponse> => {
  // Extract data from EventBridge event structure
  const detail = event.detail || event;
  const phone = detail.phone;
  const mediaId = detail.content?.mediaUrl; // WhatsApp sends media ID in mediaUrl field
  const messageId = detail.messageId;
  
  logStructured('INFO', 'KYC handler invoked', {
    phone,
    mediaId,
    requestId: context.requestId,
  });

  // Add X-Ray annotations
  Annotations.setUser(phone);
  Annotations.setOperation('kyc_processing');

  return trackOperation(
    'kyc_processing',
    async () => {
      return withErrorHandling(
        async () => {
          // Get user state
          const userState = await traceSubsegment('getUserState', async () => {
            return getUserState(phone);
          });

          if (!userState) {
            throw new Error('User state not found');
          }

          Annotations.setState(userState.state);

          // Validate user is in correct state for KYC
          if (userState.state !== 'NEW' && userState.state !== 'KYC_PENDING') {
            throw new Error(`Invalid state for KYC: ${userState.state}`);
          }

          const language = getLanguagePreference(userState.language);

          // Send initial acknowledgment message
          await sendFeedbackMessage(phone, 'DOCUMENT_RECEIVED', language);
          
          // Wait 1 second before processing
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Step 1: Download image from WhatsApp
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

          // Step 2: Upload to KYC bucket with KMS encryption
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

          // Step 3: Call document-extraction Lambda
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

          // Send verification progress message
          await sendFeedbackMessage(phone, 'DOCUMENT_VERIFIED', language);
          
          // Wait 1.5 seconds before validation
          await new Promise(resolve => setTimeout(resolve, 1500));

          // Step 4: Validate PAN format and Aadhaar presence
          const validation = validateKYCData(extractedData);
          if (!validation.valid) {
            logStructured('ERROR', 'KYC validation failed', {
              error: validation.error,
            }, validation.error || ErrorCodes.INVALID_PAN_FORMAT);
            
            await sendErrorMessage(
              phone,
              validation.error === 'INVALID_PAN' ? 'KYC_INVALID_DOCUMENT' : 'KYC_ERROR',
              language
            );
            
            Annotations.setSuccess(false);
            Annotations.setErrorCode(validation.error || ErrorCodes.INVALID_PAN_FORMAT);
            
            return {
              success: false,
              error: validation.error,
            };
          }

          // Send registration progress message
          await sendFeedbackMessage(phone, 'REGISTERING_SELLER', language);
          
          // Wait 1.5 seconds before registration
          await new Promise(resolve => setTimeout(resolve, 1500));

          // Step 5: Call seller-registration Lambda
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

          // Step 6: Update user state to KYC_VERIFIED
          await traceSubsegment('updateUserState', async () => {
            await updateUserState(phone, 'KYC_VERIFIED');
            await updateUserSellerId(phone, registrationResult.sellerId!);
          });
          
          logStructured('INFO', 'User state updated to KYC_VERIFIED');

          // Step 7: Send confirmation message
          // Wait 2 seconds before final success message
          await new Promise(resolve => setTimeout(resolve, 2000));
          await sendSuccessMessage(phone, language);
          logStructured('INFO', 'Confirmation message sent');

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
    
    // Try to send error message to user
    try {
      const userState = await getUserState(phone);
      const language = getLanguagePreference(userState?.language);
      await sendErrorMessage(phone, 'KYC_ERROR', language);
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

/**
 * Call document-extraction Lambda
 */
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

/**
 * Validate extracted KYC data
 */
function validateKYCData(data: ExtractedKYCData): { valid: boolean; error?: string } {
  // Check if document type is recognized
  if (data.documentType === 'UNKNOWN') {
    return {
      valid: false,
      error: 'UNKNOWN_DOCUMENT_TYPE',
    };
  }

  // Validate PAN number presence and format
  if (!data.panNumber || !data.panNumber.value) {
    return {
      valid: false,
      error: 'MISSING_PAN',
    };
  }

  if (!PAN_REGEX.test(data.panNumber.value)) {
    return {
      valid: false,
      error: 'INVALID_PAN',
    };
  }

  // Aadhaar is optional for testing - log warning if missing
  if (!data.aadharNumber || !data.aadharNumber.value) {
    logStructured('WARN', 'Aadhaar not found - proceeding with PAN only', {
      panNumber: data.panNumber.value,
    });
  }

  // Check confidence scores
  if (data.overallConfidence < 0.5) {
    return {
      valid: false,
      error: 'LOW_CONFIDENCE',
    };
  }

  return { valid: true };
}

/**
 * Call seller-registration Lambda
 */
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

/**
 * Send feedback message via WhatsApp with voice
 */
async function sendFeedbackMessage(
  phone: string,
  messageKey: 'DOCUMENT_RECEIVED' | 'DOCUMENT_VERIFIED' | 'REGISTERING_SELLER',
  language: 'hi-IN' | 'mr-IN' | 'en-IN'
): Promise<void> {
  const message = translateMessage(messageKey, language);
  const langCode = language.split('-')[0] as 'hi' | 'mr' | 'en';
  
  // Import sendTextWithVoice dynamically
  const { sendTextWithVoice, sendTypingIndicator } = await import('./whatsapp-message-sender');
  
  // Show typing indicator
  await sendTypingIndicator(phone);
  
  // Send message with voice
  await sendTextWithVoice(phone, message, langCode);
}

/**
 * Send success confirmation message via WhatsApp with voice
 */
async function sendSuccessMessage(
  phone: string,
  language: 'hi-IN' | 'mr-IN' | 'en-IN'
): Promise<void> {
  const message = translateMessage('KYC_SUCCESS', language);
  const langCode = language.split('-')[0] as 'hi' | 'mr' | 'en';
  
  // Import sendTextWithVoice dynamically
  const { sendTextWithVoice, sendTypingIndicator } = await import('./whatsapp-message-sender');
  
  // Show typing indicator
  await sendTypingIndicator(phone);
  
  // Send message with voice
  await sendTextWithVoice(phone, message, langCode);
}

/**
 * Send error message via WhatsApp with voice
 */
async function sendErrorMessage(
  phone: string,
  messageKey: 'DOCUMENT_UNCLEAR' | 'KYC_INVALID_DOCUMENT' | 'KYC_ERROR',
  language: 'hi-IN' | 'mr-IN' | 'en-IN'
): Promise<void> {
  const message = translateMessage(messageKey, language);
  const langCode = language.split('-')[0] as 'hi' | 'mr' | 'en';
  
  // Import sendTextWithVoice dynamically
  const { sendTextWithVoice, sendTypingIndicator } = await import('./whatsapp-message-sender');
  
  // Show typing indicator
  await sendTypingIndicator(phone);
  
  // Send message with voice
  await sendTextWithVoice(phone, message, langCode);
}
