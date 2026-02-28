# Enhanced Agent Integration Fixes - Bugfix Design

## Overview

The Vyapar Vaani system has multiple critical integration issues preventing the enhanced agent features from functioning properly. The root cause is that agent-handler.ts imports and uses personal-agent.ts instead of enhanced-agent.ts, missing the web search tool at src/tools/web-search.ts, button click events not being properly formatted for confirmation handling, and confirmation intents not being recognized by the intent classification system. This fix will integrate the enhanced agent with all its advanced features (dynamic language switching, web search, typing indicators, Bengali support), create the missing web search tool, fix button handling, and add confirmation intent recognition.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bugs - when users interact with buttons, send voice confirmations, or ask market price queries, the system fails to respond correctly
- **Property (P)**: The desired behavior - buttons trigger appropriate actions, voice confirmations are recognized and processed, market queries return search results, typing indicators show agent activity, and the enhanced agent with all features is used
- **Preservation**: Existing voice transcription, entity extraction, catalog building, KYC processing, and state management that must remain unchanged
- **agent-handler.ts**: The Lambda function in `src/lambdas/agent-handler.ts` that routes all messages through the AI agent
- **personal-agent.ts**: The basic agent service in `src/services/personal-agent.ts` currently being used (lacks advanced features)
- **enhanced-agent.ts**: The advanced agent service in `src/services/enhanced-agent.ts` with dynamic language switching, web search, typing indicators, and Bengali support
- **intent-classification.ts**: The Lambda function in `src/lambdas/intent-classification.ts` that classifies user intents from transcribed voice
- **web-search.ts**: The missing tool at `src/tools/web-search.ts` needed for market price queries
- **sendTypingIndicator**: The function in `src/lambdas/whatsapp-message-sender.ts` that displays typing animation to users

## Bug Details

### Fault Condition

The bugs manifest when users interact with the system through buttons, voice confirmations, or market price queries. The system fails because:
1. agent-handler.ts imports processWithAgent from personal-agent.ts instead of processWithEnhancedAgent from enhanced-agent.ts
2. The web search tool does not exist at src/tools/web-search.ts, causing market price queries to fail
3. Button click events are not properly formatted when passed to confirmation handling
4. Intent classification does not recognize CONFIRM_CATALOG as a valid intent type
5. The typing indicator function exists but is not exported from whatsapp-message-sender.ts

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type UserInteraction
  OUTPUT: boolean
  
  RETURN (input.type == 'button_click' AND input.buttonPayload IN ['approve', 'edit_quantity', 'view_products'])
         OR (input.type == 'voice_message' AND containsConfirmationPhrase(input.text))
         OR (input.type == 'voice_message' AND containsMarketPriceQuery(input.text))
         OR (input.type == 'any' AND agentProcessingMessage)
END FUNCTION

FUNCTION containsConfirmationPhrase(text)
  RETURN text MATCHES_PATTERN '(swikar|स्वीकार|accept|yes|haan|हाँ|ठीक|theek|ok)'
END FUNCTION

FUNCTION containsMarketPriceQuery(text)
  RETURN text MATCHES_PATTERN '(भाव|कीमत|रेट|price|market|rate)'
