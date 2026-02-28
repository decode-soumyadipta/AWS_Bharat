# Requirements Document: Voice-First Workflow Enhancement

## Introduction

This document specifies the requirements for enhancing the Vyapar-Vaani system with a complete voice-first workflow. The system currently processes text messages for catalog creation. This enhancement will enable a complete onboarding flow starting with KYC verification, voice message processing, missing information handling, image enhancement, and confirmation workflows with state management throughout the user journey.

The voice-first workflow is designed for low-literacy rural merchants who prefer speaking over typing, supporting Hindi, Marathi, and English languages through WhatsApp.

## Glossary

- **System**: The Vyapar-Vaani voice-first workflow enhancement
- **User**: A rural merchant interacting with the system via WhatsApp
- **KYC**: Know Your Customer - identity verification process using PAN and Aadhaar documents
- **Voice_Transcription_Service**: Amazon Transcribe service for converting audio to text
- **Text_To_Speech_Service**: Amazon Polly service for converting text to audio
- **Image_Enhancement_Service**: Amazon Titan Image Generator v2 for enhancing product photos
- **Document_Extraction_Service**: Amazon Textract for extracting text from identity documents
- **State_Manager**: Component tracking user progress through onboarding states
- **WhatsApp_Media_API**: API for downloading audio and image files from WhatsApp
- **User_State**: Current position in onboarding flow (NEW, KYC_PENDING, KYC_VERIFIED, VOICE_RECEIVED, IMAGE_PENDING, CONFIRMATION_PENDING, ACTIVE)
- **Catalog_Item**: Product information extracted from user voice messages
- **Missing_Field**: Required product information not provided by the user

## Requirements

### Requirement 1: KYC Verification Flow

**User Story:** As a new user, I want to complete identity verification by sending my PAN card photo, so that I can register as a verified seller on the platform.

#### Acceptance Criteria

1. WHEN a new user sends an image message, THE System SHALL check if the user state is NEW or KYC_PENDING
2. WHEN a user in NEW or KYC_PENDING state sends an image, THE Document_Extraction_Service SHALL extract text from the image
3. WHEN the extracted text contains a valid PAN number format, THE System SHALL extract the Aadhaar number from the document
4. WHEN PAN and Aadhaar are successfully extracted, THE System SHALL create a seller registration record with encrypted KYC data
5. WHEN seller registration succeeds, THE System SHALL update user state to KYC_VERIFIED
6. WHEN seller registration succeeds, THE System SHALL send a text confirmation message to the user
7. IF document extraction fails or PAN format is invalid, THEN THE System SHALL send an error message requesting a clearer photo
8. IF the image does not contain a PAN card, THEN THE System SHALL send a message explaining the required document format

### Requirement 2: Voice Message Transcription

**User Story:** As a user, I want to send voice messages in my preferred language (Hindi, Marathi, or English), so that I can describe products without typing.

#### Acceptance Criteria

1. WHEN a user sends an audio message, THE System SHALL download the audio file from WhatsApp_Media_API
2. WHEN an audio file is downloaded, THE Voice_Transcription_Service SHALL transcribe the audio to text
3. WHEN transcribing audio, THE Voice_Transcription_Service SHALL automatically detect the language (Hindi, Marathi, or English)
4. WHEN transcription completes successfully, THE System SHALL pass the transcribed text to intent classification
5. WHEN transcription completes successfully, THE System SHALL store the detected language in the user profile
6. IF audio download fails, THEN THE System SHALL retry up to 3 times with exponential backoff
7. IF transcription fails after retries, THEN THE System SHALL send an error message to the user
8. WHEN the audio file format is unsupported, THE System SHALL send a message requesting a different format

### Requirement 3: State-Based Message Routing

**User Story:** As the system, I want to route incoming messages based on user state, so that users receive appropriate responses at each stage of onboarding.

#### Acceptance Criteria

