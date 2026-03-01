# Vyapar Vaani - Complete Project Context

## 🎯 Project Vision

**Vyapar Vaani** is a voice-first e-commerce platform designed for rural Indian merchants with low digital literacy. It enables sellers to list products on a marketplace using only WhatsApp voice messages in their native language (Hindi/Marathi), while buyers can purchase through a modern web interface.

### The Problem We're Solving

- **60% of rural India** has low digital literacy and cannot use traditional e-commerce platforms
- Merchants only have **basic smartphones with WhatsApp**
- Language barriers prevent adoption of English-based platforms
- Technical complexity of product listing is a major barrier
- Poor quality product photos reduce sales

### Our Solution

**Zero-UI Platform**: Sellers speak naturally in their language → AI processes everything → Products appear in marketplace → Buyers order → Sellers get notified.

```
📱 Voice Message → 🤖 AI Processing → 🛍️ Live Marketplace → 💰 Orders → 📲 WhatsApp Notification
```

---

## 🏗️ Architecture Overview

### Technology Stack

**Frontend (Buyer Experience)**
- HTML/CSS/JavaScript (Vanilla)
- CloudFront CDN for global distribution
- S3 for static hosting

**Backend (Serverless)**
- AWS Lambda (Node.js 20.x, TypeScript)
- API Gateway (REST + HTTP APIs)
- EventBridge for event-driven architecture
- DynamoDB (single-table design)
- S3 for media storage
- KMS for encryption

**AI/ML Services**
- **Amazon Transcribe**: Voice-to-text (Hindi, Marathi, English)
- **Amazon Bedrock (Nova Pro)**: Intent classification, entity extraction, natural language understanding
- **Amazon Bedrock (Titan Image Generator v2)**: Product image enhancement
- **Amazon Polly (Neural)**: Text-to-speech for voice responses
- **Amazon Textract**: KYC document extraction

**Integration**
- WhatsApp Business API (Meta Graph API v22.0)
- ONDC (Open Network for Digital Commerce) - planned

### Event-Driven Flow

```
WhatsApp → API Gateway → Webhook Handler → EventBridge → Specialized Handlers
                                                ↓
                                          DynamoDB State
                                                ↓
                                          Response → WhatsApp
```

---

## ✅ What's Currently Implemented

### 1. Voice-First Seller Onboarding (KYC)
- ✅ Voice greeting in user's language
- ✅ PAN card photo upload
- ✅ AWS Textract document extraction
- ✅ Validation and seller registration
- ✅ Voice confirmation with success message
- ✅ Step Functions orchestration for KYC workflow

### 2. Voice-First Product Cataloging
- ✅ Natural language voice input (e.g., "मैं आम बेचना चाहता हूँ, 50 किलो, 100 रुपये")
- ✅ AWS Transcribe for voice-to-text
- ✅ Amazon Nova Pro for intent classification
- ✅ Amazon Nova Pro for entity extraction (product name, price, quantity, unit)
- ✅ Missing information detection and voice prompts
- ✅ Product image upload
- ✅ Amazon Titan image enhancement (pure white background, professional quality)
- ✅ Interactive confirmation with buttons (Approve/Edit)
- ✅ Voice confirmation playback
- ✅ Real-time sync to marketplace

### 3. Marketplace (Buyer Interface)
- ✅ Product listing with search and filters
- ✅ Shopping cart functionality
- ✅ Multi-product checkout
- ✅ Order submission with delivery address
- ✅ Pre-signed S3 URLs for product images
- ✅ AI-generated product descriptions
- ✅ Real-time product sync from DynamoDB

### 4. Order Management
- ✅ Order submission API
- ✅ WhatsApp notification to seller (with order details)
- ✅ Order storage in DynamoDB
- ✅ Buyer information capture

### 5. State Management
- ✅ User state tracking (NEW, KYC_PENDING, ACTIVE, etc.)
- ✅ Conversation flow routing
- ✅ Partial data storage for incomplete flows
- ✅ TTL-based cleanup (7 days for abandoned flows)
- ✅ Language preference persistence

### 6. Multilingual Support
- ✅ Auto-detection of Hindi, Marathi, English
- ✅ Language-specific voice responses (Polly neural voices)
- ✅ Bilingual confirmations

