# Voice Workflow Performance Fixes - Bugfix Design

## Overview

This design addresses 6 critical performance and functionality issues in the voice-first workflow that are impacting user experience. The issues span voice message latency, image enhancement functionality, interactive button handling, confirmation voice messages, agent memory management, and message ordering. These bugs affect the end-to-end user journey from voice interaction through product catalog management to order confirmation.

The fix approach involves:
1. Optimizing the voice processing pipeline by parallelizing Lambda invocations
2. Fixing the image enhancement prompt and model configuration for proper background transformation
3. Implementing proper button click event routing and handler invocation
4. Fixing voice confirmation generation and delivery
5. Implementing proper agent context management and conversation memory
6. Enforcing message ordering with explicit delays between image and button messages

## Glossary

- **Bug_Condition (C)**: The conditions that trigger each of the 6 bugs
- **Property (P)**: The desired behavior when bugs are fixed
- **Preservation**: Existing functionality that must remain unchanged
- **voice-handler**: Lambda function in `src/lambdas/voice-handler.ts` that orchestrates voice message processing
- **image-enhancement**: Lambda function in `src/lambdas/image-enhancement.ts` that enhances product photos
- **whatsapp-webhook-handler**: Lambda function in `src/lambdas/whatsapp-webhook-handler.ts` that receives WhatsApp messages
- **confirmation-handler**: Lambda function in `src/lambdas/confirmation-handler.ts` that generates confirmations
- **Sequential Invocation**: Calling Lambda functions one after another (slow)
- **Parallel Invocation**: Calling multiple Lambda functions simultaneously (fast)
- **Titan Image Generator v2**: Amazon Bedrock model for image enhancement
- **BACKGROUND_REMOVAL**: Titan task type that removes backgrounds while preserving products
- **Interactive Buttons**: WhatsApp action buttons (approve, edit_quantity, view_products)
- **Message Ordering**: The sequence in which messages are delivered to users

## Bug Details

### Issue 1: Voice Message Latency


#### Fault Condition

The bug manifests when a user sends a voice message and the system takes more than 3 seconds to respond. The `voice-handler` Lambda is invoking downstream Lambdas (voice-transcription, intent-classification, entity-extraction) sequentially, causing cumulative latency.

**Formal Specification:**
```
FUNCTION isBugCondition_VoiceLatency(input)
  INPUT: input of type VoiceMessage
  OUTPUT: boolean
  
  RETURN input.type == 'audio'
         AND responseTime(input) > 3000ms
         AND isSequentialInvocation(voice-handler)
END FUNCTION
```

#### Examples

- User sends 10-second voice message → System responds after 5 seconds (too slow)
- User sends 5-second voice message → System responds after 4 seconds (too slow)
- Expected: User sends voice message → System responds within 3 seconds

### Issue 2: Image Enhancement Not Working

#### Fault Condition

The bug manifests when image enhancement is requested for a product photo and the system returns the original image unchanged instead of transforming the background. The `image-enhancement` Lambda is using BACKGROUND_REMOVAL task type which only removes the background but doesn't add a professional solid color background.

**Formal Specification:**
```
FUNCTION isBugCondition_ImageEnhancement(input)
  INPUT: input of type ProductImage
  OUTPUT: boolean
  
  RETURN input.type == 'image'
         AND enhancementRequested(input)
         AND outputImage.background == inputImage.background
         AND taskType == 'BACKGROUND_REMOVAL'
END FUNCTION
```

#### Examples

- User uploads product photo with cluttered background → System returns same image with transparent/removed background (not solid color)
- User uploads product photo → System should return image with professional solid color background (white/beige/gray)
- Expected: Product preserved exactly, background replaced with solid professional color

### Issue 3: Action Buttons Not Working

#### Fault Condition

The bug manifests when a user clicks an interactive action button (approve, edit_quantity, view_products) and the system does not trigger any response or handler. The `whatsapp-webhook-handler` correctly routes button clicks to EventBridge, but the EventBridge rule may not be properly configured or the confirmation-handler is not being invoked.

