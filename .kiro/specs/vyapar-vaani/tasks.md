# Implementation Plan: Vyapar-Vaani

## Overview

This implementation plan breaks down the Vyapar-Vaani headless ONDC Seller Node into discrete, incremental coding tasks. The approach follows an event-driven serverless architecture on AWS, with each task building upon previous work to create a complete voice-first e-commerce platform for rural merchants.

The implementation prioritizes core functionality first (KYC, catalog creation, order management) before adding advanced features (image enhancement, multi-language support). Each major component includes property-based tests to validate correctness properties defined in the design document.

## Tasks

- [x] 1. Project Setup and Infrastructure Foundation
  - Initialize TypeScript project with AWS CDK for infrastructure as code
  - Configure AWS SDK clients for Lambda, DynamoDB, S3, EventBridge, Step Functions
  - Set up DynamoDB single table with GSIs (GSI1: phone lookup, GSI2: order status, GSI3: catalog category)
  - Create S3 buckets with lifecycle policies (kyc-documents, products/raw, products/enhanced, temp)
  - Configure EventBridge event bus with event patterns for WhatsApp and ONDC events
  - Set up CloudWatch log groups and metrics namespaces
  - _Requirements: 7.1, 7.3, 7.5, 7.6, 7.7_

- [ ] 2. WhatsApp Integration Layer
  - [x] 2.1 Implement WhatsApp webhook handler Lambda
    - Parse incoming WhatsApp messages (text, audio, image, button_reply)
    - Validate webhook signatures from AWS End User Messaging
    - Extract message metadata (sender phone, timestamp, content type)
    - Publish events to EventBridge with appropriate detail-type
    - _Requirements: 2.1, 5.3_
  
  - [x] 2.2 Implement WhatsApp message sender Lambda
    - Create function to send text messages via AWS End User Messaging API
    - Create function to send interactive messages with buttons
    - Create function to send images with captions
    - Support language-specific message formatting (Hindi, Marathi, English)
    - Implement retry logic with exponential backoff for failed deliveries
    - _Requirements: 1.4, 1.6, 5.3, 9.2, 12.6_
  
  - [x] 2.3 Write property test for WhatsApp message delivery
    - **Property 25: WhatsApp Delivery Retry**
    - **Validates: Requirements 12.6**
  
  - [x] 2.4 Write unit tests for WhatsApp integration
    - Test webhook signature validation
    - Test message parsing for different content types
    - Test interactive button message formatting
    - _Requirements: 2.1, 5.3_

- [ ] 3. Data Models and DynamoDB Access Layer
  - [x] 3.1 Define TypeScript interfaces for all data models
    - SellerProfile interface with KYC and ONDC fields
    - CatalogItem interface with Beckn catalog structure
    - Order interface with fulfillment and payment details
    - OrderTimeline interface for state tracking
    - _Requirements: 1.7, 2.9, 5.6_
  
  - [x] 3.2 Implement DynamoDB repository functions
    - Create seller profile (with GSI1 for phone lookup)
    - Get seller by phone number or seller ID
    - Create and update catalog items (with GSI3 for category lookup)
    - Get all items for a seller
    - Create and update orders (with GSI2 for status lookup)
    - Get orders by seller and status
    - Implement optimistic locking for concurrent updates
    - _Requirements: 1.7, 2.9, 5.6, 6.4_
  
  - [x] 3.3 Write property test for data encryption
    - **Property 3: KYC Data Encryption**
    - **Validates: Requirements 1.7, 11.1, 11.3**
  
  - [x] 3.4 Write unit tests for DynamoDB operations
    - Test seller profile CRUD operations
    - Test catalog item queries with GSI3
    - Test order status queries with GSI2
    - Test optimistic locking behavior
    - _Requirements: 1.7, 2.9, 5.6_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. KYC Document Processing
  - [x] 5.1 Implement document extraction Lambda
    - Download document from S3 using pre-signed URL
    - Call Amazon Textract AnalyzeDocument API with FORMS and TABLES features
    - Parse Textract response to extract key-value pairs
    - Identify document type (PAN or Aadhar) from extracted text patterns
    - Extract PAN number (format: AAAAA9999A) or Aadhar number (format: 9999 9999 9999)
    - Extract name, date of birth, and address fields
    - Return structured KYC data with confidence scores
    - _Requirements: 1.1, 1.2_
  
  - [x] 5.2 Implement KYC validation Lambda
    - Validate PAN number format using regex
    - Validate Aadhar number format and checksum
    - Check for required fields (name, document number)
    - Validate extraction confidence scores (> 80% threshold)
    - Return validation result with missing fields list
    - _Requirements: 1.3_
  
  - [x] 5.3 Implement ONDC seller registration Lambda
    - Generate unique seller ID (UUID)
    - Generate Ed25519 key pair for Beckn signing
    - Construct ONDC subscriber registration payload
    - Call ONDC Registry API to register as Sub-Network Participant
    - Store seller profile in DynamoDB with encrypted Aadhar
    - Store KYC documents in S3 with server-side encryption
    - _Requirements: 1.5, 1.7_
  
  - [x] 5.4 Create KYC processing Step Functions workflow
    - Define state machine with states: DownloadDocument, ExtractText, ParseKYCFields, ValidateFields, RegisterSeller, SendConfirmation, RequestClarification
    - Implement error handling with retry logic (3 attempts with exponential backoff)
    - Add timeout configuration (2 minutes total workflow timeout)
    - Integrate with Lambda functions from 5.1, 5.2, 5.3
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  
  - [x] 5.5 Write property test for identity document extraction
    - **Property 1: Identity Document Text Extraction**
    - **Validates: Requirements 1.1, 1.2**
  
  - [x] 5.6 Write property test for KYC validation and registration
    - **Property 2: KYC Validation and Registration**
    - **Validates: Requirements 1.3, 1.5, 1.6**
  
  - [x] 5.7 Write unit tests for KYC processing
    - Test PAN number extraction and validation
    - Test Aadhar number extraction and validation
    - Test poor image quality handling
    - Test missing fields clarification flow
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.8_

