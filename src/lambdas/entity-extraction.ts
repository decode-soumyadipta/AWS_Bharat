/**
 * Entity Extraction Lambda
 * 
 * This Lambda function extracts structured entities from transcribed voice notes
 * using Claude 3.5 Sonnet via Amazon Bedrock.
 * 
 * Features:
 * - Constructs intent-specific prompts for entity extraction
 * - For CREATE_CATALOG: extracts product_name, price, quantity, unit, description, category
 * - For UPDATE_INVENTORY: extracts product_identifier, new_quantity, operation
 * - For order intents: extracts order_id, action, reason
 * - Calls Amazon Bedrock InvokeModel API
 * - Parses JSON response and validates extracted entities
 * - Handles missing required fields by requesting clarification
 * 
 * Validates: Requirements 2.3, 4.4, 6.2
 */

import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { bedrockClient, eventBridgeClient } from '../config/aws-clients';
import {
  EntityExtractionRequest,
  EntityExtractionResponse,
  IntentType,
  CatalogEntities,
  InventoryEntities,
  OrderEntities,
} from '../models/intent';
import { EVENT_SOURCES, INTERNAL_EVENT_TYPES } from '../config/event-patterns';

/**
 * Claude 3 Haiku model ID - faster and more cost-effective
 */
const CLAUDE_MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';

/**
 * Maximum tokens for Claude response
 */
const MAX_TOKENS = 1000;

/**
 * Lambda handler for entity extraction
 */
export const handler = async (
  event: any
): Promise<EntityExtractionResponse> => {
  console.log('Entity extraction request:', JSON.stringify(event, null, 2));

  try {
    // Handle EventBridge event format
    let transcribedText: string;
    let intent: IntentType;
    let phoneNumber: string;
    let messageId: string;
    let language: string;

    if (event.detail) {
      // EventBridge event from intent classification
      transcribedText = event.detail.transcribedText || '';
      intent = event.detail.intent;
      phoneNumber = event.detail.phone || '';
      messageId = event.detail.messageId || '';
      language = event.detail.language || 'en';
    } else {
      // Direct invocation format
      transcribedText = event.transcribedText || '';
      intent = event.intent;
      phoneNumber = event.phoneNumber || '';
      messageId = event.messageId || '';
      language = event.language || 'en';
    }

    // Validate input
    if (!transcribedText || transcribedText.trim().length === 0) {
      throw new Error('Transcribed text is required');
    }

    if (!intent) {
      throw new Error('Intent is required');
    }

    // Construct intent-specific prompt
    const prompt = constructEntityExtractionPrompt(
      transcribedText,
      intent
    );
    console.log('Constructed prompt for Claude');

    // Call Claude via Bedrock
    const claudeResponse = await invokeClaudeModel(prompt);
    console.log('Claude response:', JSON.stringify(claudeResponse, null, 2));

    // Validate extracted entities
    const validationResult = validateEntities(claudeResponse, intent);

    // Send response to user via WhatsApp
    if (phoneNumber && messageId) {
      await sendWhatsAppResponse({
        phoneNumber,
        messageId,
        intent,
        entities: claudeResponse,
        language: language as 'hi' | 'mr' | 'en',
        needsClarification: validationResult.missingFields.length > 0,
        missingFields: validationResult.missingFields,
      });
    }

    // Publish entities extracted event for downstream processing
    if (!validationResult.missingFields.length && phoneNumber && messageId) {
      await publishEntitiesExtractedEvent({
        messageId,
        phoneNumber,
        intent,
        entities: claudeResponse,
        language: language as 'hi' | 'mr' | 'en',
      });
    }

    return {
      success: true,
      entities: claudeResponse,
      missingFields: validationResult.missingFields,
      needsClarification: validationResult.missingFields.length > 0,
    };
  } catch (error: any) {
    console.error('Entity extraction failed:', error);

    return {
      success: false,
      error: {
        code: error.name || 'EXTRACTION_ERROR',
        message: error.message || 'Failed to extract entities',
      },
    };
  }
};

