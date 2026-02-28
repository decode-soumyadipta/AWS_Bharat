# Design Document: Voice-First Workflow Enhancement

## Overview

This design document specifies the implementation of a complete voice-first workflow for the Vyapar-Vaani system. The enhancement enables rural merchants to onboard and create product catalogs using only voice messages and photos through WhatsApp, without requiring text input or digital literacy.

The system implements a state machine-driven workflow that guides users through:
1. KYC verification using document photos
2. Voice message transcription in Hindi/Marathi/English
3. Missing information prompts via voice
4. Product photo enhancement
5. Confirmation and approval workflow

All components integrate with the existing text-based catalog creation system, reusing intent classification, entity extraction, catalog building, and ONDC broadcast functionality.

## Architecture

### State Machine Design

The core of the voice-first workflow is a finite state machine that tracks each user's progress through the onboarding flow:

```
NEW → KYC_PENDING → KYC_VERIFIED → VOICE_RECEIVED → IMAGE_PENDING → CONFIRMATION_PENDING → ACTIVE
```

State transitions are triggered by user actions (sending messages) and system events (successful processing). The state machine is implemented in the webhook handler Lambda, which routes incoming messages to appropriate handlers based on current state and message type.

### Component Architecture

```
WhatsApp → Webhook Handler → State Router → [KYC | Voice | Image | Confirmation] Handler
                                ↓
                          State Manager (DynamoDB)
                                ↓
                          Partial Data Store (DynamoDB)
```


### Event Flow

The system uses EventBridge for asynchronous event-driven processing:

1. **WhatsApp Message** → Webhook Handler publishes event to EventBridge
2. **EventBridge** → Routes to appropriate Lambda based on message type and user state
3. **Processing Lambda** → Performs work (transcription, extraction, enhancement)
4. **Processing Lambda** → Updates state and publishes completion event
5. **Completion Event** → Triggers next step in workflow or sends response to user

### Integration Points

The voice-first workflow integrates with existing system components:

- **Intent Classification Lambda**: Receives transcribed text from voice messages
- **Entity Extraction Lambda**: Extracts product details from transcribed text
- **Catalog Builder Lambda**: Creates ONDC-compliant catalogs from extracted entities
- **WhatsApp Message Sender Lambda**: Sends text and voice responses to users
- **DynamoDB Repository**: Stores user state, partial data, and catalog items
- **EventBridge**: Routes events between components

## Components and Interfaces

### 1. State Manager

**Purpose**: Manages user state transitions and persistence

**Interface**:
```typescript
interface StateManager {
  getUserState(phone: string): Promise<UserState>;
  updateUserState(phone: string, newState: UserStateType, metadata?: Record<string, any>): Promise<void>;
  initializeNewUser(phone: string): Promise<UserState>;
}

type UserStateType = 'NEW' | 'KYC_PENDING' | 'KYC_VERIFIED' | 'VOICE_RECEIVED' | 
                     'IMAGE_PENDING' | 'CONFIRMATION_PENDING' | 'ACTIVE';

interface UserState {
  phone: string;
  state: UserStateType;
  language?: 'hi-IN' | 'mr-IN' | 'en-IN';
  metadata?: Record<string, any>;
  updatedAt: number;
}
```


**Implementation**: 
- Store state in DynamoDB with phone number as partition key
- Use conditional writes to prevent race conditions
- Include timestamp for state change tracking
- Store metadata for context (e.g., missing fields, pending catalog item ID)

### 2. Partial Data Store

**Purpose**: Stores incomplete catalog data during multi-step collection

