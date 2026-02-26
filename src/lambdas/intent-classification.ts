/**
 * Intent Classification Lambda
 * 
 * This Lambda function classifies user intent from transcribed voice notes
 * using Claude 3.5 Sonnet via Amazon Bedrock.
 * 
 * Features:
 * - Constructs prompt with transcribed text and intent options
 * - Calls Amazon Bedrock InvokeModel API with Claude 3.5 Sonnet
 * - Parses JSON response to extract intent and confidence
 * - Supports intents: CREATE_CATALOG, UPDATE_INVENTORY, ACCEPT_ORDER, 
 *   REJECT_ORDER, UPDATE_FULFILLMENT, QUERY_STATUS
 * - Handles low confidence scores (< 70%) by flagging for clarification
 * 
 * Validates: Requirements 2.2, 4.2, 4.3, 12.8
 */

import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { bedrockClient, eventBridgeClient } from '../config/aws-clients';
import {
  IntentClassificationRequest,
  IntentClassificationResponse,
  IntentType,
  ClaudeIntentResponse,
} from '../models/intent';
import { EVENT_SOURCES, INTERNAL_EVENT_TYPES } from '../config/event-patterns';

/**
 * Claude 3 Haiku model ID - faster and more cost-effective
 */
const CLAUDE_MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';

/**
 * Confidence threshold for requiring clarification
 */
const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Maximum tokens for Claude response
 */
const MAX_TOKENS = 500;

/**
 * Lambda handler for intent classification
 */
export const handler = async (
  event: any
): Promise<IntentClassificationResponse> => {
  console.log('Intent classification request:', JSON.stringify(event, null, 2));

  try {
    // Handle EventBridge event format
    let transcribedText: string;
    let phoneNumber: string;
    let messageId: string;
    
    if (event.detail && event.detail.content) {
      // EventBridge event from WhatsApp webhook
      transcribedText = event.detail.content.text || event.detail.content.transcribedText || '';
      phoneNumber = event.detail.phone || '';
      messageId = event.detail.messageId || '';
    } else if (event.transcribedText) {
      // Direct invocation format
      transcribedText = event.transcribedText;
      phoneNumber = event.phoneNumber || '';
      messageId = event.messageId || '';
    } else {
      throw new Error('No text content found in event');
    }

    // Validate input
    if (!transcribedText || transcribedText.trim().length === 0) {
      throw new Error('Transcribed text is required');
    }

    // Construct prompt for Claude
    const prompt = constructIntentClassificationPrompt(transcribedText);
    console.log('Constructed prompt for Claude');

    // Call Claude via Bedrock
    const claudeResponse = await invokeClaudeModel(prompt);
    console.log('Claude response:', JSON.stringify(claudeResponse, null, 2));

    // Parse and validate response
    const { intent, confidence, language } = claudeResponse;

    // Check if clarification is needed
    const needsClarification = confidence < CONFIDENCE_THRESHOLD;

    if (needsClarification) {
      console.log(
        `Low confidence (${confidence}) - clarification needed`
      );
    }

    // Publish intent classified event to EventBridge
    if (phoneNumber && messageId) {
      await publishIntentClassifiedEvent({
        messageId,
        phoneNumber,
        transcribedText,
        intent,
        confidence,
        language,
        needsClarification,
      });
    }

    return {
      success: true,
      intent,
      confidence,
      language,
      needsClarification,
    };
  } catch (error: any) {
    console.error('Intent classification failed:', error);

    return {
      success: false,
      error: {
        code: error.name || 'CLASSIFICATION_ERROR',
        message: error.message || 'Failed to classify intent',
      },
    };
  }
};

/**
 * Construct prompt for intent classification
 */
function constructIntentClassificationPrompt(transcribedText: string): string {
  return `You are an intent classifier for an ONDC seller management system. 
The user is a rural merchant speaking in Hindi, Marathi, or English.

Classify the following transcribed voice note into ONE of these intents:
- CREATE_CATALOG: User wants to add a new product
- UPDATE_INVENTORY: User wants to change stock quantity
- ACCEPT_ORDER: User wants to accept an order
- REJECT_ORDER: User wants to reject an order
- UPDATE_FULFILLMENT: User wants to update order status (packed, shipped, delivered)
- QUERY_STATUS: User wants to check order or catalog status

Transcription: ${transcribedText}

Respond with ONLY a JSON object in this exact format (no additional text):
{
  "intent": "<INTENT_NAME>",
  "confidence": <0.0-1.0>,
  "language": "hi|mr|en"
}

Rules:
- intent must be one of the six options listed above
- confidence must be a number between 0.0 and 1.0
- language should be "hi" for Hindi, "mr" for Marathi, or "en" for English
- Respond with ONLY the JSON object, no other text`;
}