**Formal Specification:**
```
FUNCTION isBugCondition_ButtonClick(input)
  INPUT: input of type ButtonClickEvent
  OUTPUT: boolean
  
  RETURN input.type == 'button_reply'
         AND input.content.buttonPayload IN ['approve', 'edit_quantity', 'view_products']
         AND userState == 'CONFIRMATION_PENDING'
         AND NOT handlerInvoked(confirmation-handler)
END FUNCTION
```

#### Examples

- User clicks "✅ Approve" button → No response from system
- User clicks "✏️ Edit Quantity" button → No response from system
- User clicks "📋 View Products" button → No response from system
- Expected: Button click triggers appropriate handler and sends response

### Issue 4: Confirmation Voice Messages Not Working

#### Fault Condition

The bug manifests when a confirmation voice message should be sent and the system fails to send or process the voice confirmation correctly. The `confirmation-handler` generates voice confirmations using Amazon Polly but may fail to upload to S3 or send via WhatsApp.

**Formal Specification:**
```
FUNCTION isBugCondition_VoiceConfirmation(input)
  INPUT: input of type ConfirmationRequest
  OUTPUT: boolean
  
  RETURN input.action == 'generate'
         AND userState == 'CONFIRMATION_PENDING'
         AND (pollyFailed(input) OR s3UploadFailed(input) OR whatsappSendFailed(input))
END FUNCTION
```

#### Examples

- System generates confirmation → Polly synthesis fails → No voice message sent
- System generates confirmation → S3 upload fails → Voice URL not available
- System generates confirmation → WhatsApp send fails → User doesn't receive voice
- Expected: Voice confirmation successfully generated, uploaded, and sent to user

### Issue 5: Agent Workflow/Memory Issues

#### Fault Condition

The bug manifests when the agent processes multiple interactions in a conversation and exhibits problematic context tracking and inappropriate responses. The agent may not properly maintain conversation history, user preferences, or context across multiple turns.

**Formal Specification:**
```
FUNCTION isBugCondition_AgentMemory(input)
  INPUT: input of type ConversationTurn
  OUTPUT: boolean
  
  RETURN conversationLength(input.phone) > 1
         AND (contextLost(input) OR inappropriateResponse(input) OR preferencesNotTracked(input))
END FUNCTION
```

#### Examples

- User mentions product category in turn 1 → Agent forgets in turn 3 → Asks for category again
- User sets price preference → Agent doesn't remember in next interaction
- User provides partial info → Agent doesn't merge with previous partial data
- Expected: Agent maintains full conversation context and responds appropriately

### Issue 6: Message Ordering (Buttons Before Image)

#### Fault Condition

The bug manifests when sending product information with action buttons and the system sends the action buttons message BEFORE the product photo and text message. The `confirmation-handler` should send the image with caption first, wait 2 seconds, then send the interactive buttons below the image.

**Formal Specification:**
```
FUNCTION isBugCondition_MessageOrdering(input)
  INPUT: input of type ConfirmationGeneration
  OUTPUT: boolean
  
  RETURN input.hasImage == true
         AND input.hasButtons == true
         AND messageOrder(input) == [buttons, image]  // Wrong order
         AND NOT hasDelay(input)
END FUNCTION
```

#### Examples

- System sends confirmation → Buttons appear first → Image appears below buttons (wrong order)
- System sends confirmation → Image and buttons sent simultaneously → Race condition
- Expected: Image with caption sent first → 2 second delay → Buttons sent below image

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Voice transcription accuracy must remain unchanged
- Image enhancement must preserve product exactly (no modifications to product itself)
- Non-interactive messages (text, images without buttons) must continue to work
- Agent responses for valid, in-context inputs must remain appropriate
- Text-based confirmations must continue to work
- Message delivery through WhatsApp must remain reliable

**Scope:**
All inputs that do NOT involve the specific bug conditions should be completely unaffected by these fixes. This includes:
- Voice messages that already respond quickly (< 3 seconds)
- Images that don't require enhancement
- Text messages and other non-button interactions
- Confirmations without voice components
- Single-turn conversations without context requirements
- Messages without ordering dependencies

## Hypothesized Root Cause

Based on the bug descriptions and code analysis, the most likely issues are:

### Issue 1: Voice Message Latency

1. **Sequential Lambda Invocations**: The voice-handler calls voice-transcription, then intent-classification, then entity-extraction sequentially
   - Each Lambda invocation adds ~500-1000ms overhead
   - Total latency = transcription time + intent time + entity time + 3x invocation overhead
   - Solution: Parallelize intent-classification and entity-extraction since they both depend only on transcription

