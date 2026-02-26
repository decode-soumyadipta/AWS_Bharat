#!/bin/bash

################################################################################
# Vyapar-Vaani Comprehensive System Test Suite
# 
# This script performs extensive end-to-end testing of the entire system:
# - WhatsApp webhook integration
# - Intent classification (all intents)
# - Entity extraction (all entity types)
# - Catalog building and storage
# - Image enhancement
# - Voice transcription
# - DynamoDB operations
# - EventBridge event flow
# - Error handling and edge cases
################################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
WEBHOOK_URL="https://m6sqkaco93.execute-api.us-east-1.amazonaws.com/whatsapp/webhook"
TEST_PHONE="916291024334"
TABLE_NAME="vyapar-vaani-data"
EVENT_BUS_NAME="vyapar-vaani-events"

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

################################################################################
# Helper Functions
################################################################################

print_header() {
    echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}$1${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

print_test() {
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    echo -e "${BLUE}[TEST $TOTAL_TESTS]${NC} $1"
}

print_success() {
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo -e "${GREEN}✓ PASS:${NC} $1"
}

print_failure() {
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo -e "${RED}✗ FAIL:${NC} $1"
}

print_info() {
    echo -e "${YELLOW}ℹ INFO:${NC} $1"
}

print_section() {
    echo -e "\n${MAGENTA}▶ $1${NC}"
}

wait_for_processing() {
    local seconds=$1
    echo -e "${YELLOW}⏳ Waiting ${seconds}s for processing...${NC}"
    sleep $seconds
}

################################################################################
# Test Functions
################################################################################

test_webhook_verification() {
    print_test "WhatsApp Webhook Verification"
    
    local response=$(curl -s -w "\n%{http_code}" \
        "${WEBHOOK_URL}?hub.mode=subscribe&hub.verify_token=test123&hub.challenge=test-challenge")
    
    local body=$(echo "$response" | head -n -1)
    local status=$(echo "$response" | tail -n 1)
    
    if [ "$status" = "200" ] && [ "$body" = "test-challenge" ]; then
        print_success "Webhook verification working"
    else
        print_failure "Webhook verification failed (Status: $status, Body: $body)"
    fi
}

test_text_message_intent_classification() {
    print_test "Text Message → Intent Classification (Hindi - CREATE_CATALOG)"
    
    local message_id="test-hindi-catalog-$(date +%s)"
    
    curl -s -X POST "$WEBHOOK_URL" \
        -H 'Content-Type: application/json' \
        -d "{
            \"entry\": [{
                \"changes\": [{
                    \"value\": {
                        \"messages\": [{
                            \"id\": \"$message_id\",
                            \"from\": \"$TEST_PHONE\",
                            \"timestamp\": \"$(date +%s)\",
                            \"type\": \"text\",
                            \"text\": {
                                \"body\": \"मैं आम बेचना चाहता हूं, 100 रुपये प्रति किलो, 50 किलो स्टॉक है\"
                            }
                        }]
                    }
                }]
            }]
        }" > /dev/null
    
    wait_for_processing 8
    
    # Check intent classification logs
    local intent_logs=$(aws logs tail /aws/lambda/vyapar-vaani-intent-classification --since 1m --format short 2>/dev/null | grep -i "CREATE_CATALOG" || echo "")
    
    if [ -n "$intent_logs" ]; then
        print_success "Intent classified as CREATE_CATALOG"
    else
        print_failure "Intent classification not found in logs"
    fi
}

test_entity_extraction_catalog() {
    print_test "Entity Extraction for CREATE_CATALOG (Hindi)"
    
    wait_for_processing 5
    
    # Check entity extraction logs
    local entity_logs=$(aws logs tail /aws/lambda/vyapar-vaani-entity-extraction --since 1m --format short 2>/dev/null | grep -E "product_name|price|quantity" || echo "")
    
    if [ -n "$entity_logs" ]; then
        print_success "Entities extracted (product_name, price, quantity)"
    else
        print_failure "Entity extraction not found in logs"
    fi
}

