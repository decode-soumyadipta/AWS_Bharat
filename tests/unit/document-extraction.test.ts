/**
 * Unit Tests for Document Extraction Lambda
 * 
 * Tests cover:
 * - PAN card text extraction and validation
 * - Aadhar card text extraction and validation
 * - Document type identification
 * - Key-value pair extraction
 * - Confidence score calculation
 * - Error handling for invalid inputs
 * 
 * Validates: Requirements 1.1, 1.2
 */

import { handler } from '../../src/lambdas/document-extraction';
import { textractClient } from '../../src/config/aws-clients';
import { mockClient } from 'aws-sdk-client-mock';
import { AnalyzeDocumentCommand } from '@aws-sdk/client-textract';
import type { Block } from '@aws-sdk/client-textract';

const textractMock = mockClient(textractClient);

describe('Document Extraction Lambda', () => {
  beforeEach(() => {
    textractMock.reset();
  });

  describe('PAN Card Extraction', () => {
    it('should extract PAN number from valid PAN card', async () => {
      // Mock Textract response with PAN card data
      const mockBlocks: Block[] = [
        {
          BlockType: 'LINE',
          Id: '1',
          Text: 'INCOME TAX DEPARTMENT',
          Confidence: 99.5,
        },
        {
          BlockType: 'LINE',
          Id: '2',
          Text: 'Permanent Account Number Card',
          Confidence: 99.0,
        },
        {
          BlockType: 'LINE',
          Id: '3',
          Text: 'ABCDE1234F',
          Confidence: 98.5,
        },
        {
          BlockType: 'KEY_VALUE_SET',
          Id: '4',
          EntityTypes: ['KEY'],
          Confidence: 95.0,
          Relationships: [
            { Type: 'CHILD', Ids: ['5'] },
            { Type: 'VALUE', Ids: ['6'] },
          ],
        },
        {
          BlockType: 'WORD',
          Id: '5',
          Text: 'Name',
          Confidence: 95.0,
        },
        {
          BlockType: 'KEY_VALUE_SET',
          Id: '6',
          EntityTypes: ['VALUE'],
          Confidence: 94.0,
          Relationships: [{ Type: 'CHILD', Ids: ['7'] }],
        },
        {
          BlockType: 'WORD',
          Id: '7',
          Text: 'RAJESH KUMAR',
          Confidence: 94.0,
        },
        {
          BlockType: 'KEY_VALUE_SET',
          Id: '8',
          EntityTypes: ['KEY'],
          Confidence: 93.0,
          Relationships: [
            { Type: 'CHILD', Ids: ['9'] },
            { Type: 'VALUE', Ids: ['10'] },
          ],
        },
        {
          BlockType: 'WORD',
          Id: '9',
          Text: 'Date of Birth',
          Confidence: 93.0,
        },
        {
          BlockType: 'KEY_VALUE_SET',
          Id: '10',
          EntityTypes: ['VALUE'],
          Confidence: 92.0,
          Relationships: [{ Type: 'CHILD', Ids: ['11'] }],
        },
        {
          BlockType: 'WORD',
          Id: '11',
          Text: '15/08/1985',
          Confidence: 92.0,
        },
      ];

      textractMock.on(AnalyzeDocumentCommand).resolves({
        Blocks: mockBlocks,
      });

      const result = await handler({
        documentUrl: 's3://test-bucket/pan-card.jpg',
        sellerId: 'test-seller-123',
      });

      expect(result.success).toBe(true);
      expect(result.data?.documentType).toBe('PAN');
      expect(result.data?.panNumber?.value).toBe('ABCDE1234F');
      expect(result.data?.panNumber?.confidence).toBeGreaterThan(0.9);
      expect(result.data?.name?.value).toBe('RAJESH KUMAR');
      expect(result.data?.dateOfBirth?.value).toBe('15/08/1985');
    });

    it('should validate PAN number format', async () => {
      const mockBlocks: Block[] = [
        {
          BlockType: 'LINE',
          Id: '1',
          Text: 'PAN: ABCDE1234F',
          Confidence: 99.0,
        },
      ];

      textractMock.on(AnalyzeDocumentCommand).resolves({
        Blocks: mockBlocks,
      });

      const result = await handler({
        documentUrl: 's3://test-bucket/pan-card.jpg',
        sellerId: 'test-seller-123',
      });

      expect(result.success).toBe(true);
      expect(result.data?.panNumber?.value).toMatch(/^[A-Z]{5}[0-9]{4}[A-Z]$/);
    });
  });

  describe('Aadhar Card Extraction', () => {
    it('should extract Aadhar number from valid Aadhar card', async () => {
      const mockBlocks: Block[] = [
        {
          BlockType: 'LINE',
          Id: '1',
          Text: 'GOVERNMENT OF INDIA',
          Confidence: 99.5,
        },
        {
          BlockType: 'LINE',
          Id: '2',
          Text: 'Aadhaar',
          Confidence: 99.0,
        },
        {
          BlockType: 'LINE',
          Id: '3',
          Text: '1234 5678 9012',
          Confidence: 98.5,
        },
        {
          BlockType: 'KEY_VALUE_SET',
          Id: '4',
          EntityTypes: ['KEY'],
          Confidence: 95.0,
          Relationships: [
            { Type: 'CHILD', Ids: ['5'] },
            { Type: 'VALUE', Ids: ['6'] },
          ],
        },
        {
          BlockType: 'WORD',
          Id: '5',
          Text: 'Name',
          Confidence: 95.0,
        },
        {
          BlockType: 'KEY_VALUE_SET',
          Id: '6',
          EntityTypes: ['VALUE'],
          Confidence: 94.0,
          Relationships: [{ Type: 'CHILD', Ids: ['7'] }],
        },
        {
          BlockType: 'WORD',
          Id: '7',
          Text: 'SUNITA DEVI',
          Confidence: 94.0,
        },
        {
          BlockType: 'KEY_VALUE_SET',
          Id: '8',
          EntityTypes: ['KEY'],
          Confidence: 93.0,
          Relationships: [
            { Type: 'CHILD', Ids: ['9'] },
            { Type: 'VALUE', Ids: ['10'] },
          ],
        },
        {
          BlockType: 'WORD',
          Id: '9',
          Text: 'DOB',
          Confidence: 93.0,
        },
        {
          BlockType: 'KEY_VALUE_SET',
          Id: '10',
          EntityTypes: ['VALUE'],
          Confidence: 92.0,
          Relationships: [{ Type: 'CHILD', Ids: ['11'] }],
        },
        {
          BlockType: 'WORD',
          Id: '11',
          Text: '10/03/1990',
          Confidence: 92.0,
        },
      ];

      textractMock.on(AnalyzeDocumentCommand).resolves({
        Blocks: mockBlocks,
      });

      const result = await handler({
        documentUrl: 's3://test-bucket/aadhar-card.jpg',
        sellerId: 'test-seller-456',
      });

      expect(result.success).toBe(true);
      expect(result.data?.documentType).toBe('AADHAR');
      expect(result.data?.aadharNumber?.value).toBe('123456789012');
      expect(result.data?.aadharNumber?.confidence).toBeGreaterThan(0.9);
      expect(result.data?.name?.value).toBe('SUNITA DEVI');
      expect(result.data?.dateOfBirth?.value).toBe('10/03/1990');
    });

    it('should handle Aadhar number with spaces', async () => {
      const mockBlocks: Block[] = [
        {
          BlockType: 'LINE',
          Id: '1',
          Text: 'Aadhaar: 1234 5678 9012',
          Confidence: 99.0,
        },
      ];

      textractMock.on(AnalyzeDocumentCommand).resolves({
        Blocks: mockBlocks,
      });

      const result = await handler({
        documentUrl: 's3://test-bucket/aadhar-card.jpg',
        sellerId: 'test-seller-456',
      });

      expect(result.success).toBe(true);
      expect(result.data?.aadharNumber?.value).toBe('123456789012');
      expect(result.data?.aadharNumber?.value).toMatch(/^\d{12}$/);
    });
  });

  describe('Document Type Identification', () => {
    it('should identify PAN card from keywords', async () => {
      const mockBlocks: Block[] = [
        {
          BlockType: 'LINE',
          Id: '1',
          Text: 'INCOME TAX DEPARTMENT',
          Confidence: 99.0,
        },
        {
          BlockType: 'LINE',
          Id: '2',
          Text: 'Permanent Account Number',
          Confidence: 98.0,
        },
      ];

      textractMock.on(AnalyzeDocumentCommand).resolves({
        Blocks: mockBlocks,
      });

      const result = await handler({
        documentUrl: 's3://test-bucket/document.jpg',
        sellerId: 'test-seller-789',
      });

      expect(result.success).toBe(true);
      expect(result.data?.documentType).toBe('PAN');
    });

    it('should identify Aadhar card from keywords', async () => {
      const mockBlocks: Block[] = [
        {
          BlockType: 'LINE',
          Id: '1',
          Text: 'GOVERNMENT OF INDIA',
          Confidence: 99.0,
        },
        {
          BlockType: 'LINE',
          Id: '2',
          Text: 'Aadhaar',
          Confidence: 98.0,
        },
      ];

      textractMock.on(AnalyzeDocumentCommand).resolves({
        Blocks: mockBlocks,
      });

      const result = await handler({
        documentUrl: 's3://test-bucket/document.jpg',
        sellerId: 'test-seller-789',
      });

      expect(result.success).toBe(true);
      expect(result.data?.documentType).toBe('AADHAR');
    });

    it('should return UNKNOWN for unrecognized documents', async () => {
      const mockBlocks: Block[] = [
        {
          BlockType: 'LINE',
          Id: '1',
          Text: 'Some random text',
          Confidence: 99.0,
        },
      ];

      textractMock.on(AnalyzeDocumentCommand).resolves({
        Blocks: mockBlocks,
      });

      const result = await handler({
        documentUrl: 's3://test-bucket/document.jpg',
        sellerId: 'test-seller-789',
      });

      expect(result.success).toBe(true);
      expect(result.data?.documentType).toBe('UNKNOWN');
    });
  });

  describe('Confidence Score Calculation', () => {
    it('should calculate overall confidence from extracted fields', async () => {
      const mockBlocks: Block[] = [
        {
          BlockType: 'LINE',
          Id: '1',
          Text: 'PAN: ABCDE1234F',
          Confidence: 95.0,
        },
        {
          BlockType: 'KEY_VALUE_SET',
          Id: '2',
          EntityTypes: ['KEY'],
          Confidence: 90.0,
          Relationships: [
            { Type: 'CHILD', Ids: ['3'] },
            { Type: 'VALUE', Ids: ['4'] },
          ],
        },
        {
          BlockType: 'WORD',
          Id: '3',
          Text: 'Name',
          Confidence: 90.0,
        },
        {
          BlockType: 'KEY_VALUE_SET',
          Id: '4',
          EntityTypes: ['VALUE'],
          Confidence: 85.0,
          Relationships: [{ Type: 'CHILD', Ids: ['5'] }],
        },
        {
          BlockType: 'WORD',
          Id: '5',
          Text: 'TEST NAME',
          Confidence: 85.0,
        },
      ];

      textractMock.on(AnalyzeDocumentCommand).resolves({
        Blocks: mockBlocks,
      });

      const result = await handler({
        documentUrl: 's3://test-bucket/pan-card.jpg',
        sellerId: 'test-seller-123',
      });

      expect(result.success).toBe(true);
      expect(result.data?.overallConfidence).toBeGreaterThan(0);
      expect(result.data?.overallConfidence).toBeLessThanOrEqual(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle Textract API errors gracefully', async () => {
      textractMock.on(AnalyzeDocumentCommand).rejects(new Error('Textract service unavailable'));

      const result = await handler({
        documentUrl: 's3://test-bucket/document.jpg',
        sellerId: 'test-seller-123',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Textract service unavailable');
    });

    it('should handle invalid S3 URLs', async () => {
      const result = await handler({
        documentUrl: 'invalid-url',
        sellerId: 'test-seller-123',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Invalid S3 URL');
    });

    it('should handle empty Textract response', async () => {
      textractMock.on(AnalyzeDocumentCommand).resolves({
        Blocks: [],
      });

      const result = await handler({
        documentUrl: 's3://test-bucket/document.jpg',
        sellerId: 'test-seller-123',
      });

      expect(result.success).toBe(true);
      expect(result.data?.documentType).toBe('UNKNOWN');
      expect(result.data?.overallConfidence).toBe(0);
    });
  });

  describe('Poor Image Quality Handling', () => {
    it('should detect poor quality when confidence is very low', async () => {
      const mockBlocks: Block[] = [
        {
          BlockType: 'LINE',
          Id: '1',
          Text: 'INCOME TAX',
          Confidence: 45.0, // Very low confidence
        },
        {
          BlockType: 'LINE',
          Id: '2',
          Text: 'ABCDE1234F',
          Confidence: 50.0, // Low confidence
        },
        {
          BlockType: 'KEY_VALUE_SET',
          Id: '3',
          EntityTypes: ['KEY'],
          Confidence: 40.0,
          Relationships: [
            { Type: 'CHILD', Ids: ['4'] },
            { Type: 'VALUE', Ids: ['5'] },
          ],
        },
        {
          BlockType: 'WORD',
          Id: '4',
          Text: 'Name',
          Confidence: 40.0,
        },
        {
          BlockType: 'KEY_VALUE_SET',
          Id: '5',
          EntityTypes: ['VALUE'],
          Confidence: 35.0,
          Relationships: [{ Type: 'CHILD', Ids: ['6'] }],
        },
        {
          BlockType: 'WORD',
          Id: '6',
          Text: 'UNCLEAR TEXT',
          Confidence: 35.0,
        },
      ];

      textractMock.on(AnalyzeDocumentCommand).resolves({
        Blocks: mockBlocks,
      });

      const result = await handler({
        documentUrl: 's3://test-bucket/poor-quality.jpg',
        sellerId: 'test-seller-123',
      });

      expect(result.success).toBe(true);
      // Overall confidence is average of extracted fields (PAN regex match gets 0.95, name gets 0.35)
      expect(result.data?.overallConfidence).toBeLessThan(0.8);
      expect(result.data?.name?.confidence).toBeLessThan(0.5);
    });

    it('should extract partial data from blurry images', async () => {
      const mockBlocks: Block[] = [
        {
          BlockType: 'LINE',
          Id: '1',
          Text: 'Permanent Account',
          Confidence: 65.0,
        },
        {
          BlockType: 'LINE',
          Id: '2',
          Text: 'ABCDE1234F',
          Confidence: 70.0,
        },
        {
          BlockType: 'KEY_VALUE_SET',
          Id: '3',
          EntityTypes: ['KEY'],
          Confidence: 60.0,
          Relationships: [
            { Type: 'CHILD', Ids: ['4'] },
            { Type: 'VALUE', Ids: ['5'] },
          ],
        },
        {
          BlockType: 'WORD',
          Id: '4',
          Text: 'Name',
          Confidence: 60.0,
        },
        {
          BlockType: 'KEY_VALUE_SET',
          Id: '5',
          EntityTypes: ['VALUE'],
          Confidence: 55.0,
          Relationships: [{ Type: 'CHILD', Ids: ['6'] }],
        },
        {
          BlockType: 'WORD',
          Id: '6',
          Text: 'PARTIALLY VISIBLE',
          Confidence: 55.0,
        },
      ];

      textractMock.on(AnalyzeDocumentCommand).resolves({
        Blocks: mockBlocks,
      });

      const result = await handler({
        documentUrl: 's3://test-bucket/blurry.jpg',
        sellerId: 'test-seller-456',
      });

      expect(result.success).toBe(true);
      expect(result.data?.documentType).toBe('PAN');
      expect(result.data?.panNumber?.value).toBe('ABCDE1234F');
      // PAN number extracted via regex gets high confidence (0.95)
      expect(result.data?.panNumber?.confidence).toBeGreaterThan(0.9);
      // Name extracted from key-value pairs has low confidence
      expect(result.data?.name?.confidence).toBeLessThan(0.6);
    });

    it('should handle documents with missing text blocks', async () => {
      const mockBlocks: Block[] = [
        {
          BlockType: 'LINE',
          Id: '1',
          Text: 'ABCDE1234F',
          Confidence: 75.0,
        },
        // Missing other expected blocks due to poor quality
      ];

      textractMock.on(AnalyzeDocumentCommand).resolves({
        Blocks: mockBlocks,
      });

      const result = await handler({
        documentUrl: 's3://test-bucket/incomplete.jpg',
        sellerId: 'test-seller-789',
      });

      expect(result.success).toBe(true);
      expect(result.data?.panNumber?.value).toBe('ABCDE1234F');
      expect(result.data?.name).toBeUndefined(); // Name not extracted
      expect(result.data?.overallConfidence).toBeGreaterThan(0);
    });

    it('should handle documents with corrupted text extraction', async () => {
      const mockBlocks: Block[] = [
        {
          BlockType: 'LINE',
          Id: '1',
          Text: 'A8CDE12@4F', // Corrupted PAN due to poor quality
          Confidence: 60.0,
        },
        {
          BlockType: 'LINE',
          Id: '2',
          Text: 'Permanent Account',
          Confidence: 70.0,
        },
      ];

      textractMock.on(AnalyzeDocumentCommand).resolves({
        Blocks: mockBlocks,
      });

      const result = await handler({
        documentUrl: 's3://test-bucket/corrupted.jpg',
        sellerId: 'test-seller-999',
      });

      expect(result.success).toBe(true);
      // Document type identified from keywords but not from PAN pattern
      expect(result.data?.documentType).toBe('UNKNOWN');
      // PAN number not extracted due to invalid format
      expect(result.data?.panNumber).toBeUndefined();
      expect(result.data?.overallConfidence).toBe(0);
    });
  });

  describe('URL Parsing', () => {
    it('should parse s3:// URLs correctly', async () => {
      const mockBlocks: Block[] = [
        {
          BlockType: 'LINE',
          Id: '1',
          Text: 'Test',
          Confidence: 99.0,
        },
      ];

      textractMock.on(AnalyzeDocumentCommand).resolves({
        Blocks: mockBlocks,
      });

      const result = await handler({
        documentUrl: 's3://my-bucket/path/to/document.jpg',
        sellerId: 'test-seller-123',
      });

      expect(result.success).toBe(true);
    });

    it('should parse HTTPS S3 URLs correctly', async () => {
      const mockBlocks: Block[] = [
        {
          BlockType: 'LINE',
          Id: '1',
          Text: 'Test',
          Confidence: 99.0,
        },
      ];

      textractMock.on(AnalyzeDocumentCommand).resolves({
        Blocks: mockBlocks,
      });

      const result = await handler({
        documentUrl: 'https://my-bucket.s3.ap-south-1.amazonaws.com/document.jpg',
        sellerId: 'test-seller-123',
      });

      expect(result.success).toBe(true);
    });

    it('should parse pre-signed URLs correctly', async () => {
      const mockBlocks: Block[] = [
        {
          BlockType: 'LINE',
          Id: '1',
          Text: 'Test',
          Confidence: 99.0,
        },
      ];

      textractMock.on(AnalyzeDocumentCommand).resolves({
        Blocks: mockBlocks,
      });

      const result = await handler({
        documentUrl: 'https://my-bucket.s3.ap-south-1.amazonaws.com/document.jpg?X-Amz-Signature=abc123',
        sellerId: 'test-seller-123',
      });

      expect(result.success).toBe(true);
    });
  });
});