/**
 * Construct intent-specific prompt for entity extraction
 */
function constructEntityExtractionPrompt(
  transcribedText: string,
  intent: IntentType
): string {
  switch (intent) {
    case 'CREATE_CATALOG':
      return constructCatalogPrompt(transcribedText);
    case 'UPDATE_INVENTORY':
      return constructInventoryPrompt(transcribedText);
    case 'ACCEPT_ORDER':
    case 'REJECT_ORDER':
    case 'UPDATE_FULFILLMENT':
    case 'QUERY_STATUS':
      return constructOrderPrompt(transcribedText, intent);
    default:
      throw new Error(`Unsupported intent: ${intent}`);
  }
}

/**
 * Construct prompt for catalog creation entity extraction
 */
function constructCatalogPrompt(transcribedText: string): string {
  return `Extract structured product information from this voice note.

Transcription: ${transcribedText}
Intent: CREATE_CATALOG

Extract these fields:
- product_name: string (the name of the product)
- price: number (in INR, numeric value only)
- quantity: number (numeric value only)
- unit: string (one of: "kg", "liters", "pieces", "packets", "grams", "ml")
- description: string (optional, any additional details about the product)
- category: string (one of: "food", "grocery", "handicraft", "textile", "other")

Rules:
- Extract numeric values without currency symbols or units in the number itself
- If a field is not mentioned or cannot be determined, set it to null
- For unit, normalize to standard units (e.g., "kilo" -> "kg", "liter" -> "liters")
- For category, infer from product name if not explicitly stated
- Preserve the original language of product_name and description

Respond with ONLY a JSON object in this exact format (no additional text):
{
  "product_name": "...",
  "price": 200,
  "quantity": 5,
  "unit": "kg",
  "description": "...",
  "category": "food"
}`;
}

/**
 * Construct prompt for inventory update entity extraction
 */
function constructInventoryPrompt(transcribedText: string): string {
  return `Extract inventory update information from this voice note.

Transcription: ${transcribedText}
Intent: UPDATE_INVENTORY

Extract these fields:
- product_identifier: string (product name or ID mentioned by the seller)
- new_quantity: number (the new stock quantity)
- operation: string (one of: "SET", "INCREMENT", "DECREMENT")

Rules:
- product_identifier should be the exact product name or identifier mentioned
- new_quantity should be a numeric value
- operation should be:
  * "SET" if the seller is setting a new absolute quantity (e.g., "stock is now 50")
  * "INCREMENT" if adding to existing stock (e.g., "add 10 more")
  * "DECREMENT" if reducing stock (e.g., "remove 5")
- If operation is not clear, default to "SET"
- If a field cannot be determined, set it to null

Respond with ONLY a JSON object in this exact format (no additional text):
{
  "product_identifier": "...",
  "new_quantity": 50,
  "operation": "SET"
}`;
}

/**
 * Construct prompt for order-related entity extraction
 */
function constructOrderPrompt(
  transcribedText: string,
  intent: IntentType
): string {
  return `Extract order information from this voice note.

Transcription: ${transcribedText}
Intent: ${intent}

Extract these fields:
- order_id: string (order ID or reference number if mentioned)
- action: string (the action being taken: "accept", "reject", "packed", "shipped", "delivered", "query")
- reason: string (optional, reason for rejection or other notes)

Rules:
- order_id may be explicitly stated or may need to be inferred from context
- action should match the intent (e.g., ACCEPT_ORDER -> "accept")
- reason is only required for REJECT_ORDER, optional for others
- If a field cannot be determined, set it to null

Respond with ONLY a JSON object in this exact format (no additional text):
{
  "order_id": "...",
  "action": "accept",
  "reason": null
}`;
}

/**
 * Invoke Claude model via Amazon Bedrock
 */
async function invokeClaudeModel(prompt: string): Promise<Record<string, any>> {
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
    temperature: 0.0, // Use deterministic output for extraction
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
  const entities = parseEntityResponse(textContent);

  return entities;
}

/**
 * Parse entity response from Claude's text output
 */