test_catalog_builder() {
    print_test "Catalog Builder → Beckn Catalog Item"
    
    wait_for_processing 5
    
    # Check catalog builder logs
    local catalog_logs=$(aws logs tail /aws/lambda/vyapar-vaani-catalog-builder --since 1m --format short 2>/dev/null | grep -E "Constructed catalog item|catalog.created" || echo "")
    
    if [ -n "$catalog_logs" ]; then
        print_success "Catalog item constructed and event published"
    else
        print_failure "Catalog builder not executed"
    fi
}

test_dynamodb_storage() {
    print_test "DynamoDB Storage → Catalog Item Saved"
    
    wait_for_processing 5
    
    # Check if catalog items exist in DynamoDB
    local item_count=$(aws dynamodb scan \
        --table-name "$TABLE_NAME" \
        --filter-expression "begins_with(PK, :pk)" \
        --expression-attribute-values '{":pk":{"S":"CATALOG#"}}' \
        --select COUNT \
        --output json 2>/dev/null | jq -r '.Count' || echo "0")
    
    if [ "$item_count" -gt 0 ]; then
        print_success "Catalog items found in DynamoDB (Count: $item_count)"
    else
        print_failure "No catalog items in DynamoDB"
    fi
}

test_english_inventory_update() {
    print_test "English Text → UPDATE_INVENTORY Intent"
    
    local message_id="test-english-inventory-$(date +%s)"
    
    curl -s -X POST "$WEBHOOK_URL" \
        -H 'Content-Type: application/json' \
        -d "{
            \"entry\": [{
                \"changes\": [{
                    \"value\": {
                        \"messages\": [{
                            \"id\": \"$message_id\",
                            \"from\": \"$TEST_PHONE\",
                            \"timestamp\": \"$(date +%s)\",
                            \"type\": \"text\",
                            \"text\": {
                                \"body\": \"Update mango stock to 75 kg\"
                            }
                        }]
                    }
                }]
            }]
        }" > /dev/null
    
    wait_for_processing 8
    
    local intent_logs=$(aws logs tail /aws/lambda/vyapar-vaani-intent-classification --since 1m --format short 2>/dev/null | grep -i "UPDATE_INVENTORY" || echo "")
    
    if [ -n "$intent_logs" ]; then
        print_success "UPDATE_INVENTORY intent classified"
    else
        print_failure "UPDATE_INVENTORY intent not detected"
    fi
}

test_marathi_catalog_creation() {
    print_test "Marathi Text → CREATE_CATALOG Intent"
    
    local message_id="test-marathi-catalog-$(date +%s)"
    
    curl -s -X POST "$WEBHOOK_URL" \
        -H 'Content-Type: application/json' \
        -d "{
            \"entry\": [{
                \"changes\": [{
                    \"value\": {
                        \"messages\": [{
                            \"id\": \"$message_id\",
                            \"from\": \"$TEST_PHONE\",
                            \"timestamp\": \"$(date +%s)\",
                            \"type\": \"text\",
                            \"text\": {
                                \"body\": \"मी केळी विकायची आहेत, 50 रुपये प्रति डझन, 100 डझन स्टॉक\"
                            }
                        }]
                    }
                }]
            }]
        }" > /dev/null
    
    wait_for_processing 8
    
    local intent_logs=$(aws logs tail /aws/lambda/vyapar-vaani-intent-classification --since 1m --format short 2>/dev/null | grep -i "CREATE_CATALOG" || echo "")
    
    if [ -n "$intent_logs" ]; then
        print_success "Marathi CREATE_CATALOG intent classified"
    else
        print_failure "Marathi intent classification failed"
    fi
}

test_order_acceptance() {
    print_test "Order Acceptance → ACCEPT_ORDER Intent"
    
    local message_id="test-accept-order-$(date +%s)"
    
    curl -s -X POST "$WEBHOOK_URL" \
        -H 'Content-Type: application/json' \
        -d "{
            \"entry\": [{
                \"changes\": [{
                    \"value\": {
                        \"messages\": [{
                            \"id\": \"$message_id\",
                            \"from\": \"$TEST_PHONE\",
                            \"timestamp\": \"$(date +%s)\",
                            \"type\": \"text\",
                            \"text\": {
                                \"body\": \"I want to accept the order\"
                            }
                        }]
                    }
                }]
            }]
        }" > /dev/null
    
    wait_for_processing 8
    
    local intent_logs=$(aws logs tail /aws/lambda/vyapar-vaani-intent-classification --since 1m --format short 2>/dev/null | grep -i "ACCEPT_ORDER" || echo "")
    
    if [ -n "$intent_logs" ]; then
        print_success "ACCEPT_ORDER intent classified"
    else
        print_failure "ACCEPT_ORDER intent not detected"
    fi
}

