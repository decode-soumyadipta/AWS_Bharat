# Vyapar-Vaani Testing Guide

## Local Testing (Before Deployment)

### Run All Tests
```bash
npm test
```

### Run with Coverage
```bash
npm test -- --coverage
```

### Run Specific Test Suite
```bash
# Unit tests only
npm test -- tests/unit/

# Property tests only
npm test -- tests/property/

# Specific file
npm test -- tests/unit/catalog-builder.test.ts
```

### Watch Mode (for development)
```bash
npm test -- --watch
```

---

## Testing After Deployment

### 1. Test WhatsApp Webhook

#### Send Test Message
1. Open WhatsApp
2. Send message to your business number: "Hello"

#### Check Logs
```bash
aws logs tail /aws/lambda/vyapar-vaani-whatsapp-webhook-handler --follow
```

**Expected Output:**
```
Received WhatsApp message from +91XXXXXXXXXX
Message type: text
Content: Hello
Event published to EventBridge
```

---

### 2. Test KYC Flow (Document Processing)

#### Step 1: Send PAN Card Image
1. Take photo of PAN card
2. Send via WhatsApp

#### Step 2: Monitor Processing
```bash
# Terminal 1: Document extraction
aws logs tail /aws/lambda/vyapar-vaani-document-extraction --follow

# Terminal 2: KYC validation
aws logs tail /aws/lambda/vyapar-vaani-kyc-validation --follow

# Terminal 3: Seller registration
aws logs tail /aws/lambda/vyapar-vaani-seller-registration --follow
```

#### Step 3: Verify in DynamoDB
```bash
aws dynamodb scan \
  --table-name vyapar-vaani-data \
  --filter-expression "entityType = :type" \
  --expression-attribute-values '{":type":{"S":"SELLER_PROFILE"}}' \
  --output table
```

**Expected:** Seller profile with KYC status "VERIFIED"

---

### 3. Test Voice Transcription

#### Send Voice Note
Record and send: "मैं आम का अचार बेचना चाहता हूं"

#### Check Logs
```bash
aws logs tail /aws/lambda/vyapar-vaani-voice-transcription --follow
```

**Expected Output:**
```
Transcription started for audio: s3://bucket/audio.mp3
Language detected: hi-IN
Transcription: मैं आम का अचार बेचना चाहता हूं
Confidence: 0.95
```

---

### 4. Test Intent Classification

#### After Voice Transcription
```bash
aws logs tail /aws/lambda/vyapar-vaani-intent-classification --follow
```

**Expected Output:**
```
Intent classified: CREATE_CATALOG
Confidence: 0.92
Language: hi
```

---

### 5. Test Entity Extraction

```bash
aws logs tail /aws/lambda/vyapar-vaani-entity-extraction --follow
```

**Expected Output:**
```
Entities extracted:
{
  "product_name": "आम का अचार",
  "price": null,
  "quantity": null,
  "category": "food"
}
Missing fields: price, quantity
Requesting clarification from seller
```

---

### 6. Test Catalog Creation

#### Send Complete Voice Note
"मैं 5 किलो आम का अचार 200 रुपये में बेचना चाहता हूं"

#### Monitor Full Flow
```bash
# Use tmux or multiple terminals
aws logs tail /aws/lambda/vyapar-vaani-intent-classification --follow
aws logs tail /aws/lambda/vyapar-vaani-entity-extraction --follow
aws logs tail /aws/lambda/vyapar-vaani-catalog-builder --follow
```

#### Verify Catalog in DynamoDB
```bash
aws dynamodb scan \
  --table-name vyapar-vaani-data \
  --filter-expression "entityType = :type" \
  --expression-attribute-values '{":type":{"S":"CATALOG_ITEM"}}' \
  --output table
```

**Expected:** Catalog item with Beckn-compliant structure

---

### 7. Test Order Management

#### Simulate ONDC Order
```bash
# Create test order event
cat > test-order.json << 'EOF'
{
  "context": {
    "domain": "nic2004:52110",
    "action": "confirm",
    "bap_id": "test-buyer-app.ondc.in"
  },
  "message": {
    "order": {
      "id": "test-order-123",
      "items": [
        {
          "id": "YOUR-CATALOG-ITEM-ID",
          "quantity": {
            "count": 2
          }
        }
      ],
      "billing": {
        "name": "Test Buyer",
        "phone": "+919999999999"
      },
      "fulfillment": {
        "type": "Delivery",
        "end": {
          "location": {
            "address": {
              "locality": "Test Area",
              "city": "Mumbai",
              "state": "Maharashtra",
              "country": "IND",
              "area_code": "400001"
            }
          }
        }
      }
    }
  }
}
EOF

# Invoke order handler
aws lambda invoke \
  --function-name vyapar-vaani-order-notification \
  --payload file://test-order.json \
  response.json

cat response.json
```

#### Check WhatsApp Message Sent
```bash
aws logs tail /aws/lambda/vyapar-vaani-whatsapp-sender --follow
```

**Expected:** Interactive message with Accept/Reject buttons sent to seller

---

### 8. Test Inventory Update

#### Send Voice Note
"मेरे पास अब 50 किलो आम का अचार है"

#### Monitor Logs
```bash
aws logs tail /aws/lambda/vyapar-vaani-inventory-sync --follow
```

