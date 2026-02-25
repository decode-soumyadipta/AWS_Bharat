# Vyapar-Vaani Deployment Guide

## 🚀 Quick Start: From Code to Production

This guide walks you through deploying Vyapar-Vaani to AWS and connecting it to WhatsApp.

---

## Step 1: Prepare for Git Push

### Update .gitignore

```bash
# Check current .gitignore
cat .gitignore
```

Add these entries if not present:

```
# Dependencies
node_modules/
aws_env/

# Build outputs
dist/
*.js
*.d.ts
!jest.config.js

# Test coverage
coverage/
.nyc_output/

# Environment variables
.env
.env.local
.env.*.local

# CDK outputs
cdk.out/
.cdk.staging/

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# AWS
.aws-sam/
samconfig.toml
```

### Commit and Push

```bash
# Check git status
git status

# Add all files
git add .

# Commit
git commit -m "feat: Complete Vyapar-Vaani implementation with tests"

# Push to remote
git push origin main
```

---

## Step 2: AWS Prerequisites

### 2.1 Install AWS CLI (if not installed)

```bash
# Check if installed
aws --version

# If not installed:
# macOS
brew install awscli

# Verify installation
aws --version
```

### 2.2 Configure AWS Credentials

```bash
# Configure AWS CLI
aws configure

# Enter:
# AWS Access Key ID: [Your Access Key]
# AWS Secret Access Key: [Your Secret Key]
# Default region name: us-east-1  (or your preferred region)
# Default output format: json
```

### 2.3 Install AWS CDK

```bash
# Install CDK globally
npm install -g aws-cdk

# Verify installation
cdk --version

# Bootstrap CDK (first time only)
cdk bootstrap aws://YOUR-ACCOUNT-ID/us-east-1
```

To get your AWS Account ID:
```bash
aws sts get-caller-identity --query Account --output text
```

---

## Step 3: Build the Project

```bash
# Install dependencies (if not done)
npm install

# Build TypeScript code
npm run build

# Verify dist/ folder created
ls -la dist/
```

---

## Step 4: Deploy to AWS

### 4.1 Review Infrastructure

```bash
# See what will be deployed
cdk synth

# Check for any issues
cdk diff
```

### 4.2 Deploy Stack

```bash
# Deploy everything
cdk deploy

# You'll see a confirmation prompt - type 'y' to proceed
```

This will create:
- ✅ DynamoDB table with GSIs
- ✅ S3 buckets (KYC documents, product images)
- ✅ Lambda functions (7 functions)
- ✅ Step Functions state machines
- ✅ EventBridge event bus
- ✅ KMS encryption key
- ✅ IAM roles and policies
- ✅ CloudWatch log groups

**Deployment takes ~5-10 minutes**

### 4.3 Save Stack Outputs

After deployment, save these outputs:
```bash
# Get stack outputs
aws cloudformation describe-stacks \
  --stack-name VyaparVaaniStack \
  --query 'Stacks[0].Outputs' \
  --output table
```

Save these values:
- `DataTableName`
- `KYCBucketName`
- `ProductsBucketName`
- `EventBusName`
- `EncryptionKeyId`

---

## Step 5: Set Up WhatsApp Business API

### Option A: AWS End User Messaging (Recommended)

#### 5.1 Go to AWS Console
1. Navigate to: **AWS End User Messaging** service
2. Region: Same as your deployment (e.g., us-east-1)

#### 5.2 Create WhatsApp Channel
1. Click **"Create channel"**
2. Select **"WhatsApp"**
3. Choose **"Meta Business Account"**
4. Follow the setup wizard:
   - Connect your Meta Business Account
   - Verify your phone number
   - Get WhatsApp Business API credentials

#### 5.3 Configure Webhook
1. In AWS End User Messaging console:
   - Go to your WhatsApp channel
   - Click **"Webhooks"**
   - Add webhook URL: `https://YOUR-API-GATEWAY-URL/whatsapp/webhook`
   
2. Get API Gateway URL:
```bash
# Find API Gateway
aws apigateway get-rest-apis --query 'items[?name==`VyaparVaaniAPI`]'

# Or check CloudFormation outputs
aws cloudformation describe-stacks \
  --stack-name VyaparVaaniStack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayUrl`].OutputValue' \
  --output text
