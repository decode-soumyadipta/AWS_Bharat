/**
 * Document Extraction Lambda
 * 
 * This Lambda function processes KYC documents (PAN and Aadhar cards)
 * using Amazon Textract to extract text fields and identify document types.
 * 
 * Features:
 * - Downloads documents from S3 using pre-signed URLs
 * - Calls Amazon Textract AnalyzeDocument API with FORMS and TABLES features
 * - Parses Textract response to extract key-value pairs
 * - Identifies document type from extracted text patterns
 * - Extracts structured KYC data with confidence scores
 * 
 * Validates: Requirements 1.1, 1.2
 */

import { GetObjectCommand } from '@aws-sdk/client-s3';
import {
  AnalyzeDocumentCommand,
  type AnalyzeDocumentCommandInput,
  type Block,
  type Document,
} from '@aws-sdk/client-textract';
import { s3Client, textractClient } from '../config/aws-clients';
import {
  DocumentExtractionRequest,
  DocumentExtractionResponse,
  ExtractedKYCData,
  ExtractedField,
  DocumentType,
} from '../models/kyc';

/**
 * PAN card number format: AAAAA9999A
 * - 5 uppercase letters
 * - 4 digits
 * - 1 uppercase letter
 */
const PAN_REGEX = /[A-Z]{5}[0-9]{4}[A-Z]/;

/**
 * Aadhar card number format: 9999 9999 9999 or 999999999999
 * - 12 digits with optional spaces
 */
const AADHAR_REGEX = /\d{4}\s?\d{4}\s?\d{4}/;

/**
 * Lambda handler for document extraction
 */
export const handler = async (
  event: DocumentExtractionRequest
): Promise<DocumentExtractionResponse> => {
  console.log('Document extraction request:', JSON.stringify(event, null, 2));

  try {
    // Parse S3 location from document URL
    const s3Location = parseS3Url(event.documentUrl);
    
    // Call Amazon Textract to analyze the document
    const textractResponse = await analyzeDocument(s3Location.bucket, s3Location.key);
    
    // Extract key-value pairs from Textract response
    const keyValuePairs = extractKeyValuePairs(textractResponse.Blocks || []);
    
    // Extract all text for pattern matching
    const allText = extractAllText(textractResponse.Blocks || []);
    
    // Identify document type and extract structured data
    const extractedData = extractStructuredData(keyValuePairs, allText);
    
    console.log('Extraction successful:', JSON.stringify(extractedData, null, 2));
    
    return {
      success: true,
      data: extractedData,
    };
  } catch (error: any) {
    console.error('Document extraction failed:', error);
    
    return {
      success: false,
      error: {
        code: error.name || 'EXTRACTION_ERROR',
        message: error.message || 'Failed to extract document data',
      },
    };
  }
};

/**
 * Parse S3 URL to extract bucket and key
 */
function parseS3Url(url: string): { bucket: string; key: string } {
  // Handle s3:// URLs
  if (url.startsWith('s3://')) {
    const parts = url.replace('s3://', '').split('/');
    return {
      bucket: parts[0],
      key: parts.slice(1).join('/'),
    };
  }
  
  // Handle https://bucket.s3.region.amazonaws.com/key URLs
  if (url.includes('.s3.') && url.includes('.amazonaws.com/')) {
    const urlObj = new URL(url);
    const bucket = urlObj.hostname.split('.')[0];
    const key = urlObj.pathname.substring(1); // Remove leading /
    return { bucket, key };
  }
  
  // Handle pre-signed URLs
  if (url.includes('X-Amz-Signature')) {
    const urlObj = new URL(url);
    const bucket = urlObj.hostname.split('.')[0];
    const key = urlObj.pathname.substring(1);
    return { bucket, key };
  }
  
  throw new Error(`Invalid S3 URL format: ${url}`);
}

/**
 * Call Amazon Textract to analyze document
 */
async function analyzeDocument(bucket: string, key: string) {
  const params: AnalyzeDocumentCommandInput = {
    Document: {
      S3Object: {
        Bucket: bucket,
        Name: key,
      },
    },
    FeatureTypes: ['FORMS', 'TABLES'],
  };
  
  console.log('Calling Textract with params:', JSON.stringify(params, null, 2));
  
  const command = new AnalyzeDocumentCommand(params);
  const response = await textractClient.send(command);
  
  console.log(`Textract returned ${response.Blocks?.length || 0} blocks`);
  
  return response;
}