function parseEntityResponse(text: string): Record<string, any> {
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
    return parsed;
  } catch (error) {
    console.error('Failed to parse Claude response as JSON:', text);
    throw new Error(`Invalid JSON response from Claude: ${error}`);
  }
}

/**
 * Validate extracted entities based on intent
 */
function validateEntities(
  entities: Record<string, any>,
  intent: IntentType
): { missingFields: string[] } {
  const missingFields: string[] = [];

  switch (intent) {
    case 'CREATE_CATALOG':
      return validateCatalogEntities(entities as CatalogEntities);
    case 'UPDATE_INVENTORY':
      return validateInventoryEntities(entities as InventoryEntities);
    case 'ACCEPT_ORDER':
    case 'REJECT_ORDER':
    case 'UPDATE_FULFILLMENT':
    case 'QUERY_STATUS':
      return validateOrderEntities(entities as OrderEntities, intent);
    default:
      return { missingFields: [] };
  }
}

/**
 * Validate catalog creation entities
 */
function validateCatalogEntities(entities: CatalogEntities): { missingFields: string[] } {
  const missingFields: string[] = [];

  // Required fields for catalog creation
  if (!entities.product_name) {
    missingFields.push('product_name');
  }
  if (entities.price === null || entities.price === undefined) {
    missingFields.push('price');
  }
  if (entities.quantity === null || entities.quantity === undefined) {
    missingFields.push('quantity');
  }
  if (!entities.unit) {
    missingFields.push('unit');
  }
  if (!entities.category) {
    missingFields.push('category');
  }

  // Validate data types
  if (entities.price !== null && typeof entities.price !== 'number') {
    missingFields.push('price (must be a number)');
  }
  if (entities.quantity !== null && typeof entities.quantity !== 'number') {
    missingFields.push('quantity (must be a number)');
  }

  return { missingFields };
}

/**
 * Validate inventory update entities
 */
function validateInventoryEntities(
  entities: InventoryEntities
): { missingFields: string[] } {
  const missingFields: string[] = [];

  // Required fields for inventory update
  if (!entities.product_identifier) {
    missingFields.push('product_identifier');
  }
  if (entities.new_quantity === null || entities.new_quantity === undefined) {
    missingFields.push('new_quantity');
  }

  // Validate operation
  const validOperations = ['SET', 'INCREMENT', 'DECREMENT'];
  if (entities.operation && !validOperations.includes(entities.operation)) {
    missingFields.push('operation (must be SET, INCREMENT, or DECREMENT)');
  }

  // Validate data types
  if (entities.new_quantity !== null && typeof entities.new_quantity !== 'number') {
    missingFields.push('new_quantity (must be a number)');
  }

  return { missingFields };
}

/**
 * Validate order-related entities
 */
function validateOrderEntities(
  entities: OrderEntities,
  intent: IntentType
): { missingFields: string[] } {
  const missingFields: string[] = [];

  // order_id is optional for some intents (may be inferred from context)
  // action should match the intent
  if (!entities.action) {
    missingFields.push('action');
  }

  // For REJECT_ORDER, reason is helpful but not strictly required
  if (intent === 'REJECT_ORDER' && !entities.reason) {
    console.log('Note: Rejection reason not provided');
  }

  return { missingFields };
}

/**
 * Send WhatsApp response to user
 */