**Interface**:
```typescript
interface PartialDataStore {
  savePartialData(phone: string, data: PartialCatalogItem): Promise<void>;
  getPartialData(phone: string): Promise<PartialCatalogItem | null>;
  mergePartialData(phone: string, newData: Partial<PartialCatalogItem>): Promise<PartialCatalogItem>;
  deletePartialData(phone: string): Promise<void>;
}

interface PartialCatalogItem {
  phone: string;
  productName?: string;
  price?: number;
  quantity?: number;
  unit?: string;
  category?: string;
  description?: string;
  imageUrl?: string;
  enhancedImageUrl?: string;
  missingFields: string[];
  createdAt: number;
  updatedAt: number;
}
```

**Implementation**:
- Store in same DynamoDB table as state using composite key pattern
- Merge logic preserves existing values when new data is added
- Delete after successful catalog creation
- Include missingFields array to track what still needs collection

### 3. State Router

**Purpose**: Routes incoming messages to appropriate handlers based on state and message type

**Interface**:
```typescript
interface StateRouter {
  route(message: WhatsAppInboundEvent, state: UserState): Promise<RouteDecision>;
}

interface RouteDecision {
  handler: 'KYC' | 'VOICE' | 'IMAGE' | 'CONFIRMATION' | 'ERROR';
  action: string;
  metadata?: Record<string, any>;
}
```


**Routing Rules**:
```typescript
const ROUTING_RULES = {
  NEW: {
    image: 'KYC',
    default: 'ERROR' // Send guidance message
  },
  KYC_PENDING: {
    image: 'KYC',
    default: 'ERROR'
  },
  KYC_VERIFIED: {
    audio: 'VOICE',
    text: 'VOICE', // Also accept text for accessibility
    default: 'ERROR'
  },
  VOICE_RECEIVED: {
    audio: 'VOICE', // Additional info
    text: 'VOICE',
    default: 'ERROR'
  },
  IMAGE_PENDING: {
    image: 'IMAGE',
    default: 'ERROR'
  },
  CONFIRMATION_PENDING: {
    button_reply: 'CONFIRMATION',
    default: 'ERROR'
  },
  ACTIVE: {
    audio: 'VOICE', // New catalog item
    text: 'VOICE',
    image: 'IMAGE', // Direct image for existing item
    default: 'ERROR'
  }
};
```

### 4. KYC Handler

**Purpose**: Processes identity document photos and registers sellers

**Interface**:
```typescript
interface KYCHandler {
  processDocument(imageUrl: string, phone: string): Promise<KYCResult>;
}

interface KYCResult {
  success: boolean;
  sellerId?: string;
  error?: string;
}
```

**Processing Flow**:
1. Download image from WhatsApp Media API
2. Upload to S3 KYC bucket with encryption
3. Call existing document-extraction Lambda
4. Validate extracted PAN and Aadhaar
5. Call existing seller-registration Lambda
6. Update user state to KYC_VERIFIED
7. Send confirmation message


### 5. Voice Handler

**Purpose**: Transcribes voice messages and processes product information

**Interface**:
```typescript
interface VoiceHandler {
  processVoiceMessage(audioUrl: string, phone: string, state: UserState): Promise<VoiceResult>;
}

interface VoiceResult {
  success: boolean;
  transcription?: string;
  detectedLanguage?: string;
  entities?: ExtractedEntities;
  missingFields?: string[];
  nextAction: 'REQUEST_INFO' | 'REQUEST_IMAGE' | 'ERROR';
}
```

**Processing Flow**:
1. Download audio from WhatsApp Media API
2. Upload to S3 for transcription
3. Call existing voice-transcription Lambda
4. Store detected language in user profile
5. Pass transcribed text to existing intent-classification Lambda
6. Pass to existing entity-extraction Lambda
7. Merge entities with partial data
8. Check for missing required fields
9. If missing: Generate voice prompt and send
10. If complete: Request product photo

### 6. Missing Info Handler

**Purpose**: Generates and sends voice prompts for missing information

**Interface**:
```typescript
interface MissingInfoHandler {
  generatePrompt(missingFields: string[], language: string): Promise<string>;
  convertToSpeech(text: string, language: string): Promise<string>;
  sendVoicePrompt(phone: string, audioUrl: string): Promise<void>;
}
```