### 7. Enhanced AI Agent (Recently Added)
- ✅ Conversation memory (30-day retention)
- ✅ Natural language query processing
- ✅ Market price queries via web search
- ✅ Sales analytics ("What's selling well?", "Yesterday's orders")
- ✅ Order history queries
- ✅ Context-aware responses
- ✅ Voice + text message handling

---

## 🐛 Current Bugs & Issues

### FIXED (Recently)
1. ✅ Voice messages not being sent (missing 'audio' case in sender)
2. ✅ Polly SSML error with Neural engine (removed SSML tags)
3. ✅ Marketplace images not displaying (pre-signed URLs)
4. ✅ Unit mismatch (kg vs pieces) in marketplace
5. ✅ Order submission failing (missing axios dependency)
6. ✅ Image enhancement negative prompt too long (>512 chars)
7. ✅ AI description not showing in marketplace
8. ✅ Agent handler missing Transcribe permissions

### ACTIVE ISSUES
1. **WhatsApp API Restriction**: Cannot send messages to non-whitelisted numbers
   - **Impact**: Order notifications fail for sellers not in allowed list
   - **Workaround**: User must add seller phone to WhatsApp API allowed list
   - **Status**: External limitation, not a code bug

2. **Voice Message Response Delay**: Agent takes 2-3 seconds to respond
   - **Impact**: User experience could be faster
   - **Potential Fix**: Optimize Lambda cold starts, use provisioned concurrency
   - **Status**: Performance optimization needed

3. **Image Enhancement Cost**: $0.04 per image (60% of total costs)
   - **Impact**: High operational costs at scale
   - **Potential Fix**: Conditional enhancement, user-controlled enhancement
   - **Status**: Cost optimization needed

---

## 🚀 What's NOT Yet Implemented

### High Priority
1. **ONDC Integration**
   - Catalog broadcast to ONDC network
   - Order fulfillment via ONDC protocol
   - Beckn protocol compliance
   - Network participant registration

2. **Inventory Management**
   - Stock tracking
   - Low stock alerts
   - Auto-disable out-of-stock products
   - Inventory sync across channels

3. **Payment Integration**
   - Payment gateway (Razorpay/Stripe)
   - COD (Cash on Delivery) support
   - Payment status tracking
   - Refund handling

4. **Seller Dashboard**
   - Web dashboard for sellers
   - Order management UI
   - Analytics and insights
   - Product editing

### Medium Priority
5. **Advanced Analytics**
   - Sales trends
   - Customer insights
   - Product performance metrics
   - Revenue tracking

6. **Multi-Seller Support**
   - Seller profiles
   - Seller ratings
   - Seller search
   - Commission management

7. **Delivery Integration**
   - Logistics partner APIs
   - Tracking numbers
   - Delivery status updates
   - Proof of delivery

8. **Customer Support**
   - Help desk integration
   - Dispute resolution
   - Return/refund management
   - FAQ chatbot

### Low Priority
9. **Advanced Features**
   - Product variants (size, color)
   - Bulk upload
   - Scheduled listings
   - Promotional campaigns
   - Discount codes
   - Wishlist functionality

---

## 📊 System Metrics & Performance

### Current Performance
- **Voice transcription**: 2-5 seconds (30s audio)
- **Image enhancement**: 3-5 seconds
- **Marketplace sync**: <5 seconds
- **Order notification**: <2 seconds
- **Lambda cold start**: 500-700ms
- **Lambda warm execution**: 50-150ms

### Cost Structure (per 1,000 users/month)
- **Total**: $199.84/month
- **Image Enhancement**: $120 (60%)
- **Transcribe**: $36 (18%)
- **Textract**: $15 (7.5%)
- **Lambda**: $7.50 (3.8%)
- **DynamoDB**: $13.75 (6.9%)
- **Other**: $7.59 (3.8%)

### Scalability
- **Current**: Tested up to 1,000 concurrent users
- **Theoretical**: 1M users/month with linear scaling
- **Bottlenecks**: None identified (serverless auto-scales)

---

## 🗂️ Project Structure