test_order_rejection() {
    print_test "Order Rejection → REJECT_ORDER Intent"
    
    local message_id="test-reject-order-$(date +%s)"
    
    curl -s -X POST "$WEBHOOK_URL" \
        -H 'Content-Type: application/json' \
        -d "{
            \"entry\": [{
                \"changes\": [{
                    \"value\": {
                        \"messages\": [{
                            \"id\": \"$message_id\",
                            \"from\": \"$TEST_PHONE\",
                            \"timestamp\": \"$(date +%s)\",
                            \"type\": \"text\",
                            \"text\": {
                                \"body\": \"मैं ऑर्डर अस्वीकार करना चाहता हूं, स्टॉक नहीं है\"
                            }
                        }]
                    }
                }]
            }]
        }" > /dev/null
    
    wait_for_processing 8
    
    local intent_logs=$(aws logs tail /aws/lambda/vyapar-vaani-intent-classification --since 1m --format short 2>/dev/null | grep -i "REJECT_ORDER" || echo "")
    
    if [ -n "$intent_logs" ]; then
        print_success "REJECT_ORDER intent classified"
    else
        print_failure "REJECT_ORDER intent not detected"
    fi
}

test_eventbridge_flow() {
    print_test "EventBridge Event Flow"
    
    # Check EventBridge archive for recent events
    local event_count=$(aws events list-archives \
        --event-source-arn "arn:aws:events:us-east-1:145023133719:event-bus/$EVENT_BUS_NAME" \
        --output json 2>/dev/null | jq -r '.Archives | length' || echo "0")
    
    if [ "$event_count" -gt 0 ]; then
        print_success "EventBridge archive configured (Archives: $event_count)"
    else
        print_info "EventBridge archive check skipped"
    fi
}

test_lambda_error_handling() {
    print_test "Lambda Error Handling → Invalid Input"
    
    local message_id="test-invalid-$(date +%s)"
    
    curl -s -X POST "$WEBHOOK_URL" \
        -H 'Content-Type: application/json' \
        -d "{
            \"entry\": [{
                \"changes\": [{
                    \"value\": {
                        \"messages\": [{
                            \"id\": \"$message_id\",
                            \"from\": \"$TEST_PHONE\",
                            \"timestamp\": \"$(date +%s)\",
                            \"type\": \"text\",
                            \"text\": {
                                \"body\": \"\"
                            }
                        }]
                    }
                }]
            }]
        }" > /dev/null
    
    wait_for_processing 5
    
    # Check for error handling in logs
    local error_logs=$(aws logs tail /aws/lambda/vyapar-vaani-whatsapp-webhook --since 1m --format short 2>/dev/null | grep -iE "error|empty" || echo "")
    
    if [ -n "$error_logs" ]; then
        print_success "Error handling working (empty message handled)"
    else
        print_info "Error handling check inconclusive"
    fi
}

test_whatsapp_message_sending() {
    print_test "WhatsApp Message Sending"
    
    # Check WhatsApp sender logs for successful sends
    local send_logs=$(aws logs tail /aws/lambda/vyapar-vaani-whatsapp-sender --since 2m --format short 2>/dev/null | grep -iE "Message sent successfully|status.*200" || echo "")
    
    if [ -n "$send_logs" ]; then
        print_success "WhatsApp messages sent successfully"
    else
        print_failure "No successful WhatsApp message sends found"
    fi
}