**Prompt Templates** (per language):
```typescript
const PROMPT_TEMPLATES = {
  'hi-IN': {
    productName: 'कृपया उत्पाद का नाम बताएं',
    price: 'कीमत क्या है?',
    quantity: 'कितनी मात्रा है?',
    unit: 'इकाई क्या है? जैसे किलो, लीटर, पीस',
  },
  'mr-IN': {
    productName: 'कृपया उत्पादाचे नाव सांगा',
    price: 'किंमत काय आहे?',
    quantity: 'किती प्रमाण आहे?',
    unit: 'एकक काय आहे? जसे किलो, लिटर, पीस',
  },
  'en-IN': {
    productName: 'Please tell the product name',
    price: 'What is the price?',
    quantity: 'What is the quantity?',
    unit: 'What is the unit? Like kilo, liter, piece',
  }
};
```


**Text-to-Speech Integration**:
- Use Amazon Polly with neural voices
- Language-specific voices: Kajal (hi-IN), Aditi (hi-IN fallback), Joanna (en-IN)
- Store generated audio in S3
- Send via WhatsApp Media API

### 7. Image Handler

**Purpose**: Processes product photos and enhances them

**Interface**:
```typescript
interface ImageHandler {
  processProductImage(imageUrl: string, phone: string, partialData: PartialCatalogItem): Promise<ImageResult>;
}

interface ImageResult {
  success: boolean;
  originalImageUrl?: string;
  enhancedImageUrl?: string;
  error?: string;
}
```

**Processing Flow**:
1. Download image from WhatsApp Media API
2. Upload original to S3
3. Call existing image-enhancement Lambda
4. Store enhanced image URL in partial data
5. Update state to CONFIRMATION_PENDING
6. Generate confirmation message

### 8. Confirmation Handler

**Purpose**: Handles user approval/rejection of catalog items

**Interface**:
```typescript
interface ConfirmationHandler {
  generateConfirmation(partialData: PartialCatalogItem, language: string): Promise<ConfirmationMessage>;
  processApproval(phone: string, partialData: PartialCatalogItem): Promise<ApprovalResult>;
  processEdit(phone: string, field: string): Promise<void>;
}

interface ConfirmationMessage {
  textSummary: string;
  voiceUrl: string;
  buttons: Array<{ id: string; title: string }>;
}

interface ApprovalResult {
  success: boolean;
  catalogId?: string;
  error?: string;
}
```


**Confirmation Message Format**:
```
Text: "उत्पाद: आम अचार\nकीमत: ₹500\nमात्रा: 5 किलो\n\nक्या यह सही है?"
Voice: [Same content in audio format]
Buttons: ["✅ स्वीकार करें", "✏️ संपादित करें"]
```

**Approval Flow**:
1. User clicks "Approve" button
2. Call existing catalog-builder Lambda
3. Catalog builder creates ONDC-compliant catalog
4. Store in DynamoDB
5. Broadcast to ONDC network
6. Update user state to ACTIVE
7. Delete partial data
8. Send success message

### 9. Media Download Service

**Purpose**: Downloads audio and image files from WhatsApp

**Interface**:
```typescript
interface MediaDownloadService {
  downloadMedia(mediaUrl: string, mediaType: 'audio' | 'image'): Promise<MediaDownloadResult>;
  uploadToS3(buffer: Buffer, key: string, contentType: string): Promise<string>;
}

interface MediaDownloadResult {
  success: boolean;
  buffer?: Buffer;
  mimeType?: string;
  size?: number;
  error?: string;
}
```

**Implementation Details**:
- Authenticate with WhatsApp Media API using access token from environment
- Validate file size limits (audio: 16MB, image: 5MB)
- Validate MIME types (audio: audio/ogg, audio/mpeg; image: image/jpeg, image/png)
- Implement retry logic with exponential backoff (3 attempts)
- Stream directly to S3 for large files
- Handle expired URLs by requesting user to resend


