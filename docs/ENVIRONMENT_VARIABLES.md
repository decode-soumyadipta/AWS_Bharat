# Environment Variables Configuration

This document describes all environment variables used in the Vyapar-Vaani voice-first workflow system.

## WhatsApp Integration

### WHATSAPP_ACCESS_TOKEN
- **Required**: Yes
- **Description**: Access token for WhatsApp Business API authentication
- **Used by**: All Lambda functions that interact with WhatsApp (webhook handler, KYC handler, voice handler, image handler, confirmation handler, message sender)
- **Example**: `EAABsbCS1iHgBO7ZC9yc...`

### WHATSAPP_PHONE_NUMBER_ID
- **Required**: Yes
- **Description**: WhatsApp Business phone number ID for sending messages
- **Used by**: All Lambda functions that send WhatsApp messages
- **Example**: `123456789012345`

### WHATSAPP_VERIFY_TOKEN
- **Required**: Yes
- **Description**: Verification token for WhatsApp webhook setup
- **Used by**: Webhook handler Lambda
- **Default**: `vyapar-vaani-webhook-token`

### WHATSAPP_API_ENDPOINT
- **Required**: No
- **Description**: WhatsApp Graph API endpoint
- **Used by**: Message sender Lambda
- **Default**: `https://graph.facebook.com/v22.0`

## Text-to-Speech Configuration

### POLLY_VOICE_ID_HINDI
- **Required**: No
- **Description**: Amazon Polly voice ID for Hindi language text-to-speech
- **Used by**: Voice handler (missing info prompts), confirmation handler
- **Default**: `Kajal` (neural voice)
- **Options**: `Kajal`, `Aditi`

### POLLY_VOICE_ID_MARATHI
- **Required**: No
- **Description**: Amazon Polly voice ID for Marathi language text-to-speech
- **Used by**: Voice handler (missing info prompts), confirmation handler
- **Default**: `Aditi` (neural voice)

### POLLY_VOICE_ID_ENGLISH
- **Required**: No
- **Description**: Amazon Polly voice ID for English language text-to-speech
- **Used by**: Voice handler (missing info prompts), confirmation handler
- **Default**: `Joanna` (neural voice)
- **Options**: `Joanna`, `Salli`, `Kendra`

## Media File Limits

### MAX_AUDIO_SIZE_MB
- **Required**: No
- **Description**: Maximum audio file size in megabytes for voice messages
- **Used by**: Media download service
- **Default**: `16`
- **Range**: 1-16 (WhatsApp limit)
- **Validation**: Applied before downloading from WhatsApp

### MAX_IMAGE_SIZE_MB
- **Required**: No
- **Description**: Maximum image file size in megabytes for photos
- **Used by**: Media download service, KYC handler, image handler
- **Default**: `5`
- **Range**: 1-5 (recommended for Lambda processing)
- **Validation**: Applied before downloading from WhatsApp

## State Management

### STATE_TTL_DAYS
- **Required**: No
- **Description**: Time-to-live in days for incomplete user flows (automatic cleanup)
- **Used by**: State manager, partial data store
- **Default**: `7`
- **Range**: 1-30 days
- **Behavior**: 
  - Incomplete flows (NEW, KYC_PENDING, etc.) are auto-deleted after TTL
  - ACTIVE users have no TTL (permanent)
  - Helps clean up abandoned onboarding flows

## Feature Flags

### VOICE_FIRST_ENABLED
- **Required**: No
- **Description**: Master switch to enable/disable voice-first workflow
- **Used by**: Webhook handler, voice handler, confirmation handler
- **Default**: `true`
- **Values**: `true` | `false`
- **Purpose**: Phased rollout control

### KYC_FLOW_ENABLED
- **Required**: No
- **Description**: Enable/disable KYC verification flow
- **Used by**: Webhook handler, KYC handler
- **Default**: `true`
- **Values**: `true` | `false`
- **Purpose**: Phased rollout control

### IMAGE_ENHANCEMENT_ENABLED
- **Required**: No
- **Description**: Enable/disable Amazon Titan image enhancement
- **Used by**: Image handler
- **Default**: `true`
- **Values**: `true` | `false`
- **Purpose**: Cost control and phased rollout

## ONDC Configuration

### ONDC_REGISTRY_URL
- **Required**: Yes
- **Description**: ONDC registry API endpoint
- **Used by**: Seller registration Lambda
- **Default**: `https://registry.ondc.org/api/v1`

### NETWORK_PARTICIPANT_ID
- **Required**: Yes
- **Description**: Network participant identifier for ONDC
- **Used by**: Seller registration Lambda
- **Example**: `vyapar-vaani.ondc.in`

### BPP_BASE_URL
- **Required**: Yes
- **Description**: Base URL for BPP (Buyer Platform Provider) API
- **Used by**: Seller registration Lambda
- **Example**: `https://api.vyapar-vaani.ondc.in`

## AWS Resources (Auto-configured by CDK)

These are automatically set by the CDK stack and don't need manual configuration:

- `TABLE_NAME`: DynamoDB table name
- `KYC_BUCKET_NAME`: S3 bucket for KYC documents
- `PRODUCTS_BUCKET_NAME`: S3 bucket for product images
- `EVENT_BUS_NAME`: EventBridge event bus name
- `KMS_KEY_ID`: KMS encryption key ID
- `KYC_STATE_MACHINE_ARN`: Step Functions state machine ARN

## Configuration Best Practices

1. **Security**: Never commit actual tokens/credentials to version control
2. **Environment-specific**: Use different values for dev/staging/production
3. **Validation**: The system validates all environment variables at startup
4. **Defaults**: Sensible defaults are provided for optional variables
5. **Feature Flags**: Use feature flags for gradual rollout of new features

## Setting Environment Variables

### Local Development
```bash
cp .env.example .env
# Edit .env with your values
```

### CDK Deployment
Environment variables are set in `infrastructure/stacks/vyapar-vaani-stack.ts`:
```typescript
environment: {
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || '',
  MAX_AUDIO_SIZE_MB: process.env.MAX_AUDIO_SIZE_MB || '16',
  // ... other variables
}
```

### AWS Lambda Console
You can also set/override environment variables directly in the Lambda console for testing.

## Troubleshooting

### Missing Required Variables
If required variables are missing, Lambda functions will log errors:
```
WHATSAPP_ACCESS_TOKEN not configured
```

### Invalid Values
- Size limits must be positive integers
- Feature flags must be 'true' or 'false'
- Voice IDs must be valid Polly voice names

### Testing Configuration
Use the test script to verify configuration:
```bash
npm test -- --testPathPattern="media-download|state-management"
```
