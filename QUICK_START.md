# Vyapar-Vaani Quick Start 🚀

## 1️⃣ Git Push (2 minutes)

```bash
git add .
git commit -m "feat: Complete Vyapar-Vaani implementation"
git push origin main
```

## 2️⃣ AWS Setup (5 minutes)

```bash
# Configure AWS
aws configure
# Enter: Access Key, Secret Key, Region (us-east-1), Format (json)

# Install CDK
npm install -g aws-cdk

# Bootstrap (first time only)
cdk bootstrap
```

## 3️⃣ Build & Deploy (10 minutes)

```bash
# Build
npm run build

# Deploy
cdk deploy
# Type 'y' when prompted
```

## 4️⃣ WhatsApp Setup (15 minutes)

### Go to AWS Console → End User Messaging

1. Create WhatsApp channel
2. Connect Meta Business Account
3. Get credentials:
   - Phone Number ID
   - API Endpoint
4. Configure webhook URL (from CDK output)

### Update Lambda

```bash
aws lambda update-function-configuration \
  --function-name vyapar-vaani-whatsapp-sender \
  --environment Variables="{
    WHATSAPP_API_ENDPOINT=YOUR-ENDPOINT,
    WHATSAPP_PHONE_NUMBER_ID=YOUR-PHONE-ID,
    TABLE_NAME=vyapar-vaani-data,
    EVENT_BUS_NAME=vyapar-vaani-event-bus
  }"
```

## 5️⃣ Test (5 minutes)

### Send WhatsApp Message
Send a PAN card image to your WhatsApp number

### Check Logs
```bash
aws logs tail /aws/lambda/vyapar-vaani-whatsapp-webhook-handler --follow
```

### Verify Data
```bash
aws dynamodb scan --table-name vyapar-vaani-data --max-items 5
```

## 🎉 Done!

Your system is live. Send voice notes in Hindi/Marathi/English to test!

---

## Common Commands

```bash
# View logs
aws logs tail /aws/lambda/vyapar-vaani-FUNCTION-NAME --follow

# Check DynamoDB
aws dynamodb scan --table-name vyapar-vaani-data

# Redeploy after changes
npm run build && cdk deploy

# Run tests
npm test

# Destroy everything (careful!)
cdk destroy
```

---

## Need Help?

See `DEPLOYMENT_GUIDE.md` for detailed instructions.