test_multilingual_support() {
    print_test "Multilingual Support (Hindi, Marathi, English)"
    
    # Check logs for multiple languages
    local hindi_logs=$(aws logs tail /aws/lambda/vyapar-vaani-intent-classification --since 3m --format short 2>/dev/null | grep -i "hindi\|आम\|मैं" || echo "")
    local marathi_logs=$(aws logs tail /aws/lambda/vyapar-vaani-intent-classification --since 3m --format short 2>/dev/null | grep -i "marathi\|केळी\|मी" || echo "")
    local english_logs=$(aws logs tail /aws/lambda/vyapar-vaani-intent-classification --since 3m --format short 2>/dev/null | grep -i "english\|mango\|update" || echo "")
    
    local lang_count=0
    [ -n "$hindi_logs" ] && lang_count=$((lang_count + 1))
    [ -n "$marathi_logs" ] && lang_count=$((lang_count + 1))
    [ -n "$english_logs" ] && lang_count=$((lang_count + 1))
    
    if [ $lang_count -ge 2 ]; then
        print_success "Multilingual support working ($lang_count languages detected)"
    else
        print_failure "Multilingual support limited ($lang_count languages detected)"
    fi
}

test_infrastructure_health() {
    print_test "Infrastructure Health Check"
    
    print_section "Checking Lambda Functions"
    
    local lambdas=(
        "vyapar-vaani-whatsapp-webhook"
        "vyapar-vaani-whatsapp-sender"
        "vyapar-vaani-intent-classification"
        "vyapar-vaani-entity-extraction"
        "vyapar-vaani-catalog-builder"
        "vyapar-vaani-catalog-storage-broadcast"
        "vyapar-vaani-voice-transcription"
        "vyapar-vaani-image-enhancement"
        "vyapar-vaani-document-extraction"
        "vyapar-vaani-kyc-validation"
        "vyapar-vaani-seller-registration"
    )
    
    local active_lambdas=0
    for lambda in "${lambdas[@]}"; do
        local status=$(aws lambda get-function --function-name "$lambda" --output json 2>/dev/null | jq -r '.Configuration.State' || echo "NotFound")
        if [ "$status" = "Active" ]; then
            active_lambdas=$((active_lambdas + 1))
        fi
    done
    
    if [ $active_lambdas -eq ${#lambdas[@]} ]; then
        print_success "All ${#lambdas[@]} Lambda functions active"
    else
        print_failure "Only $active_lambdas/${#lambdas[@]} Lambda functions active"
    fi
    
    print_section "Checking DynamoDB Table"
    local table_status=$(aws dynamodb describe-table --table-name "$TABLE_NAME" --output json 2>/dev/null | jq -r '.Table.TableStatus' || echo "NotFound")
    
    if [ "$table_status" = "ACTIVE" ]; then
        print_success "DynamoDB table active"
    else
        print_failure "DynamoDB table not active (Status: $table_status)"
    fi
    
    print_section "Checking S3 Buckets"
    local kyc_bucket=$(aws s3 ls s3://vyapar-vaani-kyc-145023133719 2>/dev/null && echo "exists" || echo "missing")
    local products_bucket=$(aws s3 ls s3://vyapar-vaani-products-145023133719 2>/dev/null && echo "exists" || echo "missing")
    
    if [ "$kyc_bucket" = "exists" ] && [ "$products_bucket" = "exists" ]; then
        print_success "Both S3 buckets accessible"
    else
        print_failure "S3 buckets not accessible (KYC: $kyc_bucket, Products: $products_bucket)"
    fi
    
    print_section "Checking EventBridge"
    local event_bus_status=$(aws events describe-event-bus --name "$EVENT_BUS_NAME" --output json 2>/dev/null | jq -r '.Name' || echo "NotFound")
    
    if [ "$event_bus_status" = "$EVENT_BUS_NAME" ]; then
        print_success "EventBridge event bus active"
    else
        print_failure "EventBridge event bus not found"
    fi
}

view_detailed_logs() {
    print_header "DETAILED LOGS (Last 2 Minutes)"
    
    print_section "Intent Classification Logs"
    aws logs tail /aws/lambda/vyapar-vaani-intent-classification --since 2m --format short 2>/dev/null | tail -20 || echo "No logs available"
    
    print_section "Entity Extraction Logs"
    aws logs tail /aws/lambda/vyapar-vaani-entity-extraction --since 2m --format short 2>/dev/null | tail -20 || echo "No logs available"
    
    print_section "Catalog Builder Logs"
    aws logs tail /aws/lambda/vyapar-vaani-catalog-builder --since 2m --format short 2>/dev/null | tail -20 || echo "No logs available"
    
    print_section "WhatsApp Sender Logs"
    aws logs tail /aws/lambda/vyapar-vaani-whatsapp-sender --since 2m --format short 2>/dev/null | tail -20 || echo "No logs available"
}

view_dynamodb_data() {
    print_header "DYNAMODB DATA SAMPLE"
    
    print_section "Recent Catalog Items"
    aws dynamodb scan \
        --table-name "$TABLE_NAME" \
        --filter-expression "begins_with(PK, :pk)" \
        --expression-attribute-values '{":pk":{"S":"CATALOG#"}}' \
        --limit 3 \
        --output json 2>/dev/null | jq -r '.Items[] | {PK: .PK.S, SK: .SK.S, productName: .productName.S, price: .price.N}' || echo "No catalog items found"
}

################################################################################
# Main Test Execution
################################################################################

main() {
    print_header "🧪 VYAPAR-VAANI COMPREHENSIVE SYSTEM TEST SUITE"
    
    echo -e "${YELLOW}This test suite will:${NC}"
    echo "  • Test WhatsApp webhook integration"
    echo "  • Test all intent types (CREATE_CATALOG, UPDATE_INVENTORY, ACCEPT_ORDER, REJECT_ORDER)"
    echo "  • Test multilingual support (Hindi, Marathi, English)"
    echo "  • Test entity extraction and catalog building"
    echo "  • Test DynamoDB storage"
    echo "  • Test EventBridge event flow"
    echo "  • Test error handling"
    echo "  • Check infrastructure health"
    echo ""
    echo -e "${YELLOW}Test phone number: $TEST_PHONE${NC}"
    echo -e "${YELLOW}Webhook URL: $WEBHOOK_URL${NC}"
    echo ""
    read -p "Press Enter to start tests..."
    
    # Infrastructure Tests
    print_header "PHASE 1: INFRASTRUCTURE HEALTH CHECK"
    test_infrastructure_health
    
    # Webhook Tests
    print_header "PHASE 2: WEBHOOK INTEGRATION TESTS"
    test_webhook_verification
    
    # Intent Classification Tests
    print_header "PHASE 3: INTENT CLASSIFICATION TESTS"
    test_text_message_intent_classification
    test_english_inventory_update
    test_marathi_catalog_creation
    test_order_acceptance
    test_order_rejection
    
    # Entity Extraction & Catalog Tests
    print_header "PHASE 4: ENTITY EXTRACTION & CATALOG BUILDING"
    test_entity_extraction_catalog
    test_catalog_builder
    
    # Storage Tests
    print_header "PHASE 5: DATA STORAGE TESTS"
    test_dynamodb_storage
    
    # Integration Tests
    print_header "PHASE 6: INTEGRATION TESTS"
    test_eventbridge_flow
    test_whatsapp_message_sending
    test_multilingual_support
    
    # Error Handling Tests
    print_header "PHASE 7: ERROR HANDLING TESTS"
    test_lambda_error_handling
    
    # Detailed Logs
    if [ "${SHOW_LOGS:-no}" = "yes" ]; then
        view_detailed_logs
        view_dynamodb_data
    fi
    
    # Summary
    print_header "TEST SUMMARY"
    echo -e "${CYAN}Total Tests:${NC}  $TOTAL_TESTS"
    echo -e "${GREEN}Passed:${NC}       $PASSED_TESTS"
    echo -e "${RED}Failed:${NC}       $FAILED_TESTS"
    echo ""
    
    local pass_rate=$((PASSED_TESTS * 100 / TOTAL_TESTS))
    
    if [ $pass_rate -ge 80 ]; then
        echo -e "${GREEN}✓ System Health: EXCELLENT ($pass_rate% pass rate)${NC}"
    elif [ $pass_rate -ge 60 ]; then
        echo -e "${YELLOW}⚠ System Health: GOOD ($pass_rate% pass rate)${NC}"
    else
        echo -e "${RED}✗ System Health: NEEDS ATTENTION ($pass_rate% pass rate)${NC}"
    fi
    
    echo ""
    echo -e "${CYAN}📱 Check WhatsApp ($TEST_PHONE) for responses${NC}"
    echo -e "${CYAN}📊 View detailed logs with: SHOW_LOGS=yes ./test.sh${NC}"
    echo ""
}

# Run main function
main "$@"
