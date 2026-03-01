# Implementation Plan

## Issue 1: Voice Message Latency

- [x] 1. Write bug condition exploration test for voice latency
  - **Property 1: Fault Condition** - Voice Message Response Time Exceeds 3 Seconds
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate voice latency > 3 seconds
  - **Scoped PBT Approach**: Test voice messages of varying lengths (5s, 10s, 20s) to ensure reproducibility
  - Test that voice-handler responds within 3000ms for all voice message inputs (from Fault Condition in design)
  - Measure timestamps at each stage: transcription start/end, intent start/end, entity start/end, total response time
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS with response times > 3000ms (this is correct - it proves the bug exists)
  - Document counterexamples found (e.g., "10-second voice message took 4500ms to respond")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.1_

- [x] 2. Write preservation property tests for voice latency (BEFORE implementing fix)
  - **Property 2: Preservation** - Voice Transcription Accuracy Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for voice messages that already respond quickly (< 3 seconds)
  - Write property-based test: for all voice messages, transcription accuracy remains unchanged after parallelization (from Preservation Requirements in design)
  - Verify test passes on UNFIXED code
  - _Requirements: 3.1_

- [x] 3. Fix voice message latency by parallelizing Lambda invocations

  - [x] 3.1 Implement parallel invocation in voice-handler
    - Modify `src/lambdas/voice-handler.ts` handler function
    - After transcription completes, invoke intent-classification and entity-extraction in parallel using Promise.all()
    - Change from sequential (transcription → intent → entity) to parallel (transcription → [intent, entity] in parallel)
    - Add performance logging: log timestamps at each stage (transcription start/end, intent start/end, entity start/end)
    - Calculate and log total response time
    - _Bug_Condition: isBugCondition_VoiceLatency(input) where input.type == 'audio' AND responseTime(input) > 3000ms_
    - _Expected_Behavior: result.responseTime <= 3000ms from design_
    - _Preservation: Voice transcription accuracy must remain unchanged from design_
    - _Requirements: 2.1, 3.1_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Voice Message Response Time Within 3 Seconds
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES with response times <= 3000ms (confirms bug is fixed)
    - _Requirements: 2.1_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Voice Transcription Accuracy Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions in transcription accuracy)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint - Ensure all voice latency tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Issue 2: Image Enhancement Not Working

- [~] 5. Write bug condition exploration test for image enhancement
  - **Property 1: Fault Condition** - Image Enhancement Returns Original Background
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate background not being transformed
  - **Scoped PBT Approach**: Test product images with different backgrounds (cluttered, messy, plain) to ensure reproducibility
  - Test that image-enhancement transforms background to solid professional color (white/beige/gray) while preserving product (from Fault Condition in design)
  - Verify output image background color is solid (not transparent or original)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS with transparent or original backgrounds (this is correct - it proves the bug exists)
  - Document counterexamples found (e.g., "Food product image returned with transparent background instead of solid white")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.2_

- [~] 6. Write preservation property tests for image enhancement (BEFORE implementing fix)
  - **Property 2: Preservation** - Product Preservation in Images
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for image enhancement
  - Write property-based test: for all product images, the product itself is preserved exactly without modifications (from Preservation Requirements in design)
  - Verify test passes on UNFIXED code
  - _Requirements: 3.2_

