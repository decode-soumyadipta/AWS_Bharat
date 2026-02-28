# Troubleshooting Guide

This guide helps diagnose and resolve common issues with the Vyapar-Vaani voice-first workflow.

## Table of Contents

1. [Voice Transcription Issues](#voice-transcription-issues)
2. [KYC Document Extraction Issues](#kyc-document-extraction-issues)
3. [State Management Issues](#state-management-issues)
4. [Image Enhancement Issues](#image-enhancement-issues)
5. [WhatsApp Messaging Issues](#whatsapp-messaging-issues)
6. [Language Detection Issues](#language-detection-issues)
7. [Performance Issues](#performance-issues)
8. [Monitoring and Debugging](#monitoring-and-debugging)

---

## Voice Transcription Issues

### Problem: Audio messages not being processed

**Symptoms:**
- User sends voice message but receives no response
- Transcription Lambda times out
- Error messages in CloudWatch logs

**Common Causes:**

1. **Audio file too large (>16MB)**
   ```bash
   # Check audio file size in webhook payload
   aws logs filter-pattern "audioSize" /aws/lambda/webhook-handler
   ```
   **Solution:** System automatically sends error message requesting shorter audio.

2. **Unsupported audio format**
   - Supported: `audio/ogg`, `audio/mpeg`, `audio/amr`
   - Unsupported: `audio/wav`, `audio/flac`
   
   **Solution:** Update media download service to convert formats or request user to resend.

3. **Amazon Transcribe service limits**
   ```bash
   # Check concurrent transcription jobs
   aws transcribe list-transcription-jobs --status IN_PROGRESS
   
   # Check service quotas
   aws service-quotas get-service-quota \
     --service-code transcribe \
     --quota-code L-D8EC5E8A
   ```
   **Solution:** Request quota increase or implement job queuing.

4. **WhatsApp media URL expired**
   - Media URLs expire after 5 minutes
   
   **Solution:** Download media immediately upon webhook receipt.

### Problem: Low transcription accuracy

**Symptoms:**
- Incorrect product names or prices extracted
- Wrong language detected
- Garbled transcription text

**Common Causes:**

1. **Background noise in audio**
   **Solution:** Educate users to record in quiet environment. Consider noise reduction preprocessing.

2. **Regional accent or dialect**
   **Solution:** Use custom vocabulary in Transcribe:
   ```typescript
   await transcribe.startTranscriptionJob({
     TranscriptionJobName: jobName,
     LanguageCode: 'hi-IN',
     Media: { MediaFileUri: s3Uri },
     Settings: {
       VocabularyName: 'hindi-product-terms'
     }
   });
   ```

3. **Mixed language input**
   **Solution:** Enable multi-language detection:
   ```typescript
   LanguageOptions: ['hi-IN', 'mr-IN', 'en-IN'],
   IdentifyLanguage: true
   ```

### Debugging Commands

```bash
# View transcription logs
aws logs tail /aws/lambda/voice-transcription --follow

# Check specific transcription job
aws transcribe get-transcription-job --transcription-job-name <job-name>

# Test transcription with sample audio
npm test -- --testPathPattern="voice-transcription.test"
```

---

## KYC Document Extraction Issues

### Problem: PAN card not recognized

**Symptoms:**
- Document extraction fails
- "Document unclear" error message
- No PAN/Aadhaar extracted

**Common Causes:**

1. **Poor image quality**
   - Blurry, dark, or angled photos
   - Resolution too low (<300 DPI)
   
   **Solution:** System sends guidance message requesting better photo. Consider adding image quality check before Textract.

2. **Invalid document format**
   - Not a PAN card (Aadhaar, license, etc.)
   - Damaged or expired card
   
   **Solution:** Validate document type using Textract confidence scores:
   ```typescript
   const panPattern = /[A-Z]{5}[0-9]{4}[A-Z]{1}/;
   if (!panPattern.test(extractedText)) {
     throw new Error('Invalid PAN format');
   }
   ```

3. **Textract confidence too low**
   ```bash
   # Check confidence scores in logs
   aws logs filter-pattern "confidence" /aws/lambda/document-extraction
   ```
   **Solution:** Increase minimum confidence threshold or request better photo.

### Problem: Aadhaar number not extracted

**Symptoms:**
- PAN extracted successfully but Aadhaar missing
- Seller registration fails

**Common Causes:**

1. **Aadhaar not visible on PAN card**
   - Old PAN cards don't have Aadhaar
   
   **Solution:** Request separate Aadhaar photo or make Aadhaar optional.

2. **Aadhaar number masked**
   - New cards show only last 4 digits
   
   **Solution:** Accept masked Aadhaar or request full number via secure channel.

### Debugging Commands

```bash
# View document extraction logs
aws logs tail /aws/lambda/document-extraction --follow

# Check Textract job status
aws textract get-document-analysis --job-id <job-id>

# Test with sample PAN card
npm test -- --testPathPattern="document-extraction.test"

# View extracted text
aws s3 cp s3://vyapar-vaani-kyc/<phone>/pan.json - | jq '.Blocks[] | select(.BlockType=="LINE") | .Text'
```

---

## State Management Issues

### Problem: User stuck in wrong state

**Symptoms:**
- Workflow not progressing
- User receives "unexpected message type" errors
- State doesn't match user's actions

**Common Causes:**

1. **DynamoDB write failures**
   ```bash
   # Check DynamoDB metrics
   aws cloudwatch get-metric-statistics \
     --namespace AWS/DynamoDB \
     --metric-name UserErrors \
     --dimensions Name=TableName,Value=vyapar-vaani-data \
     --start-time 2024-01-01T00:00:00Z \
     --end-time 2024-01-02T00:00:00Z \
     --period 3600 \
     --statistics Sum
   ```
   **Solution:** Enable DynamoDB auto-scaling or switch to on-demand pricing.

2. **Race condition from concurrent messages**
   - User sends multiple messages quickly
   - State updates conflict
   
   **Solution:** Use conditional writes in DynamoDB:
   ```typescript
   await dynamodb.updateItem({
     TableName: tableName,
     Key: { PK: `USER#${phone}`, SK: 'STATE' },
     UpdateExpression: 'SET #state = :newState',
     ConditionExpression: '#state = :expectedState',
     ExpressionAttributeNames: { '#state': 'state' },
     ExpressionAttributeValues: {
       ':newState': newState,
       ':expectedState': currentState
     }
   });
   ```

3. **State transition validation failed**
   ```bash
   # Check state transition logs
   aws logs filter-pattern "Invalid transition" /aws/lambda/state-manager
   ```
   **Solution:** Review state transition rules in `state-router.ts`.

### Problem: Partial data lost

**Symptoms:**
- User needs to re-enter product information
- Missing fields not tracked correctly

**Common Causes:**

1. **TTL expired**
   - Partial data auto-deleted after 7 days
   
   **Solution:** Increase `STATE_TTL_DAYS` or send reminder before expiry.

2. **Merge logic error**
   - New data overwrites existing values
   
   **Solution:** Fix merge logic to preserve existing fields:
   ```typescript
   const merged = {
     ...existingData,
     ...newData,
     missingFields: existingData.missingFields.filter(
       field => newData[field] !== undefined
     )
   };
   ```

### Debugging Commands

```bash
# Check user state
aws dynamodb get-item \
  --table-name vyapar-vaani-data \
  --key '{"PK":{"S":"USER#<phone>"},"SK":{"S":"STATE"}}'

# Check partial data
aws dynamodb get-item \
  --table-name vyapar-vaani-data \
  --key '{"PK":{"S":"USER#<phone>"},"SK":{"S":"PARTIAL#<timestamp>"}}'

# Reset user state (use carefully!)
aws dynamodb update-item \
  --table-name vyapar-vaani-data \
  --key '{"PK":{"S":"USER#<phone>"},"SK":{"S":"STATE"}}' \
  --update-expression "SET #state = :state" \
  --expression-attribute-names '{"#state":"state"}' \
  --expression-attribute-values '{":state":{"S":"NEW"}}'

# View state transition history
aws logs filter-pattern "State transition" /aws/lambda/state-manager
```

---

## Image Enhancement Issues

### Problem: Image enhancement slow or fails

**Symptoms:**
- Long wait times (>2 minutes)
- Enhancement Lambda times out
- Original image used instead of enhanced

**Common Causes:**

1. **Amazon Titan service throttling**
   ```bash
   # Check Bedrock throttling metrics
   aws cloudwatch get-metric-statistics \
     --namespace AWS/Bedrock \
     --metric-name ModelInvocationThrottles \
     --dimensions Name=ModelId,Value=amazon.titan-image-generator-v2 \
     --start-time 2024-01-01T00:00:00Z \
     --end-time 2024-01-02T00:00:00Z \
     --period 3600 \
     --statistics Sum
   ```
   **Solution:** Request quota increase or implement retry with exponential backoff.

2. **Image too large or invalid format**
   - Max size: 5MB
   - Supported: JPEG, PNG
   
   **Solution:** Resize image before enhancement:
   ```typescript
   import sharp from 'sharp';
   
   const resized = await sharp(imageBuffer)
     .resize(1024, 1024, { fit: 'inside' })
     .jpeg({ quality: 85 })
     .toBuffer();
   ```

3. **Lambda timeout (3 min limit)**
   **Solution:** Increase Lambda timeout or use Step Functions for long-running tasks.

### Problem: Enhanced image quality poor

**Symptoms:**
- Enhanced image looks worse than original
- Artifacts or distortions
- Colors incorrect

**Common Causes:**

1. **Original image quality too low**
   **Solution:** Use original image if quality below threshold.

2. **Enhancement prompt incorrect**
   **Solution:** Refine Titan prompt:
   ```typescript
   const prompt = "Professional product photography, clean white background, " +
                  "good lighting, sharp focus, high quality, commercial grade";
   ```

### Debugging Commands

```bash
# View enhancement logs
aws logs tail /aws/lambda/image-enhancement --follow

# Check Bedrock invocation metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Bedrock \
  --metric-name Invocations \
  --dimensions Name=ModelId,Value=amazon.titan-image-generator-v2 \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --period 3600 \
  --statistics Sum

# Test enhancement with sample image
npm test -- --testPathPattern="image-enhancement.test"

# Disable enhancement temporarily
aws lambda update-function-configuration \
  --function-name image-enhancement \
  --environment "Variables={IMAGE_ENHANCEMENT_ENABLED=false}"
```

---

## WhatsApp Messaging Issues

### Problem: Messages not sending

**Symptoms:**
- No responses to user
- Confirmations not delivered
- Error in message sender logs

**Common Causes:**

1. **Invalid WhatsApp access token**
   ```bash
   # Verify token
   curl -X GET "https://graph.facebook.com/v22.0/me?access_token=$WHATSAPP_ACCESS_TOKEN"
   ```
   **Solution:** Regenerate token in WhatsApp Business API dashboard.

2. **Phone number not registered**
   ```bash
   # Check phone number status
   curl -X GET "https://graph.facebook.com/v22.0/$WHATSAPP_PHONE_NUMBER_ID?access_token=$WHATSAPP_ACCESS_TOKEN"
   ```
   **Solution:** Complete phone number registration in WhatsApp dashboard.

3. **Rate limiting**
   - WhatsApp allows 1000 messages/second per phone number
   
   **Solution:** Implement message queuing with SQS:
   ```typescript
   await sqs.sendMessage({
     QueueUrl: messageQueueUrl,
     MessageBody: JSON.stringify(message),
     DelaySeconds: 0
   });
   ```

4. **Message format invalid**
   - Missing required fields
   - Invalid button format
   
   **Solution:** Validate message structure before sending:
   ```typescript
   const schema = {
     messaging_product: 'whatsapp',
     to: phone,
     type: 'text',
     text: { body: message }
   };
   ```

### Problem: Voice messages not playing

**Symptoms:**
- User receives message but audio doesn't play
- Audio file not found

**Common Causes:**

1. **S3 URL not public**
   ```bash
   # Check S3 bucket policy
   aws s3api get-bucket-policy --bucket vyapar-vaani-products
   ```
   **Solution:** Use presigned URLs:
   ```typescript
   const url = await s3.getSignedUrlPromise('getObject', {
     Bucket: bucket,
     Key: key,
     Expires: 3600 // 1 hour
   });
   ```

2. **Audio format not supported by WhatsApp**
   - Supported: OGG, MP3, AAC
   - Polly outputs: MP3
   
   **Solution:** Ensure Polly uses MP3 format:
   ```typescript
   await polly.synthesizeSpeech({
     Text: text,
     OutputFormat: 'mp3',
     VoiceId: voiceId
   });
   ```

### Debugging Commands

```bash
# View message sender logs
aws logs tail /aws/lambda/whatsapp-message-sender --follow

# Test message sending
npm test -- --testPathPattern="whatsapp-message-sender.test"

# Check WhatsApp API status
curl -X GET "https://graph.facebook.com/v22.0/$WHATSAPP_PHONE_NUMBER_ID?fields=quality_rating,messaging_limit&access_token=$WHATSAPP_ACCESS_TOKEN"

# View sent messages
aws logs filter-pattern "Message sent" /aws/lambda/whatsapp-message-sender
```

---

## Language Detection Issues

### Problem: Wrong language responses

**Symptoms:**
- User speaks Hindi, receives English response
- Prompts in incorrect language
- Language preference not stored

**Common Causes:**

1. **Transcribe language detection confidence low**
   ```bash
   # Check detection confidence
   aws logs filter-pattern "languageCode" /aws/lambda/voice-transcription
   ```
   **Solution:** Set minimum confidence threshold:
   ```typescript
   if (result.languageCode && result.confidence > 0.8) {
     await languageManager.storeLanguagePreference(phone, result.languageCode);
   }
   ```

2. **Mixed language input**
   - User speaks multiple languages in one message
   
   **Solution:** Use primary language or ask user to select:
   ```typescript
   const languages = result.alternatives.map(alt => alt.languageCode);
   if (languages.length > 1) {
     // Send language selection prompt
   }
   ```

3. **Language preference not stored**
   ```bash
   # Check user language in DynamoDB
   aws dynamodb get-item \
     --table-name vyapar-vaani-data \
     --key '{"PK":{"S":"USER#<phone>"},"SK":{"S":"STATE"}}' \
     --projection-expression "language"
   ```
   **Solution:** Ensure language stored on first detection:
   ```typescript
   await stateManager.updateUserState(phone, currentState, {
     language: detectedLanguage
   });
   ```

### Problem: Translation quality poor

**Symptoms:**
- Unnatural phrasing
- Technical terms not translated
- Cultural inappropriateness

**Common Causes:**

1. **Using literal translations**
   **Solution:** Use natural, conversational templates:
   ```typescript
   // Bad
   'hi-IN': 'कृपया उत्पाद नाम प्रदान करें'
   
   // Good
   'hi-IN': 'उत्पाद का नाम क्या है?'
   ```

2. **Missing context**
   **Solution:** Provide context in prompts:
   ```typescript
   'hi-IN': 'आपने कहा कि आप ${productName} बेचना चाहते हैं। कीमत क्या है?'
   ```

### Debugging Commands

```bash
# View language detection logs
aws logs filter-pattern "detectedLanguage" /aws/lambda/voice-transcription

# Test language detection
npm test -- --testPathPattern="language-manager.test"

# Update user language manually
aws dynamodb update-item \
  --table-name vyapar-vaani-data \
  --key '{"PK":{"S":"USER#<phone>"},"SK":{"S":"STATE"}}' \
  --update-expression "SET #lang = :lang" \
  --expression-attribute-names '{"#lang":"language"}' \
  --expression-attribute-values '{":lang":{"S":"hi-IN"}}'
```

---

## Performance Issues

### Problem: High latency

**Symptoms:**
- Slow response times (>10 seconds)
- User complaints about delays
- Lambda duration metrics high

**Common Causes:**

1. **Lambda cold starts**
   ```bash
   # Check cold start metrics
   aws cloudwatch get-metric-statistics \
     --namespace AWS/Lambda \
     --metric-name Duration \
     --dimensions Name=FunctionName,Value=webhook-handler \
     --start-time 2024-01-01T00:00:00Z \
     --end-time 2024-01-02T00:00:00Z \
     --period 3600 \
     --statistics Average,Maximum
   ```
   **Solution:** Enable provisioned concurrency:
   ```bash
   aws lambda put-provisioned-concurrency-config \
     --function-name webhook-handler \
     --provisioned-concurrent-executions 5
   ```

2. **Sequential processing**
   - Operations executed one after another
   
   **Solution:** Use parallel processing:
   ```typescript
   const [transcription, userState] = await Promise.all([
     transcribeAudio(audioUrl),
     stateManager.getUserState(phone)
   ]);
   ```

3. **Large payload sizes**
   - EventBridge events too large
   
   **Solution:** Store large data in S3, pass reference:
   ```typescript
   await s3.putObject({
     Bucket: bucket,
     Key: `temp/${messageId}.json`,
     Body: JSON.stringify(largeData)
   });
   
   await eventBridge.putEvents({
     Entries: [{
       Detail: JSON.stringify({ s3Key: `temp/${messageId}.json` })
     }]
   });
   ```

### Problem: High costs

**Symptoms:**
- AWS bill higher than expected
- Bedrock costs excessive
- S3 storage growing rapidly

**Solutions:**

1. **Cache Polly responses**
   ```typescript
   const cacheKey = `${language}/${promptKey}`;
   let audioUrl = await cache.get(cacheKey);
   
   if (!audioUrl) {
     audioUrl = await generateSpeech(text, language);
     await cache.set(cacheKey, audioUrl, 86400); // 24 hours
   }
   ```

2. **Optimize Bedrock usage**
   - Use Claude 3 Haiku (cheapest)
   - Reduce token count in prompts
   - Batch requests when possible

3. **Implement S3 lifecycle policies**
   ```json
   {
     "Rules": [{
       "Id": "ArchiveOldMedia",
       "Status": "Enabled",
       "Transitions": [{
         "Days": 30,
         "StorageClass": "GLACIER"
       }],
       "Expiration": {
         "Days": 365
       }
     }]
   }
   ```

### Debugging Commands

```bash
# View Lambda performance metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=voice-handler \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --period 3600 \
  --statistics Average,Maximum,Minimum

# Check DynamoDB throttling
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name ThrottledRequests \
  --dimensions Name=TableName,Value=vyapar-vaani-data \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --period 3600 \
  --statistics Sum

# View cost breakdown
aws ce get-cost-and-usage \
  --time-period Start=2024-01-01,End=2024-01-31 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=SERVICE
```

---

## Monitoring and Debugging

### CloudWatch Dashboards

Create custom dashboard:
```bash
aws cloudwatch put-dashboard \
  --dashboard-name VyaparVaaniMetrics \
  --dashboard-body file://dashboard.json
```

**Key Metrics to Monitor:**
- Lambda invocations and errors
- DynamoDB read/write capacity
- Bedrock invocations and throttles
- S3 storage and requests
- EventBridge events published

### CloudWatch Alarms

Set up critical alarms:
```bash
# High error rate
aws cloudwatch put-metric-alarm \
  --alarm-name VyaparVaaniHighErrorRate \
  --alarm-description "Alert when error rate exceeds 5%" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 0.05 \
  --comparison-operator GreaterThanThreshold

# DynamoDB throttling
aws cloudwatch put-metric-alarm \
  --alarm-name VyaparVaaniDynamoDBThrottling \
  --alarm-description "Alert on DynamoDB throttling" \
  --metric-name ThrottledRequests \
  --namespace AWS/DynamoDB \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold
```

### X-Ray Tracing

Enable X-Ray for all Lambdas:
```typescript
import AWSXRay from 'aws-xray-sdk-core';
const AWS = AWSXRay.captureAWS(require('aws-sdk'));
```

View traces:
```bash
# Get service map
aws xray get-service-graph \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z

# Get trace summaries
aws xray get-trace-summaries \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --filter-expression 'error = true'
```

### Debug Mode

Enable verbose logging:
```bash
# Set LOG_LEVEL for specific Lambda
aws lambda update-function-configuration \
  --function-name voice-handler \
  --environment "Variables={LOG_LEVEL=DEBUG}"
```

### CloudWatch Logs Insights

Useful queries:

**Find errors:**
```
fields @timestamp, @message
| filter @message like /ERROR/
| sort @timestamp desc
| limit 100
```

**Track state transitions:**
```
fields @timestamp, phone, previousState, newState
| filter detailType = "user.state.changed"
| sort @timestamp desc
```

**Analyze latency:**
```
fields @timestamp, @duration
| stats avg(@duration), max(@duration), min(@duration) by bin(5m)
```

---

## Getting Help

### Documentation
- [Environment Variables](ENVIRONMENT_VARIABLES.md)
- [Requirements](../.kiro/specs/voice-first-workflow/requirements.md)
- [Design](../.kiro/specs/voice-first-workflow/design.md)

### Support Channels
- **GitHub Issues:** Report bugs and feature requests
- **AWS Support:** Service-specific issues (Bedrock, Transcribe, etc.)
- **CloudWatch Logs:** Detailed error messages and stack traces

### Escalation Path

1. **Check logs:** CloudWatch Logs for error details
2. **Review metrics:** CloudWatch metrics for patterns
3. **Test locally:** Run unit tests to reproduce
4. **Check AWS status:** [AWS Service Health Dashboard](https://status.aws.amazon.com/)
5. **Contact support:** AWS Support or GitHub Issues

---

**Last Updated:** 2024-01-27
