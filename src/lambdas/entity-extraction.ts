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
  PriceUpdateEntities,
  QuantityUpdateEntities,
} from '../models/intent';
import { EVENT_SOURCES, INTERNAL_EVENT_TYPES } from '../config/event-patterns';

/**
 * Amazon Nova Pro - high-quality model without payment instrument requirements
 * Provides excellent accuracy for entity extraction
 */
const MODEL_ID = 'amazon.nova-pro-v1:0';

/**
 * Maximum tokens for Nova response
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

    // Publish entities extracted event for downstream processing
    // Only publish if all required fields are present
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
    case 'CONFIRM_CATALOG': // Treat confirmation as catalog creation
      return constructCatalogPrompt(transcribedText);
    case 'UPDATE_PRICE':
      return constructPriceUpdatePrompt(transcribedText);
    case 'UPDATE_QUANTITY':
      return constructQuantityUpdatePrompt(transcribedText);
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
  return `You are a STRICT information extractor. Your job is to extract ONLY what is EXPLICITLY stated.

Transcription: "${transcribedText}"
Intent: CREATE_CATALOG

Extract these fields ONLY if they are EXPLICITLY mentioned:
- product_name: string (the name of the product)
- price: number (per-unit price in INR, numeric value only)
- quantity: number (numeric value only - how many units available)
- unit: string (one of: "kg", "liters", "pieces", "packets", "grams", "ml", "bottles", "dozen")
- description: string (optional, any additional details)
- category: string (one of: "food", "grocery", "handicraft", "textile", "other")

⚠️ CRITICAL RULES - FAILURE TO FOLLOW WILL RESULT IN INCORRECT EXTRACTION:
1. If price is NOT mentioned → price MUST be null (DO NOT guess, infer, or use defaults)
2. If quantity is NOT mentioned → quantity MUST be null (DO NOT guess, infer, or use defaults)
3. If unit is NOT mentioned → unit MUST be null (DO NOT guess, infer, or use defaults)
4. ONLY category can be inferred from product name
5. DO NOT use common sense to fill missing values
6. DO NOT use typical values for products
7. DO NOT assume standard quantities or prices
8. HANDLE MULTIPLE UPDATES: If user mentions BOTH price AND quantity, extract BOTH values

VALIDATION CHECK:
Before responding, ask yourself for EACH field:
- "Did the user EXPLICITLY say this value in the transcription?"
- If NO → set to null
- If YES → extract the value

CORRECT EXAMPLES:
Input: "मैं 2 kg आम ₹500 प्रति केजी के दर में बेचना चाहता हूँ"
✓ Correct: {"product_name": "आम", "price": 500, "quantity": 2, "unit": "kg", "description": null, "category": "food"}
Why: ALL values (product, price, quantity, unit) are EXPLICITLY mentioned

Input: "मैं आम बेचना चाहता हूँ"
✓ Correct: {"product_name": "आम", "price": null, "quantity": null, "unit": null, "description": null, "category": "food"}
Why: ONLY product name mentioned, everything else is null

Input: "I want to sell honey"
✓ Correct: {"product_name": "honey", "price": null, "quantity": null, "unit": null, "description": null, "category": "food"}
Why: ONLY product name mentioned

Input: "10 pieces of handicraft items for 1500 per piece"
✓ Correct: {"product_name": "handicraft items", "price": 1500, "quantity": 10, "unit": "pieces", "description": null, "category": "handicraft"}

Input: "price 500 and quantity 10"
✓ Correct: {"product_name": null, "price": 500, "quantity": 10, "unit": null, "description": null, "category": null}
Why: BOTH price AND quantity mentioned together

Input: "कीमत 600 और मात्रा 20 kg"
✓ Correct: {"product_name": null, "price": 600, "quantity": 20, "unit": "kg", "description": null, "category": null}
Why: Price, quantity, AND unit mentioned together

WRONG EXAMPLES - NEVER DO THIS:
Input: "मैं आम बेचना चाहता हूँ"
❌ WRONG: {"product_name": "आम", "price": 50, "quantity": 1, "unit": "kg", "description": null, "category": "food"}
Why wrong: Price, quantity, unit were NOT mentioned but you filled them anyway

Input: "I want to sell mangoes"
❌ WRONG: {"product_name": "mangoes", "price": 100, "quantity": 10, "unit": "kg", "description": null, "category": "food"}
Why wrong: Price, quantity, unit were NOT mentioned but you filled them anyway

Respond with ONLY a JSON object (no additional text):
{
  "product_name": "...",
  "price": null,
  "quantity": null,
  "unit": null,
  "description": null,
  "category": "food"
}`;
}

/**
 * Construct prompt for price update entity extraction
 */
