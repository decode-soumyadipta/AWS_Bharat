
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

const PAN_REGEX = /[A-Z]{5}[0-9]{4}[A-Z]/;

const AADHAR_REGEX = /\d{4}\s?\d{4}\s?\d{4}/;

export const handler = async (
  event: DocumentExtractionRequest
): Promise<DocumentExtractionResponse> => {
  console.log('Document extraction request:', JSON.stringify(event, null, 2));

  try {

    const s3Location = parseS3Url(event.documentUrl);

    const textractResponse = await analyzeDocument(s3Location.bucket, s3Location.key);

    const keyValuePairs = extractKeyValuePairs(textractResponse.Blocks || []);

    const allText = extractAllText(textractResponse.Blocks || []);

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

function parseS3Url(url: string): { bucket: string; key: string } {

  if (url.startsWith('s3://')) {
    const parts = url.replace('s3://', '').split('/');
    return {
      bucket: parts[0],
      key: parts.slice(1).join('/'),
    };
  }

  if (url.includes('.s3.') && url.includes('.amazonaws.com/')) {
    const urlObj = new URL(url);
    const bucket = urlObj.hostname.split('.')[0];
    const key = urlObj.pathname.substring(1); 
    return { bucket, key };
  }

  if (url.includes('X-Amz-Signature')) {
    const urlObj = new URL(url);
    const bucket = urlObj.hostname.split('.')[0];
    const key = urlObj.pathname.substring(1);
    return { bucket, key };
  }

  throw new Error(`Invalid S3 URL format: ${url}`);
}

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

function extractKeyValuePairs(blocks: Block[]): Record<string, ExtractedField> {
  const keyValuePairs: Record<string, ExtractedField> = {};

  const blockMap = new Map<string, Block>();
  blocks.forEach(block => {
    if (block.Id) {
      blockMap.set(block.Id, block);
    }
  });

  const keyValueBlocks = blocks.filter(
    block => block.BlockType === 'KEY_VALUE_SET'
  );

  keyValueBlocks.forEach(block => {
    if (block.EntityTypes?.includes('KEY')) {

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

function extractAllText(blocks: Block[]): string {
  const textBlocks = blocks.filter(block => block.BlockType === 'LINE');
  return textBlocks.map(block => block.Text || '').join(' ');
}

function extractStructuredData(
  keyValuePairs: Record<string, ExtractedField>,
  allText: string
): ExtractedKYCData {

  const documentType = identifyDocumentType(keyValuePairs, allText);

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

  extractCommonFields(extractedData, keyValuePairs);

  extractedData.overallConfidence = calculateOverallConfidence(extractedData);

  return extractedData;
}

function identifyDocumentType(
  keyValuePairs: Record<string, ExtractedField>,
  allText: string
): DocumentType {

  const hasPANNumber = PAN_REGEX.test(allText);
  const hasPANKeywords = allText.toLowerCase().includes('income tax') ||
                         allText.toLowerCase().includes('permanent account number') ||
                         Object.keys(keyValuePairs).some(key => 
                           key.includes('pan') || key.includes('permanent account')
                         );

  if (hasPANNumber || hasPANKeywords) {
    return 'PAN';
  }

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

function extractPANFields(
  data: ExtractedKYCData,
  keyValuePairs: Record<string, ExtractedField>,
  allText: string
): void {

  const panMatches = allText.match(PAN_REGEX);
  if (panMatches && panMatches.length > 0) {
    data.panNumber = {
      value: panMatches[0],
      confidence: 0.95, 
    };
  }

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

  const lines = allText.split(/\s{3,}|\n/).map(l => l.trim()).filter(Boolean);
  console.log('PAN text lines for name extraction:', JSON.stringify(lines));

  for (let i = 0; i < lines.length - 1; i++) {
    const lower = lines[i].toLowerCase();
    if (lower === 'name' || lower === 'full name' || lower.includes('holder name') || lower === 'naam') {
      const nameLine = lines[i + 1].trim();
      if (nameLine.length > 2 && !PAN_REGEX.test(nameLine) && 
          !nameLine.toLowerCase().includes('income tax') &&
          !nameLine.toLowerCase().includes('govt') &&
          !nameLine.toLowerCase().includes('date') &&
          !/^\d+$/.test(nameLine)) {
        data.name = { value: nameLine, confidence: 0.8 };
        console.log('PAN name extracted (after label):', nameLine);
        return;
      }
    }
  }

  if (!data.name) {
    const panNum = data.panNumber?.value || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^[A-Z][A-Z\s]{2,}$/.test(trimmed) && 
          trimmed !== panNum &&
          !trimmed.includes('INCOME TAX') && 
          !trimmed.includes('GOVT') &&
          !trimmed.includes('INDIA') &&
          !trimmed.includes('PERMANENT') &&
          !trimmed.includes('DEPARTMENT') &&
          !trimmed.includes('ACCOUNT') &&
          !trimmed.includes('NUMBER') &&
          !trimmed.includes('FATHER') &&
          trimmed.length >= 3 && trimmed.length <= 50) {
        data.name = { value: trimmed, confidence: 0.7 };
        console.log('PAN name extracted (CAPS heuristic):', trimmed);
        break;
      }
    }
  }
}

function extractAadharFields(
  data: ExtractedKYCData,
  keyValuePairs: Record<string, ExtractedField>,
  allText: string
): void {

  const aadharMatches = allText.match(AADHAR_REGEX);
  if (aadharMatches && aadharMatches.length > 0) {

    const aadharNumber = aadharMatches[0].replace(/\s/g, '');
    data.aadharNumber = {
      value: aadharNumber,
      confidence: 0.95, 
    };
  }

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

function extractCommonFields(
  data: ExtractedKYCData,
  keyValuePairs: Record<string, ExtractedField>
): void {

  const nameKeys = ['name', 'full name', 'cardholder name', 'holder name'];
  for (const key of nameKeys) {
    if (keyValuePairs[key]) {
      data.name = keyValuePairs[key];
      break;
    }
  }

  if (!data.name) {
    for (const [key, field] of Object.entries(keyValuePairs)) {
      const lk = key.toLowerCase();
      if ((lk.includes('name') || lk.includes('naam')) && !lk.includes('father') && !lk.includes('pita')) {
        data.name = field;
        break;
      }
    }
  }

  const dobKeys = ['dob', 'date of birth', 'birth date', 'year of birth'];
  for (const key of dobKeys) {
    if (keyValuePairs[key]) {
      data.dateOfBirth = keyValuePairs[key];
      break;
    }
  }

  const addressKeys = ['address', 'permanent address', 'residential address'];
  for (const key of addressKeys) {
    if (keyValuePairs[key]) {
      data.address = keyValuePairs[key];
      break;
    }
  }
}

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