/**
 * Invoke Claude model via Amazon Bedrock
 */
async function invokeClaudeModel(prompt: string): Promise<ClaudeIntentResponse> {
  // Construct request body for Claude
  const requestBody = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: MAX_TOKENS,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.0, // Use deterministic output for classification
  };

  console.log('Invoking Claude model:', CLAUDE_MODEL_ID);

  // Invoke model
  const command = new InvokeModelCommand({
    modelId: CLAUDE_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody),
  });

  const response = await bedrockClient.send(command);

  // Parse response
  if (!response.body) {
    throw new Error('Empty response from Claude');
  }

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  console.log('Claude raw response:', JSON.stringify(responseBody, null, 2));

  // Extract text from Claude response
  const contentBlocks = responseBody.content;
  if (!contentBlocks || contentBlocks.length === 0) {
    throw new Error('No content in Claude response');
  }

  const textContent = contentBlocks[0].text;
  if (!textContent) {
    throw new Error('No text in Claude response content');
  }

  // Parse JSON from text content
  const intentResponse = parseIntentResponse(textContent);

  // Validate response structure
  validateIntentResponse(intentResponse);

  return intentResponse;
}

/**
 * Parse intent response from Claude's text output
 */
function parseIntentResponse(text: string): ClaudeIntentResponse {
  try {
    // Remove any markdown code blocks if present
    let cleanedText = text.trim();
    if (cleanedText.startsWith('```json')) {
      cleanedText = cleanedText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/```\n?/g, '');
    }

    // Parse JSON
    const parsed = JSON.parse(cleanedText);
    return parsed as ClaudeIntentResponse;
  } catch (error) {
    console.error('Failed to parse Claude response as JSON:', text);
    throw new Error(`Invalid JSON response from Claude: ${error}`);
  }
}

/**
 * Validate intent response structure
 */
function validateIntentResponse(response: ClaudeIntentResponse): void {
  const validIntents: IntentType[] = [
    'CREATE_CATALOG',
    'UPDATE_INVENTORY',
    'ACCEPT_ORDER',
    'REJECT_ORDER',
    'UPDATE_FULFILLMENT',
    'QUERY_STATUS',
  ];

  if (!response.intent || !validIntents.includes(response.intent)) {
    throw new Error(`Invalid intent: ${response.intent}`);
  }

  if (
    typeof response.confidence !== 'number' ||
    response.confidence < 0 ||
    response.confidence > 1
  ) {
    throw new Error(`Invalid confidence score: ${response.confidence}`);
  }

  const validLanguages = ['hi', 'mr', 'en'];
  if (!response.language || !validLanguages.includes(response.language)) {
    throw new Error(`Invalid language: ${response.language}`);
  }
}

/**
 * Publish intent classified event to EventBridge
 */
async function publishIntentClassifiedEvent(data: {
  messageId: string;
  phoneNumber: string;
  transcribedText: string;
  intent: IntentType;
  confidence: number;
  language: string;
  needsClarification: boolean;
}): Promise<void> {
  const eventBusName = process.env.EVENT_BUS_NAME;
  if (!eventBusName) {
    console.warn('EVENT_BUS_NAME not configured - skipping event publication');
    return;
  }

  const command = new PutEventsCommand({
    Entries: [
      {
        Source: EVENT_SOURCES.INTERNAL,
        DetailType: INTERNAL_EVENT_TYPES.INTENT_CLASSIFIED,
        Detail: JSON.stringify({
          messageId: data.messageId,
          phone: data.phoneNumber,
          transcribedText: data.transcribedText,
          intent: data.intent,
          confidence: data.confidence,
          language: data.language,
          needsClarification: data.needsClarification,
        }),
        EventBusName: eventBusName,
      },
    ],
  });

  const response = await eventBridgeClient.send(command);
  console.log('Published intent classified event:', {
    messageId: data.messageId,
    intent: data.intent,
    eventId: response.Entries?.[0]?.EventId,
  });
}