/**
 * Extract key-value pairs from Textract blocks
 */
function extractKeyValuePairs(blocks: Block[]): Record<string, ExtractedField> {
  const keyValuePairs: Record<string, ExtractedField> = {};
  
  // Create a map of block IDs to blocks for quick lookup
  const blockMap = new Map<string, Block>();
  blocks.forEach(block => {
    if (block.Id) {
      blockMap.set(block.Id, block);
    }
  });
  
  // Find all KEY_VALUE_SET blocks
  const keyValueBlocks = blocks.filter(
    block => block.BlockType === 'KEY_VALUE_SET'
  );
  
  keyValueBlocks.forEach(block => {
    if (block.EntityTypes?.includes('KEY')) {
      // This is a key block, find its value
      const keyText = getBlockText(block, blockMap);
      const valueBlock = findValueBlock(block, blockMap);
      
      if (keyText && valueBlock) {
        const valueText = getBlockText(valueBlock, blockMap);
        const confidence = Math.min(
          block.Confidence || 0,
          valueBlock.Confidence || 0
        ) / 100;
        
        if (valueText) {
          keyValuePairs[keyText.toLowerCase().trim()] = {
            value: valueText.trim(),
            confidence,
          };
        }
      }
    }
  });
  
  return keyValuePairs;
}

/**
 * Get text content from a block by following CHILD relationships
 */
function getBlockText(block: Block, blockMap: Map<string, Block>): string {
  if (!block.Relationships) {
    return block.Text || '';
  }
  
  const childRelationship = block.Relationships.find(
    rel => rel.Type === 'CHILD'
  );
  
  if (!childRelationship?.Ids) {
    return block.Text || '';
  }
  
  const childTexts: string[] = [];
  childRelationship.Ids.forEach(childId => {
    const childBlock = blockMap.get(childId);
    if (childBlock?.Text) {
      childTexts.push(childBlock.Text);
    }
  });
  
  return childTexts.join(' ');
}

/**
 * Find the value block associated with a key block
 */
function findValueBlock(keyBlock: Block, blockMap: Map<string, Block>): Block | null {
  if (!keyBlock.Relationships) {
    return null;
  }
  
  const valueRelationship = keyBlock.Relationships.find(
    rel => rel.Type === 'VALUE'
  );
  
  if (!valueRelationship?.Ids || valueRelationship.Ids.length === 0) {
    return null;
  }
  
  const valueBlockId = valueRelationship.Ids[0];
  return blockMap.get(valueBlockId) || null;
}

/**
 * Extract all text from document for pattern matching
 */
function extractAllText(blocks: Block[]): string {
  const textBlocks = blocks.filter(block => block.BlockType === 'LINE');
  return textBlocks.map(block => block.Text || '').join(' ');
}

/**
 * Extract structured KYC data from key-value pairs and text
 */
function extractStructuredData(
  keyValuePairs: Record<string, ExtractedField>,
  allText: string
): ExtractedKYCData {
  // Identify document type
  const documentType = identifyDocumentType(keyValuePairs, allText);
  
  // Extract fields based on document type
  const extractedData: ExtractedKYCData = {
    documentType,
    rawFields: keyValuePairs,
    overallConfidence: 0,
  };
  
  if (documentType === 'PAN') {
    extractPANFields(extractedData, keyValuePairs, allText);
  } else if (documentType === 'AADHAR') {
    extractAadharFields(extractedData, keyValuePairs, allText);
  }
  
  // Extract common fields
  extractCommonFields(extractedData, keyValuePairs);
  
  // Calculate overall confidence
  extractedData.overallConfidence = calculateOverallConfidence(extractedData);
  
  return extractedData;
}

/**
 * Identify document type from extracted data
 */
