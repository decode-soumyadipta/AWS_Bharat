# Vyapar-Vaani 🛒🗣️

**Voice-First ONDC Seller Node for Rural Indian Merchants**

A headless e-commerce platform enabling rural merchants with low digital literacy to participate in India's Open Network for Digital Commerce (ONDC) using only WhatsApp voice notes and images.

---

## 🌟 Features

- ✅ **Zero-UI KYC**: Upload PAN/Aadhar photos, get registered automatically
- ✅ **Voice-First**: Create catalogs, manage inventory, handle orders via voice notes
- ✅ **Multi-Language**: Hindi, Marathi, English support
- ✅ **AI-Powered**: Claude 3.5 Sonnet for intent classification & entity extraction
- ✅ **Image Enhancement**: Amazon Titan for professional product photos
- ✅ **ONDC Compliant**: Full Beckn Protocol v1.2.0 implementation
- ✅ **Serverless**: Scale-to-zero AWS architecture
- ✅ **Property-Based Testing**: 27 correctness properties validated

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- AWS Account
- AWS CLI configured
- WhatsApp Business Account

### 1. Clone & Install
```bash
git clone <your-repo>
cd vyapar-vaani
npm install
```

### 2. Build
```bash
npm run build
```

### 3. Deploy
```bash
cdk bootstrap  # First time only
cdk deploy
```

### 4. Configure WhatsApp
See `DEPLOYMENT_GUIDE.md` for detailed WhatsApp setup

### 5. Test
```bash
npm test
```

**Done!** Send a WhatsApp message to test.

---

## 📚 Documentation

- **[QUICK_START.md](QUICK_START.md)** - Get running in 30 minutes
- **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)** - Complete deployment instructions
- **[TESTING_GUIDE.md](TESTING_GUIDE.md)** - Testing and debugging
- **[.kiro/specs/vyapar-vaani/](./kiro/specs/vyapar-vaani/)** - Requirements, design, tasks

---

## 🏗️ Architecture

```
WhatsApp → API Gateway → EventBridge → Lambda Functions
                                    ↓
                            Step Functions (AI workflows)
                                    ↓
                            DynamoDB + S3 + KMS
                                    ↓
                            ONDC Registry (Beckn Protocol)
```

### Key Components

- **WhatsApp Integration**: Webhook handler + message sender
- **KYC Processing**: Textract → Validation → ONDC registration
- **Voice Processing**: Transcribe → Claude (intent + entities)
- **Catalog Builder**: Beckn-compliant catalog construction
- **Image Enhancement**: Titan Image Generator with Canny Edge
- **Order Management**: Interactive messages + state machine
- **BPP Adapter**: Full Beckn Protocol implementation

---

## 🧪 Testing

### Test Coverage: 82.62%

- ✅ 414 tests passing
- ✅ 9 property-based tests
- ✅ 405 unit tests
- ✅ All correctness properties validated

```bash
# Run all tests
npm test

# With coverage
npm test -- --coverage

# Watch mode
npm test -- --watch
```

---

## 📊 Tech Stack

### AWS Services
- **Compute**: Lambda, Step Functions
- **Storage**: DynamoDB, S3
- **AI/ML**: Bedrock (Claude, Titan), Transcribe, Textract, Rekognition
- **Integration**: EventBridge, API Gateway, End User Messaging
- **Security**: KMS, IAM
- **Monitoring**: CloudWatch, X-Ray

### Languages & Frameworks
- TypeScript
- AWS CDK (Infrastructure as Code)
- Jest (Testing)
- fast-check (Property-Based Testing)

---

## 💰 Cost Estimate

**For 1000 active sellers/month:**
- Lambda: ~$50
- DynamoDB: ~$25
- S3: ~$10
- AI Services (Transcribe, Bedrock, Textract): ~$350
- **Total: ~$435/month**

Scale-to-zero means you only pay for actual usage!

---

## 🔒 Security

- ✅ KMS encryption at rest
- ✅ TLS 1.3 in transit
- ✅ PII anonymization in logs
- ✅ IAM least privilege
- ✅ Beckn message signing
- ✅ WhatsApp webhook verification

---

## 🌍 Multi-Language Support

- **Hindi** (hi-IN): मैं 5 किलो आम का अचार बेचना चाहता हूं
- **Marathi** (mr-IN): मी 5 किलो आंब्याचे लोणचे विकायचे आहे
- **English** (en-IN): I want to sell 5 kg mango pickle

Code-mixed input supported: "Mango pickle 200 rupees 5 kg"

---

## 📈 Monitoring

### CloudWatch Metrics
- Time to Network (KYC → Registration)
- Catalog Rejection Rate
- Image Enhancement Success Rate
- Order Acceptance Rate
- Error Rates per Component

### Alarms
- Lambda errors > 5%
- DynamoDB throttling > 10 requests
- Step Functions failures > 3
- Beckn signature failures > 1

---

## 🛠️ Development

### Project Structure
```
vyapar-vaani/
├── src/
│   ├── lambdas/          # Lambda function handlers
│   ├── models/           # TypeScript interfaces
│   ├── services/         # Business logic
│   └── config/           # AWS client configs
├── infrastructure/       # CDK stack definitions
├── tests/
│   ├── unit/            # Unit tests
│   └── property/        # Property-based tests
├── .kiro/specs/         # Requirements & design
└── docs/                # Documentation
```

### Key Files
- `infrastructure/stacks/vyapar-vaani-stack.ts` - CDK infrastructure
- `src/lambdas/` - All Lambda functions
- `src/services/dynamodb-repository.ts` - Data access layer
- `tests/property/` - Correctness properties

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Write tests (`npm test`)
4. Commit changes (`git commit -m 'Add amazing feature'`)
5. Push to branch (`git push origin feature/amazing-feature`)
6. Open Pull Request

### Code Standards
- TypeScript strict mode
- 80%+ test coverage
- Property tests for core logic
- Beckn Protocol compliance

---

## 📝 License

MIT License - See LICENSE file

---

## 🙏 Acknowledgments

- **ONDC** for the open commerce protocol
- **AWS** for serverless infrastructure
- **Anthropic** for Claude 3.5 Sonnet
- **Meta** for WhatsApp Business API

---

## 📞 Support

- **Documentation**: See `/docs` folder
- **Issues**: GitHub Issues
- **Email**: support@vyapar-vaani.in

---

## 🎯 Roadmap

- [ ] Multi-seller marketplace support
- [ ] Advanced analytics dashboard
- [ ] Automated inventory forecasting
- [ ] Integration with payment gateways
- [ ] Mobile app for sellers
- [ ] Regional language expansion

---

## 📸 Screenshots

### WhatsApp Interface
```
Seller: [Voice Note] "मैं आम का अचार बेचना चाहता हूं"
Bot: "कृपया कीमत और मात्रा बताएं"
Seller: [Voice Note] "200 रुपये, 5 किलो"
Bot: "✅ उत्पाद सफलतापूर्वक जोड़ा गया!"
```

### Order Notification
```
🛒 नया ऑर्डर!

ग्राहक: राज कुमार
उत्पाद: आम का अचार
मात्रा: 2 किलो
कीमत: ₹400

पता: मुंबई, महाराष्ट्र

[✅ स्वीकार करें] [❌ अस्वीकार करें]
```

---

## 🌟 Star History

If you find this project useful, please star it! ⭐

---

**Built with ❤️ for rural India**
