# Requirements Document: Vyapar-Vaani

## Introduction

Vyapar-Vaani is a headless ONDC Seller Node designed to empower rural Indian merchants with low digital literacy to participate in the Open Network for Digital Commerce (ONDC) ecosystem. The system enables complete e-commerce lifecycle management exclusively through WhatsApp voice notes and images, eliminating the need for traditional web interfaces or admin panels.

The system targets rural Self-Help Group (SHG) members like "Sunita" who speak vernacular languages (Marathi/Hindi) and lack English typing skills. By leveraging AI for document processing, voice-to-protocol translation, and generative image enhancement, Vyapar-Vaani removes digital barriers while maintaining strict compliance with ONDC/Beckn Protocol v1.2.0.

## Glossary

- **ONDC**: Open Network for Digital Commerce - India's decentralized e-commerce protocol
- **Beckn_Protocol**: Open protocol specification for decentralized commerce (v1.2.0)
- **BPP**: Beckn Provider Platform - Seller-side participant in ONDC network
- **BAP**: Beckn Application Platform - Buyer-side participant in ONDC network
- **Sub_Network_Participant**: A seller entity registered under a Network Participant
- **KYC**: Know Your Customer - Identity verification process
- **Catalog_Object**: Beckn-compliant JSON structure representing product listings
- **WhatsApp_Business_API**: Meta's official API for business messaging
- **Vyapar_Vaani_System**: The complete headless ONDC seller node system
- **AI_Processing_Engine**: The collection of AWS AI services used for document, voice, and image processing
- **Step_Functions_Orchestrator**: AWS Step Functions managing async AI workflows
- **DynamoDB_Store**: Amazon DynamoDB single-table design for data persistence
- **Seller**: Rural merchant using the system via WhatsApp
- **Voice_Note**: Audio message sent via WhatsApp
- **Raw_Product_Photo**: Unedited product image uploaded by seller
- **Enhanced_Product_Image**: AI-generated professional product image with background replacement
- **ONDC_Registry**: Central registry for network participants and catalog data
- **Interactive_WhatsApp_Message**: WhatsApp message with action buttons
- **Intent_Classification**: AI process to determine user's intended action from voice/text
- **Entity_Extraction**: AI process to extract structured data from unstructured input
- **Canny_Edge_Conditioning**: Image generation technique preserving product structure while changing background
- **Time_to_Network**: KPI measuring duration from first contact to ONDC registration
- **Catalog_Rejection_Rate**: KPI measuring percentage of catalogs rejected by ONDC validation

## Requirements

### Requirement 1: Zero-UI KYC and Seller Onboarding

**User Story:** As a rural merchant with low digital literacy, I want to register as an ONDC seller by simply uploading photos of my identity documents via WhatsApp, so that I can start selling without filling complex forms.

#### Acceptance Criteria

1. WHEN a Seller sends a photo of a PAN card via WhatsApp, THE Vyapar_Vaani_System SHALL extract all text fields using Amazon Textract
2. WHEN a Seller sends a photo of an Aadhar card via WhatsApp, THE Vyapar_Vaani_System SHALL extract all text fields using Amazon Textract
3. WHEN identity document text extraction is complete, THE Vyapar_Vaani_System SHALL validate extracted fields against ONDC registration requirements
4. IF extracted fields are incomplete or invalid, THEN THE Vyapar_Vaani_System SHALL send a WhatsApp message requesting clarification in the Seller's language
5. WHEN all required KYC fields are validated, THE Vyapar_Vaani_System SHALL register the Seller as a Sub_Network_Participant in the ONDC_Registry
6. WHEN registration is complete, THE Vyapar_Vaani_System SHALL send a confirmation WhatsApp message to the Seller within 2 minutes of initial document upload
7. THE Vyapar_Vaani_System SHALL store extracted KYC data in DynamoDB_Store with encryption at rest
8. WHEN KYC processing fails due to poor image quality, THE Vyapar_Vaani_System SHALL request a clearer photo via WhatsApp

### Requirement 2: Multimodal Catalog Creation

**User Story:** As a rural merchant, I want to create product listings by sending a voice note describing my product and a photo, so that I can list items without typing or using forms.

#### Acceptance Criteria

