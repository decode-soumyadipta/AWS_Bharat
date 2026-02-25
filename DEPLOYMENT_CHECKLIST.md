# Vyapar-Vaani Deployment Checklist ✅

Use this checklist to ensure smooth deployment.

---

## Pre-Deployment

### Code Preparation
- [ ] All tests passing (`npm test`)
- [ ] Code coverage > 80%
- [ ] TypeScript compiles without errors (`npm run build`)
- [ ] No console.log statements in production code
- [ ] Environment variables documented

### Git
- [ ] .gitignore updated
- [ ] All changes committed
- [ ] Pushed to remote repository
- [ ] Tagged release version

### AWS Account
- [ ] AWS CLI installed and configured
- [ ] AWS credentials set up (`aws configure`)
- [ ] Correct region selected
- [ ] IAM permissions verified
- [ ] Account ID noted

---

## Deployment

### CDK Setup
- [ ] CDK installed globally (`npm install -g aws-cdk`)
- [ ] CDK bootstrapped (`cdk bootstrap`)
- [ ] CDK synth successful (`cdk synth`)
- [ ] CDK diff reviewed (`cdk diff`)

### Deploy Infrastructure
- [ ] Run `cdk deploy`
- [ ] Deployment completed successfully
- [ ] Stack outputs saved
- [ ] Resource ARNs noted

### Verify Resources Created
- [ ] DynamoDB table exists
- [ ] S3 buckets created (KYC, Products)
- [ ] Lambda functions deployed (7 functions)
- [ ] Step Functions state machines created
- [ ] EventBridge event bus created
- [ ] KMS key created
- [ ] IAM roles configured
- [ ] CloudWatch log groups created

---

## WhatsApp Configuration

### AWS End User Messaging
- [ ] Service accessed in AWS Console
- [ ] WhatsApp channel created
- [ ] Meta Business Account connected
- [ ] Phone number verified
- [ ] API credentials obtained:
  - [ ] Phone Number ID
  - [ ] API Endpoint
  - [ ] Access Token

### Webhook Configuration
- [ ] API Gateway URL obtained
- [ ] Webhook URL configured in AWS End User Messaging
- [ ] Webhook verification successful
- [ ] Test message sent and received

### Lambda Environment Variables
- [ ] WHATSAPP_API_ENDPOINT set
- [ ] WHATSAPP_PHONE_NUMBER_ID set
- [ ] Other environment variables verified

---

## Testing

### Smoke Tests
- [ ] WhatsApp message received
- [ ] Webhook handler logs show activity
- [ ] EventBridge events published
- [ ] DynamoDB writes successful

### Functional Tests
- [ ] KYC flow tested (PAN/Aadhar upload)
- [ ] Voice transcription tested
- [ ] Intent classification tested
- [ ] Catalog creation tested
- [ ] Order notification tested
- [ ] Inventory update tested

### Integration Tests
- [ ] End-to-end KYC flow
- [ ] End-to-end catalog creation
- [ ] End-to-end order management
- [ ] Multi-language support verified

---

## Monitoring Setup

### CloudWatch
- [ ] Dashboard created
- [ ] Alarms configured:
  - [ ] Lambda errors > 5%
  - [ ] DynamoDB throttling
  - [ ] Step Functions failures
  - [ ] Beckn signature failures
- [ ] Log retention set (30 days)
- [ ] Metrics namespace verified

### SNS Notifications
- [ ] SNS topic created for alerts
- [ ] Email subscriptions added
- [ ] Test notification sent

### X-Ray Tracing
- [ ] X-Ray enabled on Lambda functions
- [ ] Service map visible
- [ ] Traces captured

---

## Security

### Encryption
- [ ] KMS key rotation enabled
- [ ] DynamoDB encryption verified
- [ ] S3 bucket encryption verified
- [ ] TLS 1.3 enforced

### IAM
- [ ] Least privilege policies applied
- [ ] No overly permissive roles
- [ ] Service roles properly configured
- [ ] Cross-account access reviewed