- [ ] 6. Voice-to-Text Transcription
  - [x] 6.1 Implement voice transcription Lambda
    - Download audio file from S3
    - Call Amazon Transcribe StartTranscriptionJob API
    - Support Hindi (hi-IN), Marathi (mr-IN), and English (en-IN) language codes
    - Implement automatic language detection
    - Poll for transcription job completion
    - Parse transcription result and extract text
    - Return transcribed text with detected language and confidence
    - _Requirements: 2.1, 4.1, 9.1_
  
  - [x] 6.2 Write property test for voice transcription
    - **Property 4: Voice Transcription Across Languages**
    - **Validates: Requirements 2.1, 4.1, 9.1**
  
  - [x] 6.3 Write unit tests for transcription
    - Test transcription for each supported language
    - Test automatic language detection
    - Test transcription failure handling
    - _Requirements: 2.1, 12.1_

- [ ] 7. Intent Classification and Entity Extraction
  - [x] 7.1 Implement intent classification Lambda using Claude 3.5 Sonnet
    - Construct prompt with transcribed text and intent options
    - Call Amazon Bedrock InvokeModel API with Claude 3.5 Sonnet model
    - Parse JSON response to extract intent and confidence
    - Support intents: CREATE_CATALOG, UPDATE_INVENTORY, ACCEPT_ORDER, REJECT_ORDER, UPDATE_FULFILLMENT, QUERY_STATUS
    - Handle low confidence scores (< 70%) by requesting clarification
    - _Requirements: 2.2, 4.2, 4.3, 12.8_
  
  - [x] 7.2 Implement entity extraction Lambda using Claude 3.5 Sonnet
    - Construct intent-specific prompts for entity extraction
    - For CREATE_CATALOG: extract product_name, price, quantity, unit, description, category
    - For UPDATE_INVENTORY: extract product_identifier, new_quantity, operation
    - For order intents: extract order_id, action, reason
    - Call Amazon Bedrock InvokeModel API
    - Parse JSON response and validate extracted entities
    - Handle missing required fields by requesting clarification
    - _Requirements: 2.3, 4.4, 6.2_
  
  - [x] 7.3 Write property test for intent classification
    - **Property 5: Intent Classification Completeness**
    - **Validates: Requirements 2.2, 4.3**
  
  - [x] 7.4 Write property test for entity extraction
    - **Property 6: Entity Extraction from Voice**
    - **Validates: Requirements 2.3, 4.4**
  
  - [x] 7.5 Write unit tests for AI processing
    - Test intent classification for each intent type
    - Test entity extraction for catalog creation
    - Test entity extraction for inventory updates
    - Test code-mixed input handling
    - Test low confidence clarification flow
    - _Requirements: 2.2, 2.3, 4.3, 4.4, 9.6, 12.8_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Beckn Protocol Catalog Builder
  - [x] 9.1 Implement Beckn catalog object constructor
    - Map extracted entities to BecknCatalogItem interface
    - Generate unique item ID (UUID)
    - Set descriptor fields (name, short_desc, long_desc)
    - Set price fields (currency: INR, value as decimal string)
    - Set quantity fields (available count, maximum count)
    - Map product category to ONDC category taxonomy
    - Add ONDC-specific tags (@ondc/org/returnable, @ondc/org/cancellable, etc.)
    - Set fulfillment_id and location_id from seller profile
    - _Requirements: 2.5, 2.6, 4.5_
  
  - [x] 9.2 Implement ONDC schema validator
    - Load Beckn Protocol v1.2.0 JSON schemas
    - Validate catalog object against on_search schema
    - Validate context fields (domain, country, city, action, core_version)
    - Validate mandatory fields presence
    - Validate currency code (ISO 4217: INR)
    - Validate GPS coordinate format (lat,long)
    - Return validation result with detailed error messages
    - _Requirements: 2.7, 4.7, 8.2, 8.5, 8.6, 8.7_
  
  - [x] 9.3 Implement catalog storage and broadcast Lambda
    - Validate catalog object using schema validator
    - If validation fails, request missing information from seller
    - Store validated catalog item in DynamoDB
    - Construct ONDC on_search payload with seller and item details
    - Call BPP Adapter to broadcast catalog to ONDC Registry
    - Send confirmation WhatsApp message to seller
    - _Requirements: 2.7, 2.8, 2.9, 10.4_
  
  - [x] 9.4 Write property test for Beckn protocol compliance
    - **Property 7: Beckn Protocol Compliance**
    - **Validates: Requirements 2.5, 2.6, 2.7, 4.5, 4.6, 4.7, 8.2, 8.5, 8.6, 8.7**
  
  - [x] 9.5 Write property test for catalog pre-validation
    - **Property 19: Catalog Pre-Validation**
    - **Validates: Requirements 10.4**
  
  - [x] 9.6 Write unit tests for catalog builder
    - Test catalog object construction from entities
    - Test ONDC schema validation with valid catalog
    - Test ONDC schema validation with invalid catalog
    - Test missing field clarification flow
    - _Requirements: 2.5, 2.6, 2.7, 2.8_

