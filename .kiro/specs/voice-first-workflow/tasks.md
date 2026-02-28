# Implementation Plan: Voice-First Workflow Enhancement

## Overview

This implementation plan breaks down the voice-first workflow enhancement into discrete, incremental tasks. Each task builds on previous work and integrates with the existing Vyapar-Vaani system. The implementation follows a bottom-up approach: core infrastructure first, then individual handlers, then integration and testing.

## Tasks

- [x] 1. Implement State Management Infrastructure
  - Create StateManager service for user state persistence and retrieval
  - Create PartialDataStore service for incomplete catalog data
  - Implement DynamoDB operations with retry logic
  - Add state transition validation
  - _Requirements: 3.1, 3.7, 3.8, 7.1, 7.2, 7.3, 7.4, 7.7_

- [x] 1.1 Write property tests for state management
  - **Property 2: State Transition Consistency**
  - **Validates: Requirements 1.5, 3.8, 6.5, 6.8, 7.1**
  - **Property 11: State Persistence and Recovery**
  - **Validates: Requirements 7.2, 7.3, 7.4, 7.7**

- [x] 2. Implement Language Manager
  - Create LanguageManager service for language detection and storage
  - Add message template system with Hindi, Marathi, English translations
  - Implement language preference persistence
  - Add default language fallback (Hindi)
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 2.1 Write property tests for language consistency
  - **Property 9: Language Consistency**
  - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**


- [x] 3. Implement Media Download Service
  - Create MediaDownloadService for WhatsApp audio/image downloads
  - Add authentication with WhatsApp Media API
  - Implement file size and MIME type validation
  - Add retry logic with exponential backoff (3 attempts)
  - Implement streaming upload to S3
  - _Requirements: 2.1, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [x] 3.1 Write property tests for media download
  - **Property 10: Media Download with Retry**
  - **Validates: Requirements 2.6, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6**

- [x] 3.2 Write unit tests for media download edge cases
  - Test expired URL handling
  - Test oversized file rejection
  - Test unsupported MIME type rejection
  - _Requirements: 10.7, 10.8_

- [x] 4. Implement State Router
  - Create StateRouter service with routing rules
  - Implement state/message type validation
  - Add error guidance message generation
  - Integrate with LanguageManager for localized guidance
  - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 4.1 Write property tests for state routing
  - **Property 1: State-Based Message Routing**
  - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

- [x] 5. Implement KYC Handler Lambda
  - Create KYC handler Lambda function
  - Integrate with MediaDownloadService for image download
  - Upload images to KYC S3 bucket with KMS encryption
  - Call existing document-extraction Lambda
  - Validate PAN format and extract Aadhaar
  - Call existing seller-registration Lambda
  - Update user state to KYC_VERIFIED
  - Send confirmation message via existing WhatsApp sender
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 5.1 Write property tests for KYC processing
  - **Property 4: KYC Document Processing**
  - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6**

- [x] 5.2 Write unit tests for KYC error handling
  - Test document extraction failure
  - Test invalid PAN format
  - Test non-PAN document
  - _Requirements: 1.7, 1.8_


- [x] 6. Implement Voice Handler Lambda
  - Create Voice handler Lambda function
  - Integrate with MediaDownloadService for audio download
  - Upload audio to S3 for transcription
  - Call existing voice-transcription Lambda
  - Store detected language in user profile
  - Pass transcribed text to existing intent-classification Lambda
  - Pass to existing entity-extraction Lambda
  - Merge entities with partial data
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 6.1 Write property tests for voice transcription pipeline
  - **Property 3: Voice Transcription Pipeline**
  - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

- [x] 6.2 Write unit tests for voice error handling
  - Test transcription failure after retries
  - Test unsupported audio format
  - _Requirements: 2.7, 2.8_

- [x] 7. Implement Missing Info Handler
  - Create MissingInfoHandler service
  - Implement required field validation (productName, price, quantity, unit)
  - Generate natural language prompts using templates
  - Integrate with Amazon Polly for text-to-speech
  - Configure neural voices (Kajal for Hindi, Aditi for Marathi, Joanna for English)
  - Upload generated audio to S3
  - Send voice message via WhatsApp
  - Update user state with pending fields metadata
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 7.1 Write property tests for missing field handling
  - **Property 5: Missing Field Detection and Prompting**
  - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**
  - **Property 6: Partial Data Merging**
  - **Validates: Requirements 4.7, 7.5**

- [x] 7.2 Write unit tests for prompt generation
  - Test prompt templates in all three languages
  - Test field-specific prompts
  - _Requirements: 4.3_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.


- [x] 9. Implement Image Handler Lambda
  - Create Image handler Lambda function
  - Integrate with MediaDownloadService for image download
  - Upload original image to S3
  - Call existing image-enhancement Lambda
  - Store both original and enhanced image URLs in partial data
  - Update user state to CONFIRMATION_PENDING
  - _Requirements: 5.2, 5.3, 5.4, 5.5_