async function sendWhatsAppResponse(data: {
  phoneNumber: string;
  messageId: string;
  intent: IntentType;
  entities: Record<string, any>;
  language: 'hi' | 'mr' | 'en';
  needsClarification: boolean;
  missingFields: string[];
}): Promise<void> {
  const eventBusName = process.env.EVENT_BUS_NAME;
  if (!eventBusName) {
    console.warn('EVENT_BUS_NAME not configured - skipping response');
    return;
  }

  // Generate response message based on intent and entities
  let responseText: string;

  if (data.needsClarification) {
    // Request clarification for missing fields
    const messages = {
      hi: `कृपया निम्नलिखित जानकारी प्रदान करें: ${data.missingFields.join(', ')}`,
      mr: `कृपया खालील माहिती द्या: ${data.missingFields.join(', ')}`,
      en: `Please provide the following information: ${data.missingFields.join(', ')}`,
    };
    responseText = messages[data.language];
  } else {
    // Confirm successful extraction
    const messages = {
      CREATE_CATALOG: {
        hi: `✅ उत्पाद जोड़ा जा रहा है: ${data.entities.product_name}, कीमत: ₹${data.entities.price}`,
        mr: `✅ उत्पादन जोडले जात आहे: ${data.entities.product_name}, किंमत: ₹${data.entities.price}`,
        en: `✅ Adding product: ${data.entities.product_name}, price: ₹${data.entities.price}`,
      },
      UPDATE_INVENTORY: {
        hi: `✅ स्टॉक अपडेट हो रहा है: ${data.entities.product_identifier}, नई मात्रा: ${data.entities.new_quantity}`,
        mr: `✅ स्टॉक अपडेट होत आहे: ${data.entities.product_identifier}, नवीन प्रमाण: ${data.entities.new_quantity}`,
        en: `✅ Updating stock: ${data.entities.product_identifier}, new quantity: ${data.entities.new_quantity}`,
      },
      ACCEPT_ORDER: {
        hi: `✅ ऑर्डर स्वीकार किया जा रहा है: ${data.entities.order_id || 'नवीनतम'}`,
        mr: `✅ ऑर्डर स्वीकारली जात आहे: ${data.entities.order_id || 'नवीनतम'}`,
        en: `✅ Accepting order: ${data.entities.order_id || 'latest'}`,
      },
      REJECT_ORDER: {
        hi: `❌ ऑर्डर अस्वीकार किया जा रहा है: ${data.entities.order_id || 'नवीनतम'}`,
        mr: `❌ ऑर्डर नाकारली जात आहे: ${data.entities.order_id || 'नवीनतम'}`,
        en: `❌ Rejecting order: ${data.entities.order_id || 'latest'}`,
      },
      UPDATE_FULFILLMENT: {
        hi: `📦 ऑर्डर स्थिति अपडेट हो रही है: ${data.entities.action}`,
        mr: `📦 ऑर्डर स्थिती अपडेट होत आहे: ${data.entities.action}`,
        en: `📦 Updating order status: ${data.entities.action}`,
      },
      QUERY_STATUS: {
        hi: `🔍 स्थिति की जांच की जा रही है...`,
        mr: `🔍 स्थिती तपासली जात आहे...`,
        en: `🔍 Checking status...`,
      },
    };

    responseText = messages[data.intent][data.language];
  }

  // Publish event to send WhatsApp message
  const command = new PutEventsCommand({
    Entries: [
      {
        Source: EVENT_SOURCES.INTERNAL,
        DetailType: 'whatsapp.message.send',
        Detail: JSON.stringify({
          to: data.phoneNumber,
          type: 'text',
          content: {
            text: responseText,
          },
          language: data.language,
        }),
        EventBusName: eventBusName,
      },
    ],
  });

  const response = await eventBridgeClient.send(command);
  console.log('Published WhatsApp response event:', {
    phoneNumber: data.phoneNumber,
    eventId: response.Entries?.[0]?.EventId,
  });
}

/**
 * Publish entities extracted event for downstream processing
 */
async function publishEntitiesExtractedEvent(data: {
  messageId: string;
  phoneNumber: string;
  intent: IntentType;
  entities: Record<string, any>;
  language: string;
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
        DetailType: INTERNAL_EVENT_TYPES.ENTITIES_EXTRACTED,
        Detail: JSON.stringify({
          messageId: data.messageId,
          phone: data.phoneNumber,
          intent: data.intent,
          entities: data.entities,
          language: data.language,
        }),
        EventBusName: eventBusName,
      },
    ],
  });

  const response = await eventBridgeClient.send(command);
  console.log('Published entities extracted event:', {
    messageId: data.messageId,
    intent: data.intent,
    eventId: response.Entries?.[0]?.EventId,
  });
}
