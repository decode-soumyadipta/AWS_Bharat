/**
 * Image Handler Lambda
 * 
 * Processes product photos from WhatsApp messages, enhances them using Titan,
 * and prepares for confirmation workflow.
 * 
 * Features:
 * - Downloads images from WhatsApp Media API
 * - Uploads original images to S3
 * - Calls image-enhancement Lambda for professional quality
 * - Stores both original and enhanced image URLs in partial data
 * - Updates user state to CONFIRMATION_PENDING
 * - Sends confirmation message with product summary
 * 
 * Validates: Requirements 5.2, 5.3, 5.4, 5.5
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { downloadImage } from '../services/media-download';
import { getUserState, updateUserState } from '../services/state-manager';
import { getPartialData, savePartialData } from '../services/partial-data-store';
import { sendTextMessage } from './whatsapp-message-sender';
import { PRODUCTS_BUCKET_NAME } from '../config/aws-clients';
import { ImageEnhancementRequest, ImageEnhancementResponse } from './image-enhancement';

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });

export interface ImageHandlerRequest {
  phone: string;
  mediaId: string;
  messageId: string;
}

export interface ImageHandlerResponse {
  success: boolean;
  originalImageUrl?: string;
  enhancedImageUrl?: string;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Lambda handler for image processing
 */
export const handler = async (
  event: any
): Promise<ImageHandlerResponse> => {
  console.log('Image handler request:', JSON.stringify(event, null, 2));

  try {
    // Extract request data
    let phone: string;
    let mediaId: string;
    let messageId: string;

    if (event.detail) {
      // EventBridge event format
      phone = event.detail.phone;
      // Try multiple possible locations for media ID
      mediaId = event.detail.content?.mediaId || 
                event.detail.content?.mediaUrl || 
                event.detail.content?.image?.id;
      messageId = event.detail.messageId;
    } else {
      // Direct invocation format
      phone = event.phone;
      mediaId = event.mediaId;
      messageId = event.messageId;
    }

    if (!phone || !mediaId) {
      throw new Error('Phone number and media ID are required');
    }

    // Get user state
    const userState = await getUserState(phone);
    console.log('User state:', userState);

    if (!userState) {
      throw new Error(`User state not found for phone: ${phone}`);
    }

    // Convert language format from 'hi-IN' to 'hi'
    const langCode = (userState.language?.split('-')[0] || 'hi') as 'hi' | 'mr' | 'en';

    // Verify user is in IMAGE_PENDING state
    if (userState.state !== 'IMAGE_PENDING') {
      console.warn(`User ${phone} sent image but is in state ${userState.state}`);
      await sendTextMessage(
        phone,
        'कृपया पहले उत्पाद की जानकारी दें। Please provide product information first.',
        langCode
      );
      return {
        success: false,
        error: {
          code: 'INVALID_STATE',
          message: `Expected IMAGE_PENDING state, got ${userState.state}`,
        },
      };
    }

    // Get partial data
    const partialData = await getPartialData(phone);
    if (!partialData) {
      throw new Error('No partial data found for user');
    }

    console.log('Partial data:', partialData);

    // Download image from WhatsApp (no progress message - keep it fast)
    console.log('Downloading image from WhatsApp:', mediaId);
    const downloadResult = await downloadImage(mediaId, PRODUCTS_BUCKET_NAME);

    if (!downloadResult.success || !downloadResult.s3Url) {
      console.error('Failed to download image:', downloadResult.error);
      await sendTextMessage(
        phone,
        'छवि डाउनलोड करने में त्रुटि। कृपया पुनः प्रयास करें। Error downloading image. Please try again.',
        langCode
      );
      return {
        success: false,
        error: {
          code: 'DOWNLOAD_FAILED',
          message: downloadResult.error || 'Failed to download image',
        },
      };
    }

    const originalImageUrl = downloadResult.s3Url;
    console.log('Original image uploaded:', originalImageUrl);

    // Call image enhancement Lambda (no progress message - keep it fast)
    console.log('Calling image enhancement Lambda');
    const enhancementRequest: ImageEnhancementRequest = {
      rawImageUrl: originalImageUrl,
      productName: partialData.productName || 'Product',
      productCategory: partialData.category,
      itemId: `item-${Date.now()}`,
      sellerId: phone.replace(/\+/g, ''),
    };

    let enhancedImageUrl = originalImageUrl; // Fallback to original if enhancement fails

    try {
      const enhancementResponse = await invokeImageEnhancement(enhancementRequest);
      
      if (enhancementResponse.success && enhancementResponse.enhancedImageUrl) {
        enhancedImageUrl = enhancementResponse.enhancedImageUrl;
        console.log('Image enhanced successfully:', enhancedImageUrl);
      } else {
        console.warn('Image enhancement failed, using original:', enhancementResponse.error);
      }
    } catch (error: any) {
      console.error('Image enhancement error:', error);
      console.log('Falling back to original image');
    }

    // Update partial data with image URLs
    partialData.originalImageUrl = originalImageUrl;
    partialData.enhancedImageUrl = enhancedImageUrl;

    await savePartialData(phone, partialData);
    console.log('Updated partial data with image URLs');

    // Update state to CONFIRMATION_PENDING
    await updateUserState(phone, 'CONFIRMATION_PENDING', {
      enhancedImageUrl,
      originalImageUrl,
    });
    console.log('Updated state to CONFIRMATION_PENDING');

    // Call confirmation-handler Lambda to generate confirmation with image and buttons
    console.log('Calling confirmation-handler Lambda');
    const confirmationRequest = {
      detail: {
        phone,
        action: 'generate',
      },
    };

    const confirmationCommand = new InvokeCommand({
      FunctionName: process.env.CONFIRMATION_HANDLER_FUNCTION_NAME || 'vyapar-vaani-confirmation-handler',
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify(confirmationRequest),
    });

    try {
      const confirmationResponse = await lambdaClient.send(confirmationCommand);
      if (confirmationResponse.Payload) {
        const result = JSON.parse(new TextDecoder().decode(confirmationResponse.Payload));
        console.log('Confirmation handler result:', result);
      }
    } catch (error: any) {
      console.error('Failed to call confirmation handler:', error);
      // Fallback to simple text message
      await sendConfirmationMessage(phone, partialData, userState.language || 'hi');
    }

    return {
      success: true,
      originalImageUrl,
      enhancedImageUrl,
    };
  } catch (error: any) {
    console.error('Image handler failed:', error);

    return {
      success: false,
      error: {
        code: error.name || 'IMAGE_HANDLER_ERROR',
        message: error.message || 'Failed to process image',
      },
    };
  }
};