```

#### 5.4 Update Lambda Environment Variables
```bash
# Update WhatsApp sender Lambda
aws lambda update-function-configuration \
  --function-name vyapar-vaani-whatsapp-sender \
  --environment Variables="{
    TABLE_NAME=vyapar-vaani-data,
    KYC_BUCKET_NAME=vyapar-vaani-kyc-YOUR-ACCOUNT-ID,
    PRODUCTS_BUCKET_NAME=vyapar-vaani-products-YOUR-ACCOUNT-ID,
    EVENT_BUS_NAME=vyapar-vaani-event-bus,
    KMS_KEY_ID=YOUR-KMS-KEY-ID,
    WHATSAPP_API_ENDPOINT=YOUR-WHATSAPP-API-ENDPOINT,
    WHATSAPP_PHONE_NUMBER_ID=YOUR-PHONE-NUMBER-ID
  }"
```

### Option B: Direct Meta WhatsApp Business API

1. Go to: https://developers.facebook.com/
2. Create a Meta App
3. Add WhatsApp product
4. Get credentials:
   - Phone Number ID
   - WhatsApp Business Account ID
   - Access Token
5. Configure webhook (same as above)

---

## Step 6: Test the System

### 6.1 Test WhatsApp Webhook

```bash
# Send test message to your WhatsApp number
# The system should receive and process it

# Check CloudWatch logs
aws logs tail /aws/lambda/vyapar-vaani-whatsapp-webhook-handler --follow
```

### 6.2 Test KYC Flow

1. **Send a PAN card image** via WhatsApp
2. **Check logs**:
```bash
# Document extraction
aws logs tail /aws/lambda/vyapar-vaani-document-extraction --follow

# KYC validation
aws logs tail /aws/lambda/vyapar-vaani-kyc-validation --follow

# Seller registration
aws logs tail /aws/lambda/vyapar-vaani-seller-registration --follow
```

3. **Verify in DynamoDB**:
```bash
# Check if seller created
aws dynamodb scan \
  --table-name vyapar-vaani-data \
  --filter-expression "entityType = :type" \
  --expression-attribute-values '{":type":{"S":"SELLER_PROFILE"}}'
```

### 6.3 Test Voice Transcription

1. **Send a voice note** in Hindi/Marathi/English
2. **Check logs**:
```bash
aws logs tail /aws/lambda/vyapar-vaani-voice-transcription --follow
```

### 6.4 Test Catalog Creation

1. **Send voice note**: "मैं 5 किलो आम का अचार 200 रुपये में बेचना चाहता हूं"
2. **Check logs**:
```bash
# Intent classification
aws logs tail /aws/lambda/vyapar-vaani-intent-classification --follow

# Entity extraction
aws logs tail /aws/lambda/vyapar-vaani-entity-extraction --follow

# Catalog builder
aws logs tail /aws/lambda/vyapar-vaani-catalog-builder --follow
```

3. **Verify catalog in DynamoDB**:
```bash
aws dynamodb scan \
  --table-name vyapar-vaani-data \
  --filter-expression "entityType = :type" \
  --expression-attribute-values '{":type":{"S":"CATALOG_ITEM"}}'
```

---

## Step 7: Monitor and Debug

### 7.1 CloudWatch Dashboards

Create a dashboard:
```bash
# Go to CloudWatch Console
# Create dashboard: "Vyapar-Vaani-Monitoring"
# Add widgets for:
# - Lambda invocations
# - Lambda errors
# - DynamoDB read/write capacity
# - Step Functions executions
```

### 7.2 Set Up Alarms

```bash
# Lambda error alarm
aws cloudwatch put-metric-alarm \
  --alarm-name vyapar-vaani-lambda-errors \
  --alarm-description "Alert on Lambda errors" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1
```

### 7.3 Debug Common Issues

#### Issue: WhatsApp messages not received
```bash
# Check webhook configuration
aws apigateway get-rest-apis

# Check Lambda permissions
aws lambda get-policy --function-name vyapar-vaani-whatsapp-webhook-handler

# Check EventBridge rules
aws events list-rules --name-prefix vyapar-vaani
```

#### Issue: Transcription failing
```bash
# Check Transcribe permissions
aws iam get-role-policy \
  --role-name VyaparVaaniStack-LambdaExecutionRole \
  --policy-name LambdaExecutionRoleDefaultPolicy

# Check S3 bucket access
aws s3 ls s3://vyapar-vaani-products-YOUR-ACCOUNT-ID/
```

#### Issue: DynamoDB throttling
```bash
# Check table metrics
aws dynamodb describe-table --table-name vyapar-vaani-data

# Increase capacity if needed (or switch to on-demand)
aws dynamodb update-table \
  --table-name vyapar-vaani-data \
  --billing-mode PAY_PER_REQUEST