- [x] 9.1 Write property tests for image enhancement flow
  - **Property 7: Image Enhancement Flow**
  - **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.8**

- [x] 9.2 Write unit tests for image error handling
  - Test enhancement failure fallback
  - Test invalid image rejection
  - _Requirements: 5.6, 5.7_

- [x] 10. Implement Confirmation Handler Lambda
  - Create Confirmation handler Lambda function
  - Generate text summary with all product details
  - Generate voice confirmation using Polly
  - Send text + voice + interactive buttons (Approve/Edit)
  - Handle approval: call existing catalog-builder Lambda
  - Handle approval: broadcast to ONDC network
  - Handle approval: update state to ACTIVE
  - Handle approval: delete partial data
  - Handle approval: send success message
  - Handle edit: prompt for field selection
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 6.8, 6.9_

- [x] 10.1 Write property tests for confirmation flow
  - **Property 8: Confirmation and Approval Flow**
  - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.6, 6.8, 6.9, 7.8**

- [x] 10.2 Write unit tests for edit flow
  - Test edit button handling
  - Test field selection prompt
  - _Requirements: 6.7_

- [x] 11. Update Webhook Handler with State Routing
  - Modify existing whatsapp-webhook-handler.ts
  - Add StateManager integration
  - Add StateRouter integration
  - Route messages to appropriate handlers based on state
  - Handle state initialization for new users
  - Add error handling with user guidance
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_


- [x] 11.1 Write integration tests for webhook routing
  - Test routing for all state/message combinations
  - Test new user initialization
  - Test error guidance messages
  - _Requirements: 3.1, 3.6, 3.7_

- [x] 12. Add EventBridge Rules for New Handlers
  - Update infrastructure/stacks/vyapar-vaani-stack.ts
  - Add EventBridge rule for KYC handler
  - Add EventBridge rule for Voice handler
  - Add EventBridge rule for Image handler
  - Add EventBridge rule for Confirmation handler
  - Configure event patterns for state-based routing
  - _Requirements: 11.7_

- [x] 13. Add Environment Variables and Configuration
  - Add WHATSAPP_ACCESS_TOKEN to Lambda environment
  - Add WHATSAPP_PHONE_NUMBER_ID to Lambda environment
  - Add Polly voice IDs for each language
  - Add MAX_AUDIO_SIZE_MB and MAX_IMAGE_SIZE_MB limits
  - Add STATE_TTL_DAYS for cleanup
  - Add feature flags for phased rollout
  - _Requirements: 10.5, 10.6_

- [x] 14. Implement Error Handling and Monitoring
  - Add CloudWatch Logs structured logging
  - Add error categorization (transient, permanent, critical)
  - Implement retry logic with exponential backoff
  - Add CloudWatch metrics for state transitions
  - Add CloudWatch alarms for high error rates
  - Add X-Ray tracing to all Lambda functions
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.7_

- [x] 14.1 Write property tests for error handling
  - **Property 12: Error Handling with User Guidance**
  - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**
  - **Property 14: Retry Logic Consistency**
  - **Validates: Requirements 2.6, 7.6, 10.4**

- [x] 14.2 Write unit tests for error scenarios
  - Test unexpected state recovery
  - Test unrecognized command help
  - _Requirements: 8.6, 8.8_


- [x] 15. Add Integration Tests for End-to-End Flows
  - [x] 15.1 Write integration test for complete KYC flow
    - Test image upload → extraction → registration → confirmation
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  
  - [x] 15.2 Write integration test for voice catalog creation
    - Test voice → transcription → entity extraction → missing info → image → confirmation → catalog
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 4.1, 4.7, 5.1, 6.1, 6.6_
  
  - [x] 15.3 Write integration test for state persistence
    - Test state recovery across multiple messages
    - Test partial data merging
    - _Requirements: 7.1, 7.2, 7.4, 7.5_

- [x] 15.4 Write property test for system integration
  - **Property 13: Integration with Existing System**
  - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8**

- [x] 16. Add DynamoDB Table Schema Updates
  - Add GSI for querying by state (if needed for analytics)
  - Add TTL attribute for automatic cleanup
  - Update table capacity or switch to on-demand
  - Add backup and point-in-time recovery
  - _Requirements: 7.1, 7.8_

- [x] 17. Update Documentation
  - Update README.md with voice-first workflow description
  - Add architecture diagrams for state machine
  - Document environment variables
  - Add troubleshooting guide
  - Document cost estimates
  - _Requirements: All_

- [x] 18. Final Checkpoint - End-to-End Testing
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Implementation reuses existing Lambdas (document-extraction, voice-transcription, image-enhancement, intent-classification, entity-extraction, catalog-builder, whatsapp-message-sender)
- State management is the foundation - implement first
- Handlers can be implemented in parallel after state management is complete
- Integration tests validate end-to-end flows
- Feature flags enable phased rollout