### 10. Language Manager

**Purpose**: Manages user language preferences and translations

**Interface**:
```typescript
interface LanguageManager {
  detectLanguage(transcription: string): Promise<'hi-IN' | 'mr-IN' | 'en-IN'>;
  storeLanguagePreference(phone: string, language: string): Promise<void>;
  getLanguagePreference(phone: string): Promise<string>;
  translateMessage(messageKey: string, language: string, params?: Record<string, any>): string;
}
```

**Message Templates**:
```typescript
const MESSAGES = {
  KYC_SUCCESS: {
    'hi-IN': 'आपका पंजीकरण सफल रहा! अब आप उत्पाद जोड़ सकते हैं।',
    'mr-IN': 'तुमची नोंदणी यशस्वी झाली! आता तुम्ही उत्पादने जोडू शकता.',
    'en-IN': 'Your registration is successful! You can now add products.'
  },
  KYC_ERROR: {
    'hi-IN': 'दस्तावेज़ स्पष्ट नहीं है। कृपया फिर से फोटो भेजें।',
    'mr-IN': 'कागदपत्र स्पष्ट नाही. कृपया पुन्हा फोटो पाठवा.',
    'en-IN': 'Document is not clear. Please send photo again.'
  },
  IMAGE_REQUEST: {
    'hi-IN': 'कृपया उत्पाद की फोटो भेजें',
    'mr-IN': 'कृपया उत्पादाचा फोटो पाठवा',
    'en-IN': 'Please send product photo'
  },
  CATALOG_SUCCESS: {
    'hi-IN': '✅ उत्पाद सफलतापूर्वक जोड़ा गया!',
    'mr-IN': '✅ उत्पादन यशस्वीरित्या जोडले!',
    'en-IN': '✅ Product added successfully!'
  }
};
```

## Data Models

### User State Record (DynamoDB)

```typescript
interface UserStateRecord {
  PK: string; // 'USER#<phone>'
  SK: string; // 'STATE'
  phone: string;
  state: UserStateType;
  language?: 'hi-IN' | 'mr-IN' | 'en-IN';
  sellerId?: string; // After KYC
  metadata?: {
    missingFields?: string[];
    pendingCatalogItemId?: string;
    lastMessageTimestamp?: number;
  };
  createdAt: number;
  updatedAt: number;
  TTL?: number; // For cleanup of abandoned flows
}
```


### Partial Catalog Data Record (DynamoDB)

```typescript
interface PartialCatalogDataRecord {
  PK: string; // 'USER#<phone>'
  SK: string; // 'PARTIAL#<timestamp>'
  phone: string;
  productName?: string;
  price?: number;
  quantity?: number;
  unit?: string;
  category?: string;
  description?: string;
  originalImageUrl?: string;
  enhancedImageUrl?: string;
  missingFields: string[];
  source: 'voice' | 'text';
  createdAt: number;
  updatedAt: number;
  TTL?: number; // Auto-delete after 7 days
}
```

### Voice Transcription Event

```typescript
interface VoiceTranscriptionEvent {
  source: 'vyapar.vaani.internal';
  detailType: 'voice.transcription.complete';
  detail: {
    phone: string;
    messageId: string;
    transcription: string;
    detectedLanguage: 'hi-IN' | 'mr-IN' | 'en-IN';
    confidence: number;
    audioUrl: string;
  };
}
```

### State Transition Event

