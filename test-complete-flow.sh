#!/bin/bash

# Complete End-to-End Test for Vyapar-Vaani
# This script tests the full flow: WhatsApp → Intent → Entity → Response

echo "🧪 Testing Vyapar-Vaani Complete Flow"
echo "======================================"
echo ""

# Test 1: Hindi - Create Catalog
echo "📝 Test 1: Hindi - Create Catalog Intent"
curl -X POST https://m6sqkaco93.execute-api.us-east-1.amazonaws.com/whatsapp/webhook \
  -H 'Content-Type: application/json' \
  -d '{
    "message": {
      "id": "test-hindi-catalog",
      "from": "916291024334",
      "timestamp": 1234567890,
      "type": "text",
      "text": {
        "body": "मैं आम बेचना चाहता हूं, 100 रुपये प्रति किलो, 50 किलो स्टॉक है"
      }
    }
  }'
echo -e "\n"

sleep 2

# Test 2: English - Update Inventory
echo "📝 Test 2: English - Update Inventory Intent"
curl -X POST https://m6sqkaco93.execute-api.us-east-1.amazonaws.com/whatsapp/webhook \
  -H 'Content-Type: application/json' \
  -d '{
    "message": {
      "id": "test-english-inventory",
      "from": "916291024334",
      "timestamp": 1234567890,
      "type": "text",
      "text": {
        "body": "Update mango stock to 75 kg"
      }
    }
  }'
echo -e "\n"

sleep 2

# Test 3: Hindi - Accept Order
echo "📝 Test 3: Hindi - Accept Order Intent"
curl -X POST https://m6sqkaco93.execute-api.us-east-1.amazonaws.com/whatsapp/webhook \
  -H 'Content-Type: application/json' \
  -d '{
    "message": {
      "id": "test-hindi-order",
      "from": "916291024334",
      "timestamp": 1234567890,
      "type": "text",
      "text": {
        "body": "मैं ऑर्डर स्वीकार करना चाहता हूं"
      }
    }
  }'
echo -e "\n"

echo "⏳ Waiting 10 seconds for processing..."
sleep 10

echo ""
echo "📊 Checking Logs..."
echo "==================="
echo ""

echo "🎯 Intent Classification:"
aws logs tail /aws/lambda/vyapar-vaani-intent-classification --since 2m --format short | grep "Claude response" -A 3 | tail -15

echo ""
echo "🔍 Entity Extraction:"
aws logs tail /aws/lambda/vyapar-vaani-entity-extraction --since 2m --format short | grep "Claude response" -A 5 | tail -20

echo ""
echo "📱 WhatsApp Messages Sent:"
aws logs tail /aws/lambda/vyapar-vaani-whatsapp-sender --since 2m --format short | grep "Message sent successfully" -A 2 | tail -15

echo ""
echo "✅ Test Complete!"
echo "Check your WhatsApp (916291024334) for responses"
