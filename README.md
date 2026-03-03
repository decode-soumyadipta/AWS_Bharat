<div align="center">

<img src="marketplace/logo.png" alt="Vyapar Vaani" width="120" style="border-radius: 50%;" />

# Vyapar Vaani

**Voice-First WhatsApp Commerce Platform for Rural India**

Enabling low-literacy merchants to sell online through voice messages — no typing, no apps, no training.

[![AWS Serverless](https://img.shields.io/badge/AWS-Serverless-FF9900?logo=amazon-aws&logoColor=white)](https://aws.amazon.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Amazon Bedrock](https://img.shields.io/badge/Amazon%20Bedrock-AI-232F3E?logo=amazon-aws)](https://aws.amazon.com/bedrock/)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-Business%20API-25D366?logo=whatsapp&logoColor=white)](https://business.whatsapp.com/)
[![ESLint](https://img.shields.io/badge/ESLint-0%20errors-4B32C3?logo=eslint&logoColor=white)](https://eslint.org/)
[![CI/CD](https://img.shields.io/badge/CI%2FCD-GitHub%20Actions-2088FF?logo=github-actions&logoColor=white)](https://github.com/features/actions)
[![ONDC](https://img.shields.io/badge/ONDC-Beckn%20Protocol-0055A4)](https://ondc.org/)

[**Live Marketplace**](https://d29x1w2stzqkag.cloudfront.net) · [**API**](https://o72ecc4lpg.execute-api.us-east-1.amazonaws.com/prod/) · [**Webhook**](https://m6sqkaco93.execute-api.us-east-1.amazonaws.com/whatsapp/webhook) · [**Docs**](docs/)

</div>

---

## The Problem

**800M+ Indians** use WhatsApp, yet rural merchants remain locked out of e-commerce. Low digital literacy, Hindi/regional language barriers, and feature-phone-level smartphones make conventional platforms inaccessible. Traditional solutions demand typing, app installation, and technical training — none of which work at the last mile.

## The Solution

Vyapar Vaani is a **zero-UI commerce platform**. Sellers speak in their native language on WhatsApp. AI handles everything else — transcription, product listing, image enhancement, pricing, and order management. Buyers shop through a real-time web marketplace.

```
📱 Voice Message → 🤖 AI Agent → 🛍️ Live Marketplace → 💰 Orders → 📱 WhatsApp Alert
```

---

## Architecture

```mermaid
graph TB
    subgraph "Seller · WhatsApp"
        S1[📱 Voice / Image / Text]
    end

    subgraph "Ingestion Layer"
        A1[API Gateway HTTP] --> A2[Webhook Handler Lambda]
        A2 --> A3[State Router]
        A3 --> A4[EventBridge]
    end

    subgraph "AI Processing"
        B1[Amazon Transcribe<br/>Voice → Text]
        B2[Amazon Nova Pro<br/>AI Agent Brain]
        B3[Titan Image Gen v2<br/>Image Enhancement]
        B4[Amazon Textract<br/>PAN Card OCR]
        B5[Amazon Rekognition<br/>Image Quality]
        B6[Amazon Polly<br/>Voice Responses]
    end

    subgraph "Data & State"
        C1[(DynamoDB<br/>Single-Table)]
        C2[S3<br/>Images & KYC]
        C3[Step Functions<br/>KYC Pipeline]
    end

    subgraph "Marketplace"
        D1[CloudFront CDN] --> D2[S3 SPA]
        D3[REST API Gateway] --> D4[Products / Orders / Payments]
    end

    subgraph "Buyer"
        E1[🌐 Web Browser]
    end

    S1 --> A1
    A4 --> B1
    A4 --> B2
    A4 --> B3
    A4 --> B4
    B1 --> B2
    B2 --> C1
    B3 --> C2
    B4 --> C3
    C3 --> C1
    B2 --> B6
    B6 --> S1
    C1 -->|Catalog Sync| D4
    E1 --> D1
    D4 -->|Order Notification| S1
```

### Seller Onboarding & Catalog Flow

```mermaid
stateDiagram-v2
    [*] --> NEW: First WhatsApp message
    NEW --> KYC_PENDING: PAN card photo sent
    KYC_PENDING --> KYC_VERIFIED: Textract + Step Functions validation
    KYC_VERIFIED --> VOICE_RECEIVED: Voice message with product details
    VOICE_RECEIVED --> IMAGE_PENDING: AI extracts entities · asks for photo
    IMAGE_PENDING --> CONFIRMATION_PENDING: Photo enhanced via Titan · summary shown
    CONFIRMATION_PENDING --> ACTIVE: Seller approves → product live
    ACTIVE --> VOICE_RECEIVED: Add another product
    CONFIRMATION_PENDING --> VOICE_RECEIVED: Seller edits
```

### Order Flow

```mermaid
sequenceDiagram
    participant B as 🌐 Buyer
    participant M as Marketplace API
    participant DB as DynamoDB
    participant W as WhatsApp
    participant Se as 📱 Seller

    B->>M: POST /orders (cart + address)
    M->>DB: Create order (PENDING)
    M->>W: Send Accept/Reject buttons
    W->>Se: Order notification
    Se->>W: Click Accept ✅
    W->>DB: Update → CONFIRMED
    W->>DB: Decrement stock
    W->>B: Status update (polling)

    Note over B,M: UPI Payment Flow
    B->>M: Upload payment screenshot
    M->>DB: Nova Pro vision analysis
    M->>DB: Auto-verify → PAID
```

---

## Key Features

### Seller Experience (WhatsApp)

| Feature | Implementation |
|---|---|
| **Voice Catalog Creation** | Speak product name, price, quantity in Hindi/Marathi/English → AI extracts structured data |
| **PAN Card KYC** | Photo → Textract OCR → Step Functions validation → auto-registration |
| **Image Enhancement** | Product photos auto-enhanced with professional backgrounds (Titan Image Gen v2) |
| **Live Mandi Prices** | Real-time market prices from [data.gov.in](https://data.gov.in) API with Hindi commodity mapping |
| **Smart Pricing** | AI-powered competitive price recommendations based on marketplace data |
| **Order Management** | Accept/reject orders via WhatsApp buttons, real-time stock sync |
| **Sales Analytics** | Revenue breakdowns, top products, daily/weekly/monthly trends — all via voice |
| **UPI Registration** | Sellers register UPI ID to receive direct payments from buyers |
| **Multilingual Voice** | Amazon Polly responses in Hindi (Kajal), Marathi (Aditi), English (Joanna) |
| **Conversation Memory** | 30-day context with preference tracking for natural interactions |

### Buyer Experience (Web)

| Feature | Implementation |
|---|---|
| **Real-Time Marketplace** | Products appear within seconds of seller approval |
| **Search & Filter** | By product name and category |
| **Shopping Cart** | Multi-seller support, localStorage persistence, quantity controls |
| **UPI Payments** | QR code generation, deep links to UPI apps, AI-powered screenshot verification |
| **Cash on Delivery** | Available as payment option |
| **Live Order Tracking** | 8-second polling for real-time status updates |
| **Quality Badges** | AI-scored "Top Quality" / "Good" labels on products |

---

## Why AI?

The core challenge is **bridging the digital divide** — turning unstructured voice in regional languages into structured e-commerce data, with zero manual intervention.

| AI Service | Why It's Essential | Where Used |
|---|---|---|
| **Amazon Nova Pro** (Bedrock) | Conversational AI agent — understands Hindi/Hinglish intent, extracts product entities from natural speech (e.g., *"do sau pachaas rupaye kilo tamatar"* → ₹250/kg tomatoes), generates descriptions, verifies UPI screenshots via vision | `enhanced-agent.ts` → `callAgentModel()` every user interaction |
| **Amazon Bedrock Agent** (Agentic AI) | Managed agent with tool-use capabilities — autonomously calls catalog search, analytics, and market price tools for ACTIVE sellers. True agentic behavior vs simple prompt-routing | `enhanced-agent.ts` → `callBedrockAgentIfAvailable()` for ACTIVE state |
| **Amazon Transcribe** | Converts Hindi/Marathi voice messages to text — the only input method for low-literacy sellers | `voice-transcriber.ts` — processes every voice message |
| **Titan Image Gen v2** (Bedrock) | Enhances poor-quality phone photos into professional product images — critical for marketplace trust | `image-enhancer.ts` — triggered on every product photo |
| **Amazon Textract** | Extracts PAN card details (name, number, DOB) for automated KYC — no manual data entry | `document-extraction.ts` — KYC pipeline |
| **Amazon Rekognition** | Image quality analysis + content moderation before marketplace listing | `kyc-handler.ts` — validates document images |
| **Amazon Polly** (Neural SSML) | Speaks responses back in seller's language with natural prosody — completing the voice-first loop | `whatsapp-message-sender.ts` — every response |
| **Amazon Nova Lite** (Bedrock) | Fast fallback model when Nova Pro times out. Also used for lightweight reasoning tasks | `enhanced-agent.ts` — 3-tier fallback chain |

### AI Decision Flow

Every user message passes through this pipeline:

1. **Voice → Text**: Amazon Transcribe (if voice message)
2. **Intent Detection**: Regex-based fast-path for price queries, analytics, language switch
3. **Context Assembly**: DynamoDB state + conversation memory + partial catalog data + live market prices
4. **Model Invocation**: Nova Pro (12s timeout) → retry (8s) → Nova Lite fallback (10s)
5. **Bedrock Agent**: For ACTIVE sellers, the managed Bedrock Agent with tool-use runs first; falls back to direct model if unavailable
6. **Response Parsing**: Structured MESSAGE/ACTION/DATA extraction from model output
7. **Action Execution**: EventBridge routes STORE_DATA, CREATE_CATALOG, DELETE_PRODUCT, REGISTER_UPI to handler Lambdas
8. **Voice Synthesis**: Amazon Polly (SSML) converts response to audio, sent via WhatsApp

---

## AWS Services — Why Each One

| Service | Role | Why This Service |
|---|---|---|
| **Lambda** (17 functions) | All compute — webhook, agent, KYC, catalog, voice, image, marketplace API | Zero cold-start cost for bursty WhatsApp traffic; pay-per-invocation fits hackathon budget |
| **DynamoDB** (single-table) | All state — user sessions, seller profiles, catalog items, orders, conversations | Single-digit ms latency for real-time WhatsApp responses; single-table design with 4 GSIs avoids joins |
| **EventBridge** | Event-driven routing between all Lambdas | Decouples webhook from processing; 30-day event archive for debugging; pattern matching routes to correct handler |
| **S3** (3 buckets) | Product images, KYC documents, marketplace SPA | Presigned URLs for secure image access; static website hosting for marketplace |
| **CloudFront** | CDN for marketplace SPA | Sub-100ms page loads across India; HTTPS by default |
| **API Gateway v2** (HTTP) | WhatsApp webhook endpoint | Lower latency than REST API; Lambda proxy integration |
| **API Gateway v1** (REST) | Marketplace API (products, orders, payments) | API key support for marketplace security; CORS preflight handling |
| **Step Functions** | KYC validation pipeline | Orchestrates Textract → validation → registration with built-in retry/error handling |
| **Polly** (Neural) | Voice response generation | Neural voices (Kajal/Hindi, Aditi/Marathi) sound natural; SSML for prosody control |
| **Bedrock** | Foundation model inference | Managed service — no model hosting; Nova Pro/Lite for text, Titan for images |
| **Transcribe** | Voice-to-text | Hindi/Marathi language support; real-time transcription |
| **Textract** | Document OCR | Structured data extraction from PAN cards; handles low-quality photos |
| **KMS** | Encryption at rest | All DynamoDB data and S3 objects encrypted |
| **CloudWatch** | Monitoring + alerting | 9 alarms, composite health, custom metrics, SNS email alerts |
| **SNS** | Alert notifications | Email alerts on alarm state changes |

---

## Metrics & Cost

| Metric | Value |
|---|---|
| Monthly cost (1,000 users) | **~$200** |
| Cost per user per month | **$0.199** |
| Onboarding cost (one-time) | **$0.016** |
| Cost per product listing | **~$0.057** |
| Free tier coverage | **~500 users/month** |
| Top cost driver | Titan Image Enhancement (60%) |
| Voice-first vs text-only | 19× cost, but **3× higher completion rate** |
| Optimization potential | **56–63% reduction** achievable |

---

## ONDC Beckn Protocol Integration

Vyapar Vaani implements the ONDC Beckn Protocol (v1.2.0) for interoperable open commerce:

- **BPP (Buyer Platform Provider)**: Every seller registered through WhatsApp gets a unique ONDC subscriber ID (`vyapar-vaani.ondc.in/sellers/<uuid>`)
- **Ed25519 Signing**: Each seller gets a cryptographic key pair for Beckn request signing, stored in S3
- **Catalog Broadcast**: Product additions trigger `on_search` responses in Beckn format
- **Order Protocol**: Orders follow Beckn state machine (Created → Accepted → Packed → Shipped → Delivered)
- **Domain**: `ONDC:RET10` (Food & Grocery)

This means products listed via WhatsApp voice messages are discoverable by any ONDC-compatible buyer app across India.

---

## Code Quality

| Check | Status |
|---|---|
| TypeScript strict compilation | 0 errors |
| ESLint (typescript-eslint) | 0 errors, warnings-only |
| CI/CD | GitHub Actions (lint → build → test → deploy) |
| Tests | Unit (27) + Integration (5) + Property-based (27) |

```bash
npm run lint          # ESLint check
npm run lint:fix      # Auto-fix
npx tsc --noEmit      # Type check
npm test              # All tests
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Compute** | AWS Lambda (Node.js 20.x) — 17+ functions |
| **AI/ML** | Amazon Bedrock (Nova Pro, Nova Lite, Titan Image), Bedrock Agent (tool-use), Transcribe, Polly, Textract, Rekognition |
| **Data** | DynamoDB (single-table design, 4 GSIs, TTL), S3 |
| **Orchestration** | EventBridge (event-driven routing, 30-day archive), Step Functions (KYC pipeline) |
| **API** | API Gateway v2 (HTTP — webhook), API Gateway v1 (REST — marketplace) |
| **Frontend** | Vanilla JS SPA, CloudFront CDN, S3 hosting |
| **Security** | KMS encryption at rest, WhatsApp signature validation, API key auth |
| **Monitoring** | CloudWatch (9 alarms + composite health), SNS email alerts, custom metrics namespace |
| **IaC** | AWS CDK (TypeScript) |
| **CI/CD** | GitHub Actions (lint → build → test → deploy) |
| **Code Quality** | ESLint + typescript-eslint, TypeScript strict mode |
| **Protocol** | ONDC Beckn v1.2.0, Ed25519 signing |

---

## API

**Base URL**: [`https://o72ecc4lpg.execute-api.us-east-1.amazonaws.com/prod/`](https://o72ecc4lpg.execute-api.us-east-1.amazonaws.com/prod/)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/products` | List all active marketplace products with presigned image URLs |
| `POST` | `/orders` | Submit order (multi-seller cart split, WhatsApp notification to sellers) |
| `GET` | `/orders/{orderId}` | Get order status |
| `POST` | `/orders/{orderId}/verify-payment` | Verify UPI payment (AI screenshot analysis or manual reference) |

---

## Monitoring

### Real CloudWatch Metrics (Last 14 Days)

*Pulled from `AWS/Lambda` and `VyaparVaani` namespaces — real production data.*

| Lambda Function | Invocations | Avg Latency | P100 Latency |
|---|---|---|---|
| **whatsapp-webhook** | 4,234 | 50ms | 8,992ms |
| **agent-handler** | 97 | 12,123ms | 200,074ms |
| **voice-transcription** | 247 | 4,785ms | 64,399ms |
| **image-enhancement** | 108 | 2,374ms | 12,017ms |
| **kyc-handler** | 37 | 16,588ms | 30,000ms |

### Custom Metrics (VyaparVaani Namespace)

| Metric | Description |
|---|---|
| `TimeToNetwork` | End-to-end latency from webhook receipt to WhatsApp response delivery |
| `MediaDownloadDuration` | Time to download voice/image files from WhatsApp CDN |
| `KYCProcessingDuration` | Full PAN card processing pipeline (Textract + validation + registration) |
| `StateTransitionDuration` | Time for user state transitions in DynamoDB |
| `StateTransition` | Count of state transitions (NEW → KYC_PENDING → ACTIVE etc.) |
| `Voice/TranscriptionFailure` | Failed voice-to-text conversions |

### Alarms & Alerting

- **9 CloudWatch Alarms** — error rate, state transitions, media downloads, KYC, transcription, image enhancement, DynamoDB throttling, Lambda errors, Lambda duration
- **Composite Health Alarm** — triggers on any critical alarm
- **SNS Notifications** — email alerts on alarm state changes
- **Event Archive** — 30-day EventBridge retention for all `vyapar.vaani.*` events

---

## Project Structure

```
vyapar-vaani/
├── src/
│   ├── lambdas/           # 16 Lambda handlers (webhook, agent, KYC, catalog, voice, image)
│   ├── services/          # 17 service modules (AI agent, state router, analytics, memory)
│   ├── models/            # TypeScript types & interfaces
│   ├── config/            # AWS SDK client configuration
│   ├── tools/             # Web search, mandi price lookup
│   └── utils/             # Hindi number normalization, helpers
├── infrastructure/
│   ├── stacks/            # CDK stacks (main + marketplace integration)
│   └── monitoring/        # CloudWatch alarms, dashboards, SNS
├── marketplace/           # Buyer SPA (HTML/JS/CSS)
├── backend/lambdas/       # Marketplace API handlers (products, orders, payments)
├── tests/
│   ├── unit/              # 27 unit tests
│   ├── integration/       # 5 integration tests
│   └── property/          # 27 property-based tests (fast-check)
└── docs/                  # Cost estimates, environment variables, troubleshooting
```

---

## Quick Start

```bash
# Install
npm install

# Configure environment
cp .env.example .env
# Set: WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, AWS_REGION

# Deploy
npx tsc && cp -r backend/* dist/backend/ && npx cdk deploy --all

# Run tests
npm test
```

### Prerequisites

- AWS Account with CLI configured
- Node.js 20.x, AWS CDK
- WhatsApp Business API credentials
- Amazon Bedrock model access (Nova Pro, Titan Image Gen v2)

---

## Live URLs

| Resource | URL |
|---|---|
| **Marketplace** | [d29x1w2stzqkag.cloudfront.net](https://d29x1w2stzqkag.cloudfront.net) |
| **API** | [o72ecc4lpg.execute-api.us-east-1.amazonaws.com/prod/](https://o72ecc4lpg.execute-api.us-east-1.amazonaws.com/prod/) |
| **Webhook** | [m6sqkaco93.execute-api.us-east-1.amazonaws.com/whatsapp/webhook](https://m6sqkaco93.execute-api.us-east-1.amazonaws.com/whatsapp/webhook) |

---

## Testing

```bash
npm test                  # Unit tests (27)
npm run test:coverage     # Coverage report
npm run test:integration  # Integration tests (5)
npm run test:property     # Property-based tests (27)
```

---

<div align="center">

**Built for Bharat** 🇮🇳

*Empowering rural commerce through voice AI*

</div>