2. **Synchronous Waiting**: The handler waits for each Lambda to complete before proceeding
   - No pipelining or async processing
   - Solution: Use Promise.all() for parallel invocations

### Issue 2: Image Enhancement Not Working

1. **Wrong Task Type**: Using BACKGROUND_REMOVAL which only removes background, doesn't add solid color
   - BACKGROUND_REMOVAL returns transparent or removed background
   - Need IMAGE_VARIATION with solid color prompts
   - Solution: Switch to IMAGE_VARIATION task type with proper prompts

2. **Insufficient Prompts**: Positive prompt doesn't strongly specify solid color background
   - Current prompt may be too generic
   - Solution: Add explicit "solid white background" or "solid beige background" to positive prompt

3. **Missing Post-Processing**: No step to add solid color background after removal
   - BACKGROUND_REMOVAL alone is insufficient
   - Solution: Either use IMAGE_VARIATION or add post-processing step to composite onto solid color

### Issue 3: Action Buttons Not Working

1. **EventBridge Rule Misconfiguration**: The rule routing button clicks to confirmation-handler may have wrong event pattern
   - Rule may not match button_reply message type
   - Rule may not match CONFIRMATION_PENDING state
   - Solution: Verify and fix EventBridge rule event pattern

2. **Button Payload Parsing**: The confirmation-handler may not correctly parse button payloads from event
   - Event structure from EventBridge may differ from expected format
   - Solution: Add robust payload parsing with fallbacks

3. **Missing Handler Invocation**: The EventBridge rule may not have confirmation-handler as target
   - Rule exists but doesn't invoke the Lambda
   - Solution: Verify rule has correct Lambda target

### Issue 4: Confirmation Voice Messages Not Working

1. **Polly Synthesis Failure**: Amazon Polly may fail due to incorrect voice ID or language code
   - Marathi voice may not be available
   - Voice ID may be incorrect
   - Solution: Add error handling and fallback to text-only confirmation

2. **S3 Upload Failure**: Voice file upload to S3 may fail due to permissions or bucket issues
   - Lambda may lack S3 PutObject permissions
   - Bucket name may be incorrect
   - Solution: Verify IAM permissions and bucket configuration

3. **WhatsApp Audio Send Not Implemented**: The system may not have code to send audio messages via WhatsApp
   - Only text, image, and interactive message types implemented
   - Solution: Implement audio message sending or send voice as text with audio URL

### Issue 5: Agent Workflow/Memory Issues

1. **No Conversation History Tracking**: The agent doesn't maintain conversation history across turns
   - Each turn treated as isolated interaction
   - No memory of previous messages
   - Solution: Implement conversation memory service with DynamoDB

2. **Context Not Passed to Agent**: The agent doesn't receive conversation context in prompts
   - Agent LLM doesn't see previous turns
   - Solution: Include conversation history in agent prompts

3. **Preferences Not Tracked**: User preferences (categories, price ranges) not stored
   - Each interaction starts fresh
   - Solution: Track and persist user preferences

### Issue 6: Message Ordering (Buttons Before Image)

1. **No Explicit Ordering**: The confirmation-handler sends image and buttons without enforcing order
   - Both sent via async calls without await
   - Race condition determines order
   - Solution: Add await between image send and button send

2. **Missing Delay**: No delay between image and button messages
   - WhatsApp may deliver in wrong order without delay
   - Solution: Add 2-second delay after image send before button send

3. **Parallel Sends**: Using Promise.all() or similar to send both simultaneously
   - Explicitly parallelizing when should be sequential
   - Solution: Remove parallelization, use sequential sends with delay


## Correctness Properties

Property 1: Fault Condition - Voice Message Latency

_For any_ voice message input where the bug condition holds (response time > 3 seconds due to sequential invocations), the fixed voice-handler function SHALL respond within 3 seconds by parallelizing independent Lambda invocations (intent-classification and entity-extraction).

**Validates: Requirements 2.1**

Property 2: Fault Condition - Image Enhancement Background Transformation