### Secrets Management
- [ ] No hardcoded credentials
- [ ] Secrets in environment variables
- [ ] AWS Secrets Manager considered for sensitive data

### Compliance
- [ ] PII anonymization in logs verified
- [ ] Data retention policies set
- [ ] Backup policies configured

---

## Performance

### Lambda Configuration
- [ ] Memory sizes optimized
- [ ] Timeouts appropriate
- [ ] Reserved concurrency set (if needed)
- [ ] Cold start times acceptable

### DynamoDB
- [ ] On-demand billing mode set
- [ ] GSIs created and tested
- [ ] Point-in-time recovery enabled
- [ ] Backup policies configured

### S3
- [ ] Lifecycle policies configured
- [ ] Versioning enabled for critical buckets
- [ ] Cross-region replication considered

---

## Documentation

### Code Documentation
- [ ] README.md updated
- [ ] API documentation complete
- [ ] Architecture diagrams current
- [ ] Deployment guide accurate

### Operational Documentation
- [ ] Runbooks created
- [ ] Troubleshooting guide updated
- [ ] Monitoring guide complete
- [ ] Disaster recovery plan documented

---

## Post-Deployment

### Verification
- [ ] All endpoints responding
- [ ] No errors in CloudWatch logs
- [ ] Metrics being published
- [ ] Alarms in OK state

### Load Testing
- [ ] Load test plan created
- [ ] Load tests executed
- [ ] Performance metrics acceptable
- [ ] Scaling behavior verified

### User Acceptance
- [ ] Test users onboarded
- [ ] Feedback collected
- [ ] Issues documented
- [ ] Improvements planned

---

## Production Readiness

### High Availability
- [ ] Multi-AZ deployment verified
- [ ] Failover tested
- [ ] Backup and restore tested
- [ ] Disaster recovery plan validated

### Cost Optimization
- [ ] Cost allocation tags applied
- [ ] Budget alerts configured
- [ ] Reserved capacity considered
- [ ] Unused resources cleaned up

### Compliance
- [ ] Security audit completed
- [ ] Compliance requirements met
- [ ] Data privacy verified
- [ ] Audit logging enabled

---

## Rollback Plan

### Preparation
- [ ] Previous version tagged
- [ ] Rollback procedure documented
- [ ] Database migration rollback plan
- [ ] Communication plan for rollback

### Rollback Steps
1. [ ] Stop incoming traffic
2. [ ] Revert CDK deployment: `cdk deploy --previous-version`
3. [ ] Verify rollback successful
4. [ ] Resume traffic
5. [ ] Notify stakeholders

---

## Sign-Off

### Technical Lead
- [ ] Code review completed
- [ ] Architecture approved
- [ ] Security review passed
- [ ] Performance acceptable

### Product Owner
- [ ] Features verified
- [ ] User acceptance complete
- [ ] Documentation approved
- [ ] Ready for production

### Operations
- [ ] Monitoring configured
- [ ] Alerts tested
- [ ] Runbooks ready
- [ ] On-call schedule set

---

## Go-Live

### Final Checks
- [ ] All checklist items completed
- [ ] Stakeholders notified
- [ ] Support team briefed
- [ ] Communication plan ready

### Launch
- [ ] Production traffic enabled
- [ ] Monitoring active
- [ ] Team on standby
- [ ] Success metrics tracked

### Post-Launch
- [ ] Monitor for 24 hours
- [ ] Address any issues immediately
- [ ] Collect user feedback
- [ ] Plan next iteration

---

## Success Criteria

System is production-ready when:
- ✅ All tests passing
- ✅ All resources deployed
- ✅ WhatsApp integration working
- ✅ Monitoring and alerts active
- ✅ Security measures in place
- ✅ Documentation complete
- ✅ Team trained
- ✅ Rollback plan ready

---

**Date Deployed:** _______________

**Deployed By:** _______________

**Version:** _______________

**Notes:** _______________________________________________

---

🎉 **Congratulations on your deployment!**