1. WHEN a Seller sends a Voice_Note in Hindi or Marathi, THE Vyapar_Vaani_System SHALL transcribe it to text using Amazon Transcribe
2. WHEN transcription is complete, THE AI_Processing_Engine SHALL classify the intent as catalog creation, inventory update, or order management
3. WHEN intent is classified as catalog creation, THE AI_Processing_Engine SHALL extract product entities including name, price, quantity, and description
4. WHEN a Seller sends a Raw_Product_Photo alongside a Voice_Note, THE Vyapar_Vaani_System SHALL associate the image with the extracted product entities
5. WHEN all product entities are extracted, THE AI_Processing_Engine SHALL construct a valid Beckn_Protocol Catalog_Object conforming to ONDC v1.2.0 schema
6. THE Catalog_Object SHALL include mandatory fields: item_id, descriptor.name, price.value, price.currency, quantity, category_id, fulfillment_id
7. WHEN Catalog_Object construction is complete, THE Vyapar_Vaani_System SHALL validate the JSON against ONDC schema definitions
8. IF validation fails, THEN THE Vyapar_Vaani_System SHALL request missing information from the Seller via WhatsApp
9. WHEN Catalog_Object is validated, THE Vyapar_Vaani_System SHALL store it in DynamoDB_Store and broadcast it via ONDC on_search

### Requirement 3: Generative Image Enhancement with Truthfulness Preservation

**User Story:** As a rural merchant, I want my product photos to look professional and appealing to buyers, while ensuring the actual product appearance is not misrepresented.

#### Acceptance Criteria

1. WHEN a Raw_Product_Photo is received, THE Vyapar_Vaani_System SHALL initiate an AWS Step Functions workflow for image processing
2. THE Step_Functions_Orchestrator SHALL invoke Amazon Titan Image Generator v2 with CANNY_EDGE conditioning mode
3. THE AI_Processing_Engine SHALL detect the product's edges and structural features from the Raw_Product_Photo
4. THE AI_Processing_Engine SHALL generate a professional background (kitchen setting, studio backdrop, or contextually appropriate scene) while preserving the product's original shape, label, and color
5. THE Enhanced_Product_Image SHALL maintain the product's visible text, logos, and packaging details exactly as they appear in the Raw_Product_Photo
6. WHEN background replacement is complete, THE Vyapar_Vaani_System SHALL store both the Raw_Product_Photo and Enhanced_Product_Image in Amazon S3
7. THE Catalog_Object SHALL reference the Enhanced_Product_Image URL for ONDC catalog display
8. WHEN image generation fails or produces unrealistic results, THE Vyapar_Vaani_System SHALL fall back to using the Raw_Product_Photo
9. THE Vyapar_Vaani_System SHALL complete image enhancement within 30 seconds of receiving the Raw_Product_Photo

### Requirement 4: Voice-to-Protocol Translation

**User Story:** As a rural merchant speaking only vernacular languages, I want my voice commands to be automatically translated into technical ONDC protocol messages, so that I can manage my store without understanding technical specifications.

#### Acceptance Criteria

1. WHEN a Voice_Note is received, THE Vyapar_Vaani_System SHALL detect the language (Hindi, Marathi, or English)
2. THE AI_Processing_Engine SHALL use Claude 3.5 Sonnet to perform Intent_Classification on the transcribed text
3. THE AI_Processing_Engine SHALL support intents: CREATE_CATALOG, UPDATE_INVENTORY, ACCEPT_ORDER, REJECT_ORDER, UPDATE_FULFILLMENT, QUERY_STATUS
4. WHEN intent is classified, THE AI_Processing_Engine SHALL perform Entity_Extraction to identify structured data fields
5. THE AI_Processing_Engine SHALL map extracted entities to corresponding Beckn_Protocol JSON schema fields
6. THE Vyapar_Vaani_System SHALL construct valid ONDC API payloads (on_search, on_select, on_init, on_confirm, on_status, on_update)
7. WHEN JSON construction is complete, THE Vyapar_Vaani_System SHALL validate the payload against Beckn_Protocol v1.2.0 specifications
8. IF the Voice_Note contains ambiguous or insufficient information, THEN THE Vyapar_Vaani_System SHALL ask clarifying questions via WhatsApp before constructing the protocol message

### Requirement 5: Real-Time Order Management via Interactive Messages

**User Story:** As a rural merchant, I want to receive order notifications on WhatsApp and respond with simple button clicks, so that I can manage orders without complex interfaces.

#### Acceptance Criteria