- [ ] 10. Image Enhancement with Amazon Titan
  - [x] 10.1 Implement image enhancement Lambda
    - Download raw product photo from S3
    - Encode image to base64
    - Construct Titan Image Generator v2 request with CANNY_EDGE conditioning
    - Set positive prompt for professional product photography
    - Set negative prompt to avoid label/text modifications
    - Set similarityStrength to 0.8 for high structure preservation
    - Call Amazon Bedrock InvokeModel API with Titan Image Generator v2
    - Decode generated image from base64
    - Upload enhanced image to S3
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  
  - [x] 10.2 Implement image validation using Amazon Rekognition
    - Call Rekognition DetectLabels for raw image
    - Call Rekognition DetectLabels for enhanced image
    - Compare top 5 labels from each image
    - Calculate label overlap percentage
    - Return validation result (pass if overlap >= 60%)
    - _Requirements: 3.4, 3.5_
  
  - [x] 10.3 Create image enhancement Step Functions workflow
    - Define state machine with states: DownloadImage, EnhanceImage, ValidateImage, StoreImages, UpdateCatalog, HandleFailure
    - Implement fallback logic: use raw image if enhancement fails or validation fails
    - Add timeout configuration (30 seconds total workflow timeout)
    - Integrate with Lambda functions from 10.1 and 10.2
    - _Requirements: 3.1, 3.6, 3.7, 3.8, 3.9_
  
  - [x] 10.4 Write property test for image enhancement workflow
    - **Property 8: Image Enhancement Workflow Initiation**
    - **Validates: Requirements 3.1, 3.9**
  
  - [x] 10.5 Write property test for product structure preservation
    - **Property 9: Product Structure Preservation**
    - **Validates: Requirements 3.3, 3.4, 3.5**
  
  - [x] 10.6 Write property test for image storage
    - **Property 10: Image Storage Completeness**
    - **Validates: Requirements 3.6, 3.7**
  
  - [x] 10.7 Write property test for image enhancement fallback
    - **Property 11: Image Enhancement Fallback**
    - **Validates: Requirements 3.8**
  
  - [x] 10.8 Write unit tests for image enhancement
    - Test Titan image generation with valid input
    - Test image validation with high overlap
    - Test image validation with low overlap
    - Test fallback to raw image on failure
    - _Requirements: 3.1, 3.4, 3.8_