```typescript
interface StateTransitionEvent {
  source: 'vyapar.vaani.internal';
  detailType: 'user.state.changed';
  detail: {
    phone: string;
    previousState: UserStateType;
    newState: UserStateType;
    timestamp: number;
    metadata?: Record<string, any>;
  };
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property 1: State-Based Message Routing

*For any* incoming message and user state combination, the system should route the message to the correct handler based on the routing rules, or send an error guidance message if the combination is invalid.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

### Property 2: State Transition Consistency

*For any* successful operation (KYC completion, voice processing, image upload, approval), the user state should transition to the next appropriate state and be persisted to DynamoDB with a timestamp.

**Validates: Requirements 1.5, 3.8, 6.5, 6.8, 7.1**

### Property 3: Voice Transcription Pipeline

*For any* audio message received when user is in KYC_VERIFIED or VOICE_RECEIVED state, the system should download the audio, transcribe it, detect the language, store the language preference, and pass the transcription to intent classification.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

### Property 4: KYC Document Processing

*For any* image message received when user is in NEW or KYC_PENDING state, the system should extract text from the document, validate PAN format, extract Aadhaar, create encrypted registration record, transition to KYC_VERIFIED, and send confirmation.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6**

### Property 5: Missing Field Detection and Prompting

*For any* entity extraction result, if required fields (productName, price, quantity, unit) are missing, the system should identify missing fields, generate a prompt in the user's language, convert to speech, send via WhatsApp, and update state with pending fields metadata.

**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**

### Property 6: Partial Data Merging

*For any* new entity extraction when partial data exists, the system should merge the new entities with existing data, preserving existing values, and update the missing fields list.

**Validates: Requirements 4.7, 7.5**


### Property 7: Image Enhancement Flow

*For any* product image received when user is in IMAGE_PENDING state, the system should download the image, enhance it using Titan, store both original and enhanced images in S3, associate URLs with partial data, and transition to CONFIRMATION_PENDING.

**Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.8**

### Property 8: Confirmation and Approval Flow

*For any* complete catalog item in CONFIRMATION_PENDING state, the system should generate text and voice confirmations in the user's language, send with approve/edit buttons, and upon approval create the catalog entry, broadcast to ONDC, transition to ACTIVE, delete partial data, and send success message.

**Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.6, 6.8, 6.9, 7.8**

### Property 9: Language Consistency

*For any* user interaction after language detection, all text responses, voice responses, and prompts should use the stored language preference, defaulting to Hindi if no preference exists.

**Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**

### Property 10: Media Download with Retry

*For any* media download request (audio or image), the system should authenticate with WhatsApp API, validate file size and MIME type, and retry up to 3 times with exponential backoff on failure.

**Validates: Requirements 2.6, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6**

### Property 11: State Persistence and Recovery

*For any* user message, the system should retrieve both state and partial data in a single query, and for new users initialize with NEW state and empty partial data.

**Validates: Requirements 7.2, 7.3, 7.4, 7.7**

### Property 12: Error Handling with User Guidance

*For any* error (transient or permanent), the system should log with full context, and for user-facing errors send a message in the user's language with specific guidance on how to proceed.

**Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**


### Property 13: Integration with Existing System

*For any* voice-created catalog, the system should use the same intent classification, entity extraction, catalog builder, ONDC broadcast, and message sender components as text-based catalogs, with identical DynamoDB table structure and a source field indicating "voice" origin.

**Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8**

### Property 14: Retry Logic Consistency

*For any* retriable operation (media download, state persistence, AWS service calls), the system should retry up to 3 times with exponential backoff before failing.

**Validates: Requirements 2.6, 7.6, 10.4**

## Error Handling

### Error Categories

1. **Transient Errors** (retry automatically):
   - Network timeouts
   - AWS service throttling
   - Temporary service unavailability
   - Media download failures

2. **Permanent Errors** (notify user immediately):
   - Invalid document format
   - Unsupported file type
   - File size exceeded
   - Invalid PAN/Aadhaar format
   - Missing required fields after max attempts

3. **Critical Errors** (alert monitoring):
   - DynamoDB write failures after retries
   - EventBridge publish failures
   - KMS encryption failures
   - Unexpected state transitions

### Error Response Strategy

```typescript
interface ErrorResponse {
  userMessage: string; // Localized, actionable guidance
  logMessage: string; // Technical details for debugging
  retryable: boolean;
  errorCode: string;
  metadata?: Record<string, any>;
}
```


### Retry Configuration

```typescript
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffMultiplier: 2,
  jitter: true
};