- [x] 7. Fix image enhancement to transform backgrounds properly

  - [x] 7.1 Implement IMAGE_VARIATION task type in image-enhancement
    - Modify `src/lambdas/image-enhancement.ts` functions: handler, invokeTitanImageGenerator, generatePositivePrompt
    - Switch from BACKGROUND_REMOVAL to IMAGE_VARIATION task type
    - Update titanRequest.taskType from 'BACKGROUND_REMOVAL' to 'IMAGE_VARIATION'
    - Add imageVariationParams with images array, text (positive prompt), negativeText, and similarityStrength
    - Remove backgroundRemovalParams
    - Set similarityStrength to 0.9 (very high) to preserve product exactly
    - _Bug_Condition: isBugCondition_ImageEnhancement(input) where input.type == 'image' AND enhancementRequested(input) AND outputImage.background == inputImage.background_
    - _Expected_Behavior: result.background IN [solid_white, solid_beige, solid_gray] AND result.product == input.product from design_
    - _Preservation: Product in image must be preserved exactly from design_
    - _Requirements: 2.2, 3.2_

  - [x] 7.2 Enhance positive prompt for solid color backgrounds
    - Modify generatePositivePrompt function in `src/lambdas/image-enhancement.ts`
    - Add explicit "solid white background" or "solid beige background" or "solid gray background"
    - Add "no patterns, no textures, plain backdrop, professional studio setup"
    - Add "completely replace background, solid color only"
    - Add category-specific background colors: Food/Grocery → Pure white, Handicraft/Textile → Warm beige, Other → Light gray
    - _Requirements: 2.2_

  - [x] 7.3 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Image Enhancement Transforms Background to Solid Color
    - **IMPORTANT**: Re-run the SAME test from task 5 - do NOT write a new test
    - The test from task 5 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 5
    - **EXPECTED OUTCOME**: Test PASSES with solid color backgrounds (confirms bug is fixed)
    - _Requirements: 2.2_

  - [x] 7.4 Verify preservation tests still pass
    - **Property 2: Preservation** - Product Preservation in Images
    - **IMPORTANT**: Re-run the SAME tests from task 6 - do NOT write new tests
    - Run preservation property tests from step 6
    - **EXPECTED OUTCOME**: Tests PASS (confirms product is still preserved exactly)
    - Confirm all tests still pass after fix (no regressions)

- [x] 8. Checkpoint - Ensure all image enhancement tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Issue 3: Action Buttons Not Working

- [~] 9. Write bug condition exploration test for action buttons
  - **Property 1: Fault Condition** - Button Clicks Do Not Trigger Handler
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate button clicks not triggering handlers
  - **Scoped PBT Approach**: Test all button types (approve, edit_quantity, view_products) in CONFIRMATION_PENDING state to ensure reproducibility
  - Test that button clicks trigger confirmation-handler and send appropriate responses (from Fault Condition in design)
  - Verify handler invocation and response delivery for each button type
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS with no handler invocation or response (this is correct - it proves the bug exists)
  - Document counterexamples found (e.g., "Approve button click did not trigger confirmation-handler")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.3_

