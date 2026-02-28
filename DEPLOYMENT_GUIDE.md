# Marketplace Deployment Guide

This guide walks you through deploying the Vyapar Vaani marketplace buyer interface to AWS.

## Prerequisites

Before deploying, ensure you have:

1. **AWS Account** with appropriate permissions
2. **AWS CLI** installed and configured (`aws configure`)
3. **Node.js** (v20 or later) and npm installed
4. **AWS CDK** bootstrapped in your account
5. **WhatsApp Business API** credentials configured in `.env`

## Quick Start

### Option 1: Automated Deployment (Recommended)

**For Windows (PowerShell):**
```powershell
.\deploy-marketplace.ps1
```

**For Linux/Mac (Bash):**
```bash
chmod +x deploy-marketplace.sh
./deploy-marketplace.sh
```

The script will:
- Build TypeScript backend
- Copy backend files to dist directory
- Deploy CDK stack to AWS
- Extract API URL from deployment outputs
- Update frontend with correct API URL
- Upload frontend files to S3
- Invalidate CloudFront cache
- Display deployment summary with URLs

### Option 2: Manual Deployment

If you prefer manual control:

#### Step 1: Build Backend
```bash
npm run build
```

#### Step 2: Copy Backend Files
```bash
# Windows PowerShell
New-Item -ItemType Directory -Force -Path dist/backend/lambdas
New-Item -ItemType Directory -Force -Path dist/backend/lib
Copy-Item backend/lambdas/*.js dist/backend/lambdas/
Copy-Item backend/lib/*.js dist/backend/lib/

# Linux/Mac
mkdir -p dist/backend/lambdas dist/backend/lib
cp backend/lambdas/*.js dist/backend/lambdas/
cp backend/lib/*.js dist/backend/lib/
```

#### Step 3: Bootstrap CDK (First Time Only)
```bash
npx cdk bootstrap
```

#### Step 4: Deploy Stack
```bash
npx cdk deploy --outputs-file cdk-outputs.json
```

#### Step 5: Update Frontend with API URL

After deployment, extract the API URL from `cdk-outputs.json` and update `marketplace/app.js`:

```javascript
const API_BASE_URL = window.API_BASE_URL || 'YOUR_API_URL_HERE';
```

#### Step 6: Upload Frontend to S3

Get the bucket name from `cdk-outputs.json` and upload:

```bash
aws s3 sync marketplace/ s3://YOUR_BUCKET_NAME/ --exclude "*.md"
```

#### Step 7: Invalidate CloudFront Cache

Get the distribution ID and invalidate:

```bash
aws cloudfront create-invalidation --distribution-id YOUR_DISTRIBUTION_ID --paths "/*"
```

## Deployment Architecture

The deployment creates the following AWS resources:

### Backend Infrastructure
- **DynamoDB Table**: `marketplace-products` - Stores product catalog
- **Lambda Functions**:
  - `marketplace-catalog-sync` - Syncs products from Vyapar Vaani
  - `marketplace-get-products` - API endpoint for product listing
  - `marketplace-submit-order` - API endpoint for order submission
- **API Gateway**: REST API with CORS enabled
- **EventBridge Rule**: Triggers catalog sync on `catalog.created` events

### Frontend Infrastructure
- **S3 Bucket**: Hosts static marketplace files
- **CloudFront Distribution**: CDN for global content delivery
- **Origin Access Identity**: Secures S3 bucket access

## Environment Variables

Ensure these are set in your `.env` file:

```env
# WhatsApp Configuration (Required)
WHATSAPP_ACCESS_TOKEN=your_token_here
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_API_ENDPOINT=https://graph.facebook.com/v22.0

# AWS Configuration (Optional - set by CDK)
AWS_REGION=us-east-1
```

## Post-Deployment Configuration

### 1. Test the Marketplace

Visit the CloudFront URL displayed after deployment:
```
https://d1234567890abc.cloudfront.net
```

### 2. Add Test Products

Use the Vyapar Vaani WhatsApp interface to add products:
1. Send a voice message describing a product
2. Upload a product image
3. Confirm the catalog item
4. Product will automatically sync to marketplace

### 3. Test Order Flow

1. Browse products in marketplace
2. Add items to cart
3. Proceed to checkout
4. Fill in delivery address
5. Submit order
6. Seller receives order via WhatsApp

## Monitoring and Logs

### CloudWatch Logs

View Lambda function logs:
```bash
# Catalog sync logs
aws logs tail /aws/lambda/marketplace-catalog-sync --follow

# Get products logs
aws logs tail /aws/lambda/marketplace-get-products --follow

# Submit order logs
aws logs tail /aws/lambda/marketplace-submit-order --follow
```

### DynamoDB Tables

Check product data:
```bash
aws dynamodb scan --table-name marketplace-products
```

### API Gateway Metrics

Monitor API usage in CloudWatch:
- Request count
- Latency
- Error rates

## Troubleshooting

### Issue: CDK Deploy Fails

**Solution**: Ensure AWS credentials are configured:
```bash
aws configure
aws sts get-caller-identity
```

### Issue: Products Not Syncing

**Solution**: Check EventBridge rule and catalog sync Lambda logs:
```bash
aws logs tail /aws/lambda/marketplace-catalog-sync --follow
```

### Issue: Frontend Shows "Failed to Load Products"

**Solution**: 
1. Check API URL in `marketplace/app.js`
2. Verify API Gateway endpoint is accessible
3. Check CORS configuration in API Gateway

### Issue: Orders Not Reaching Sellers

**Solution**:
1. Verify WhatsApp credentials in `.env`
2. Check submit order Lambda logs
3. Ensure WhatsApp Business API is active

## Updating the Deployment

To update after making changes:

```bash
# Rebuild and redeploy
npm run build
npx cdk deploy

# Update frontend only
aws s3 sync marketplace/ s3://YOUR_BUCKET_NAME/
aws cloudfront create-invalidation --distribution-id YOUR_DISTRIBUTION_ID --paths "/*"
```

## Cost Estimates

Expected monthly costs (low traffic):
- **Lambda**: ~$0.20 (1M requests)
- **API Gateway**: ~$3.50 (1M requests)
- **DynamoDB**: ~$0.25 (on-demand)
- **S3**: ~$0.50 (storage + requests)
- **CloudFront**: ~$1.00 (data transfer)

**Total**: ~$5-10/month for low traffic

## Security Considerations

1. **API Gateway**: CORS enabled for all origins (restrict in production)
2. **S3 Bucket**: Private with CloudFront OAI access only
3. **WhatsApp Credentials**: Stored in environment variables (use AWS Secrets Manager in production)
4. **DynamoDB**: On-demand billing with point-in-time recovery enabled

## Cleanup

To remove all resources:

```bash
npx cdk destroy
```

**Warning**: This will delete all data including products and orders.

## Support

For issues or questions:
1. Check CloudWatch logs
2. Review CDK deployment outputs
3. Verify environment variables
4. Test API endpoints directly

## Next Steps

After successful deployment:
1. Configure custom domain (optional)
2. Set up monitoring alerts
3. Enable AWS WAF for security (optional)
4. Implement user authentication (optional)
5. Add analytics tracking (optional)

---

**Deployment Status**: Ready for production use
**Last Updated**: 2026-02-28
