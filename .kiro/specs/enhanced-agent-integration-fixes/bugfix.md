# Bugfix Requirements Document

## Introduction

The Vyapar Vaani voice-first workflow system has multiple critical integration issues preventing the enhanced agent features from functioning properly. Users cannot interact with buttons, voice confirmations are not recognized, the enhanced agent with advanced features (dynamic language switching, web search, typing indicators, Bengali support) is not integrated, and several supporting features are missing or non-functional. These issues severely impact the user experience by making the system less interactive, less responsive, and unable to deliver the promised voice-first, multilingual, personal agent experience.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user clicks the "✅ स्वीकार करें" (Approve) button THEN the system does not trigger catalog creation

1.2 WHEN a user clicks the "✏️ मात्रा बदलें" (Edit Quantity) button THEN the system does not trigger quantity editing flow

1.3 WHEN a user clicks the "📋 उत्पाद देखें" (View Products) button THEN the system does not display the product list

1.4 WHEN a user sends a voice message saying "swikar hai" or similar confirmation phrases THEN the system does not recognize it as a confirmation intent and does not respond

1.5 WHEN a user sends a voice message saying "swikar hai" THEN the system does not create the catalog

1.6 WHEN agent-handler.ts processes messages THEN it uses personal-agent.ts instead of enhanced-agent.ts with advanced features

1.7 WHEN a user asks market price queries like "aaj aam ka bhav kya hai" (what's the price of mangoes today) THEN the system fails because the web search tool does not exist at src/tools/web-search.ts

1.8 WHEN the agent processes a message THEN users do not see the typing indicator animation showing the agent is thinking

1.9 WHEN button click events are routed through agent-handler THEN the confirmation-handler does not receive properly formatted button payloads

1.10 WHEN intent classification processes voice confirmations THEN it does not recognize confirmation intents because they are not defined in the classification system

### Expected Behavior (Correct)

2.1 WHEN a user clicks the "✅ स्वीकार करें" (Approve) button THEN the system SHALL trigger catalog creation and provide confirmation feedback

2.2 WHEN a user clicks the "✏️ मात्रा बदलें" (Edit Quantity) button THEN the system SHALL initiate the quantity editing flow and prompt for new quantity

2.3 WHEN a user clicks the "📋 उत्पाद देखें" (View Products) button THEN the system SHALL display the complete product list to the user

2.4 WHEN a user sends a voice message saying "swikar hai" or similar confirmation phrases THEN the system SHALL recognize it as a confirmation intent

2.5 WHEN a user sends a voice message saying "swikar hai" THEN the system SHALL create the catalog and provide confirmation feedback

2.6 WHEN agent-handler.ts processes messages THEN it SHALL use enhanced-agent.ts with all advanced features including dynamic language switching (Hindi ↔ English ↔ Marathi ↔ Bengali), web search, typing indicators, and Bengali support

2.7 WHEN a user asks market price queries like "aaj aam ka bhav kya hai" THEN the system SHALL use the web search tool to fetch current market prices and provide results with source links

2.8 WHEN the agent processes a message THEN the system SHALL display the typing indicator animation to users before sending the response

2.9 WHEN button click events are routed through agent-handler THEN the system SHALL properly format and pass button payloads to confirmation-handler for processing

2.10 WHEN intent classification processes voice confirmations THEN it SHALL recognize confirmation intents and classify them appropriately

### Unchanged Behavior (Regression Prevention)

3.1 WHEN users send regular voice messages for product catalog creation THEN the system SHALL CONTINUE TO transcribe, extract entities, and build catalogs as before

3.2 WHEN users interact with the KYC document upload flow THEN the system SHALL CONTINUE TO process identity documents and validate seller registration

3.3 WHEN the system validates ONDC schema compliance THEN it SHALL CONTINUE TO enforce Beckn protocol requirements

3.4 WHEN users send image messages for product photos THEN the system SHALL CONTINUE TO download, enhance, and store media files

3.5 WHEN the state manager tracks conversation state THEN it SHALL CONTINUE TO maintain partial data and route between conversation states

3.6 WHEN the catalog builder creates product catalogs THEN it SHALL CONTINUE TO validate and structure catalog data according to ONDC standards

3.7 WHEN WhatsApp messages are received at the webhook THEN the system SHALL CONTINUE TO route them to appropriate handlers based on message type

3.8 WHEN voice transcription processes audio messages THEN it SHALL CONTINUE TO convert speech to text with Hindi language support

3.9 WHEN entity extraction processes transcribed text THEN it SHALL CONTINUE TO identify product names, quantities, prices, and other catalog entities

3.10 WHEN the DynamoDB repository stores seller and catalog data THEN it SHALL CONTINUE TO maintain data persistence and encryption