1. WHEN an ONDC BAP sends a confirm request to the BPP, THE Vyapar_Vaani_System SHALL receive the webhook within 2 seconds
2. THE Vyapar_Vaani_System SHALL parse the confirm request and extract order details: buyer name, items, quantities, delivery address, payment status
3. THE Vyapar_Vaani_System SHALL send an Interactive_WhatsApp_Message to the Seller with order details and two buttons: "Accept" and "Reject"
4. WHEN the Seller clicks "Accept", THE Vyapar_Vaani_System SHALL send an on_confirm response to the BAP with status "ACCEPTED"
5. WHEN the Seller clicks "Reject", THE Vyapar_Vaani_System SHALL send an on_confirm response to the BAP with status "REJECTED" and a cancellation reason
6. THE Vyapar_Vaani_System SHALL update the order status in DynamoDB_Store immediately after Seller response
7. WHEN the Seller sends a Voice_Note about order fulfillment (e.g., "Order packed and ready"), THE Vyapar_Vaani_System SHALL send an on_status update to the BAP
8. THE Vyapar_Vaani_System SHALL support order state transitions: PENDING → ACCEPTED → PACKED → SHIPPED → DELIVERED

### Requirement 6: Voice-Driven Inventory Synchronization

**User Story:** As a rural merchant, I want to update my product inventory by speaking into WhatsApp, so that my stock levels are always accurate on ONDC without manual data entry.

#### Acceptance Criteria

1. WHEN a Seller sends a Voice_Note containing inventory update intent (e.g., "Updated stock to 50 packets"), THE Vyapar_Vaani_System SHALL transcribe and classify the intent
2. THE AI_Processing_Engine SHALL extract the product identifier and new quantity from the Voice_Note
3. THE Vyapar_Vaani_System SHALL retrieve the corresponding Catalog_Object from DynamoDB_Store
4. THE Vyapar_Vaani_System SHALL update the quantity field in the Catalog_Object
5. WHEN quantity is updated, THE Vyapar_Vaani_System SHALL broadcast the updated catalog via ONDC on_search
6. THE Vyapar_Vaani_System SHALL send a confirmation WhatsApp message to the Seller with the updated inventory details
7. IF the product identifier is ambiguous, THEN THE Vyapar_Vaani_System SHALL present a list of matching products via WhatsApp for Seller selection
8. WHEN inventory reaches zero, THE Vyapar_Vaani_System SHALL mark the item as out-of-stock in the ONDC_Registry

### Requirement 7: Event-Driven Serverless Architecture

**User Story:** As a system architect, I want the platform to scale automatically from zero to handle variable load while minimizing costs, so that the solution is economically viable for rural commerce.

#### Acceptance Criteria

1. THE Vyapar_Vaani_System SHALL use AWS Lambda functions for all compute operations
2. WHEN no requests are active, THE Vyapar_Vaani_System SHALL scale to zero and incur no compute costs
3. THE Vyapar_Vaani_System SHALL use AWS End User Messaging (Social) for WhatsApp Business API integration
4. THE Step_Functions_Orchestrator SHALL manage all long-running AI workflows (image generation, document processing) to prevent Lambda timeouts
5. THE Vyapar_Vaani_System SHALL use Amazon EventBridge for event routing between components
6. THE DynamoDB_Store SHALL use on-demand billing mode to scale automatically with request volume
7. THE Vyapar_Vaani_System SHALL use Amazon S3 for storing images and documents with lifecycle policies for cost optimization
8. WHEN concurrent requests exceed 100, THE Vyapar_Vaani_System SHALL scale Lambda functions horizontally without manual intervention

### Requirement 8: ONDC/Beckn Protocol v1.2.0 Compliance

**User Story:** As a network participant, I want all protocol messages to strictly conform to ONDC specifications, so that the system interoperates seamlessly with all ONDC buyer and seller applications.

#### Acceptance Criteria

1. THE Vyapar_Vaani_System SHALL implement all mandatory Beckn_Protocol APIs: search, select, init, confirm, status, track, cancel, update, rating
2. WHEN constructing on_search responses, THE Vyapar_Vaani_System SHALL include all mandatory fields: context, message.catalog.bpp/providers, bpp/descriptor, bpp/locations, items
3. THE Vyapar_Vaani_System SHALL sign all API responses using the registered BPP private key
4. THE Vyapar_Vaani_System SHALL validate all incoming requests using the BAP's public key
5. THE Vyapar_Vaani_System SHALL include the correct context.domain value based on product category (e.g., "nic2004:52110" for retail)
6. THE Vyapar_Vaani_System SHALL use ISO 4217 currency codes (INR) in all price fields
7. THE Vyapar_Vaani_System SHALL include GPS coordinates in location fields conforming to the format "lat,long"
8. WHEN catalog validation fails against ONDC schema, THE Vyapar_Vaani_System SHALL log the error and prevent catalog broadcast

### Requirement 9: Multi-Language Support for Vernacular Commerce

**User Story:** As a rural merchant speaking Hindi or Marathi, I want to interact with the system entirely in my native language, so that language is not a barrier to digital commerce.

#### Acceptance Criteria