/**
 * Invoke image enhancement Lambda
 */
async function invokeImageEnhancement(
  request: ImageEnhancementRequest
): Promise<ImageEnhancementResponse> {
  const command = new InvokeCommand({
    FunctionName: process.env.IMAGE_ENHANCEMENT_FUNCTION_NAME || 'vyapar-vaani-image-enhancement',
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify(request),
  });

  const response = await lambdaClient.send(command);
  
  if (!response.Payload) {
    throw new Error('No response from image enhancement Lambda');
  }

  const payload = JSON.parse(new TextDecoder().decode(response.Payload));
  return payload as ImageEnhancementResponse;
}

/**
 * Send confirmation message to user
 */
async function sendConfirmationMessage(
  phone: string,
  partialData: any,
  language: string
): Promise<void> {
  // Convert language format from 'hi-IN' to 'hi'
  const langCode = language.split('-')[0] as 'hi' | 'mr' | 'en';
  
  const messages: Record<string, string> = {
    'hi': `✅ उत्पाद की छवि प्राप्त हुई!\n\nउत्पाद: ${partialData.productName}\nकीमत: ₹${partialData.price}\nमात्रा: ${partialData.quantity} ${partialData.unit}\n\nकृपया पुष्टि करें कि यह जानकारी सही है।`,
    'mr': `✅ उत्पादाची प्रतिमा प्राप्त झाली!\n\nउत्पाद: ${partialData.productName}\nकिंमत: ₹${partialData.price}\nप्रमाण: ${partialData.quantity} ${partialData.unit}\n\nकृपया पुष्टी करा की ही माहिती बरोबर आहे.`,
    'en': `✅ Product image received!\n\nProduct: ${partialData.productName}\nPrice: ₹${partialData.price}\nQuantity: ${partialData.quantity} ${partialData.unit}\n\nPlease confirm that this information is correct.`,
  };

  const message = messages[langCode] || messages['hi'];
  await sendTextMessage(phone, message, langCode);
}