function calculateDelay(attempt: number): number {
  const delay = Math.min(
    RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
    RETRY_CONFIG.maxDelay
  );
  
  if (RETRY_CONFIG.jitter) {
    return delay * (0.5 + Math.random() * 0.5);
  }
  
  return delay;
}
```

### Error Message Examples

```typescript
const ERROR_MESSAGES = {
  DOCUMENT_UNCLEAR: {
    'hi-IN': 'दस्तावेज़ स्पष्ट नहीं है। कृपया अच्छी रोशनी में साफ फोटो भेजें।',
    'mr-IN': 'कागदपत्र स्पष्ट नाही. कृपया चांगल्या प्रकाशात स्पष्ट फोटो पाठवा.',
    'en-IN': 'Document is not clear. Please send a clear photo in good lighting.'
  },
  AUDIO_TOO_LARGE: {
    'hi-IN': 'ऑडियो फ़ाइल बहुत बड़ी है। कृपया छोटा संदेश भेजें।',
    'mr-IN': 'ऑडिओ फाइल खूप मोठी आहे. कृपया लहान संदेश पाठवा.',
    'en-IN': 'Audio file is too large. Please send a shorter message.'
  },
  UNEXPECTED_STATE: {
    'hi-IN': 'कुछ गलत हो गया। कृपया "शुरू करें" लिखकर फिर से शुरू करें।',
    'mr-IN': 'काहीतरी चूक झाली. कृपया "सुरू करा" लिहून पुन्हा सुरू करा.',
    'en-IN': 'Something went wrong. Please type "start" to begin again.'
  }
};
```

## Testing Strategy

### Dual Testing Approach

The voice-first workflow requires both unit tests and property-based tests for comprehensive coverage:

**Unit Tests**: Focus on specific examples, edge cases, and integration points
- KYC document extraction with sample PAN/Aadhaar images
- State routing for specific state/message combinations
- Error handling for specific failure scenarios
- Message template rendering in each language
- Media download with mocked WhatsApp API responses

**Property-Based Tests**: Verify universal properties across all inputs
- State transitions maintain consistency for any valid operation
- Routing rules apply correctly for any state/message combination
- Partial data merging preserves existing values for any merge operation
- Language consistency maintained for any user interaction
- Retry logic executes correctly for any retriable failure


### Property-Based Testing Configuration

All property-based tests should:
- Run minimum 100 iterations per test (due to randomization)
- Use fast-check library for TypeScript
- Tag each test with feature name and property number
- Reference the design document property being validated

**Example Test Structure**:
```typescript
import fc from 'fast-check';