```
vyapar-vaani/
├── src/
│   ├── lambdas/              # Lambda function handlers
│   │   ├── whatsapp-webhook-handler.ts    # Entry point for WhatsApp messages
│   │   ├── agent-handler.ts               # AI agent for natural language queries
│   │   ├── kyc-handler.ts                 # KYC flow orchestration
│   │   ├── voice-handler.ts               # Voice message processing
│   │   ├── image-handler.ts               # Image upload handling
│   │   ├── confirmation-handler.ts        # Product confirmation flow
│   │   ├── catalog-builder.ts             # Catalog creation
│   │   ├── catalog-storage-broadcast.ts   # Marketplace sync
│   │   ├── voice-transcription.ts         # Transcribe integration
│   │   ├── intent-classification.ts       # Intent detection
│   │   ├── entity-extraction.ts           # Entity extraction
│   │   ├── image-enhancement.ts           # Titan image enhancement
│   │   ├── whatsapp-message-sender.ts     # WhatsApp API client
│   │   ├── document-extraction.ts         # Textract integration
│   │   ├── kyc-validation.ts              # KYC validation
│   │   └── seller-registration.ts         # Seller onboarding
│   ├── services/             # Business logic services
│   │   ├── state-manager.ts               # User state management
│   │   ├── state-router.ts                # Flow routing logic
│   │   ├── conversation-memory.ts         # Chat history (30 days)
│   │   ├── enhanced-agent.ts              # AI agent with tools
│   │   ├── analytics-service.ts           # Sales analytics
│   │   ├── language-manager.ts            # Language detection
│   │   ├── partial-data-store.ts          # Incomplete flow data
│   │   ├── media-download.ts              # WhatsApp media download
│   │   ├── missing-info-handler.ts        # Missing field prompts
│   │   ├── dynamodb-repository.ts         # DynamoDB operations
│   │   └── ondc-schema-validator.ts       # ONDC compliance
│   ├── tools/                # AI agent tools
│   │   └── web-search.ts                  # Market price search
│   ├── models/               # TypeScript types
│   │   ├── catalog.ts
│   │   ├── order.ts
│   │   ├── voice.ts
│   │   └── user.ts
│   └── config/               # AWS clients & config
│       ├── aws-clients.ts
│       ├── event-patterns.ts
│       └── metrics.ts
├── infrastructure/           # CDK infrastructure
│   ├── app.ts
│   └── stacks/
│       ├── vyapar-vaani-stack.ts          # Main stack
│       └── marketplace-integration.ts     # Marketplace stack
├── marketplace/              # Buyer web UI
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   ├── CartUI.js
│   └── ShoppingCart.js
├── backend/                  # Marketplace backend
│   └── lambdas/
│       ├── getProducts.js                 # Product listing API
│       ├── submitOrder.js                 # Order submission API
│       └── marketplace-catalog-sync.js    # DynamoDB sync
├── tests/                    # Test suites
│   ├── unit/                 # Unit tests
│   └── property/             # Property-based tests
└── docs/                     # Documentation
    ├── COST_ESTIMATES.md
    ├── ENVIRONMENT_VARIABLES.md
    └── TROUBLESHOOTING.md
```

---

## 🔑 Key Design Decisions

### 1. Event-Driven Architecture
- **Why**: Decouples components, enables async processing, scales independently
- **How**: EventBridge routes messages to specialized Lambda handlers
- **Trade-off**: More complex debugging, eventual consistency

### 2. Single-Table DynamoDB Design
- **Why**: Cost-effective, fast queries, single transaction boundary
- **How**: Composite keys (PK/SK) with GSIs for access patterns
- **Trade-off**: Requires careful data modeling upfront

### 3. Voice-First UX
- **Why**: Targets low-literacy users, natural interaction
- **How**: Transcribe → Nova Pro → Polly pipeline
- **Trade-off**: Higher costs ($0.057 vs $0.003 per product)

### 4. Serverless Architecture
- **Why**: Scale-to-zero, pay-per-use, no infrastructure management
- **How**: Lambda + API Gateway + DynamoDB + S3
- **Trade-off**: Cold starts, vendor lock-in

### 5. AI-Powered Image Enhancement
- **Why**: Professional product photos increase sales by 40%
- **How**: Titan Image Generator v2 with pure white background
- **Trade-off**: Expensive ($0.04 per image, 60% of costs)

---

## 🔐 Security & Compliance

### Implemented
- ✅ KMS encryption at rest (DynamoDB, S3)
- ✅ HTTPS/TLS for all API calls
- ✅ IAM least-privilege roles
- ✅ WhatsApp webhook verification
- ✅ Input validation and sanitization
- ✅ PII data encryption (PAN cards)
- ✅ 7-year retention for KYC documents (Indian regulations)

