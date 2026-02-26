# Vyapar-Vaani

> **Voice-First ONDC Platform for Rural Indian Merchants**  
> Enabling low-literacy sellers to join India's Open Network for Digital Commerce using only WhatsApp.

<div align="center">

[![AWS](https://img.shields.io/badge/AWS-Serverless-orange?logo=amazon-aws)](https://aws.amazon.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![ONDC](https://img.shields.io/badge/ONDC-Compliant-green)](https://ondc.org)
[![Tests](https://img.shields.io/badge/Tests-414%20passing-success)](./test.sh)
[![Coverage](https://img.shields.io/badge/Coverage-82.62%25-brightgreen)](./coverage)

</div>

---

## 🎯 The Problem

Rural Indian merchants face barriers to e-commerce:
- **Low digital literacy** - Can't use complex apps
- **Language barriers** - English-only interfaces
- **No technical skills** - Can't manage online catalogs
- **Limited access** - Only have basic smartphones

## 💡 Our Solution

A **zero-UI, voice-first platform** that works entirely through WhatsApp:

```
📱 WhatsApp Voice Note → 🤖 AI Processing → 🛍️ ONDC Network
```

Merchants speak in their language. We handle the rest.

---

## 🏗️ Architecture

### System Overview

```mermaid
graph LR
    A[👤 Seller<br/>WhatsApp] -->|Voice/Text/Image| B[🌐 API Gateway]
    B --> C[📨 Webhook<br/>Handler]
    C --> D[⚡ EventBridge]
    
    D -->|Text| E[🎯 Intent<br/>Classification]
    D -->|Voice| F[🎤 Voice<br/>Transcription]
    D -->|Image| G[🖼️ Image<br/>Enhancement]
    
    E --> H[🔍 Entity<br/>Extraction]
    F --> E
    
    H --> I[📦 Catalog<br/>Builder]
    I --> J[💾 DynamoDB]
    J --> K[📤 ONDC<br/>Network]
    
    J --> L[📱 WhatsApp<br/>Response]
    L --> A
    
    style A fill:#25D366
    style K fill:#FF6B35
    style J fill:#4A90E2
```

### AWS Services

```mermaid
graph TB
    subgraph "AI/ML Layer"
        A1[Amazon Bedrock<br/>Claude 3 Haiku]
        A2[Amazon Bedrock<br/>Titan Image Gen v2]
        A3[Amazon Transcribe]
        A4[Amazon Textract]
    end
    
    subgraph "Compute Layer"
        B1[AWS Lambda<br/>11 Functions]
        B2[Step Functions<br/>KYC Workflow]
    end
    
    subgraph "Integration Layer"
        C1[EventBridge<br/>Event Bus]
        C2[API Gateway<br/>HTTP API]
    end
    
    subgraph "Storage Layer"
        D1[DynamoDB<br/>Single Table]
        D2[S3<br/>Images & Docs]
        D3[KMS<br/>Encryption]
    end
    
    A1 --> B1
    A2 --> B1
    A3 --> B1
    A4 --> B2
    B1 --> C1
    C1 --> B1
    B1 --> D1
    B1 --> D2
    D3 --> D1
    D3 --> D2
    
    style A1 fill:#FF9900
    style B1 fill:#FF9900
    style C1 fill:#FF9900
    style D1 fill:#FF9900
```

### Event Flow

```mermaid
sequenceDiagram
    participant S as Seller
    participant W as WhatsApp
    participant API as API Gateway
    participant EB as EventBridge
    participant IC as Intent Classifier
    participant EE as Entity Extractor
    participant CB as Catalog Builder
    participant DB as DynamoDB
    participant ONDC as ONDC Network
    
    S->>W: Voice: "मैं आम बेचना चाहता हूं"
    W->>API: Webhook POST
    API->>EB: Publish Event
    EB->>IC: Trigger Lambda
    IC->>IC: Claude 3 Haiku<br/>Intent: CREATE_CATALOG
    IC->>EB: Publish Intent
    EB->>EE: Trigger Lambda
    EE->>EE: Claude 3 Haiku<br/>Extract Entities
    EE->>EB: Publish Entities
    EB->>CB: Trigger Lambda
    CB->>CB: Build Beckn Catalog
    CB->>DB: Store Catalog
    DB->>ONDC: Broadcast
    CB->>W: Send Confirmation
    W->>S: "✅ उत्पाद जोड़ा गया"
```

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 🎤 Voice-First
- Speak in Hindi, Marathi, or English
- No typing required
- Natural conversation flow

### 📸 Smart Images
- Upload product photos
- AI enhances to professional quality
- Titan Image Generator v2

### 🔐 Zero-UI KYC
- Upload PAN/Aadhar photos
- Automatic extraction & validation
- Instant seller registration

</td>
<td width="50%">

### 🌐 ONDC Compliant
- Full Beckn Protocol v1.2.0
- Real-time catalog sync
- Order management

### ⚡ Serverless
- Scale to zero when idle
- Pay only for usage
- Auto-scaling to millions

### 🧪 Production-Ready
- 82.62% test coverage
- 414 tests passing
- Property-based testing

</td>
</tr>
</table>

---