_For any_ product image where enhancement is requested, the fixed image-enhancement function SHALL preserve the product exactly while replacing the background with a solid professional color (white/beige/gray) using IMAGE_VARIATION task type with proper prompts.

**Validates: Requirements 2.2**

Property 3: Fault Condition - Action Button Response

_For any_ button click event (approve, edit_quantity, view_products) in CONFIRMATION_PENDING state, the fixed system SHALL trigger the confirmation-handler and send an appropriate response to the user.

**Validates: Requirements 2.3**

Property 4: Fault Condition - Voice Confirmation Delivery

_For any_ confirmation generation request, the fixed confirmation-handler SHALL successfully generate voice confirmation using Polly, upload to S3, and deliver to user (or gracefully fall back to text-only if voice fails).

**Validates: Requirements 2.4**

Property 5: Fault Condition - Agent Context Management

_For any_ multi-turn conversation, the fixed agent SHALL properly maintain conversation context, track user preferences, and respond appropriately based on conversation history.

**Validates: Requirements 2.5**

Property 6: Fault Condition - Message Ordering

_For any_ confirmation with image and buttons, the fixed confirmation-handler SHALL send the product photo with caption first, wait 2 seconds, then send the interactive buttons below the image.

**Validates: Requirements 2.6**

Property 7: Preservation - Voice Transcription Accuracy

_For any_ voice message input where the bug condition does NOT hold (already fast responses), the fixed voice-handler SHALL produce the same transcription accuracy as the original function, preserving voice processing quality.

**Validates: Requirements 3.1**

Property 8: Preservation - Product Preservation in Images

_For any_ image enhancement, the fixed image-enhancement function SHALL continue to preserve the product in the image without any modifications to the product itself, only changing the background.

**Validates: Requirements 3.2**

Property 9: Preservation - Non-Interactive Message Delivery

_For any_ message without action buttons, the fixed system SHALL continue to deliver messages in the correct order and format without any changes.

**Validates: Requirements 3.3**

Property 10: Preservation - Agent Valid Input Responses

_For any_ valid, in-context user input, the fixed agent SHALL continue to generate appropriate responses as before.

**Validates: Requirements 3.4**

Property 11: Preservation - Text Confirmation Processing

_For any_ text-based confirmation, the fixed confirmation-handler SHALL continue to process them correctly without changes.

**Validates: Requirements 3.5**

Property 12: Preservation - Message Delivery Reliability

_For any_ message sent through WhatsApp, the fixed system SHALL continue to deliver messages successfully to the recipient.

**Validates: Requirements 3.6**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

#### Issue 1: Voice Message Latency

**File**: `src/lambdas/voice-handler.ts`

**Function**: `handler`

**Specific Changes**:
1. **Parallelize Intent and Entity Extraction**: After transcription completes, invoke intent-classification and entity-extraction in parallel using Promise.all()
   - Current: Sequential invocation (transcription → intent → entity)
   - Fixed: Parallel invocation (transcription → [intent, entity] in parallel)
   - Note: Entity extraction needs intent, so may need to keep sequential OR pass transcription to both and let entity-extraction call intent internally

2. **Alternative Approach - Pipeline Optimization**: If entity-extraction depends on intent, parallelize other operations
   - Parallelize language storage with intent classification
   - Parallelize conversation tracking with entity extraction
   - Use Promise.all() for independent operations

3. **Add Performance Logging**: Log timestamps at each stage to measure actual latency improvements
   - Log: transcription start/end, intent start/end, entity start/end
   - Calculate and log total response time

#### Issue 2: Image Enhancement Not Working

**File**: `src/lambdas/image-enhancement.ts`

**Function**: `handler`, `invokeTitanImageGenerator`, `generatePositivePrompt`

**Specific Changes**:
1. **Switch to IMAGE_VARIATION Task Type**: Change from BACKGROUND_REMOVAL to IMAGE_VARIATION
   - Update `titanRequest.taskType` from 'BACKGROUND_REMOVAL' to 'IMAGE_VARIATION'
   - Add `imageVariationParams` with images array, text (positive prompt), negativeText, and similarityStrength
   - Remove `backgroundRemovalParams`

2. **Enhance Positive Prompt**: Strengthen prompt to explicitly request solid color background
   - Add "solid white background" or "solid beige background" or "solid gray background"
   - Add "no patterns, no textures, plain backdrop, professional studio setup"
   - Add "completely replace background, solid color only"

