/**
 * Property-Based Test: Identity Document Text Extraction
 * 
 * **Validates: Requirements 1.1, 1.2**
 * 
 * Property 1: Identity Document Text Extraction
 * For any identity document image (PAN or Aadhar) with sufficient quality, 
 * the system should successfully extract all text fields using Amazon Textract 
 * and return structured data containing the document type, document number, 
 * name, and other relevant fields.
 * 
 * This test verifies:
 * 1. PAN cards are correctly identified and PAN numbers extracted
 * 2. Aadhar cards are correctly identified and Aadhar numbers extracted
 * 3. Common fields (name, DOB, address) are extracted when present
 * 4. Document type identification works across various document formats
 * 5. Confidence scores are calculated correctly
 * 6. Extraction handles various text patterns and layouts
 */

import fc from 'fast-check';
import { handler } from '../../src/lambdas/document-extraction';
import { textractClient } from '../../src/config/aws-clients';
import { mockClient } from 'aws-sdk-client-mock';
import { AnalyzeDocumentCommand } from '@aws-sdk/client-textract';
import type { Block } from '@aws-sdk/client-textract';

const textractMock = mockClient(textractClient);

describe('Property 1: Identity Document Text Extraction', () => {
  beforeEach(() => {
    textractMock.reset();
  });

  it('should extract PAN number and identify document type for any valid PAN card', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          panNumber: fc.stringMatching(/^[A-Z]{5}[0-9]{4}[A-Z]$/),
          name: fc.string({ minLength: 5, maxLength: 50 }).filter(s => s.trim().length >= 5).map(s => s.trim()),
          dob: fc.date({ min: new Date('1950-01-01'), max: new Date('2005-12-31') })
            .map(d => d.toLocaleDateString('en-GB')),
          documentUrl: fc.constantFrom(
            's3://test-bucket/pan-card.jpg',
            'https://test-bucket.s3.ap-south-1.amazonaws.com/pan-card.jpg'
          ),
        }),
        async ({ panNumber, name, dob, documentUrl }) => {
          // Generate mock Textract response with PAN card data
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
              Text: panNumber,
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
              Text: name,
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
              Text: dob,
              Confidence: 92.0,
            },
          ];

          textractMock.on(AnalyzeDocumentCommand).resolves({
            Blocks: mockBlocks,
          });

          const result = await handler({
            documentUrl,
            sellerId: 'test-seller-123',
          });

          // Verify extraction succeeded
          expect(result.success).toBe(true);
          expect(result.data).toBeDefined();

          // Verify document type is correctly identified as PAN
          expect(result.data?.documentType).toBe('PAN');

          // Verify PAN number is extracted
          expect(result.data?.panNumber).toBeDefined();
          expect(result.data?.panNumber?.value).toBe(panNumber);
          expect(result.data?.panNumber?.confidence).toBeGreaterThan(0);

          // Verify PAN number format is valid
          expect(result.data?.panNumber?.value).toMatch(/^[A-Z]{5}[0-9]{4}[A-Z]$/);

          // Verify name is extracted
          expect(result.data?.name).toBeDefined();
          expect(result.data?.name?.value).toBe(name);

          // Verify DOB is extracted
          expect(result.data?.dateOfBirth).toBeDefined();
          expect(result.data?.dateOfBirth?.value).toBe(dob);

          // Verify overall confidence is calculated
          expect(result.data?.overallConfidence).toBeGreaterThan(0);
          expect(result.data?.overallConfidence).toBeLessThanOrEqual(1);
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should extract Aadhar number and identify document type for any valid Aadhar card', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          aadharNumber: fc.stringMatching(/^[0-9]{12}$/),
          name: fc.string({ minLength: 5, maxLength: 50 }).filter(s => s.trim().length >= 5).map(s => s.trim()),
          dob: fc.date({ min: new Date('1950-01-01'), max: new Date('2010-12-31') })
            .map(d => d.toLocaleDateString('en-GB')),
          documentUrl: fc.constantFrom(
            's3://test-bucket/aadhar-card.jpg',
            'https://test-bucket.s3.ap-south-1.amazonaws.com/aadhar-card.jpg'
          ),
          withSpaces: fc.boolean(),
        }),
        async ({ aadharNumber, name, dob, documentUrl, withSpaces }) => {
          // Format Aadhar number with or without spaces
          const formattedAadhar = withSpaces
            ? `${aadharNumber.slice(0, 4)} ${aadharNumber.slice(4, 8)} ${aadharNumber.slice(8, 12)}`
            : aadharNumber;

          // Generate mock Textract response with Aadhar card data
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
              Text: formattedAadhar,
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
              Text: name,
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
              Text: dob,
              Confidence: 92.0,
            },
          ];

          textractMock.on(AnalyzeDocumentCommand).resolves({
            Blocks: mockBlocks,
          });

          const result = await handler({
            documentUrl,
            sellerId: 'test-seller-456',
          });

          // Verify extraction succeeded
          expect(result.success).toBe(true);
          expect(result.data).toBeDefined();

          // Verify document type is correctly identified as AADHAR
          expect(result.data?.documentType).toBe('AADHAR');

          // Verify Aadhar number is extracted (without spaces)
          expect(result.data?.aadharNumber).toBeDefined();
          expect(result.data?.aadharNumber?.value).toBe(aadharNumber);
          expect(result.data?.aadharNumber?.confidence).toBeGreaterThan(0);

          // Verify Aadhar number format is valid (12 digits, no spaces)
          expect(result.data?.aadharNumber?.value).toMatch(/^[0-9]{12}$/);

          // Verify name is extracted
          expect(result.data?.name).toBeDefined();
          expect(result.data?.name?.value).toBe(name);

          // Verify DOB is extracted
          expect(result.data?.dateOfBirth).toBeDefined();
          expect(result.data?.dateOfBirth?.value).toBe(dob);

          // Verify overall confidence is calculated
          expect(result.data?.overallConfidence).toBeGreaterThan(0);
          expect(result.data?.overallConfidence).toBeLessThanOrEqual(1);
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should correctly identify document type from keywords and patterns', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          documentType: fc.constantFrom('PAN', 'AADHAR'),
          documentUrl: fc.constantFrom(
            's3://test-bucket/document.jpg',
            'https://test-bucket.s3.ap-south-1.amazonaws.com/document.jpg'
          ),
        }),
        async ({ documentType, documentUrl }) => {
          // Generate appropriate document number based on type
          const documentNumber = documentType === 'PAN' 
            ? 'ABCDE1234F'  // Valid PAN format
            : '123456789012'; // Valid Aadhar format
          
          // Generate appropriate keywords and blocks based on document type
          const isPAN = documentType === 'PAN';
          
          const mockBlocks: Block[] = isPAN
            ? [
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
                {
                  BlockType: 'LINE',
                  Id: '3',
                  Text: documentNumber,
                  Confidence: 97.0,
                },
              ]
            : [
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
                {
                  BlockType: 'LINE',
                  Id: '3',
                  Text: documentNumber,
                  Confidence: 97.0,
                },
              ];

          textractMock.on(AnalyzeDocumentCommand).resolves({
            Blocks: mockBlocks,
          });

          const result = await handler({
            documentUrl,
            sellerId: 'test-seller-789',
          });

          // Verify extraction succeeded
          expect(result.success).toBe(true);
          expect(result.data).toBeDefined();

          // Verify document type is correctly identified
          const expectedType = isPAN ? 'PAN' : 'AADHAR';
          expect(result.data?.documentType).toBe(expectedType);

          // Verify document number is extracted
          if (isPAN) {
            expect(result.data?.panNumber).toBeDefined();
            expect(result.data?.panNumber?.value).toBe(documentNumber);
          } else {
            expect(result.data?.aadharNumber).toBeDefined();
            expect(result.data?.aadharNumber?.value).toBe(documentNumber);
          }
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should extract all relevant fields with proper confidence scores', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          documentType: fc.constantFrom('PAN', 'AADHAR'),
          name: fc.string({ minLength: 5, maxLength: 50 }).filter(s => s.trim().length >= 5).map(s => s.trim()),
          dob: fc.date({ min: new Date('1950-01-01'), max: new Date('2010-12-31') })
            .map(d => d.toLocaleDateString('en-GB')),
          address: fc.string({ minLength: 10, maxLength: 100 }).filter(s => s.trim().length >= 10).map(s => s.trim()),
          nameConfidence: fc.integer({ min: 85, max: 99 }),
          dobConfidence: fc.integer({ min: 85, max: 99 }),
          addressConfidence: fc.integer({ min: 80, max: 99 }),
        }),
        async ({ documentType, name, dob, address, nameConfidence, dobConfidence, addressConfidence }) => {
          const documentNumber = documentType === 'PAN'
            ? 'ABCDE1234F'
            : '123456789012';

          // Generate comprehensive mock blocks with all fields
          const mockBlocks: Block[] = [
            {
              BlockType: 'LINE',
              Id: '1',
              Text: documentType === 'PAN' ? 'INCOME TAX DEPARTMENT' : 'GOVERNMENT OF INDIA',
              Confidence: 99.5,
            },
            {
              BlockType: 'LINE',
              Id: '2',
              Text: documentType === 'PAN' ? 'Permanent Account Number' : 'Aadhaar',
              Confidence: 99.0,
            },
            {
              BlockType: 'LINE',
              Id: '3',
              Text: documentNumber,
              Confidence: 98.5,
            },
            // Name field
            {
              BlockType: 'KEY_VALUE_SET',
              Id: '4',
              EntityTypes: ['KEY'],
              Confidence: nameConfidence,
              Relationships: [
                { Type: 'CHILD', Ids: ['5'] },
                { Type: 'VALUE', Ids: ['6'] },
              ],
            },
            {
              BlockType: 'WORD',
              Id: '5',
              Text: 'Name',
              Confidence: nameConfidence,
            },
            {
              BlockType: 'KEY_VALUE_SET',
              Id: '6',
              EntityTypes: ['VALUE'],
              Confidence: nameConfidence,
              Relationships: [{ Type: 'CHILD', Ids: ['7'] }],
            },
            {
              BlockType: 'WORD',
              Id: '7',
              Text: name,
              Confidence: nameConfidence,
            },
            // DOB field
            {
              BlockType: 'KEY_VALUE_SET',
              Id: '8',
              EntityTypes: ['KEY'],
              Confidence: dobConfidence,
              Relationships: [
                { Type: 'CHILD', Ids: ['9'] },
                { Type: 'VALUE', Ids: ['10'] },
              ],
            },
            {
              BlockType: 'WORD',
              Id: '9',
              Text: 'Date of Birth',
              Confidence: dobConfidence,
            },
            {
              BlockType: 'KEY_VALUE_SET',
              Id: '10',
              EntityTypes: ['VALUE'],
              Confidence: dobConfidence,
              Relationships: [{ Type: 'CHILD', Ids: ['11'] }],
            },
            {
              BlockType: 'WORD',
              Id: '11',
              Text: dob,
              Confidence: dobConfidence,
            },
            // Address field
            {
              BlockType: 'KEY_VALUE_SET',
              Id: '12',
              EntityTypes: ['KEY'],
              Confidence: addressConfidence,
              Relationships: [
                { Type: 'CHILD', Ids: ['13'] },
                { Type: 'VALUE', Ids: ['14'] },
              ],
            },
            {
              BlockType: 'WORD',
              Id: '13',
              Text: 'Address',
              Confidence: addressConfidence,
            },
            {
              BlockType: 'KEY_VALUE_SET',
              Id: '14',
              EntityTypes: ['VALUE'],
              Confidence: addressConfidence,
              Relationships: [{ Type: 'CHILD', Ids: ['15'] }],
            },
            {
              BlockType: 'WORD',
              Id: '15',
              Text: address,
              Confidence: addressConfidence,
            },
          ];

          textractMock.on(AnalyzeDocumentCommand).resolves({
            Blocks: mockBlocks,
          });

          const result = await handler({
            documentUrl: 's3://test-bucket/document.jpg',
            sellerId: 'test-seller-comprehensive',
          });

          // Verify extraction succeeded
          expect(result.success).toBe(true);
          expect(result.data).toBeDefined();

          // Verify all fields are extracted
          expect(result.data?.name).toBeDefined();
          expect(result.data?.name?.value).toBe(name);
          expect(result.data?.name?.confidence).toBeCloseTo(nameConfidence / 100, 2);

          expect(result.data?.dateOfBirth).toBeDefined();
          expect(result.data?.dateOfBirth?.value).toBe(dob);
          expect(result.data?.dateOfBirth?.confidence).toBeCloseTo(dobConfidence / 100, 2);

          expect(result.data?.address).toBeDefined();
          expect(result.data?.address?.value).toBe(address);
          expect(result.data?.address?.confidence).toBeCloseTo(addressConfidence / 100, 2);

          // Verify overall confidence is within valid range
          expect(result.data?.overallConfidence).toBeGreaterThan(0);
          expect(result.data?.overallConfidence).toBeLessThanOrEqual(1);

          // Verify overall confidence is reasonable average of field confidences
          const expectedAvgConfidence = (nameConfidence + dobConfidence + addressConfidence + 95) / 400; // +95 for document number
          expect(result.data?.overallConfidence).toBeGreaterThan(expectedAvgConfidence - 0.1);
          expect(result.data?.overallConfidence).toBeLessThan(expectedAvgConfidence + 0.1);
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should handle various URL formats correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          urlFormat: fc.constantFrom(
            's3://bucket/key',
            'https://bucket.s3.region.amazonaws.com/key',
            'https://bucket.s3.region.amazonaws.com/key?X-Amz-Signature=abc123'
          ),
          panNumber: fc.stringMatching(/^[A-Z]{5}[0-9]{4}[A-Z]$/),
        }),
        async ({ urlFormat, panNumber }) => {
          // Generate URL based on format
          let documentUrl: string;
          if (urlFormat.startsWith('s3://')) {
            documentUrl = `s3://test-bucket/documents/${panNumber}.jpg`;
          } else if (urlFormat.includes('X-Amz-Signature')) {
            documentUrl = `https://test-bucket.s3.ap-south-1.amazonaws.com/documents/${panNumber}.jpg?X-Amz-Signature=abc123&X-Amz-Expires=3600`;
          } else {
            documentUrl = `https://test-bucket.s3.ap-south-1.amazonaws.com/documents/${panNumber}.jpg`;
          }

          const mockBlocks: Block[] = [
            {
              BlockType: 'LINE',
              Id: '1',
              Text: `PAN: ${panNumber}`,
              Confidence: 99.0,
            },
          ];

          textractMock.on(AnalyzeDocumentCommand).resolves({
            Blocks: mockBlocks,
          });

          const result = await handler({
            documentUrl,
            sellerId: 'test-seller-url',
          });

          // Verify extraction succeeded regardless of URL format
          expect(result.success).toBe(true);
          expect(result.data).toBeDefined();
          expect(result.data?.documentType).toBe('PAN');
          expect(result.data?.panNumber?.value).toBe(panNumber);
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should return structured data with all required fields for any valid document', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          documentType: fc.constantFrom('PAN', 'AADHAR'),
          hasName: fc.boolean(),
          hasDOB: fc.boolean(),
          hasAddress: fc.boolean(),
        }),
        async ({ documentType, hasName, hasDOB, hasAddress }) => {
          const documentNumber = documentType === 'PAN' ? 'ZYXWV9876K' : '987654321098';
          
          const mockBlocks: Block[] = [
            {
              BlockType: 'LINE',
              Id: '1',
              Text: documentType === 'PAN' ? 'INCOME TAX' : 'Aadhaar',
              Confidence: 99.0,
            },
            {
              BlockType: 'LINE',
              Id: '2',
              Text: documentNumber,
              Confidence: 98.0,
            },
          ];

          // Add optional fields based on flags
          let blockId = 3;
          if (hasName) {
            mockBlocks.push(
              {
                BlockType: 'KEY_VALUE_SET',
                Id: String(blockId++),
                EntityTypes: ['KEY'],
                Confidence: 95.0,
                Relationships: [
                  { Type: 'CHILD', Ids: [String(blockId)] },
                  { Type: 'VALUE', Ids: [String(blockId + 1)] },
                ],
              },
              {
                BlockType: 'WORD',
                Id: String(blockId++),
                Text: 'Name',
                Confidence: 95.0,
              },
              {
                BlockType: 'KEY_VALUE_SET',
                Id: String(blockId++),
                EntityTypes: ['VALUE'],
                Confidence: 94.0,
                Relationships: [{ Type: 'CHILD', Ids: [String(blockId)] }],
              },
              {
                BlockType: 'WORD',
                Id: String(blockId++),
                Text: 'TEST NAME',
                Confidence: 94.0,
              }
            );
          }

          textractMock.on(AnalyzeDocumentCommand).resolves({
            Blocks: mockBlocks,
          });

          const result = await handler({
            documentUrl: 's3://test-bucket/doc.jpg',
            sellerId: 'test-seller-fields',
          });

          // Verify extraction succeeded
          expect(result.success).toBe(true);
          expect(result.data).toBeDefined();

          // Verify required fields are always present
          expect(result.data?.documentType).toBeDefined();
          expect(['PAN', 'AADHAR', 'UNKNOWN']).toContain(result.data?.documentType);
          expect(result.data?.rawFields).toBeDefined();
          expect(result.data?.overallConfidence).toBeDefined();
          expect(result.data?.overallConfidence).toBeGreaterThanOrEqual(0);
          expect(result.data?.overallConfidence).toBeLessThanOrEqual(1);

          // Verify document number is extracted
          if (documentType === 'PAN') {
            expect(result.data?.panNumber).toBeDefined();
          } else {
            expect(result.data?.aadharNumber).toBeDefined();
          }

          // Verify optional fields match expectations
          if (hasName) {
            expect(result.data?.name).toBeDefined();
          }
        }
      ),
      { numRuns: 5 }
    );
  });
});