- [x] 11. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. BPP Adapter and Beckn Protocol Implementation
  - [x] 12.1 Implement Beckn message signing
    - Generate signing string from payload (created, expires, digest)
    - Calculate BLAKE-512 digest of payload
    - Sign using Ed25519 private key
    - Construct Authorization header with signature
    - _Requirements: 8.3_
  
  - [x] 12.2 Implement Beckn message verification
    - Extract signature from Authorization header
    - Parse keyId to get BAP subscriber ID
    - Fetch BAP public key from ONDC Registry
    - Verify signature using Ed25519 public key
    - Reject requests with invalid signatures
    - _Requirements: 8.4_
  
  - [x] 12.3 Implement BPP API endpoints
    - Implement search handler (return on_search with catalog)
    - Implement select handler (return on_select with quote)
    - Implement init handler (return on_init with order draft)
    - Implement confirm handler (return on_confirm with order confirmation)
    - Implement status handler (return on_status with order status)
    - Implement track handler (return on_track with tracking details)
    - Implement update handler (return on_update with updated order)
    - Implement cancel handler (return on_cancel with cancellation)
    - Implement rating handler (return on_rating acknowledgment)
    - Implement support handler (return on_support with contact details)
    - _Requirements: 8.1_
  
  - [x] 12.4 Implement ONDC webhook receiver Lambda
    - Parse incoming Beckn protocol requests
    - Verify digital signature
    - Route to appropriate handler based on action
    - Publish events to EventBridge for internal processing
    - Return Beckn protocol responses
    - _Requirements: 5.1, 8.1, 8.4_
  
  - [x] 12.5 Write property test for Beckn message signing
    - **Property 15: Beckn Message Signing**
    - **Validates: Requirements 8.3**
  
  - [x] 12.6 Write property test for Beckn message verification
    - **Property 16: Beckn Message Verification**
    - **Validates: Requirements 8.4**
  
  - [x] 12.7 Write unit tests for BPP adapter
    - Test signature generation and verification
    - Test each Beckn API endpoint
    - Test signature verification failure handling
    - _Requirements: 8.1, 8.3, 8.4_

- [ ] 13. Order Management System
  - [x] 13.1 Implement order notification Lambda
    - Parse ONDC confirm request from EventBridge event
    - Extract order details (buyer name, items, quantities, address, payment)
    - Format order details in seller's preferred language
    - Construct interactive WhatsApp message with Accept/Reject buttons
    - Send message via WhatsApp sender Lambda
    - Store order in DynamoDB with status PENDING
    - _Requirements: 5.2, 5.3_
  
  - [x] 13.2 Implement order state transition Lambda
    - Validate state transition against state machine rules
    - Update order status in DynamoDB
    - Add timeline entry with timestamp and actor
    - Construct appropriate Beckn response (on_confirm, on_status)
    - Send response to BAP via BPP Adapter
    - Send confirmation WhatsApp message to seller
    - _Requirements: 5.4, 5.5, 5.6, 5.7, 5.8_
  
  - [x] 13.3 Implement order button handler Lambda
    - Parse button click event from WhatsApp webhook
    - Extract order ID and action (ACCEPT or REJECT) from button payload
    - Call order state transition Lambda with appropriate action
    - _Requirements: 5.4, 5.5_
  
  - [x] 13.4 Write property test for order notification delivery
    - **Property 12: Order Notification Delivery**
    - **Validates: Requirements 5.2, 5.3**
  
  - [x] 13.5 Write property test for order state transitions
    - **Property 13: Order State Transitions**
    - **Validates: Requirements 5.4, 5.5, 5.6, 5.7, 5.8**
  
  - [x] 13.6 Write unit tests for order management
    - Test order notification formatting
    - Test valid state transitions
    - Test invalid state transition rejection
    - Test order acceptance flow
    - Test order rejection flow
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.8_