1. WHEN a message is received, THE State_Manager SHALL retrieve the current user state from DynamoDB
2. WHEN user state is NEW, THE System SHALL route image messages to KYC verification flow
3. WHEN user state is KYC_VERIFIED, THE System SHALL route voice messages to catalog creation flow
4. WHEN user state is IMAGE_PENDING, THE System SHALL route image messages to image enhancement flow
5. WHEN user state is CONFIRMATION_PENDING, THE System SHALL route button replies to confirmation handler
6. WHEN a user sends a message type incompatible with their current state, THE System SHALL send a guidance message explaining the expected action
7. WHEN state retrieval fails, THE System SHALL default to NEW state and log the error
8. WHEN state transition occurs, THE System SHALL persist the new state to DynamoDB immediately

### Requirement 4: Missing Information Handler

**User Story:** As a user, I want to be prompted for missing product information in my language, so that I can provide complete details without confusion.

#### Acceptance Criteria

1. WHEN entity extraction completes, THE System SHALL validate that all required fields (product name, price, quantity, unit) are present
2. WHEN one or more required fields are missing, THE System SHALL identify which fields are missing
3. WHEN missing fields are identified, THE System SHALL generate a natural language prompt in the user's detected language
4. WHEN a prompt is generated, THE Text_To_Speech_Service SHALL convert the text to audio in the user's language
5. WHEN audio generation completes, THE System SHALL send the voice message via WhatsApp
6. WHEN a voice prompt is sent, THE System SHALL update user state to include pending fields information
7. WHEN the user responds with additional information, THE System SHALL merge new entities with previously extracted data
8. WHEN all required fields are present after merging, THE System SHALL proceed to image request flow

### Requirement 5: Product Image Enhancement

**User Story:** As a user, I want my product photos to be automatically enhanced to professional quality, so that my products look appealing to buyers.

#### Acceptance Criteria

1. WHEN all required product information is collected, THE System SHALL send a message requesting a product photo
2. WHEN user state is IMAGE_PENDING and an image is received, THE System SHALL download the image from WhatsApp_Media_API
3. WHEN a product image is downloaded, THE Image_Enhancement_Service SHALL enhance the image quality
4. WHEN image enhancement completes, THE System SHALL store both original and enhanced images in S3
5. WHEN images are stored, THE System SHALL associate the enhanced image URL with the pending catalog item
6. WHEN image enhancement fails, THE System SHALL use the original image and log a warning
7. IF the image is inappropriate or invalid, THEN THE System SHALL request a different photo
8. WHEN the enhanced image is ready, THE System SHALL proceed to confirmation flow

### Requirement 6: Confirmation Workflow

**User Story:** As a user, I want to review and approve my product listing before it goes live, so that I can ensure accuracy.

#### Acceptance Criteria

1. WHEN a catalog item is ready for confirmation, THE System SHALL generate a summary message with all product details
2. WHEN generating confirmation, THE System SHALL create both text and voice versions in the user's language
3. WHEN confirmation messages are ready, THE System SHALL send the text summary followed by the voice confirmation
4. WHEN sending confirmation, THE System SHALL include interactive buttons for "Approve" and "Edit"
5. WHEN confirmation is sent, THE System SHALL update user state to CONFIRMATION_PENDING
6. WHEN the user clicks "Approve", THE System SHALL create the catalog entry in DynamoDB
7. WHEN the user clicks "Edit", THE System SHALL prompt for which field to modify
8. WHEN catalog creation succeeds, THE System SHALL update user state to ACTIVE and send success confirmation
9. WHEN catalog creation succeeds, THE System SHALL broadcast the catalog to the ONDC network
10. IF the user does not respond within 24 hours, THEN THE System SHALL send a reminder message

### Requirement 7: State Persistence and Recovery

**User Story:** As the system, I want to persist user state and partial data reliably, so that users can resume their workflow after interruptions.

#### Acceptance Criteria

1. WHEN user state changes, THE System SHALL write the new state to DynamoDB with a timestamp
2. WHEN partial catalog data is collected, THE System SHALL store it in DynamoDB with the user's phone number as key
3. WHEN storing partial data, THE System SHALL include all collected fields and missing field indicators
4. WHEN a user sends a message, THE System SHALL retrieve both state and partial data in a single DynamoDB query
5. WHEN partial data exists and new entities are extracted, THE System SHALL merge them preserving existing values
6. WHEN state persistence fails, THE System SHALL retry up to 3 times before returning an error
7. WHEN retrieving state for a new user, THE System SHALL initialize with NEW state and empty partial data
8. WHEN a catalog item is successfully created, THE System SHALL delete the partial data record