function constructPriceUpdatePrompt(transcribedText: string): string {
  return `Extract price update information from this voice note.

Transcription: ${transcribedText}
Intent: UPDATE_PRICE

Extract these fields:
- new_price: number (the new per-unit price in INR, numeric value only)
- product_name: string (optional, product name if mentioned)

CRITICAL RULES FOR PRICE EXTRACTION:
- Extract ONLY the per-unit price, NOT the total price
- If seller says "update price to 600" or "change price to 600", extract new_price as 600
- If seller says "price should be 700 per kg", extract new_price as 700
- Remove all currency symbols (₹, Rs, rupees) and extract only the number
- If price includes decimals, keep them (e.g., 99.50 -> 99.5)

EXAMPLES:
Input: "update price to 600"
Output: {"new_price": 600, "product_name": null}

Input: "कीमत 700 रुपये प्रति केजी करें"
Output: {"new_price": 700, "product_name": null}

Input: "change mango price to 550"
Output: {"new_price": 550, "product_name": "mango"}

Rules:
- If a field is not mentioned or cannot be determined, set it to null
- product_name is optional - only extract if explicitly mentioned

Respond with ONLY a JSON object in this exact format (no additional text):
{
  "new_price": 600,
  "product_name": null
}`;
}

/**
 * Construct prompt for quantity update entity extraction
 */
function constructQuantityUpdatePrompt(transcribedText: string): string {
  return `Extract quantity update information from this voice note.

Transcription: ${transcribedText}
Intent: UPDATE_QUANTITY

Extract these fields:
- new_quantity: number (the new quantity value, numeric value only)
- product_name: string (optional, product name if mentioned)

CRITICAL RULES FOR QUANTITY EXTRACTION:
- Extract ONLY the quantity number
- If seller says "update quantity to 50" or "change quantity to 50", extract new_quantity as 50
- If seller says "quantity should be 100", extract new_quantity as 100
- Remove all unit names (kg, bottles, pieces, etc.) and extract only the number
- If quantity includes decimals, keep them (e.g., 10.5 -> 10.5)

EXAMPLES:
Input: "update quantity to 50"
Output: {"new_quantity": 50, "product_name": null}

Input: "मात्रा 100 करें"
Output: {"new_quantity": 100, "product_name": null}

Input: "change mango quantity to 75"
Output: {"new_quantity": 75, "product_name": "mango"}

Rules:
- If a field is not mentioned or cannot be determined, set it to null
- product_name is optional - only extract if explicitly mentioned

Respond with ONLY a JSON object in this exact format (no additional text):
{
  "new_quantity": 50,
  "product_name": null
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
 * Invoke Amazon Nova Pro via Amazon Bedrock
 */
async function invokeClaudeModel(prompt: string): Promise<Record<string, any>> {
  // Construct request body for Nova Messages API format
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
      temperature: 0.0, // Use deterministic output for extraction
    },
  };

  console.log('Invoking Amazon Nova Pro:', MODEL_ID);

  // Invoke model
  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody),
  });

  const response = await bedrockClient.send(command);

  // Parse response
  if (!response.body) {
    throw new Error('Empty response from Nova');
  }

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  console.log('Nova raw response:', JSON.stringify(responseBody, null, 2));

  // Extract text from Nova response format
  if (!responseBody.output?.message?.content || !Array.isArray(responseBody.output.message.content)) {
    throw new Error('No content in Nova response');
  }

  const textContent = responseBody.output.message.content.find((item: any) => item.text)?.text;
  if (!textContent) {
    throw new Error('No text in Nova response content');
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
    case 'UPDATE_PRICE':
      return validatePriceUpdateEntities(entities as PriceUpdateEntities);
    case 'UPDATE_QUANTITY':
      return validateQuantityUpdateEntities(entities as QuantityUpdateEntities);
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

  // Note: We store the per-unit price, not the total price
  // For example, "500 per kg" for 2kg should be stored as price=500, quantity=2, unit=kg
  // The buyer app will display the per-unit rate

  return { missingFields };
}

/**
 * Validate price update entities
 */
function validatePriceUpdateEntities(entities: PriceUpdateEntities): { missingFields: string[] } {
  const missingFields: string[] = [];

  // Required field for price update
  if (entities.new_price === null || entities.new_price === undefined) {
    missingFields.push('new_price');
  }

  // Validate data type
  if (entities.new_price !== null && typeof entities.new_price !== 'number') {
    missingFields.push('new_price (must be a number)');
  }

  return { missingFields };
}

/**
 * Validate quantity update entities
 */
function validateQuantityUpdateEntities(entities: QuantityUpdateEntities): { missingFields: string[] } {
  const missingFields: string[] = [];

  // Required field for quantity update
  if (entities.new_quantity === null || entities.new_quantity === undefined) {
    missingFields.push('new_quantity');
  }

  // Validate data type
  if (entities.new_quantity !== null && typeof entities.new_quantity !== 'number') {
    missingFields.push('new_quantity (must be a number)');
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