- [ ] 14. Inventory Synchronization
  - [x] 14.1 Implement inventory update Lambda
    - Parse inventory update intent and entities from EventBridge event
    - Extract product identifier and new quantity
    - Query DynamoDB for matching catalog items (exact match or fuzzy search)
    - If multiple matches, send selection list to seller via WhatsApp
    - Update catalog item quantity in DynamoDB
    - If quantity is zero, mark item as OUT_OF_STOCK
    - Construct updated ONDC on_search payload
    - Broadcast updated catalog via BPP Adapter
    - Send confirmation WhatsApp message with updated inventory details
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_
  
  - [x] 14.2 Write property test for inventory update workflow
    - **Property 14: Inventory Update Workflow**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6**
  
  - [x] 14.3 Write unit tests for inventory sync
    - Test inventory update with exact product match
    - Test inventory update with fuzzy product match
    - Test inventory update with ambiguous identifier
    - Test out-of-stock marking when quantity is zero
    - _Requirements: 6.1, 6.4, 6.6, 6.7, 6.8_

- [x] 15. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Multi-Language Support
  - [x] 16.1 Implement language preference management
    - Store seller's preferred language in profile (hi, mr, en)
    - Detect language from first voice note if not set
    - Allow sellers to change language preference via voice command
    - _Requirements: 9.1, 9.2_
  
  - [x] 16.2 Implement message translation and formatting
    - Create message templates for each language (Hindi, Marathi, English)
    - Implement template rendering with dynamic values
    - Support code-mixed input in entity extraction
    - Preserve vernacular product names in catalog objects
    - _Requirements: 9.2, 9.4, 9.5, 9.6_
  
  - [x] 16.3 Implement low confidence language detection handling
    - Check language detection confidence from Transcribe
    - If confidence < 80%, ask seller to confirm preferred language
    - Store confirmed language in seller profile
    - _Requirements: 9.7_
  
  - [x] 16.4 Write property test for language preference preservation
    - **Property 17: Language Preference Preservation**
    - **Validates: Requirements 9.2, 9.4, 9.5**
  
  - [x] 16.5 Write property test for vernacular text processing
    - **Property 18: Vernacular Text Processing**
    - **Validates: Requirements 9.3, 9.6**
  
  - [x] 16.6 Write unit tests for multi-language support
    - Test message formatting in each language
    - Test language detection and confirmation
    - Test code-mixed input processing
    - Test vernacular name preservation
    - _Requirements: 9.1, 9.2, 9.6, 9.7_

- [ ] 17. Error Handling and Resilience
  - [x] 17.1 Implement error handling for AI service failures
    - Handle transcription failures with retry and user notification
    - Handle image enhancement failures with fallback to raw image
    - Handle low confidence AI operations with user confirmation
    - _Requirements: 12.1, 12.2, 12.8_
  
  - [x] 17.2 Implement retry logic for external services
    - Implement exponential backoff for ONDC Registry calls
    - Implement exponential backoff for WhatsApp message delivery
    - Configure dead-letter queues for failed operations
    - _Requirements: 12.3, 12.6_
  
  - [x] 17.3 Implement error notification system
    - Create SNS topic for critical error notifications
    - Send notifications for Lambda timeouts after retries
    - Send notifications for DynamoDB unavailability
    - Send notifications for Beckn signature verification failures
    - _Requirements: 12.7_
  
  - [x] 17.4 Write property test for transcription failure handling
    - **Property 23: Transcription Failure Handling**
    - **Validates: Requirements 12.1**
  
  - [x] 17.5 Write property test for ONDC registry retry logic
    - **Property 24: ONDC Registry Retry Logic**
    - **Validates: Requirements 12.3**
  
  - [x] 17.6 Write property test for low confidence confirmation
    - **Property 26: Low Confidence Confirmation**
    - **Validates: Requirements 12.8**
  
  - [x] 17.7 Write property test for error notification dispatch
    - **Property 27: Error Notification Dispatch**
    - **Validates: Requirements 12.7**
  
  - [x] 17.8 Write unit tests for error handling
    - Test transcription failure notification
    - Test image enhancement fallback
    - Test ONDC registry retry with exponential backoff
    - Test WhatsApp delivery retry
    - Test critical error notifications
    - _Requirements: 12.1, 12.2, 12.3, 12.6, 12.7, 12.8_