#### Verify Update
```bash
aws dynamodb get-item \
  --table-name vyapar-vaani-data \
  --key '{"PK":{"S":"SELLER#YOUR-SELLER-ID"},"SK":{"S":"ITEM#YOUR-ITEM-ID"}}'
```

**Expected:** Quantity updated to 50

---

## Performance Testing

### Load Test with Artillery

#### Install Artillery
```bash
npm install -g artillery
```

#### Create Load Test
```yaml
# load-test.yml
config:
  target: "https://YOUR-API-GATEWAY-URL"
  phases:
    - duration: 60
      arrivalRate: 10
      name: "Warm up"
    - duration: 120
      arrivalRate: 50
      name: "Sustained load"
  
scenarios:
  - name: "WhatsApp Webhook"
    flow:
      - post:
          url: "/whatsapp/webhook"
          json:
            messageId: "{{ $randomString() }}"
            from: "+919876543210"
            type: "text"
            content:
              text: "Test message"
```

#### Run Load Test
```bash
artillery run load-test.yml
```

---

## Debugging Tips

### Enable Detailed Logging

Update Lambda environment:
```bash
aws lambda update-function-configuration \
  --function-name vyapar-vaani-FUNCTION-NAME \
  --environment Variables="{LOG_LEVEL=DEBUG}"
```

### Check Step Functions Execution

```bash
# List executions
aws stepfunctions list-executions \
  --state-machine-arn YOUR-STATE-MACHINE-ARN

# Get execution details
aws stepfunctions describe-execution \
  --execution-arn YOUR-EXECUTION-ARN
```

### Check EventBridge Events

```bash
# Enable event archive (if not already enabled)
aws events create-archive \
  --archive-name vyapar-vaani-archive \
  --event-source-arn YOUR-EVENT-BUS-ARN

# Replay events for testing
aws events start-replay \
  --replay-name test-replay \
  --event-source-arn YOUR-EVENT-BUS-ARN \
  --event-start-time 2024-01-01T00:00:00Z \
  --event-end-time 2024-01-02T00:00:00Z \
  --destination YOUR-EVENT-BUS-ARN
```

### Check DynamoDB Streams

```bash
# List streams
aws dynamodbstreams list-streams \
  --table-name vyapar-vaani-data

# Get stream records
aws dynamodbstreams get-records \
  --shard-iterator YOUR-SHARD-ITERATOR
```

---

## Automated Testing

### Set Up CI/CD Testing

#### GitHub Actions Example
```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '20'
      - run: npm install
      - run: npm test -- --coverage
      - uses: codecov/codecov-action@v2
```

---

## Test Data Cleanup

### Clear Test Data
```bash
# Delete all test sellers
aws dynamodb scan \
  --table-name vyapar-vaani-data \
  --filter-expression "begins_with(phone, :test)" \
  --expression-attribute-values '{":test":{"S":"+91999"}}' \
  | jq -r '.Items[] | {PK: .PK.S, SK: .SK.S}' \
  | while read item; do
      aws dynamodb delete-item \
        --table-name vyapar-vaani-data \
        --key "$item"
    done

# Clear S3 test files
aws s3 rm s3://vyapar-vaani-products-YOUR-ACCOUNT/test/ --recursive
```

---

## Monitoring Dashboard

### Create CloudWatch Dashboard
```bash
aws cloudwatch put-dashboard \
  --dashboard-name VyaparVaani \
  --dashboard-body file://dashboard.json
```

### Dashboard JSON
```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/Lambda", "Invocations", {"stat": "Sum"}],
          [".", "Errors", {"stat": "Sum"}],
          [".", "Duration", {"stat": "Average"}]
        ],
        "period": 300,
        "stat": "Average",
        "region": "us-east-1",
        "title": "Lambda Metrics"
      }
    }
  ]
}
```

---

## Success Criteria

### ✅ System is Working When:

1. **WhatsApp Integration**
   - Messages received within 2 seconds
   - Responses sent within 5 seconds

2. **KYC Processing**
   - Document extraction accuracy > 90%
   - Registration completes in < 2 minutes

3. **Voice Processing**
   - Transcription accuracy > 85%
   - Intent classification confidence > 70%

4. **Catalog Creation**
   - ONDC validation passes 100%
   - Catalog broadcast succeeds

5. **Order Management**
   - Orders received within 2 seconds
   - State transitions tracked correctly

6. **Performance**
   - Lambda cold start < 3 seconds
   - Lambda warm execution < 500ms
   - DynamoDB latency < 10ms

---

## Troubleshooting Common Test Failures

### Test: WhatsApp webhook not receiving messages
**Fix:** Check API Gateway configuration and webhook URL

### Test: Transcription failing
**Fix:** Verify S3 bucket permissions and Transcribe IAM role

### Test: DynamoDB writes failing
**Fix:** Check IAM permissions and table capacity

### Test: Property tests failing
**Fix:** These test universal properties - if failing, there's a logic bug

---

## Next Steps

After all tests pass:
1. ✅ Deploy to production
2. ✅ Set up monitoring alerts
3. ✅ Configure backup policies
4. ✅ Train users
5. ✅ Monitor metrics

Happy Testing! 🎉