describe('Voice-First Workflow Properties', () => {
  it('Property 1: State-Based Message Routing', () => {
    // Feature: voice-first-workflow, Property 1
    fc.assert(
      fc.property(
        fc.record({
          state: fc.constantFrom('NEW', 'KYC_PENDING', 'KYC_VERIFIED', 'VOICE_RECEIVED', 
                                 'IMAGE_PENDING', 'CONFIRMATION_PENDING', 'ACTIVE'),
          messageType: fc.constantFrom('text', 'audio', 'image', 'button_reply')
        }),
        ({ state, messageType }) => {
          const decision = stateRouter.route({ type: messageType }, { state });
          
          // Should either route to valid handler or return ERROR with guidance
          const validHandlers = ['KYC', 'VOICE', 'IMAGE', 'CONFIRMATION', 'ERROR'];
          expect(validHandlers).toContain(decision.handler);
          
          // If ERROR, should have guidance message
          if (decision.handler === 'ERROR') {
            expect(decision.metadata?.guidanceMessage).toBeDefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### Test Coverage Requirements

- **State Management**: 100% coverage of state transitions and routing logic
- **Media Download**: Test all retry scenarios and error conditions
- **Language Handling**: Test all three languages (Hindi, Marathi, English)
- **Integration Points**: Mock all external services (Transcribe, Textract, Polly, Titan)
- **Error Handling**: Test all error categories and user guidance messages

### Integration Testing

Integration tests should verify:
1. End-to-end KYC flow from image upload to registration
2. End-to-end voice catalog creation from audio to ONDC broadcast
3. State persistence and recovery across Lambda invocations
4. EventBridge event routing to correct handlers
5. WhatsApp message sending with correct formatting


## Implementation Notes

### Performance Considerations

1. **Lambda Cold Starts**: 
   - Keep Lambda functions small and focused
   - Use provisioned concurrency for webhook handler
   - Lazy-load AWS SDK clients

2. **DynamoDB Optimization**:
   - Use single-table design with composite keys
   - Batch operations where possible
   - Enable point-in-time recovery for state data

3. **S3 Storage**:
   - Use lifecycle policies to archive old media after 30 days
   - Enable versioning for KYC documents
   - Use S3 Transfer Acceleration for faster uploads

4. **Media Processing**:
   - Stream large files instead of buffering in memory
   - Use Lambda with 1GB+ memory for image enhancement
   - Set appropriate timeouts (voice: 5 min, image: 3 min)

### Security Considerations

1. **KYC Data Protection**:
   - Encrypt all PAN/Aadhaar data at rest using KMS
   - Use separate S3 bucket with restricted access
   - Enable CloudTrail logging for audit
   - Implement data retention policies (delete after 7 years)

2. **WhatsApp Integration**:
   - Validate webhook signatures
   - Use short-lived access tokens
   - Rate limit incoming messages per user
   - Sanitize all user inputs

3. **State Management**:
   - Use conditional writes to prevent race conditions
   - Implement idempotency keys for operations
   - Add TTL for abandoned flows (7 days)

### Monitoring and Observability

1. **CloudWatch Metrics**:
   - State transition counts by type
   - Processing duration by handler
   - Error rates by category
   - Media download success/failure rates

2. **CloudWatch Alarms**:
   - High error rate (>5% in 5 minutes)
   - DynamoDB throttling
   - Lambda timeout rate
   - KYC processing failures

3. **X-Ray Tracing**:
   - Enable for all Lambda functions
   - Track end-to-end latency
   - Identify bottlenecks in processing pipeline


### Deployment Strategy

1. **Phased Rollout**:
   - Phase 1: Deploy state management and routing (no user impact)
   - Phase 2: Enable KYC flow for new users only
   - Phase 3: Enable voice transcription for verified users
   - Phase 4: Enable full workflow with image enhancement
   - Phase 5: Enable for all users

2. **Feature Flags**:
   ```typescript
   const FEATURE_FLAGS = {
     VOICE_FIRST_ENABLED: process.env.VOICE_FIRST_ENABLED === 'true',
     KYC_FLOW_ENABLED: process.env.KYC_FLOW_ENABLED === 'true',
     IMAGE_ENHANCEMENT_ENABLED: process.env.IMAGE_ENHANCEMENT_ENABLED === 'true',
   };
   ```

3. **Rollback Plan**:
   - Keep existing text-based flow as fallback
   - Monitor error rates during rollout
   - Ability to disable voice-first per user
   - Preserve partial data for recovery

### Migration Considerations

1. **Existing Users**:
   - Initialize state as ACTIVE for users with existing catalogs
   - No KYC required for already registered sellers
   - Gradual migration to voice-first workflow

2. **Data Migration**:
   - No schema changes to existing catalog data
   - Add source field to new catalog items
   - Backfill language preferences from historical data

3. **Backward Compatibility**:
   - Text-based catalog creation continues to work
   - Existing EventBridge patterns unchanged
   - No breaking changes to ONDC integration

## Appendix

### State Transition Diagram

```
┌─────┐
│ NEW │
└──┬──┘
   │ image
   ▼
┌──────────────┐
│ KYC_PENDING  │
└──────┬───────┘
       │ PAN+Aadhaar extracted
       ▼
┌──────────────┐
│ KYC_VERIFIED │
└──────┬───────┘
       │ voice/text
       ▼
┌────────────────┐
│ VOICE_RECEIVED │
└────────┬───────┘
         │ all fields present
         ▼
┌──────────────┐
│ IMAGE_PENDING│
└──────┬───────┘
       │ image
       ▼
┌─────────────────────┐
│ CONFIRMATION_PENDING│
└──────────┬──────────┘
           │ approve
           ▼
        ┌────────┐
        │ ACTIVE │
        └────────┘
```


### AWS Service Limits

| Service | Limit | Impact | Mitigation |
|---------|-------|--------|------------|
| Amazon Transcribe | 100 concurrent jobs | Voice processing | Queue jobs, use batch processing |
| Amazon Polly | 100 TPS | Voice responses | Cache common prompts |
| Amazon Textract | 15 TPS | KYC processing | Implement queue with backoff |
| Amazon Titan | 10 TPS | Image enhancement | Queue images, process async |
| Lambda Concurrent Executions | 1000 | Overall throughput | Request limit increase |
| DynamoDB WCU | 40,000 | State writes | Use on-demand pricing |

### Cost Estimates (per 1000 users/month)

| Component | Usage | Cost |
|-----------|-------|------|
| Amazon Transcribe | 1000 voice messages × 30s | $24 |
| Amazon Polly | 2000 prompts × 50 chars | $8 |
| Amazon Textract | 1000 documents | $15 |
| Amazon Titan | 1000 images | $40 |
| Lambda | 10,000 invocations | $2 |
| DynamoDB | 50,000 writes | $6 |
| S3 Storage | 10GB | $0.23 |
| **Total** | | **~$95/month** |

### Environment Variables

```typescript
// Required environment variables for voice-first workflow
const ENV_VARS = {
  // Existing
  TABLE_NAME: process.env.TABLE_NAME,
  KYC_BUCKET_NAME: process.env.KYC_BUCKET_NAME,
  PRODUCTS_BUCKET_NAME: process.env.PRODUCTS_BUCKET_NAME,
  EVENT_BUS_NAME: process.env.EVENT_BUS_NAME,
  KMS_KEY_ID: process.env.KMS_KEY_ID,
  
  // New for voice-first
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  POLLY_VOICE_ID_HINDI: process.env.POLLY_VOICE_ID_HINDI || 'Kajal',
  POLLY_VOICE_ID_MARATHI: process.env.POLLY_VOICE_ID_MARATHI || 'Aditi',
  POLLY_VOICE_ID_ENGLISH: process.env.POLLY_VOICE_ID_ENGLISH || 'Joanna',
  MAX_AUDIO_SIZE_MB: process.env.MAX_AUDIO_SIZE_MB || '16',
  MAX_IMAGE_SIZE_MB: process.env.MAX_IMAGE_SIZE_MB || '5',
  STATE_TTL_DAYS: process.env.STATE_TTL_DAYS || '7',
};
```

### References

- [Amazon Transcribe Documentation](https://docs.aws.amazon.com/transcribe/)
- [Amazon Polly Neural Voices](https://docs.aws.amazon.com/polly/latest/dg/ntts-voices-main.html)
- [Amazon Textract Document Analysis](https://docs.aws.amazon.com/textract/latest/dg/how-it-works-analyzing.html)
- [Amazon Titan Image Generator v2](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-image-models.html)
- [WhatsApp Business API](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [ONDC Beckn Protocol](https://developers.ondc.org/docs/specifications/beckn-protocol)