```

---

## Step 8: Production Checklist

### Security
- [ ] Enable AWS CloudTrail for audit logging
- [ ] Set up AWS WAF for API Gateway
- [ ] Enable S3 bucket versioning
- [ ] Configure KMS key rotation
- [ ] Set up VPC endpoints for private access

### Monitoring
- [ ] Configure CloudWatch alarms
- [ ] Set up SNS notifications for errors
- [ ] Create CloudWatch dashboard
- [ ] Enable X-Ray tracing

### Backup
- [ ] Enable DynamoDB point-in-time recovery
- [ ] Configure S3 cross-region replication
- [ ] Set up automated backups

### Cost Optimization
- [ ] Set S3 lifecycle policies
- [ ] Configure Lambda reserved concurrency
- [ ] Enable DynamoDB auto-scaling
- [ ] Review CloudWatch log retention

---

## Step 9: Local Development

### Run Tests Locally
```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test
npm test -- tests/unit/catalog-builder.test.ts

# Watch mode
npm test -- --watch
```

### Local Lambda Testing
```bash
# Install SAM CLI
brew install aws-sam-cli

# Test Lambda locally
sam local invoke DocumentExtractionLambda \
  --event tests/events/document-extraction-event.json
```

### Debug with VS Code
Create `.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Jest Tests",
      "program": "${workspaceFolder}/node_modules/.bin/jest",
      "args": ["--runInBand", "--no-cache"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

---

## Step 10: Useful Commands

### CDK Commands
```bash
# List all stacks
cdk list

# Show differences
cdk diff

# Deploy specific stack
cdk deploy VyaparVaaniStack

# Destroy stack (careful!)
cdk destroy
```

### AWS CLI Commands
```bash
# List Lambda functions
aws lambda list-functions --query 'Functions[?starts_with(FunctionName, `vyapar-vaani`)].FunctionName'

# Invoke Lambda directly
aws lambda invoke \
  --function-name vyapar-vaani-document-extraction \
  --payload '{"bucket":"test","key":"test.jpg"}' \
  response.json

# Check DynamoDB items
aws dynamodb scan --table-name vyapar-vaani-data --max-items 10

# View S3 buckets
aws s3 ls | grep vyapar-vaani
```

### Logs Commands
```bash
# Tail logs
aws logs tail /aws/lambda/vyapar-vaani-FUNCTION-NAME --follow

# Search logs
aws logs filter-log-events \
  --log-group-name /aws/lambda/vyapar-vaani-FUNCTION-NAME \
  --filter-pattern "ERROR"

# Get recent errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/vyapar-vaani-FUNCTION-NAME \
  --start-time $(date -u -d '1 hour ago' +%s)000 \
  --filter-pattern "ERROR"
```

---

## Troubleshooting

### Problem: CDK Deploy Fails

**Solution 1**: Check AWS credentials
```bash
aws sts get-caller-identity
```

**Solution 2**: Bootstrap CDK
```bash
cdk bootstrap
```

**Solution 3**: Check IAM permissions
- Ensure your AWS user has permissions for:
  - CloudFormation
  - Lambda
  - DynamoDB
  - S3
  - IAM
  - EventBridge
  - Step Functions

### Problem: Lambda Timeout

**Solution**: Increase timeout
```bash
aws lambda update-function-configuration \
  --function-name vyapar-vaani-FUNCTION-NAME \
  --timeout 60
```

### Problem: Out of Memory

**Solution**: Increase memory
```bash
aws lambda update-function-configuration \
  --function-name vyapar-vaani-FUNCTION-NAME \
  --memory-size 1024
```

---

## Next Steps

1. **Set up CI/CD**: Use GitHub Actions or AWS CodePipeline
2. **Add monitoring**: Set up comprehensive CloudWatch dashboards
3. **Load testing**: Use Artillery or Locust to test at scale
4. **Documentation**: Create API documentation with Swagger
5. **User training**: Create guides for rural merchants

---

## Support

For issues:
1. Check CloudWatch logs
2. Review this guide
3. Check AWS service health dashboard
4. Contact AWS support if needed

---

## Cost Estimation

**Monthly costs for 1000 sellers:**
- Lambda: ~$50
- DynamoDB: ~$25
- S3: ~$10
- Transcribe: ~$100
- Bedrock (Claude): ~$200
- Textract: ~$50
- **Total: ~$435/month**

Scale-to-zero architecture means you only pay for what you use!