### Requirement 8: Error Handling and User Guidance

**User Story:** As a user, I want clear error messages and guidance when something goes wrong, so that I know how to proceed.

#### Acceptance Criteria

1. WHEN any AWS service call fails, THE System SHALL log the error with full context
2. WHEN a user-facing error occurs, THE System SHALL send a message in the user's language explaining the issue
3. WHEN an error message is sent, THE System SHALL include specific guidance on how to retry or fix the issue
4. WHEN a transient error occurs (network, timeout), THE System SHALL retry automatically before notifying the user
5. WHEN a permanent error occurs (invalid format, unsupported type), THE System SHALL notify the user immediately
6. WHEN the system is in an unexpected state, THE System SHALL send a message asking the user to start over
7. WHEN critical errors occur, THE System SHALL send alerts to monitoring systems
8. WHEN a user sends an unrecognized command, THE System SHALL send a help message with available actions

### Requirement 9: Language Consistency

**User Story:** As a user, I want all system responses in my preferred language, so that I can understand every interaction.

#### Acceptance Criteria

1. WHEN a user's language is detected from voice transcription, THE System SHALL store it in the user profile
2. WHEN generating text responses, THE System SHALL use the stored language preference
3. WHEN generating voice responses, THE Text_To_Speech_Service SHALL use the stored language preference
4. WHEN a user profile has no language preference, THE System SHALL default to Hindi
5. WHEN a user switches languages in a message, THE System SHALL update the language preference
6. WHEN translating system messages, THE System SHALL use natural, conversational phrasing
7. WHEN technical terms are used, THE System SHALL use commonly understood equivalents in the target language
8. WHEN sending error messages, THE System SHALL ensure they are culturally appropriate and clear

### Requirement 10: Audio and Image Download Management

**User Story:** As the system, I want to reliably download media files from WhatsApp, so that I can process voice messages and images.

#### Acceptance Criteria

1. WHEN a voice or image message is received, THE System SHALL extract the media URL from the webhook payload
2. WHEN a media URL is extracted, THE System SHALL authenticate with WhatsApp_Media_API using the access token
3. WHEN downloading media, THE System SHALL stream the file directly to the processing service
4. WHEN a download fails, THE System SHALL retry up to 3 times with exponential backoff
5. WHEN media download succeeds, THE System SHALL validate the file size is within acceptable limits
6. WHEN media download succeeds, THE System SHALL validate the MIME type matches the expected format
7. IF media URL is expired, THEN THE System SHALL request the user to resend the message
8. IF media file is too large, THEN THE System SHALL send a message requesting a smaller file

### Requirement 11: Integration with Existing System

**User Story:** As the system, I want to integrate seamlessly with existing catalog creation and ONDC broadcast functionality, so that voice-created catalogs work identically to text-created ones.

#### Acceptance Criteria

1. WHEN voice transcription completes, THE System SHALL pass transcribed text to the existing intent classification Lambda
2. WHEN entities are extracted from voice messages, THE System SHALL use the same entity extraction Lambda as text messages
3. WHEN a catalog item is ready, THE System SHALL use the existing catalog builder Lambda
4. WHEN catalog creation completes, THE System SHALL use the existing ONDC broadcast functionality
5. WHEN storing catalog data, THE System SHALL use the same DynamoDB table structure as text-based catalogs
6. WHEN sending WhatsApp messages, THE System SHALL use the existing WhatsApp message sender Lambda
7. WHEN publishing events, THE System SHALL use the existing EventBridge event patterns
8. WHEN voice-created catalogs are stored, THE System SHALL include a source field indicating "voice" origin

## Notes

- All AWS service integrations must use existing configured clients from `src/config/aws-clients.ts`
- State management must be atomic to prevent race conditions from concurrent messages
- Voice and image processing must handle large files efficiently without Lambda memory issues
- All PII (PAN, Aadhaar) must be encrypted at rest using AWS KMS
- The system must maintain backward compatibility with existing text-based workflows
- Language detection accuracy should be monitored and improved based on user feedback
