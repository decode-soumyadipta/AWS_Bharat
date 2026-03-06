<div align="center">

<img src="marketplace/logo.png" alt="Vyapar Vaani" width="180"/>

# Vyapar Vaani

**500M Indian Rural Sellers can't navigate through complex apps.**

*Vyapar Vaani is Zero UI — no forms, no apps, no menus. Just WhatsApp — the app 800M Indians already know — speak in Hindi, Marathi, or your local language, and AI handles product listings, pricing, product photography, and orders. The rest is commerce.*

[![AWS](https://img.shields.io/badge/AWS-13%20Services-FF9900?logo=amazonaws&logoColor=white)](https://aws.amazon.com)
[![Bedrock](https://img.shields.io/badge/Bedrock-Nova%20Pro%20%2B%20Lite%20%2B%20Titan-232F3E?logo=amazonaws&logoColor=white)](https://aws.amazon.com/bedrock/)
[![TypeScript](https://img.shields.io/badge/TypeScript-18.5K%20LOC-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-909%20passed-4CAF50?logo=vitest&logoColor=white)](tests/)
[![ONDC](https://img.shields.io/badge/ONDC-Beckn%20Protocol-0055A4)](https://ondc.org/)
[![WhatsApp](https://img.shields.io/badge/WhatsApp_Cloud_API-v22.0-25D366?logo=whatsapp&logoColor=white)](https://business.whatsapp.com/)

[**Live Marketplace →**](https://d29x1w2stzqkag.cloudfront.net) &nbsp;·&nbsp; [**REST API →**](https://o72ecc4lpg.execute-api.us-east-1.amazonaws.com/prod/) &nbsp;·&nbsp; [**Webhook →**](https://m6sqkaco93.execute-api.us-east-1.amazonaws.com/whatsapp/webhook)

</div>

---

## Problem

Rural merchants aren't offline because they lack smartphones or internet — they're offline because **every e-commerce platform demands digital literacy they don't have**: app installs, form filling, menu navigation, and onboarding flows designed for urban, educated users.

This friction exists in Hindi just as much as English. Translating an interface doesn't eliminate it. **The interaction model itself is broken for 500M+ Indians at the last mile.**

## Solution

Vyapar Vaani removes the interface entirely. A seller speaks a voice message on WhatsApp — the one app they already know. AI handles everything else: transcription, product extraction, photo enhancement, market pricing, and live listing. **No forms. No menus. No steps to learn. Zero digital literacy required.**

---

## Why AI Is Non-Negotiable

> Remove AI and this product cannot function. A non-AI version would require sellers to type product names, prices, and descriptions in English — the exact barrier being solved.

| Barrier | Without AI | With AI (AWS Service) |
|---|---|---|
| **Language** — seller speaks Hindi/Marathi | Must type in English | **Transcribe** auto-detects language, converts speech to text |
| **Literacy** — cannot type product details | Cannot list products | **Nova Pro** extracts name, price, quantity, unit from natural speech |
| **Photography** — cluttered backgrounds | Unprofessional images | **Titan Image v2** removes background, creates clean product photos |
| **Pricing** — no market awareness | Over/underprices | **Nova Lite** + live mandi data recommends optimal price |
| **Orders** — cannot read notifications | Misses orders | **Polly** reads order details aloud in seller's language |
| **KYC** — cannot fill forms | Blocked from selling | **Textract** extracts PAN/Aadhaar fields from a photo |
| **Payments** — screenshot verification | Manual, error-prone | **Nova Pro** verifies UPI payment screenshots |
| **Business insight** — no analytics | Operates blind | **Nova Lite** generates PDF reports with AI recommendations |

In a typical session (listing one product), AI is invoked **7 times**: Transcribe → Nova Pro (intent) → Nova Pro (entities) → Nova Lite (description) → Titan (image) → Nova Lite (price) → Polly (voice confirmation).

---

## Architecture

<div align="center">
<img src="generated-diagrams/vyapar-vaani-architecture.png" alt="Vyapar Vaani AWS Architecture" width="100%"/>
</div>

**4-Layer Event-Driven Architecture** (Left → Right):

**Layer 1: External** (Blue)
- Users: Sellers (WhatsApp) + Buyers (Web)
- WhatsApp Cloud API v22.0
- API Gateway: HTTP (webhook) + REST (marketplace)

**Layer 2: Event & Compute** (Orange)
- EventBridge: 17 rules, 30-day archive, DLQ
- Lambda: Webhook, AI Agent, Marketplace API
- Step Functions: KYC pipeline (2min timeout)

**Layer 3: AI/ML** (Purple)
- Bedrock: Nova Pro (intent/entity), Nova Lite (descriptions/pricing), Titan Image (enhancement)
- Transcribe: Voice→Text (hi-IN/mr-IN/en-IN)
- Textract: KYC OCR (PAN/Aadhaar)
- Polly: TTS (Kajal/Aditi/Joanna)

**Layer 4: Data & Security** (Red)
- DynamoDB: 2 tables, 7 GSIs total
- S3: 3 buckets (products, KYC, frontend)
- CloudFront: CDN for marketplace
- KMS: Encryption key (auto-rotation)
- IAM: 23 roles (least privilege)

**Data Flows**:
- Blue: Seller journey | Purple: AI processing | Red: Storage | Orange: KYC | Green: Marketplace | Teal: CDN | Gray: Security

---

## Seller Flow — Voice to Marketplace

```mermaid
sequenceDiagram
    participant S as Seller (WhatsApp)
    participant WH as Webhook Lambda
    participant AI as AI Pipeline
    participant DB as DynamoDB / S3
    participant B as Buyer Marketplace

    S->>WH: 🎤 "Mera tamatar 30 rupay kilo"
    WH->>AI: Route via EventBridge
    AI->>AI: Transcribe → language auto-detect (hi-IN)
    AI->>AI: Nova Pro → intent=CREATE_CATALOG, entities={tamatar, ₹30, kg}
    AI->>AI: Nova Lite → fetch live mandi price (₹11–₹28/kg)
    AI->>DB: Store partial session state
    WH-->>S: 🔊 Polly: "Photo bhejiye"

    S->>WH: 📷 Product photo
    AI->>AI: Titan Image v2 → background removal → white background
    AI->>AI: Nova Lite → bilingual product description
    AI->>DB: Save enhanced image to S3
    WH-->>S: Confirmation card + market price + [Approve] [Edit] [View]

    S->>WH: ✅ Taps "Approve"
    AI->>DB: Create catalog item (DynamoDB + marketplace-products table)
    DB-->>B: Product live on marketplace instantly

    B->>WH: Place order (UPI / COD)
    WH-->>S: 🔊 Polly reads order aloud in Hindi
    S->>WH: Taps [Accept]
    WH-->>B: Order confirmed + real-time tracking
```

---

## AWS Services

| # | Service | Role | Scale |
|---|---|---|---|
| 1 | **Lambda** | All compute — webhook, AI agents, voice, image, KYC, orders | 23 functions |
| 2 | **Bedrock** | LLM (Nova Pro + Lite) + Titan image generation | 4 model IDs |
| 3 | **DynamoDB** | Sellers, products, orders, sessions, state | 2 tables, 7 GSIs |
| 4 | **S3** | Product images, voice files, PDF reports, KYC docs, SPA | 3 buckets |
| 5 | **Transcribe** | Voice → text with auto language detection | Per-message jobs |
| 6 | **Polly** | Text → speech in 3 voices (Kajal · Aditi · Joanna) | Neural engine |
| 7 | **Textract** | KYC document OCR — PAN / Aadhaar extraction | AnalyzeDocument |
| 8 | **EventBridge** | Event-driven routing — 17 rules, 30-day archive | 1 bus |
| 9 | **Step Functions** | KYC pipeline — extract → validate → register | 1 state machine |
| 10 | **API Gateway** | WhatsApp webhook (HTTP) + Marketplace buyer API (REST) | 2 APIs, 7 endpoints |
| 11 | **CloudFront** | Marketplace SPA CDN with S3 OAI | 1 distribution |
| 12 | **KMS** | Encryption at rest — DynamoDB + S3, auto-rotation | 1 customer key |
| 13 | **SQS** | Dead-letter queue for EventBridge failures | 14-day retention |

---

## AI Models

| Model | ID | Used For |
|---|---|---|
| **Nova Pro** | `amazon.nova-pro-v1:0` | Intent classification (10 types), entity extraction, UPI payment screenshot verification |
| **Nova Lite** | `us.amazon.nova-lite-v1:0` | Product descriptions, price recommendations, daily alert generation |
| **Nova Lite** | `amazon.nova-lite-v1:0` | PDF report AI recommendations + voice summary |
| **Titan Image v2** | `amazon.titan-image-generator-v2:0` | Product photo background removal + white background inpainting |

---

## ONDC Integration — Full Beckn Order Lifecycle

| Phase | Action | What Happens |
|---|---|---|
| Discovery | `search` → `on_search` | ONDC-compliant catalog with `@ondc/org` extensions |
| Selection | `select` → `on_select` | Quote with item availability check |
| Initialization | `init` → `on_init` | Billing, fulfillment, payment terms |
| Confirmation | `confirm` → `on_confirm` | Order created, seller notified via WhatsApp |
| Tracking | `status` → `on_status` | Real-time order status from DynamoDB |
| Modification | `update` → `on_update` | Address / quantity changes |
| Cancellation | `cancel` → `on_cancel` | Cancellation with refund trigger |
| Tracking | `track` → `on_track` | Delivery tracking info |

---

## Language Support

| Language | Transcribe | Polly Voice | LLM Prompts |
|---|---|---|---|
| **Hindi** (hi-IN) | Auto-detect | Kajal Neural | ✅ |
| **Marathi** (mr-IN) | Auto-detect | Aditi Neural | ✅ |
| **English** (en-IN) | Auto-detect | Joanna Neural | ✅ |

- Auto language detection via `IdentifyLanguage` — no manual selection needed
- Runtime language switching mid-conversation ("English mein baat karo")
- 35+ commodity names mapped across Devanagari, Romanised Hindi, and English for mandi price lookups

---

## KYC Pipeline

```mermaid
flowchart LR
    A[📄 Photo of PAN / Aadhaar] --> B[Textract\nAnalyzeDocument\nFORMS + TABLES]
    B --> C{Validate Fields}
    C -->|PAN format: ABCDE1234F\nName + DOB valid| D[✅ Register Seller\nONDC Registry\nWhatsApp confirmation]
    C -->|Invalid| E[❌ Request re-upload\nwith guidance]

    style D fill:#22c55e,color:#fff
    style E fill:#ef4444,color:#fff
```

Timeout: 2 min &nbsp;|&nbsp; Retries: 3 with exponential backoff

---

## Background Agent — Daily Proactive Alerts

Scheduled via EventBridge at **7:00 PM IST** (`cron(30 13 * * ? *)`):

1. **Weather** — Open-Meteo API, 3-day forecast for seller's location
2. **Market prices** — data.gov.in live mandi prices for seller's crops
3. **AI summary** — Nova Lite synthesises weather + prices into actionable Hindi advice
4. **Delivery** — Text + Polly voice message to every active seller

Also triggered on-demand when a seller asks about weather or prices.

---

## Buyer Marketplace

Live at **[d29x1w2stzqkag.cloudfront.net](https://d29x1w2stzqkag.cloudfront.net)** — served via CloudFront + S3.

| Feature | Details |
|---|---|
| Product browsing | Grid view with images, prices, seller info |
| Search + filter | Real-time text search, category filtering |
| Cart | Add/remove, quantity management |
| UPI payment | UPI ID + reference + AI screenshot verification |
| Cash on delivery | Alternative payment path |
| Order tracking | Real-time status polling |
| Responsive | 640px + 380px breakpoints, touch-optimised |

---

## PDF Business Reports

Generated with `pdfmake` (Roboto font). Delivered as WhatsApp document + Polly voice summary.

Sections: Order summary · Revenue breakdown · Product performance · Catalog · **AI recommendations (Nova Lite)**

Report periods: weekly · monthly · custom date range

---

## Security

| Layer | Implementation |
|---|---|
| Encryption at rest | KMS customer-managed key — DynamoDB + S3 |
| Encryption in transit | TLS — API Gateway, CloudFront, WhatsApp API |
| KYC documents | Separate encrypted bucket · Glacier after 90 days · Delete after 7 years |
| API authentication | WhatsApp webhook signature verification + Marketplace API key |
| IAM | Per-Lambda scoped policies (23 role policies, least privilege) |
| Reliability | SQS DLQ (14-day) + 30-day EventBridge archive |

---

## Codebase

| Component | Files | LOC |
|---|---|---|
| `src/` — Lambdas, services, models, utils | 49 TypeScript files | 18,543 |
| `infrastructure/` — CDK stacks | 2 files | 1,640 |
| `tests/` — Unit + integration | 69 test files | 909 cases |
| `marketplace/` — Buyer SPA | 4 files (HTML/JS/CSS) | — |
| `backend/` — Marketplace API handlers | 4 JS files | — |

```
src/
├── lambdas/    17 Lambda handlers
├── services/   17 modules (AI agent, analytics, TTS, reports…)
├── models/      8 data models (order, intent, seller, catalog…)
├── config/      3 files (AWS clients, constants, env)
├── tools/       1 module (web search, market prices)
└── utils/       3 utilities (formatting, validation, Hindi number normalisation)
```

---

## Deployment

```bash
npm install
npm run build
cp -r node_modules/pdfmake dist/src/node_modules/pdfmake
npx cdk deploy --all
```

**Stack:** Node.js 20.x · TypeScript 5.x · CDK v2 · Region: `us-east-1`

---

<div align="center">

**Built for the [AWS Hackathon for Bharat](https://awshackathonforbharat.devpost.com/)**

*Vyapar Vaani — giving every rural seller a voice in digital commerce.*

</div>