END FUNCTION
```

### Examples

- **Button Click - Approve**: User clicks "✅ स्वीकार करें" button → System should create catalog and send confirmation → Currently creates catalog but agent features not fully utilized
- **Button Click - Edit Quantity**: User clicks "✏️ मात्रा बदलें" button → System should initiate quantity editing flow → Currently returns generic message without enhanced agent processing
- **Button Click - View Products**: User clicks "📋 उत्पाद देखें" button → System should display product list → Currently returns generic message without enhanced agent processing
- **Voice Confirmation**: User says "swikar hai" (I accept) → System should recognize as CONFIRM_CATALOG intent and create catalog → Currently not recognized, no action taken
- **Market Price Query**: User asks "aaj aam ka bhav kya hai" (what's the price of mangoes today) → System should search web and return market prices with sources → Currently fails because web-search.ts doesn't exist
- **Typing Indicator**: User sends any message → System should show typing indicator while agent processes → Currently not shown because sendTypingIndicator not exported
- **Language Switching**: User says "English mein baat karo" → System should switch to English → Currently not supported because personal-agent doesn't have this feature
- **Bengali Support**: User sends Bengali voice message → System should process in Bengali → Currently not supported because personal-agent doesn't have Bengali support

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Voice transcription must continue to convert audio to text with Hindi language support
- Entity extraction must continue to identify product names, quantities, prices, and catalog entities
- Catalog builder must continue to validate and structure catalog data according to ONDC standards
- KYC document processing must continue to handle identity documents and seller registration
- State manager must continue to track conversation state and maintain partial data
- Media download and image enhancement must continue to process product photos
- WhatsApp webhook routing must continue to direct messages to appropriate handlers
- DynamoDB repository must continue to maintain data persistence and encryption
- ONDC schema validation must continue to enforce Beckn protocol requirements
- Existing text message handling must continue to work as before

**Scope:**
All inputs that do NOT involve button clicks, voice confirmations, market price queries, or agent message processing should be completely unaffected by this fix. This includes:
- Regular voice messages for product catalog creation (transcription → entity extraction → catalog building)
- Image uploads for product photos (download → enhancement → storage)
- KYC document uploads (extraction → validation → registration)
- Order status queries and fulfillment updates
- Inventory management operations
- Schema validation and compliance checking

## Hypothesized Root Cause

Based on the bug description and code analysis, the root causes are:

1. **Wrong Agent Import**: agent-handler.ts line 12 imports `processWithAgent` from `'../services/personal-agent'` instead of `processWithEnhancedAgent` from `'../services/enhanced-agent'`
   - This causes all messages to be processed by the basic agent without advanced features
   - The enhanced agent with language switching, web search, typing indicators, and Bengali support is never used

2. **Missing Web Search Tool**: The file `src/tools/web-search.ts` does not exist
   - enhanced-agent.ts line 11 imports `remote_web_search` from `'../tools/web-search'` but the file doesn't exist
   - Market price queries fail when the agent tries to call this function
   - The searchMarketPrice function in enhanced-agent.ts cannot execute

3. **Typing Indicator Not Exported**: whatsapp-message-sender.ts has sendTypingIndicator function but it's not exported
   - enhanced-agent.ts line 13 imports `sendTypingIndicator` from whatsapp-message-sender
   - The function exists (line 89) but is not in the export list
   - This causes import errors when enhanced-agent tries to use it

4. **Missing Confirmation Intent**: intent-classification.ts does not include CONFIRM_CATALOG in the valid intents list
   - Line 138 defines validIntents array with 8 intents but CONFIRM_CATALOG is not included
   - Voice confirmations like "swikar hai" cannot be classified correctly
   - The system cannot recognize when users are confirming catalog creation

5. **Button Payload Formatting**: agent-handler.ts handleButtonClick function (line 177) returns simple text messages instead of properly formatted payloads
   - Button clicks are converted to text like "मैं मात्रा बदलना चाहता हूं" instead of structured data
   - The confirmation-handler (if it existed) would not receive properly formatted button payloads
   - This prevents proper button action handling

## Correctness Properties

Property 1: Fault Condition - Enhanced Agent Integration

_For any_ user interaction where a button is clicked, a voice confirmation is sent, a market price query is asked, or any message is processed by the agent, the fixed system SHALL use enhanced-agent.ts with all advanced features (dynamic language switching, web search, typing indicators, Bengali support), properly recognize and handle the interaction, display typing indicators, and provide appropriate responses with market data when requested.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10**

Property 2: Preservation - Existing Workflow Behavior

_For any_ input that is NOT a button click, voice confirmation, or market price query (regular voice messages, image uploads, KYC documents, order queries), the fixed code SHALL produce exactly the same behavior as the original code, preserving all existing functionality for voice transcription, entity extraction, catalog building, KYC processing, state management, media handling, and schema validation.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File 1**: `src/lambdas/agent-handler.ts`

**Function**: Import statements and processWithAgent calls

**Specific Changes**:
1. **Change Import Statement**: Replace line 12
   - FROM: `import { processWithAgent, sendAgentMessage, extractProductInfo } from '../services/personal-agent';`
   - TO: `import { processWithEnhancedAgent, sendEnhancedAgentMessage } from '../services/enhanced-agent';`

2. **Update processWithAgent Call**: Replace line 73 in handler function
   - FROM: `const agentResponse = await processWithAgent(phone, userMessage, messageType, language);`
   - TO: `const agentResponse = await processWithEnhancedAgent(phone, userMessage, messageType, language as any);`

3. **Update sendAgentMessage Call**: Replace line 79 in handler function
   - FROM: `await sendAgentMessage(phone, agentResponse.message, language);`
   - TO: `await sendEnhancedAgentMessage(phone, agentResponse.message, language as any);`

4. **Update Success Message Sending**: Replace line 163 in createCatalog function
   - FROM: `await sendAgentMessage(phone, successMsg, language as any);`
   - TO: `await sendEnhancedAgentMessage(phone, successMsg, language as any);`

5. **Remove extractProductInfo**: Remove the extractProductInfo call (lines 82-88) as enhanced agent handles this internally

**File 2**: `src/tools/web-search.ts` (NEW FILE)

**Function**: Create web search tool for market price queries

**Specific Changes**:
1. **Create New File**: Create `src/tools/web-search.ts` with remote_web_search function
   - Implement web search using a search API (e.g., Brave Search API, SerpAPI, or custom implementation)
   - Accept query parameter and return array of search results with snippet and url
   - Handle errors gracefully and return empty array on failure
   - Export remote_web_search function for use by enhanced-agent

**File 3**: `src/lambdas/whatsapp-message-sender.ts`

**Function**: Export statements

**Specific Changes**:
1. **Add sendTypingIndicator to Exports**: Add sendTypingIndicator to the export list
   - The function already exists at line 89
   - Add it to the module exports so enhanced-agent can import it
   - Ensure it's exported alongside sendTextMessage, sendImageMessage, etc.

**File 4**: `src/lambdas/intent-classification.ts`

**Function**: constructIntentClassificationPrompt and validateIntentResponse

**Specific Changes**:
1. **Add CONFIRM_CATALOG Intent**: Update line 109 in constructIntentClassificationPrompt
   - Add CONFIRM_CATALOG to the list of valid intents in the prompt
   - Description: "User confirms/accepts the catalog creation (e.g., 'swikar hai', 'yes', 'accept', 'ok')"

2. **Update Valid Intents Array**: Update line 138 in validateIntentResponse
   - Add 'CONFIRM_CATALOG' to the validIntents array
   - This allows the intent to pass validation

3. **Add Intent Type**: Update `src/models/intent.ts` to include CONFIRM_CATALOG in IntentType union type

**File 5**: `src/models/intent.ts`

**Function**: IntentType type definition

**Specific Changes**:
1. **Add CONFIRM_CATALOG**: Add 'CONFIRM_CATALOG' to the IntentType union type
   - This ensures TypeScript recognizes it as a valid intent throughout the codebase

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bugs on unfixed code, then verify the fixes work correctly and preserve existing behavior.

### Exploratory Fault Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that simulate button clicks, voice confirmations, and market price queries. Run these tests on the UNFIXED code to observe failures and understand the root causes.

**Test Cases**:
1. **Button Click Test**: Simulate clicking "✅ स्वीकार करें" button and verify catalog creation (will fail on unfixed code - uses basic agent)
2. **Voice Confirmation Test**: Send voice message "swikar hai" and verify CONFIRM_CATALOG intent classification (will fail on unfixed code - intent not recognized)
3. **Market Price Query Test**: Send voice message "aaj aam ka bhav kya hai" and verify web search execution (will fail on unfixed code - web-search.ts missing)
4. **Typing Indicator Test**: Send any message and verify typing indicator is displayed (will fail on unfixed code - function not exported)
5. **Language Switch Test**: Send message "English mein baat karo" and verify language switches to English (will fail on unfixed code - personal-agent doesn't support this)
6. **Bengali Support Test**: Send Bengali voice message and verify processing (will fail on unfixed code - personal-agent doesn't support Bengali)

**Expected Counterexamples**:
- agent-handler imports personal-agent instead of enhanced-agent
- web-search.ts file does not exist, causing import errors
- sendTypingIndicator is not exported from whatsapp-message-sender
- CONFIRM_CATALOG is not in the valid intents list
- Button clicks return generic text instead of triggering enhanced agent features

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := handleUserInteraction_fixed(input)
  ASSERT expectedBehavior(result)
END FOR
```

