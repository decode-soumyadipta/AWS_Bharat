
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

const MODEL_ID = 'amazon.nova-pro-v1:0';

const CONFIDENCE_THRESHOLD = 0.7;

const MAX_TOKENS = 500;

export const handler = async (
  event: any
): Promise<IntentClassificationResponse> => {
  console.log('Intent classification request:', JSON.stringify(event, null, 2));

  try {

    let transcribedText: string;
    let phoneNumber: string;
    let messageId: string;

    if (event.detail && event.detail.content) {

      transcribedText = event.detail.content.text || event.detail.content.transcribedText || '';
      phoneNumber = event.detail.phone || '';
      messageId = event.detail.messageId || '';
    } else if (event.transcribedText) {

      transcribedText = event.transcribedText;
      phoneNumber = event.phoneNumber || '';
      messageId = event.messageId || '';
    } else {
      throw new Error('No text content found in event');
    }

    if (!transcribedText || transcribedText.trim().length === 0) {
      throw new Error('Transcribed text is required');
    }

    const prompt = constructIntentClassificationPrompt(transcribedText);
    console.log('Constructed prompt for Claude');

    const claudeResponse = await invokeClaudeModel(prompt);
    console.log('Claude response:', JSON.stringify(claudeResponse, null, 2));

    const { intent, confidence, language } = claudeResponse;

    const needsClarification = confidence < CONFIDENCE_THRESHOLD;

    if (needsClarification) {
      console.log(
        `Low confidence (${confidence}) - clarification needed`
      );
    }

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

function constructIntentClassificationPrompt(transcribedText: string): string {
  return `You are an intent classifier for an ONDC seller management system. 
The user is a rural merchant speaking in Hindi, Marathi, or English.

Classify the following transcribed voice note into ONE of these intents:
- CREATE_CATALOG: User wants to add a new product OR is providing product details (name, price, quantity, unit) for catalog creation
- UPDATE_PRICE: User EXPLICITLY wants to UPDATE/CHANGE the price of an EXISTING confirmed product (e.g., "update price to 600", "change price", "price ko badlo")
- UPDATE_QUANTITY: User EXPLICITLY wants to UPDATE/CHANGE the quantity of an EXISTING confirmed product (e.g., "update quantity to 50", "change quantity", "quantity ko badlo")
- UPDATE_INVENTORY: User wants to change stock quantity
- ACCEPT_ORDER: User wants to accept an order
- REJECT_ORDER: User wants to reject an order
- UPDATE_FULFILLMENT: User wants to update order status (packed, shipped, delivered)
- QUERY_STATUS: User wants to check order or catalog status
- CONFIRM_CATALOG: User confirms/accepts the catalog creation (e.g., 'swikar hai', 'स्वीकार है', 'yes', 'accept', 'ok', 'haan', 'हां', 'theek hai', 'ठीक है')
- CANCEL_ORDER: User wants to cancel the current order/product creation (e.g., 'cancel', 'रद्द करो', 'रद्द', 'cancel karo', 'nahi chahiye')

CRITICAL RULES:
1. If user is providing product details (price, quantity, unit) WITHOUT explicitly saying "update" or "change", classify as CREATE_CATALOG
2. UPDATE_PRICE is ONLY for explicitly updating an already confirmed product's price
3. UPDATE_QUANTITY is ONLY for explicitly updating an already confirmed product's quantity
4. When user says "I will sell X kg at Y rupees", this is CREATE_CATALOG, NOT UPDATE_PRICE

EXAMPLES:
Input: "मैं 6 kg आम ₹10000 प्रति किलो के भाव में बेचूँगा"
Output: {"intent": "CREATE_CATALOG", "confidence": 0.95, "language": "hi"}
Why: User is providing product details for catalog creation

Input: "कीमत 600 रुपये करें"
Output: {"intent": "UPDATE_PRICE", "confidence": 0.95, "language": "hi"}
Why: User explicitly wants to update/change price

Input: "price 500 and quantity 10 kg"
Output: {"intent": "CREATE_CATALOG", "confidence": 0.95, "language": "en"}
Why: User is providing product details, not updating existing product

Transcription: ${transcribedText}

Respond with ONLY a JSON object in this exact format (no additional text):
{
  "intent": "<INTENT_NAME>",
  "confidence": <0.0-1.0>,
  "language": "hi|mr|en"
}

Rules:
- intent must be one of the ten options listed above
- confidence must be a number between 0.0 and 1.0
- language should be "hi" for Hindi, "mr" for Marathi, or "en" for English
- UPDATE_PRICE is specifically for UPDATING price of EXISTING confirmed product
- UPDATE_QUANTITY is specifically for UPDATING quantity of EXISTING confirmed product
- CANCEL_ORDER is for canceling the ongoing order/product creation process
- Respond with ONLY the JSON object, no other text`;
}

async function invokeClaudeModel(prompt: string): Promise<ClaudeIntentResponse> {

  const requestBody = {
    messages: [
      {
        role: 'user',
        content: [
          {
            text: prompt,
          },
        ],
      },
    ],
    inferenceConfig: {
      max_new_tokens: MAX_TOKENS,
      temperature: 0.0, 
    },
  };

  console.log('Invoking Amazon Nova Pro:', MODEL_ID);

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody),
  });

  const response = await bedrockClient.send(command);

  if (!response.body) {
    throw new Error('Empty response from Nova');
  }

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  console.log('Nova raw response:', JSON.stringify(responseBody, null, 2));

  if (!responseBody.output?.message?.content || !Array.isArray(responseBody.output.message.content)) {
    throw new Error('No content in Nova response');
  }

  const textContent = responseBody.output.message.content.find((item: any) => item.text)?.text;
  if (!textContent) {
    throw new Error('No text in Nova response content');
  }

  const intentResponse = parseIntentResponse(textContent);

  validateIntentResponse(intentResponse);

  return intentResponse;
}

function parseIntentResponse(text: string): ClaudeIntentResponse {
  try {

    let cleanedText = text.trim();
    if (cleanedText.startsWith('```json')) {
      cleanedText = cleanedText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/```\n?/g, '');
    }

    const parsed = JSON.parse(cleanedText);
    return parsed as ClaudeIntentResponse;
  } catch (error) {
    console.error('Failed to parse Claude response as JSON:', text);
    throw new Error(`Invalid JSON response from Claude: ${error}`);
  }
}

function validateIntentResponse(response: ClaudeIntentResponse): void {
  const validIntents: IntentType[] = [
    'CREATE_CATALOG',
    'UPDATE_PRICE',
    'UPDATE_QUANTITY',
    'UPDATE_INVENTORY',
    'ACCEPT_ORDER',
    'REJECT_ORDER',
    'CANCEL_ORDER',
    'UPDATE_FULFILLMENT',
    'QUERY_STATUS',
    'CONFIRM_CATALOG',
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