3. **Set High Similarity Strength**: Set similarityStrength to 0.9 (very high) to preserve product exactly
   - This ensures product is not modified, only background changes
   - Range: 0.0-1.0, higher = more preservation

4. **Add Category-Specific Background Colors**: Choose background color based on product category
   - Food/Grocery: Pure white (#FFFFFF)
   - Handicraft/Textile: Warm beige (#F5F5DC)
   - Other: Light gray (#E5E5E5)

#### Issue 3: Action Buttons Not Working

**File**: `infrastructure/stacks/vyapar-vaani-stack.ts`

**Resource**: `ConfirmationHandlerRule`

**Specific Changes**:
1. **Verify EventBridge Rule Event Pattern**: Ensure rule matches button_reply events in CONFIRMATION_PENDING state
   - Check `source`: Should be `[EVENT_SOURCES.WHATSAPP]`
   - Check `detail-type`: Should include button click event type
   - Check `detail.messageType`: Should match 'button_reply'
   - Check `detail.state`: Should match 'CONFIRMATION_PENDING'

2. **Add Detailed Logging**: Add logging in whatsapp-webhook-handler and confirmation-handler
   - Log when button click is detected
   - Log when EventBridge event is published
   - Log when confirmation-handler receives event

3. **Verify Lambda Target**: Ensure EventBridge rule has confirmation-handler as target
   - Check `targets` array includes `confirmationHandlerLambda`

**File**: `src/lambdas/confirmation-handler.ts`

**Function**: `handler`

**Specific Changes**:
4. **Robust Button Payload Parsing**: Add fallback parsing for different event structures
   - Check `event.detail.content.buttonPayload`
   - Check `event.detail.buttonPayload`
   - Check `event.content.buttonPayload`
   - Log parsed payload for debugging

5. **Add Error Handling**: Wrap handler logic in try-catch with detailed error logging
   - Log full event structure on error
   - Send error message to user if handler fails

#### Issue 4: Confirmation Voice Messages Not Working

**File**: `src/lambdas/confirmation-handler.ts`

**Function**: `generateConfirmation`, `convertToSpeech`

**Specific Changes**:
1. **Add Polly Error Handling**: Wrap Polly synthesis in try-catch with fallback to text-only
   - If Polly fails, log error and continue without voice
   - Set `voiceUrl = undefined` on failure
   - Already implemented in current code, verify it works

2. **Verify IAM Permissions**: Ensure confirmation-handler Lambda has Polly and S3 permissions
   - Check `confirmationHandlerLambda.addToRolePolicy()` includes Polly:SynthesizeSpeech
   - Check S3 PutObject permission for PRODUCTS_BUCKET_NAME
   - Already granted in infrastructure code, verify deployment

3. **Implement Audio Message Sending**: Add support for sending audio messages via WhatsApp
   - Option 1: Send audio file directly (requires WhatsApp audio message support)
   - Option 2: Send text message with audio URL link
   - Option 3: Skip voice for now, rely on text-only (current fallback)
   - Recommendation: Implement Option 1 if WhatsApp API supports, otherwise use Option 3

4. **Add Voice Generation Logging**: Log Polly synthesis success/failure
   - Log voice ID, language code, text length
   - Log S3 upload success with URL
   - Log if falling back to text-only

#### Issue 5: Agent Workflow/Memory Issues

**File**: `src/services/conversation-memory.ts` (may need to create)

**Specific Changes**:
1. **Implement Conversation History Tracking**: Create service to store conversation turns in DynamoDB
   - Table: `ConversationHistory` with partition key `phone`, sort key `timestamp`
   - Store: timestamp, role (user/assistant), content, messageType, intent, entities
   - Functions: `addConversationMessage()`, `getConversationContext()`

2. **Track User Preferences**: Store user preferences in DynamoDB
   - Table: `UserPreferences` with partition key `phone`
   - Store: preferredCategories, typicalPriceRange, language, lastInteractionTime
   - Functions: `updateUserPreferences()`, `getUserPreferences()`

3. **Generate Contextual Responses**: Use conversation history to generate personalized responses
   - Function: `generateContextualResponse(context, intent, entities, language)`
   - Include previous turns in agent prompts
   - Reference user preferences in responses

**File**: `src/lambdas/voice-handler.ts`

**Function**: `handler`

**Specific Changes**:
4. **Add Conversation Tracking**: Call conversation memory service after transcription
   - Track user message: `addConversationMessage(phone, { role: 'user', content: transcription })`
   - Track assistant understanding: `addConversationMessage(phone, { role: 'assistant', content: intent })`

5. **Get Conversation Context**: Retrieve context before generating responses
   - Call: `getConversationContext(phone)` to get recent history
   - Pass context to response generation

6. **Update Preferences**: Track preferences from extracted entities
   - If category extracted: Update preferredCategories
   - If price extracted: Update typicalPriceRange
   - If language detected: Update language preference

#### Issue 6: Message Ordering (Buttons Before Image)

**File**: `src/lambdas/confirmation-handler.ts`

**Function**: `generateConfirmation`

**Specific Changes**:
1. **Enforce Sequential Sending**: Add await between image send and button send
   - Current: May send in parallel or without proper ordering
   - Fixed: `await sendImageMessage(...)` then `await sleep(2000)` then `await sendInteractiveMessage(...)`

2. **Add 2-Second Delay**: Insert explicit delay after image send
   - Use: `await new Promise(resolve => setTimeout(resolve, 2000))`
   - This ensures WhatsApp delivers image before buttons

3. **Remove Parallel Sends**: Ensure no Promise.all() or parallel execution
   - Check for any Promise.all() wrapping image and button sends
   - Replace with sequential awaits

4. **Add Ordering Logs**: Log message send order for debugging
   - Log: "Sending image with caption..."
   - Log: "Image sent, waiting 2 seconds..."
   - Log: "Sending interactive buttons..."

5. **Verify Current Implementation**: Check if ordering is already implemented correctly
   - Current code shows sequential sends with 2-second delay
   - May just need to verify it's working in production


## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate each bug on unfixed code, then verify the fixes work correctly and preserve existing behavior. Since there are 6 distinct bugs, we'll test each independently.

### Exploratory Fault Condition Checking

**Goal**: Surface counterexamples that demonstrate each bug BEFORE implementing fixes. Confirm or refute the root cause analysis for each issue. If we refute, we will need to re-hypothesize.

#### Issue 1: Voice Message Latency

**Test Plan**: Measure response time for voice messages on UNFIXED code. Send voice messages and log timestamps at each stage (transcription start/end, intent start/end, entity start/end, total response time). Run these tests to observe latency > 3 seconds and confirm sequential invocation is the cause.

**Test Cases**:
1. **Short Voice Message Test**: Send 5-second voice message, measure total response time (will exceed 3 seconds on unfixed code)
2. **Medium Voice Message Test**: Send 10-second voice message, measure total response time (will exceed 4 seconds on unfixed code)
3. **Long Voice Message Test**: Send 20-second voice message, measure total response time (will exceed 5 seconds on unfixed code)
4. **Latency Breakdown Test**: Log individual Lambda invocation times to confirm sequential overhead (will show cumulative delays on unfixed code)

**Expected Counterexamples**:
- Total response time > 3 seconds for typical voice messages
- Possible causes: Sequential Lambda invocations, synchronous waiting, no parallelization

#### Issue 2: Image Enhancement Not Working

**Test Plan**: Send product images for enhancement on UNFIXED code. Observe that output images have transparent or removed backgrounds instead of solid professional colors. Verify that BACKGROUND_REMOVAL task type is being used.

**Test Cases**:
1. **Food Product Image Test**: Send food product photo with cluttered background (will return transparent background on unfixed code)
2. **Handicraft Product Image Test**: Send handicraft photo with messy background (will return transparent background on unfixed code)
3. **Generic Product Image Test**: Send generic product photo (will return transparent background on unfixed code)
4. **Background Color Verification Test**: Check output image background color (will not be solid white/beige/gray on unfixed code)

**Expected Counterexamples**:
- Output images have transparent or removed backgrounds, not solid colors
- Possible causes: BACKGROUND_REMOVAL task type, insufficient prompts, missing post-processing

#### Issue 3: Action Buttons Not Working

**Test Plan**: Generate confirmation with action buttons on UNFIXED code. Click each button (approve, edit_quantity, view_products) and observe that no handler is invoked and no response is sent. Check EventBridge logs to see if events are published and if rules are triggered.

**Test Cases**:
1. **Approve Button Test**: Click "✅ Approve" button in CONFIRMATION_PENDING state (will not trigger handler on unfixed code)
2. **Edit Quantity Button Test**: Click "✏️ Edit Quantity" button (will not trigger handler on unfixed code)
3. **View Products Button Test**: Click "📋 View Products" button (will not trigger handler on unfixed code)
4. **EventBridge Rule Test**: Check if button click events are published to EventBridge (may not match rule pattern on unfixed code)

**Expected Counterexamples**:
- Button clicks do not trigger confirmation-handler
- Possible causes: EventBridge rule misconfiguration, button payload parsing issues, missing Lambda target

#### Issue 4: Confirmation Voice Messages Not Working

**Test Plan**: Generate confirmation on UNFIXED code and observe voice message generation. Check Polly synthesis logs, S3 upload logs, and WhatsApp message delivery logs. Verify if voice confirmations are being sent to users.

**Test Cases**:
1. **Hindi Voice Confirmation Test**: Generate confirmation in Hindi (may fail Polly synthesis on unfixed code)
2. **Marathi Voice Confirmation Test**: Generate confirmation in Marathi (may fail due to voice availability on unfixed code)
3. **English Voice Confirmation Test**: Generate confirmation in English (may fail S3 upload on unfixed code)
4. **Voice Delivery Test**: Check if voice message is sent via WhatsApp (may not be implemented on unfixed code)

**Expected Counterexamples**:
- Polly synthesis fails for certain languages
- S3 upload fails due to permissions
- Voice messages not sent via WhatsApp (only text sent)
- Possible causes: Incorrect voice IDs, missing permissions, audio message sending not implemented

#### Issue 5: Agent Workflow/Memory Issues

**Test Plan**: Conduct multi-turn conversations on UNFIXED code. Observe if agent maintains context, remembers user preferences, and responds appropriately across turns. Check if conversation history is stored and retrieved.

**Test Cases**:
1. **Context Tracking Test**: Mention product category in turn 1, check if agent remembers in turn 3 (will forget on unfixed code)
2. **Preference Tracking Test**: Set price preference in turn 1, check if agent uses it in turn 2 (will not remember on unfixed code)
3. **Partial Data Merge Test**: Provide partial info in turn 1, add more in turn 2, check if merged correctly (may not merge on unfixed code)
4. **Conversation History Test**: Check if conversation history is stored in DynamoDB (may not exist on unfixed code)

**Expected Counterexamples**:
- Agent forgets context from previous turns
- User preferences not tracked or used
- Partial data not merged correctly across turns
- Possible causes: No conversation history tracking, context not passed to agent, preferences not stored

#### Issue 6: Message Ordering (Buttons Before Image)

**Test Plan**: Generate confirmation with image and buttons on UNFIXED code. Observe the order in which messages are delivered to WhatsApp. Check if buttons appear before image or if there's a race condition.

**Test Cases**:
1. **Message Order Test**: Generate confirmation, observe delivery order (buttons may appear before image on unfixed code)
2. **Race Condition Test**: Generate multiple confirmations rapidly, check for inconsistent ordering (will show race condition on unfixed code)
3. **Delay Verification Test**: Check if there's a delay between image and button sends (will not have delay on unfixed code)
4. **WhatsApp Delivery Order Test**: Verify actual message order in WhatsApp client (will show wrong order on unfixed code)

**Expected Counterexamples**:
- Buttons delivered before image
- Inconsistent message ordering due to race condition
- No delay between image and button sends
- Possible causes: No explicit ordering, missing delay, parallel sends

### Fix Checking

**Goal**: Verify that for all inputs where each bug condition holds, the fixed functions produce the expected behavior.

#### Issue 1: Voice Message Latency

**Pseudocode:**
```
FOR ALL voiceMessage WHERE isBugCondition_VoiceLatency(voiceMessage) DO
  result := voice-handler_fixed(voiceMessage)
  ASSERT result.responseTime <= 3000ms
  ASSERT result.transcription == voice-handler_original(voiceMessage).transcription
END FOR
```

#### Issue 2: Image Enhancement

**Pseudocode:**
```
FOR ALL productImage WHERE isBugCondition_ImageEnhancement(productImage) DO
  result := image-enhancement_fixed(productImage)
  ASSERT result.background IN [solid_white, solid_beige, solid_gray]
  ASSERT result.product == productImage.product  // Product preserved
END FOR
```

#### Issue 3: Action Buttons

**Pseudocode:**
```
FOR ALL buttonClick WHERE isBugCondition_ButtonClick(buttonClick) DO
  result := system_fixed(buttonClick)
  ASSERT confirmation-handler_invoked(buttonClick)
  ASSERT response_sent(buttonClick)
END FOR
```

#### Issue 4: Voice Confirmation

**Pseudocode:**
```
FOR ALL confirmationRequest WHERE isBugCondition_VoiceConfirmation(confirmationRequest) DO
  result := confirmation-handler_fixed(confirmationRequest)
  ASSERT result.voiceUrl != null OR result.textSummary != null  // Voice or text fallback
  ASSERT message_delivered(confirmationRequest.phone)
END FOR
```

#### Issue 5: Agent Memory

**Pseudocode:**
```
FOR ALL conversationTurn WHERE isBugCondition_AgentMemory(conversationTurn) DO
  result := agent_fixed(conversationTurn)
  ASSERT context_maintained(conversationTurn)
  ASSERT preferences_tracked(conversationTurn)
  ASSERT appropriate_response(result)
END FOR
```

#### Issue 6: Message Ordering

**Pseudocode:**
```
FOR ALL confirmation WHERE isBugCondition_MessageOrdering(confirmation) DO
  result := confirmation-handler_fixed(confirmation)
  ASSERT messageOrder(result) == [image, delay_2s, buttons]
  ASSERT image_delivered_before_buttons(result)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug conditions do NOT hold, the fixed functions produce the same results as the original functions.

**Pseudocode:**
```
FOR ALL input WHERE NOT (isBugCondition_VoiceLatency(input) OR 
                         isBugCondition_ImageEnhancement(input) OR 
                         isBugCondition_ButtonClick(input) OR 
                         isBugCondition_VoiceConfirmation(input) OR 
                         isBugCondition_AgentMemory(input) OR 
                         isBugCondition_MessageOrdering(input)) DO
  ASSERT system_original(input) = system_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for non-buggy scenarios, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Voice Transcription Preservation**: Verify voice messages that already respond quickly continue to work with same accuracy
2. **Image Product Preservation**: Verify product in images is preserved exactly (no modifications to product itself)
3. **Non-Interactive Message Preservation**: Verify text messages and images without buttons continue to work
4. **Agent Valid Input Preservation**: Verify agent responses for valid, in-context inputs remain appropriate
5. **Text Confirmation Preservation**: Verify text-based confirmations continue to work correctly
6. **Message Delivery Preservation**: Verify all messages continue to be delivered successfully through WhatsApp

### Unit Tests

- Test voice-handler with mocked Lambda invocations to verify parallelization
- Test image-enhancement with mocked Bedrock API to verify IMAGE_VARIATION task type and prompts
- Test whatsapp-webhook-handler button click routing to EventBridge
- Test confirmation-handler button payload parsing and action handling
- Test confirmation-handler voice generation with mocked Polly and S3
- Test conversation-memory service for storing and retrieving conversation history
- Test confirmation-handler message ordering with mocked WhatsApp API

### Property-Based Tests

- Generate random voice messages and verify response time < 3 seconds after fix
- Generate random product images and verify background transformation while preserving product
- Generate random button click events and verify handler invocation
- Generate random confirmation requests and verify voice or text delivery
- Generate random multi-turn conversations and verify context maintenance
- Generate random confirmations with images and verify message ordering

### Integration Tests

- Test full voice message flow from WhatsApp webhook to response (end-to-end latency)
- Test full image enhancement flow from upload to enhanced image delivery
- Test full button click flow from WhatsApp to confirmation handler to response
- Test full confirmation flow with voice generation, S3 upload, and WhatsApp delivery
- Test full multi-turn conversation flow with context tracking and preference updates
- Test full confirmation flow with image and buttons in correct order