- [ ] 18. Security and Privacy Implementation
  - [x] 18.1 Implement data encryption
    - Configure DynamoDB encryption at rest using AWS KMS
    - Configure S3 server-side encryption for KYC documents
    - Encrypt sensitive fields (Aadhar number) before storing
    - _Requirements: 1.7, 11.1, 11.3_
  
  - [x] 18.2 Implement PII anonymization in logs
    - Create logging utility that redacts PAN numbers, Aadhar numbers, phone numbers
    - Apply anonymization to all CloudWatch log entries
    - Test log output to ensure no PII leakage
    - _Requirements: 11.6_
  
  - [x] 18.3 Implement message content deletion
    - Delete WhatsApp message content from temporary storage after processing
    - Ensure no message content is retained beyond processing duration
    - _Requirements: 11.5_
  
  - [x] 18.4 Implement data deletion on request
    - Create Lambda to handle seller data deletion requests
    - Delete KYC documents from S3
    - Delete seller profile from DynamoDB
    - Preserve transaction records required for compliance
    - Complete deletion within 30 days
    - _Requirements: 11.8_
  
  - [x] 18.5 Write property test for PII anonymization
    - **Property 20: PII Anonymization in Logs**
    - **Validates: Requirements 11.6**
  
  - [x] 18.6 Write property test for message content deletion
    - **Property 21: Message Content Deletion**
    - **Validates: Requirements 11.5**
  
  - [x] 18.7 Write property test for data deletion on request
    - **Property 22: Data Deletion on Request**
    - **Validates: Requirements 11.8**
  
  - [x] 18.8 Write unit tests for security features
    - Test PII redaction in logs
    - Test message content deletion after processing
    - Test data deletion request handling
    - _Requirements: 11.5, 11.6, 11.8_

- [ ] 19. Monitoring and Metrics
  - [x] 19.1 Implement CloudWatch metrics publishing
    - Publish Time_to_Network metric (KYC to registration duration)
    - Publish Catalog_Rejection_Rate metric
    - Publish image enhancement success rate
    - Publish order acceptance rate
    - Publish error metrics for each component
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_
  
  - [x] 19.2 Configure CloudWatch alarms
    - Create alarm for Lambda error rate > 5%
    - Create alarm for DynamoDB throttled requests > 10
    - Create alarm for Step Functions execution failures > 3
    - Create alarm for Beckn signature verification failures > 1
    - Create alarm for image enhancement fallback rate > 20%
    - _Requirements: 10.8_
  
  - [x] 19.3 Write unit tests for metrics publishing
    - Test metric publishing for each metric type
    - Test alarm triggering conditions
    - _Requirements: 10.8_

- [ ] 20. Integration and End-to-End Wiring
  - [x] 20.1 Wire WhatsApp webhook to EventBridge
    - Configure API Gateway to receive WhatsApp webhooks
    - Route webhook events to EventBridge with appropriate detail-types
    - _Requirements: 2.1_
  
  - [x] 20.2 Wire EventBridge to Lambda functions
    - Create EventBridge rules for KYC events → KYC processor
    - Create EventBridge rules for voice events → transcription → intent classification → entity extraction
    - Create EventBridge rules for catalog events → catalog builder → image enhancement
    - Create EventBridge rules for order events → order manager
    - Create EventBridge rules for inventory events → inventory sync
    - _Requirements: 7.5_
  
  - [x] 20.3 Wire ONDC webhooks to BPP Adapter
    - Configure API Gateway to receive ONDC Beckn protocol requests
    - Route requests to BPP Adapter Lambda
    - Route BPP Adapter events to EventBridge for internal processing
    - _Requirements: 8.1_
  
  - [x] 20.4 Configure Step Functions workflows
    - Deploy KYC processing workflow
    - Deploy image enhancement workflow
    - Configure workflow triggers from EventBridge
    - _Requirements: 7.4_
  
  - [x] 20.5 Write integration tests
    - Test end-to-end KYC flow
    - Test end-to-end catalog creation flow
    - Test end-to-end order management flow
    - Test end-to-end inventory update flow
    - _Requirements: 1.1-1.8, 2.1-2.9, 5.1-5.8, 6.1-6.8_

- [x] 21. Final Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The implementation uses TypeScript with AWS CDK for infrastructure
- All AWS services are configured for scale-to-zero serverless architecture
- ONDC/Beckn Protocol v1.2.0 compliance is maintained throughout