### Pending
- ⏳ PCI DSS compliance (for payments)
- ⏳ GDPR compliance (for EU users)
- ⏳ Audit logging
- ⏳ Rate limiting
- ⏳ DDoS protection

---

## 📈 Deployment & Operations

### Deployed Environments
- **Production**: AWS us-east-1
  - Marketplace: https://d29x1w2stzqkag.cloudfront.net
  - API: https://o72ecc4lpg.execute-api.us-east-1.amazonaws.com/prod/
  - Webhook: https://m6sqkaco93.execute-api.us-east-1.amazonaws.com/whatsapp/webhook

### Deployment Process
```bash
npm run build      # TypeScript compilation
npm test           # Run tests
npx cdk deploy     # Deploy to AWS
```

### Monitoring
- CloudWatch Logs (1-month retention)
- CloudWatch Metrics (custom metrics)
- EventBridge event archive (30 days)
- DynamoDB point-in-time recovery

### Backup & Recovery
- DynamoDB: Point-in-time recovery enabled
- S3: Versioning enabled
- KYC documents: 7-year retention, Glacier after 90 days

---

## 🧪 Testing Strategy

### Unit Tests
- Jest framework
- 80%+ code coverage
- Mock AWS services

### Property-Based Tests
- Fast-check library
- Correctness properties
- Edge case discovery

### Integration Tests
- End-to-end flows
- Real AWS services (dev account)
- WhatsApp webhook simulation

---

## 🎓 Learning Resources

### AWS Services Used
- [Lambda Documentation](https://docs.aws.amazon.com/lambda/)
- [Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [Transcribe Documentation](https://docs.aws.amazon.com/transcribe/)
- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)

### WhatsApp Business API
- [Meta Graph API](https://developers.facebook.com/docs/graph-api)
- [WhatsApp Business Platform](https://developers.facebook.com/docs/whatsapp)

### ONDC
- [ONDC Documentation](https://ondc.org/developers)
- [Beckn Protocol](https://developers.becknprotocol.io/)

---

## 🤝 How to Contribute / Work on This Project

### For AI Agents Working on This Codebase

**When you receive this context, you should:**

1. **Understand the user's language**: They may type with typos (e.g., "recety" = "recently", "messg" = "message")

2. **Check AWS logs first**: When debugging, always check CloudWatch logs:
   ```bash
   aws logs tail /aws/lambda/<function-name> --since 30m --format short
   ```

3. **Deploy after changes**: Always build and deploy:
   ```bash
   npm run build && npx cdk deploy
   ```

4. **Test with real WhatsApp**: The user tests by sending actual WhatsApp messages

5. **Focus on voice-first**: Remember this is for low-literacy users - voice is primary, text is secondary

6. **Cost-conscious**: Image enhancement is expensive - optimize where possible

7. **Event-driven debugging**: Check EventBridge events, not just Lambda logs

8. **State management**: Always check user state in DynamoDB before making assumptions

### Common Debugging Patterns

**Voice message not working?**
1. Check Transcribe permissions
2. Check S3 audio upload
3. Check transcription job status
4. Check Nova Pro API call

**Image not showing in marketplace?**
1. Check S3 upload
2. Check pre-signed URL generation
3. Check marketplace sync Lambda
4. Check DynamoDB item

**Order notification failing?**
1. Check WhatsApp API allowed list
2. Check message sender Lambda logs
3. Check WhatsApp API credentials

---

## 📞 Contact & Support

- **Project Owner**: Soumyadipta Dey
- **AWS Account**: 145023133719
- **Region**: us-east-1
- **WhatsApp Test Number**: +91 6291024334

---

## 🎯 Next Steps for AI Agents

When you start working on this project, prioritize:

1. **Fix any active bugs** (check "Current Bugs & Issues" section)
2. **Optimize costs** (especially image enhancement)
3. **Improve performance** (reduce voice response latency)
4. **Implement ONDC integration** (high business value)
5. **Add inventory management** (critical for sellers)

**Remember**: This is a real production system serving rural Indian merchants. Every change impacts real users. Test thoroughly, deploy carefully, and always check logs.

---

**Last Updated**: March 1, 2026
**Version**: 1.0.0
**Status**: Production (Active Development)
