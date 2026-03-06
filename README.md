<div align="center">

# Vyapar Vaani

**Voice-First WhatsApp Commerce for Rural India**

Sellers speak. AI sells. Buyers shop.

[![AWS](https://img.shields.io/badge/AWS-13%20Services-FF9900?logo=amazon-web-services&logoColor=white)](https://aws.amazon.com)
[![Bedrock](https://img.shields.io/badge/Bedrock-Nova%20Pro%20%2B%20Lite%20%2B%20Titan-232F3E?logo=amazon-web-services)](https://aws.amazon.com/bedrock/)
[![TypeScript](https://img.shields.io/badge/TypeScript-18.5K%20LOC-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-909%20cases-4CAF50)](tests/)
[![ONDC](https://img.shields.io/badge/ONDC-Beckn%20Protocol-0055A4)](https://ondc.org/)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-Cloud%20API%20v22.0-25D366?logo=whatsapp&logoColor=white)](https://business.whatsapp.com/)

[**Live Marketplace**](https://d29x1w2stzqkag.cloudfront.net) · [**API**](https://o72ecc4lpg.execute-api.us-east-1.amazonaws.com/prod/) · [**Webhook**](https://m6sqkaco93.execute-api.us-east-1.amazonaws.com/whatsapp/webhook)

</div>

---

## Problem

800M+ Indians use WhatsApp daily, but rural merchants cannot sell online. Conventional e-commerce demands typing, app installs, and English proficiency — things that don't work at India's last mile. The gap: **no zero-literacy commerce path exists on the platform they already use**.

## Solution

A seller speaks a voice message in Hindi/Marathi/English on WhatsApp. AI transcribes, extracts product data, enhances the photo, sets a market-competitive price, and publishes to a live buyer marketplace — all within a single conversation. No app. No typing. No training.

---

## Why AI Is Required

Every step of the seller journey has a barrier that only AI can remove:

| Barrier | Without AI | With AI (AWS Service) |
|---------|-----------|----------------------|
| **Language** — seller speaks Hindi/Marathi | Must type in English | **Transcribe** auto-detects language, converts speech to text |
| **Literacy** — cannot type product details | Cannot list products | **Bedrock Nova Pro** extracts name, price, quantity, unit from natural speech |
| **Photography** — cluttered backgrounds | Unprofessional images deter buyers | **Titan Image Generator v2** removes background, creates clean product photos |
| **Pricing** — no market awareness | Overprices or underprices | **Bedrock Nova Lite** + live mandi data recommends optimal price |
| **Orders** — cannot read order notifications | Misses or mishandles orders | **Polly** reads order details aloud in seller's language |
| **Business insight** — no analytics capability | Operates blind | **Bedrock Nova Lite** generates PDF reports with AI recommendations |
| **KYC** — cannot fill forms | Blocked from selling | **Textract** extracts PAN/Aadhaar fields from a photo |
| **Payments** — screenshot-based UPI verification | Manual, error-prone | **Bedrock Nova Pro** verifies UPI payment screenshots with AI |

> **Without AI, this product cannot exist.** A non-AI version would require the seller to type product names, prices, and descriptions in English — the exact barrier we are solving.

---

## Architecture

```
+---------------------------------------------------------------------------+
|                        SELLER (WhatsApp)                                  |
|                  Voice / Image / Text / Buttons                           |
+-------------------------------+-------------------------------------------+
                                | WhatsApp Cloud API v22.0
                                v
+----------------------------------------------------------------------+
|  API Gateway (HTTP)          |  API Gateway (REST)                    |
|  POST /whatsapp/webhook      |  GET  /products                        |
|  POST /beckn/{action}        |  POST /orders                          |
|                              |  POST /orders/{id}/verify-payment      |
+--------------+---------------+------------------+---------------------+
               |                                  |
               v                                  v
+-------------------------+            +-------------------------+
|  EventBridge Bus        |            |  Marketplace API        |
|  17 rules + DLQ         |            |  4 Lambda functions     |
|  1 scheduled rule       |            |                         |
|  (7 PM IST daily)       |            |  CloudFront CDN         |
+--------+----------------+            |  S3 Static SPA          |
         | routes to                   +------------+------------+
         v                                          |
+----------------------------------------------------------------------+
|                        23 Lambda Functions                            |
|  +--------------+ +---------------+ +---------------+ +------------+ |
|  | Agent        | | Voice         | | Image         | | KYC        | |
|  | Handler      | | Transcribe    | | Enhancement   | | Pipeline   | |
|  | Enhanced     | | Polly TTS     | | Titan v2      | | Textract   | |
|  | Agent        | | 3 languages   | | BG removal    | | Step Fn    | |
|  +--------------+ +---------------+ +---------------+ +------------+ |
|  +--------------+ +---------------+ +---------------+ +------------+ |
|  | Intent       | | Catalog       | | BPP Adapter   | | Background | |
|  | Classify     | | Builder +     | | 8 Beckn       | | Agent      | |
|  | Nova Pro     | | Broadcast     | | actions       | | Weather +  | |
|  | 10 intents   | | EventBridge   | | ONDC ready    | | Mkt Data   | |
|  +--------------+ +---------------+ +---------------+ +------------+ |
+------------------------------+---------------------------------------+
                               |
                               v
+----------------------------------------------------------------------+
|  DynamoDB (2 tables)  |  S3 (3 buckets)  |  KMS encryption          |
|  vyapar-vaani-data    |  Products/voice   |  Customer-managed key    |
|  5 GSIs, streams      |  KYC documents    |  Auto-rotation           |
|  marketplace-products |  Marketplace SPA  |                          |
+----------------------------------------------------------------------+
```

---

## AWS Services — 13 Services, 23 Lambdas

| # | Service | What It Does | Quantity |
|---|---------|-------------|----------|
| 1 | **Lambda** | All compute — webhook, AI agents, voice, image, KYC, orders, marketplace | 23 functions |
| 2 | **Bedrock** | LLM (Nova Pro + Lite) for intent, entities, conversations, reports; Titan for images | 4 model IDs |
| 3 | **DynamoDB** | Primary data store — sellers, products, orders, state, sessions | 2 tables, 5 GSIs |
| 4 | **S3** | Product images, voice files, PDF reports, KYC docs, marketplace SPA | 3 buckets |
| 5 | **Transcribe** | Voice to text with auto language detection (Hindi, Marathi, English) | Per-message jobs |
| 6 | **Polly** | Text to speech in 3 voices (Kajal, Aditi, Joanna) | Neural engine |
| 7 | **Textract** | KYC document OCR — PAN card, Aadhaar extraction | AnalyzeDocument |
| 8 | **EventBridge** | Event-driven routing — 17 rules, 1 scheduled, 30-day archive | 1 bus |
| 9 | **Step Functions** | KYC processing pipeline — extract, validate, register | 1 state machine |
| 10 | **API Gateway** | WhatsApp webhook (HTTP) + marketplace buyer API (REST) | 2 APIs, 7 endpoints |
| 11 | **CloudFront** | Marketplace SPA CDN with S3 origin | 1 distribution |
| 12 | **KMS** | Encryption at rest — DynamoDB + S3 | 1 key, auto-rotation |
| 13 | **SQS** | Dead-letter queue for EventBridge failures | 1 DLQ, 14-day retention |

---

## AI Models — 4 Bedrock Models

| Model | ID | Used For |
|-------|-----|----------|
| **Nova Pro** | `amazon.nova-pro-v1:0` | Intent classification (10 types), entity extraction, conversational AI, UPI payment screenshot verification |
| **Nova Lite** | `us.amazon.nova-lite-v1:0` | Fallback LLM, AI product descriptions, price recommendations, daily alert generation |
| **Nova Lite** | `amazon.nova-lite-v1:0` | PDF report AI recommendations + voice summary |
| **Titan Image v2** | `amazon.titan-image-generator-v2:0` | Product photo background removal + white background inpainting |

### AI Processing Pipeline

```
Voice Message (OGG)
  |
  +-- Transcribe --> Auto-detect language (hi-IN / mr-IN / en-IN)
  |                  Output: text + confidence + detected language
  |
  +-- Nova Pro ----> Intent Classification (10 types)
  |                  Entity Extraction (name, price, qty, unit, category)
  |
  +-- Nova Lite ---> AI Product Description (bilingual)
  |                  Price Recommendation (vs. live mandi data)
  |
  +-- Titan v2 ---> Background Removal then Inpainting fallback
  |                  Output: clean product photo on white background
  |
  +-- Polly ------> Response as voice (Hindi/Marathi/English)
                     Text + audio sent simultaneously
```

---

## Seller Flow — Voice to Marketplace

```
SELLER: "Mera naam Raju hai, mujhe tamatar bechna hai, 30 rupay kilo"
   |
   v  WhatsApp Cloud API v22.0
   |
   v  Lambda: whatsapp-webhook
   |     Routes via EventBridge
   |
   v  Lambda: agent-handler
   |     +-- Transcribe: "mera naam raju hai mujhe tamatar bechna hai 30 rupay kilo"
   |     +-- Nova Pro: intent=CREATE_CATALOG
   |     |            entities={name:"tamatar", price:30, unit:"kg"}
   |     +-- Fetch live mandi price: Tomato Rs.11-Rs.28/kg (data.gov.in)
   |     +-- Store partial data in DynamoDB
   |
   v  SELLER: sends product photo
   |     +-- Titan v2: background removal
   |     +-- Nova Lite: generates bilingual description
   |     +-- Stores enhanced image in S3
   |
   v  Lambda: confirmation-handler
   |     +-- Builds confirmation card with live market price
   |     +-- Polly TTS: reads confirmation in Hindi
   |     +-- Interactive buttons: [Approve] [Edit] [View]
   |
   v  SELLER: taps "Approve" or says "haan theek hai"
   |     +-- Catalog item created in DynamoDB
   |     +-- EventBridge: catalog.created event
   |     +-- Synced to marketplace-products table
   |     +-- Live on buyer marketplace immediately
   |
   v  BUYER: browses https://d29x1w2stzqkag.cloudfront.net
         +-- Adds to cart, checkout with UPI or COD
         +-- Order notification sent to seller via WhatsApp
         |     Polly reads order aloud in seller's language
         +-- Seller taps [Accept] or [Reject]
```

---

## Data Flow — Event-Driven Architecture

```
                    +----------------------------+
                    |      EventBridge Bus        |
                    |   vyapar-vaani-events       |
                    |   17 rules + DLQ + archive  |
                    +---------+------------------+
                              |
        +---------+----------++-----------+-----------+
        v         v          v            v           v
    whatsapp   whatsapp   catalog     catalog     background
    .text      .voice     .created    .deleted    .schedule
    .image     .button                            (7 PM IST)
        |         |          |            |           |
        v         v          v            v           v
    agent     agent       catalog     catalog     background
    handler   handler     sync to     sync to     agent:
    (NLP +    (voice to   marketplace marketplace weather +
     tools)    transcribe) products   products    market prices
                                                  + AI summary
```

---

## ONDC Integration — 8 Beckn Protocol Actions

Full order lifecycle via Beckn protocol adapter:

| Phase | Action | Response | What Happens |
|-------|--------|----------|-------------|
| Discovery | `search` | `on_search` | Returns ONDC-compliant catalog with `@ondc/org` extensions |
| Selection | `select` | `on_select` | Quote generation with item availability check |
| Initialization | `init` | `on_init` | Billing + fulfillment details, payment terms |
| Confirmation | `confirm` | `on_confirm` | Order created, seller notified via WhatsApp |
| Tracking | `status` | `on_status` | Real-time order status from DynamoDB |
| Modification | `update` | `on_update` | Order modifications (address, quantity) |
| Cancellation | `cancel` | `on_cancel` | Cancellation with reason, refund trigger |
| Tracking | `track` | `on_track` | Delivery tracking info |

---

## Language Support — 3 Languages, Voice-First

| Language | Transcribe | Polly Voice | LLM Prompts | System Messages |
|----------|-----------|-------------|-------------|-----------------|
| **Hindi** (hi-IN) | Auto-detect | Kajal (Neural) | Yes | Yes |
| **Marathi** (mr-IN) | Auto-detect | Aditi (Neural) | Yes | Yes |
| **English** (en-IN) | Auto-detect | Joanna (Neural) | Yes | Yes |

- **Auto language detection** via Transcribe `IdentifyLanguage` — no manual selection
- **Runtime language switching** — say "English mein baat karo" mid-conversation
- **Voice-first responses** — every text reply has a parallel Polly audio message
- **35+ commodity names** mapped across Devanagari, Romanized Hindi, and English for market price lookups

---

## Marketplace — Buyer Frontend

Live at **[d29x1w2stzqkag.cloudfront.net](https://d29x1w2stzqkag.cloudfront.net)**

| Feature | Implementation |
|---------|---------------|
| Product browsing | Grid view with images, prices, seller info |
| Search + filter | Real-time text search, category filtering |
| Shopping cart | Add/remove, quantity management |
| UPI payment | UPI ID display + reference input + screenshot AI verification |
| Cash on delivery | Alternative payment path |
| Order tracking | Real-time status polling |
| Mobile responsive | 640px + 380px breakpoints, touch-optimized |

Served via **CloudFront CDN** from **S3** origin with OAI access control.

---

## KYC Pipeline — Step Functions State Machine

```
Photo of PAN/Aadhaar
  |
  v  Textract AnalyzeDocument (FORMS + TABLES)
  |     Extracts: name, PAN number, DOB, address
  |
  v  Validate extracted fields
  |     PAN format: ABCDE1234F
  |     Name length, date validity
  |
  +-- Valid -----> Register seller, ONDC registry, send confirmation
  |
  +-- Invalid ---> Request clarification, re-upload photo
  
  Timeout: 2 minutes | Retries: 3 with exponential backoff
```

---

## Background Agent — Proactive Daily Alerts

Scheduled via EventBridge at **7:00 PM IST** (cron `30 13 * * ? *`):

1. **Weather forecast** — Open-Meteo API, 3-day forecast for seller's location
2. **Live market prices** — data.gov.in API for seller's crops (35+ commodities mapped)
3. **AI-generated summary** — Nova Lite synthesizes weather + prices into actionable Hindi advice
4. **WhatsApp delivery** — Text + Polly voice message sent to each active seller

Also triggered **on-demand** when seller asks about weather or market prices.

---

## PDF Business Reports

Generated via `pdfmake` with Roboto font, delivered as WhatsApp document + voice summary.

| Section | Content |
|---------|---------|
| **Header** | Seller name, phone, report period, generation timestamp |
| **Order Summary** | Total / Confirmed / Pending / Rejected / Cancelled counts |
| **Revenue Breakdown** | Confirmed revenue, pending revenue, average order value |
| **Product Performance** | Table: product name, orders, qty sold, revenue, avg price |
| **Product Catalog** | All listed products with price, stock, status |
| **AI Recommendations** | Nova Lite-generated business insights based on sales data |

Report types: **weekly**, **monthly**, **custom date range**

---

## Security

| Layer | Implementation |
|-------|---------------|
| **Encryption at rest** | KMS customer-managed key — DynamoDB + S3 |
| **Encryption in transit** | TLS everywhere — API Gateway, CloudFront, WhatsApp API |
| **KYC documents** | Separate encrypted S3 bucket, Glacier after 90 days, delete after 7 years |
| **API authentication** | WhatsApp webhook signature verification, Marketplace API key |
| **IAM least privilege** | Per-Lambda scoped policies (23 role policies) |
| **DLQ** | SQS dead-letter queue for all EventBridge targets, 14-day retention |
| **Event archive** | 30-day EventBridge archive for audit |

---

## Codebase

| Component | Files | Lines |
|-----------|-------|-------|
| **Source** (`src/`) | 49 TypeScript files | 18,543 LOC |
| **Infrastructure** (`infrastructure/`) | 2 CDK stacks | 1,640 LOC |
| **Tests** (`tests/`) | 69 test files | 909 test cases |
| **Marketplace** (`marketplace/`) | 4 files (HTML/JS/CSS) | SPA frontend |
| **Backend Lambdas** (`backend/`) | 4 JS files | Marketplace API handlers |

### Source Structure

```
src/
+-- lambdas/        17 Lambda handlers
+-- services/       17 service modules (AI agent, analytics, TTS, reports...)
+-- models/          8 data models (order, intent, seller, catalog...)
+-- config/          3 config files (AWS clients, constants, env)
+-- tools/           1 tool module (web search, market prices)
+-- utils/           3 utilities (formatting, validation, Hindi number normalization)
```

---

## Deployment

Single-command deployment via AWS CDK:

```bash
npm install
npm run build
cp -r node_modules/pdfmake dist/src/node_modules/pdfmake
npx cdk deploy --all
```

**Environment**: Node.js 20.x, TypeScript 5.x, CDK v2, us-east-1

---

## Value of the AI Layer

The AI layer is not an enhancement — it is the product. Remove AI and the platform cannot function:

| Without AI | With AI |
|-----------|---------|
| Seller must type in English | Seller speaks in any supported language |
| Seller must know product photography | Titan removes background automatically |
| Seller must research market prices | Live mandi prices fetched + AI price recommendation |
| Seller must read order notifications | Polly reads orders aloud |
| Seller must fill KYC forms | Photo of PAN card, Textract extracts all fields |
| Seller must track business manually | AI-generated PDF reports with recommendations |
| Payment verification is manual | AI verifies UPI screenshots |
| No proactive guidance | Daily AI-powered weather + market + crop advisory |

**AI touches every interaction.** In a typical seller session (list a product), AI is invoked **7 times**: Transcribe (voice to text), Nova Pro (intent), Nova Pro (entities), Nova Lite (description), Titan (image), Nova Lite (price recommendation), Polly (voice confirmation).

---

<div align="center">

**Built for the [AWS Hackathon for Bharat](https://awshackathonforbharat.devpost.com/)**

*Vyapar Vaani — giving every rural seller a voice in digital commerce.*

</div>