**Expected Behavior After Fix**:
- Button clicks trigger enhanced agent processing with full feature set
- Voice confirmations are recognized as CONFIRM_CATALOG intent
- Market price queries execute web search and return results with sources
- Typing indicators display before agent responses
- Language switching works dynamically (Hindi ↔ English ↔ Marathi ↔ Bengali)
- Bengali voice messages are processed correctly

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalWorkflow(input) = fixedWorkflow(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for regular voice messages, image uploads, and KYC processing, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Voice Transcription Preservation**: Observe that regular voice messages (not confirmations or price queries) are transcribed correctly on unfixed code, then verify this continues after fix
2. **Entity Extraction Preservation**: Observe that product entities are extracted from transcriptions on unfixed code, then verify this continues after fix
3. **Catalog Building Preservation**: Observe that catalogs are built and validated on unfixed code, then verify this continues after fix
4. **Image Processing Preservation**: Observe that product images are downloaded and enhanced on unfixed code, then verify this continues after fix
5. **KYC Processing Preservation**: Observe that KYC documents are processed and validated on unfixed code, then verify this continues after fix
6. **State Management Preservation**: Observe that conversation state is tracked correctly on unfixed code, then verify this continues after fix

### Unit Tests

- Test enhanced agent import in agent-handler.ts
- Test web search tool with various market price queries
- Test sendTypingIndicator export and functionality
- Test CONFIRM_CATALOG intent classification with various confirmation phrases
- Test button click handling with all button types (approve, edit_quantity, view_products)
- Test language switching with all supported languages (Hindi, English, Marathi, Bengali)
- Test typing indicator display timing and duration

### Property-Based Tests

- Generate random button click events and verify enhanced agent processes them correctly
- Generate random voice confirmation phrases and verify CONFIRM_CATALOG intent is recognized
- Generate random market price queries and verify web search is executed
- Generate random product catalog messages and verify existing workflow is preserved
- Generate random image upload events and verify media processing is preserved
- Generate random KYC document uploads and verify validation is preserved

### Integration Tests

- Test full flow: button click → enhanced agent → catalog creation → confirmation message
- Test full flow: voice confirmation → intent classification → CONFIRM_CATALOG → catalog creation
- Test full flow: market price query → web search → results with sources → agent response
- Test full flow: any message → typing indicator → enhanced agent processing → response
- Test full flow: language switch request → language detection → agent response in new language
- Test full flow: Bengali voice message → transcription → enhanced agent → Bengali response
- Test preservation: regular voice message → transcription → entity extraction → catalog building (unchanged)
- Test preservation: image upload → download → enhancement → storage (unchanged)
- Test preservation: KYC document → extraction → validation → registration (unchanged)