1. THE Vyapar_Vaani_System SHALL support voice transcription for Hindi, Marathi, and English using Amazon Transcribe
2. WHEN sending WhatsApp messages to the Seller, THE Vyapar_Vaani_System SHALL use the Seller's preferred language stored in their profile
3. THE AI_Processing_Engine SHALL perform Intent_Classification and Entity_Extraction on vernacular text without requiring English translation
4. THE Vyapar_Vaani_System SHALL store product descriptions in the original language provided by the Seller
5. WHEN constructing Catalog_Objects, THE Vyapar_Vaani_System SHALL include vernacular product names in the descriptor.name field
6. THE Vyapar_Vaani_System SHALL support code-mixed input (e.g., "Mango pickle 200 rupees") where numbers and some terms are in English
7. WHEN language detection confidence is below 80%, THE Vyapar_Vaani_System SHALL ask the Seller to confirm their preferred language

### Requirement 10: Impact Metrics and Performance Monitoring

**User Story:** As a program manager, I want to track key performance indicators that demonstrate the system's impact on rural merchant inclusion, so that I can measure success and identify improvement areas.

#### Acceptance Criteria

1. THE Vyapar_Vaani_System SHALL measure Time_to_Network as the duration from first WhatsApp message to successful ONDC registration
2. THE Vyapar_Vaani_System SHALL achieve Time_to_Network of less than 2 minutes for 95% of successful registrations
3. THE Vyapar_Vaani_System SHALL measure Catalog_Rejection_Rate as the percentage of catalogs rejected by ONDC validation
4. THE Vyapar_Vaani_System SHALL achieve Catalog_Rejection_Rate of 0% through pre-validation before ONDC submission
5. THE Vyapar_Vaani_System SHALL track the number of voice interactions per successful catalog creation
6. THE Vyapar_Vaani_System SHALL measure image enhancement success rate (percentage of images successfully processed without fallback)
7. THE Vyapar_Vaani_System SHALL track order acceptance rate (percentage of orders accepted vs rejected by sellers)
8. THE Vyapar_Vaani_System SHALL publish all metrics to Amazon CloudWatch with 1-minute granularity
9. THE Vyapar_Vaani_System SHALL generate daily reports showing: new seller registrations, catalog items created, orders processed, and average response times

### Requirement 11: Data Security and Privacy Compliance

**User Story:** As a rural merchant, I want my personal information and business data to be securely protected, so that I can trust the platform with sensitive documents and transaction details.

#### Acceptance Criteria

1. THE Vyapar_Vaani_System SHALL encrypt all data at rest in DynamoDB_Store using AWS KMS
2. THE Vyapar_Vaani_System SHALL encrypt all data in transit using TLS 1.3
3. THE Vyapar_Vaani_System SHALL store KYC documents in Amazon S3 with server-side encryption
4. THE Vyapar_Vaani_System SHALL implement IAM policies following the principle of least privilege
5. THE Vyapar_Vaani_System SHALL not store WhatsApp message content beyond the processing duration required for intent classification
6. THE Vyapar_Vaani_System SHALL anonymize seller data in CloudWatch logs (no PAN, Aadhar, or phone numbers in logs)
7. THE Vyapar_Vaani_System SHALL implement automatic deletion of KYC documents after 7 years as per Indian data retention regulations
8. WHEN a Seller requests data deletion, THE Vyapar_Vaani_System SHALL remove all personal data within 30 days while maintaining transaction records required for compliance

### Requirement 12: Error Handling and Graceful Degradation

**User Story:** As a rural merchant with unreliable internet connectivity, I want the system to handle failures gracefully and keep me informed, so that I don't lose data or miss important updates.

#### Acceptance Criteria

1. WHEN Amazon Transcribe fails to transcribe a Voice_Note, THE Vyapar_Vaani_System SHALL request the Seller to resend the message
2. WHEN Amazon Titan Image Generator fails, THE Vyapar_Vaani_System SHALL use the Raw_Product_Photo for the catalog
3. WHEN ONDC_Registry is unreachable, THE Vyapar_Vaani_System SHALL queue the catalog broadcast and retry with exponential backoff
4. THE Vyapar_Vaani_System SHALL implement dead-letter queues for all asynchronous operations
5. WHEN a Lambda function times out, THE Step_Functions_Orchestrator SHALL retry the operation up to 3 times
6. WHEN WhatsApp message delivery fails, THE Vyapar_Vaani_System SHALL retry delivery for up to 24 hours
7. THE Vyapar_Vaani_System SHALL send error notifications to system administrators via Amazon SNS when critical failures occur
8. WHEN AI_Processing_Engine confidence is below 70%, THE Vyapar_Vaani_System SHALL ask the Seller for confirmation before proceeding