function identifyDocumentType(
  keyValuePairs: Record<string, ExtractedField>,
  allText: string
): DocumentType {
  // Check for PAN indicators
  const hasPANNumber = PAN_REGEX.test(allText);
  const hasPANKeywords = allText.toLowerCase().includes('income tax') ||
                         allText.toLowerCase().includes('permanent account number') ||
                         Object.keys(keyValuePairs).some(key => 
                           key.includes('pan') || key.includes('permanent account')
                         );
  
  if (hasPANNumber || hasPANKeywords) {
    return 'PAN';
  }
  
  // Check for Aadhar indicators
  const hasAadharNumber = AADHAR_REGEX.test(allText);
  const hasAadharKeywords = allText.toLowerCase().includes('aadhaar') ||
                            allText.toLowerCase().includes('aadhar') ||
                            allText.toLowerCase().includes('uidai') ||
                            Object.keys(keyValuePairs).some(key =>
                              key.includes('aadhaar') || key.includes('aadhar')
                            );
  
  if (hasAadharNumber || hasAadharKeywords) {
    return 'AADHAR';
  }
  
  return 'UNKNOWN';
}

/**
 * Extract PAN-specific fields
 */
function extractPANFields(
  data: ExtractedKYCData,
  keyValuePairs: Record<string, ExtractedField>,
  allText: string
): void {
  // Extract PAN number using regex
  const panMatches = allText.match(PAN_REGEX);
  if (panMatches && panMatches.length > 0) {
    data.panNumber = {
      value: panMatches[0],
      confidence: 0.95, // High confidence for regex match
    };
  }
  
  // Try to find PAN number in key-value pairs
  const panKeys = ['pan', 'permanent account number', 'pan number', 'panno'];
  for (const key of panKeys) {
    if (keyValuePairs[key]) {
      const value = keyValuePairs[key].value;
      if (PAN_REGEX.test(value)) {
        data.panNumber = keyValuePairs[key];
        break;
      }
    }
  }
}

/**
 * Extract Aadhar-specific fields
 */
function extractAadharFields(
  data: ExtractedKYCData,
  keyValuePairs: Record<string, ExtractedField>,
  allText: string
): void {
  // Extract Aadhar number using regex
  const aadharMatches = allText.match(AADHAR_REGEX);
  if (aadharMatches && aadharMatches.length > 0) {
    // Remove spaces and format consistently
    const aadharNumber = aadharMatches[0].replace(/\s/g, '');
    data.aadharNumber = {
      value: aadharNumber,
      confidence: 0.95, // High confidence for regex match
    };
  }
  
  // Try to find Aadhar number in key-value pairs
  const aadharKeys = ['aadhaar', 'aadhar', 'aadhaar number', 'aadhar number'];
  for (const key of aadharKeys) {
    if (keyValuePairs[key]) {
      const value = keyValuePairs[key].value.replace(/\s/g, '');
      if (AADHAR_REGEX.test(value)) {
        data.aadharNumber = {
          value,
          confidence: keyValuePairs[key].confidence,
        };
        break;
      }
    }
  }
}

/**
 * Extract common fields (name, DOB, address)
 */
function extractCommonFields(
  data: ExtractedKYCData,
  keyValuePairs: Record<string, ExtractedField>
): void {
  // Extract name
  const nameKeys = ['name', 'full name', 'cardholder name', 'holder name'];
  for (const key of nameKeys) {
    if (keyValuePairs[key]) {
      data.name = keyValuePairs[key];
      break;
    }
  }
  
  // Extract date of birth
  const dobKeys = ['dob', 'date of birth', 'birth date', 'year of birth'];
  for (const key of dobKeys) {
    if (keyValuePairs[key]) {
      data.dateOfBirth = keyValuePairs[key];
      break;
    }
  }
  
  // Extract address
  const addressKeys = ['address', 'permanent address', 'residential address'];
  for (const key of addressKeys) {
    if (keyValuePairs[key]) {
      data.address = keyValuePairs[key];
      break;
    }
  }
}

/**
 * Calculate overall confidence score
 */
function calculateOverallConfidence(data: ExtractedKYCData): number {
  const confidences: number[] = [];
  
  if (data.panNumber) confidences.push(data.panNumber.confidence);
  if (data.aadharNumber) confidences.push(data.aadharNumber.confidence);
  if (data.name) confidences.push(data.name.confidence);
  if (data.dateOfBirth) confidences.push(data.dateOfBirth.confidence);
  if (data.address) confidences.push(data.address.confidence);
  
  if (confidences.length === 0) {
    return 0;
  }
  
  return confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length;
}