- [~] 10. Write preservation property tests for action buttons (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Interactive Message Delivery
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for messages without action buttons
  - Write property-based test: for all non-interactive messages (text, images without buttons), delivery continues to work correctly (from Preservation Requirements in design)
  - Verify test passes on UNFIXED code
  - _Requirements: 3.3_

- [x] 11. Fix action button handling to trigger confirmation-handler

  - [x] 11.1 Verify and fix EventBridge rule configuration
    - Modify `infrastructure/stacks/vyapar-vaani-stack.ts` ConfirmationHandlerRule resource
    - Verify EventBridge rule event pattern matches button_reply events in CONFIRMATION_PENDING state
    - Check source, detail-type, detail.messageType, detail.state
    - Verify targets array includes confirmationHandlerLambda
    - _Bug_Condition: isBugCondition_ButtonClick(input) where input.type == 'button_reply' AND userState == 'CONFIRMATION_PENDING' AND NOT handlerInvoked_
    - _Expected_Behavior: confirmation-handler_invoked AND response_sent from design_
    - _Preservation: Non-interactive messages must continue to work from design_
    - _Requirements: 2.3, 3.3_

  - [x] 11.2 Implement robust button payload parsing in confirmation-handler
    - Modify `src/lambdas/confirmation-handler.ts` handler function
    - Add fallback parsing for different event structures
    - Add error handling with detailed logging
    - _Requirements: 2.3_

  - [x] 11.3 Add detailed logging for button click flow
    - Add logging in whatsapp-webhook-handler and confirmation-handler
    - _Requirements: 2.3_

  - [x] 11.4 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Button Clicks Trigger Handler and Send Response
    - **IMPORTANT**: Re-run the SAME test from task 9 - do NOT write a new test
    - Run bug condition exploration test from step 9
    - **EXPECTED OUTCOME**: Test PASSES with handler invocation and response delivery
    - _Requirements: 2.3_

  - [x] 11.5 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Interactive Message Delivery
    - **IMPORTANT**: Re-run the SAME tests from task 10 - do NOT write new tests
    - Run preservation property tests from step 10
    - **EXPECTED OUTCOME**: Tests PASS (confirms non-interactive messages still work)

- [x] 12. Checkpoint - Ensure all action button tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Issue 4: Confirmation Voice Messages Not Working

- [~] 13. Write bug condition exploration test for voice confirmations
  - **Property 1: Fault Condition** - Voice Confirmations Fail to Generate or Deliver
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate voice confirmation failures
  - **Scoped PBT Approach**: Test voice confirmations in different languages (Hindi, Marathi, English) to ensure reproducibility
  - Test that confirmation-handler successfully generates voice using Polly, uploads to S3, and delivers to user (from Fault Condition in design)
  - Verify voice URL is generated or text fallback is provided
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS with Polly synthesis, S3 upload, or delivery failures (this is correct - it proves the bug exists)
  - Document counterexamples found (e.g., "Marathi voice confirmation failed Polly synthesis")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.4_

- [~] 14. Write preservation property tests for voice confirmations (BEFORE implementing fix)
  - **Property 2: Preservation** - Text Confirmation Processing
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for text-based confirmations
  - Write property-based test: for all text-based confirmations, processing continues to work correctly (from Preservation Requirements in design)
  - Verify test passes on UNFIXED code
  - _Requirements: 3.5_

- [x] 15. Fix voice confirmation generation and delivery

  - [x] 15.1 Add Polly error handling with text fallback
    - Modify `src/lambdas/confirmation-handler.ts` functions: generateConfirmation, convertToSpeech
    - Wrap Polly synthesis in try-catch with fallback to text-only
    - If Polly fails, log error and continue without voice
    - Set voiceUrl = undefined on failure
    - Verify existing error handling works correctly
    - _Bug_Condition: isBugCondition_VoiceConfirmation(input) where input.action == 'generate' AND (pollyFailed OR s3UploadFailed OR whatsappSendFailed)_
    - _Expected_Behavior: result.voiceUrl != null OR result.textSummary != null from design_
    - _Preservation: Text confirmations must continue to work from design_
    - _Requirements: 2.4, 3.5_

  - [x] 15.2 Verify IAM permissions for Polly and S3
    - Check `infrastructure/stacks/vyapar-vaani-stack.ts` confirmationHandlerLambda permissions
    - Verify Polly:SynthesizeSpeech and S3 PutObject permissions
    - _Requirements: 2.4_

  - [x] 15.3 Implement audio message sending via WhatsApp
    - Modify `src/lambdas/confirmation-handler.ts` to support audio messages
    - Implement audio file sending or text with audio URL link
    - _Requirements: 2.4_

  - [x] 15.4 Add voice generation logging
    - Add logging for Polly synthesis, S3 upload, and text fallback
    - _Requirements: 2.4_

  - [x] 15.5 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Voice Confirmations Generate and Deliver Successfully
    - **IMPORTANT**: Re-run the SAME test from task 13 - do NOT write a new test
    - Run bug condition exploration test from step 13
    - **EXPECTED OUTCOME**: Test PASSES with voice URL or text fallback
    - _Requirements: 2.4_

  - [x] 15.6 Verify preservation tests still pass
    - **Property 2: Preservation** - Text Confirmation Processing
    - **IMPORTANT**: Re-run the SAME tests from task 14 - do NOT write new tests
    - Run preservation property tests from step 14
    - **EXPECTED OUTCOME**: Tests PASS (confirms text confirmations still work)

- [x] 16. Checkpoint - Ensure all voice confirmation tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Issue 5: Agent Workflow/Memory Issues

- [~] 17. Write bug condition exploration test for agent memory
  - **Property 1: Fault Condition** - Agent Loses Context Across Conversation Turns
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate context loss and inappropriate responses
  - **Scoped PBT Approach**: Test multi-turn conversations with context dependencies (category mentions, price preferences, partial data) to ensure reproducibility
  - Test that agent maintains conversation context, tracks user preferences, and responds appropriately across turns (from Fault Condition in design)
  - Verify context is maintained, preferences are tracked, and responses are appropriate
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS with context loss, forgotten preferences, or inappropriate responses (this is correct - it proves the bug exists)
  - Document counterexamples found (e.g., "Agent forgot product category mentioned in turn 1 by turn 3")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.5_

- [~] 18. Write preservation property tests for agent memory (BEFORE implementing fix)
  - **Property 2: Preservation** - Agent Valid Input Responses
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for valid, in-context user inputs
  - Write property-based test: for all valid, in-context inputs, agent responses remain appropriate (from Preservation Requirements in design)
  - Verify test passes on UNFIXED code
  - _Requirements: 3.4_

- [-] 19. Fix agent memory and context management

  - [x] 19.1 Implement conversation history tracking service
    - Create `src/services/conversation-memory.ts` service
    - Create ConversationHistory DynamoDB table with partition key phone, sort key timestamp
    - Store: timestamp, role, content, messageType, intent, entities
    - Implement functions: addConversationMessage(), getConversationContext()
    - _Bug_Condition: isBugCondition_AgentMemory(input) where conversationLength > 1 AND (contextLost OR inappropriateResponse OR preferencesNotTracked)_
    - _Expected_Behavior: context_maintained AND preferences_tracked AND appropriate_response from design_
    - _Preservation: Agent responses for valid inputs must remain appropriate from design_
    - _Requirements: 2.5, 3.4_

  - [x] 19.2 Implement user preferences tracking
    - Add to `src/services/conversation-memory.ts` service
    - Create UserPreferences DynamoDB table with partition key phone
    - Store: preferredCategories, typicalPriceRange, language, lastInteractionTime
    - Implement functions: updateUserPreferences(), getUserPreferences()
    - _Requirements: 2.5_

  - [x] 19.3 Generate contextual responses using conversation history
    - Add to `src/services/conversation-memory.ts` service
    - Implement function: generateContextualResponse(context, intent, entities, language)
    - Include previous turns in agent prompts
    - _Requirements: 2.5_

  - [x] 19.4 Add conversation tracking to voice-handler
    - Modify `src/lambdas/voice-handler.ts` handler function
    - Call conversation memory service after transcription
    - Track user and assistant messages
    - Get conversation context before generating responses
    - _Requirements: 2.5_

  - [x] 19.5 Update user preferences from extracted entities
    - Modify `src/lambdas/voice-handler.ts` handler function
    - Update preferredCategories, typicalPriceRange, language from entities
    - _Requirements: 2.5_

  - [~] 19.6 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Agent Maintains Context and Tracks Preferences
    - **IMPORTANT**: Re-run the SAME test from task 17 - do NOT write a new test
    - Run bug condition exploration test from step 17
    - **EXPECTED OUTCOME**: Test PASSES with context maintained and appropriate responses
    - _Requirements: 2.5_

  - [~] 19.7 Verify preservation tests still pass
    - **Property 2: Preservation** - Agent Valid Input Responses
    - **IMPORTANT**: Re-run the SAME tests from task 18 - do NOT write new tests
    - Run preservation property tests from step 18
    - **EXPECTED OUTCOME**: Tests PASS (confirms agent responses for valid inputs remain appropriate)

- [x] 20. Checkpoint - Ensure all agent memory tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Issue 6: Message Ordering (Buttons Before Image)

- [~] 21. Write bug condition exploration test for message ordering
  - **Property 1: Fault Condition** - Buttons Delivered Before Image
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate wrong message ordering
  - **Scoped PBT Approach**: Test confirmations with images and buttons to ensure reproducibility
  - Test that confirmation-handler sends image with caption first, waits 2 seconds, then sends buttons below image (from Fault Condition in design)
  - Verify message order is [image, delay_2s, buttons]
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS with buttons before image or race condition (this is correct - it proves the bug exists)
  - Document counterexamples found (e.g., "Buttons appeared before image in WhatsApp")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.6_

- [~] 22. Write preservation property tests for message ordering (BEFORE implementing fix)
  - **Property 2: Preservation** - Message Delivery Reliability
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for all message types
  - Write property-based test: for all messages sent through WhatsApp, delivery continues to be successful (from Preservation Requirements in design)
  - Verify test passes on UNFIXED code
  - _Requirements: 3.6_

- [x] 23. Fix message ordering to send image before buttons

  - [x] 23.1 Enforce sequential sending with explicit delay
    - Modify `src/lambdas/confirmation-handler.ts` generateConfirmation function
    - Add await between image send and button send
    - Change to sequential: await sendImageMessage() then await sleep(2000) then await sendInteractiveMessage()
    - Use: await new Promise(resolve => setTimeout(resolve, 2000)) for 2-second delay
    - Remove any Promise.all() wrapping image and button sends
    - _Bug_Condition: isBugCondition_MessageOrdering(input) where input.hasImage AND input.hasButtons AND messageOrder == [buttons, image] AND NOT hasDelay_
    - _Expected_Behavior: messageOrder == [image, delay_2s, buttons] from design_
    - _Preservation: Message delivery must remain reliable from design_
    - _Requirements: 2.6, 3.6_

  - [x] 23.2 Add ordering logs for debugging
    - Add logging in `src/lambdas/confirmation-handler.ts` generateConfirmation function
    - Log message send sequence
    - _Requirements: 2.6_

  - [x] 23.3 Verify current implementation
    - Check if ordering is already implemented correctly in confirmation-handler
    - Verify production behavior
    - _Requirements: 2.6_

  - [x] 23.4 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Image Delivered Before Buttons with Delay
    - **IMPORTANT**: Re-run the SAME test from task 21 - do NOT write a new test
    - Run bug condition exploration test from step 21
    - **EXPECTED OUTCOME**: Test PASSES with correct message order
    - _Requirements: 2.6_

  - [x] 23.5 Verify preservation tests still pass
    - **Property 2: Preservation** - Message Delivery Reliability
    - **IMPORTANT**: Re-run the SAME tests from task 22 - do NOT write new tests
    - Run preservation property tests from step 22
    - **EXPECTED OUTCOME**: Tests PASS (confirms message delivery remains reliable)

- [x] 24. Checkpoint - Ensure all message ordering tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Final Validation

- [x] 25. Run all property-based tests across all 6 fixes
  - Run all exploration tests (should all pass on fixed code)
  - Run all preservation tests (should all pass on fixed code)
  - Verify no regressions across the entire voice workflow
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 26. Integration testing for end-to-end voice workflow
  - Test full voice message flow from WhatsApp webhook to response (verify latency < 3s)
  - Test full image enhancement flow from upload to enhanced image delivery (verify solid color backgrounds)
  - Test full button click flow from WhatsApp to confirmation handler to response (verify handler invocation)
  - Test full confirmation flow with voice generation, S3 upload, and WhatsApp delivery (verify voice or text fallback)
  - Test full multi-turn conversation flow with context tracking and preference updates (verify context maintenance)
  - Test full confirmation flow with image and buttons in correct order (verify image before buttons)
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 27. Final checkpoint - All fixes validated
  - Ensure all 6 fixes are working correctly
  - Ensure all preservation properties are maintained
  - Ask the user if any issues or questions arise
