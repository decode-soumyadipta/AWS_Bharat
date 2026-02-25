/**
 * Unit tests for KYC Validation Lambda
 * 
 * Tests validation logic for PAN and Aadhar documents including:
 * - PAN number format validation
 * - Aadhar number format and checksum validation
 * - Required fields validation
 * - Confidence score validation
 * - Missing and invalid fields detection
 */

import {
  handler,
  validateKYCData,
  validatePANFormat,
  validateAadharFormat,
  validateAadharChecksum,
  KYCValidationRequest,
  KYCValidationResult,
} from '../../src/lambdas/kyc-validation';
import { ExtractedKYCData } from '../../src/models/kyc';

describe('KYC Validation Lambda', () => {
  describe('handler', () => {
    it('should validate valid PAN data successfully', async () => {
      const request: KYCValidationRequest = {
        sellerId: 'seller-123',
        extractedData: {
          documentType: 'PAN',
          panNumber: {
            value: 'ABCDE1234F',
            confidence: 0.95,
          },
          name: {
            value: 'John Doe',
            confidence: 0.92,
          },
          overallConfidence: 0.93,
          rawFields: {},
        },
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.validationResult).toBeDefined();
      expect(response.validationResult?.valid).toBe(true);
      expect(response.validationResult?.missingFields).toHaveLength(0);
      expect(response.validationResult?.invalidFields).toHaveLength(0);
      expect(response.validationResult?.errors).toHaveLength(0);
    });

    it('should validate valid Aadhar data successfully', async () => {
      const request: KYCValidationRequest = {
        sellerId: 'seller-456',
        extractedData: {
          documentType: 'AADHAR',
          aadharNumber: {
            value: '234123412346', // Valid Aadhar with correct checksum
            confidence: 0.90,
          },
          name: {
            value: 'Jane Smith',
            confidence: 0.88,
          },
          overallConfidence: 0.89,
          rawFields: {},
        },
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.validationResult).toBeDefined();
      expect(response.validationResult?.valid).toBe(true);
    });

    it('should handle validation errors gracefully', async () => {
      const request: KYCValidationRequest = {
        sellerId: 'seller-789',
        extractedData: {
          documentType: 'UNKNOWN',
          overallConfidence: 0.5,
          rawFields: {},
        },
      };

      const response = await handler(request);

      expect(response.success).toBe(true);
      expect(response.validationResult).toBeDefined();
      expect(response.validationResult?.valid).toBe(false);
      expect(response.validationResult?.errors).toContain('Unable to identify document type');
    });
  });

  describe('validateKYCData', () => {
    describe('PAN validation', () => {
      it('should validate correct PAN data', () => {
        const data: ExtractedKYCData = {
          documentType: 'PAN',
          panNumber: {
            value: 'ABCDE1234F',
            confidence: 0.95,
          },
          name: {
            value: 'Test User',
            confidence: 0.90,
          },
          overallConfidence: 0.92,
          rawFields: {},
        };

        const result = validateKYCData(data);

        expect(result.valid).toBe(true);
        expect(result.missingFields).toHaveLength(0);
        expect(result.invalidFields).toHaveLength(0);
        expect(result.errors).toHaveLength(0);
      });

      it('should detect missing PAN number', () => {
        const data: ExtractedKYCData = {
          documentType: 'PAN',
          name: {
            value: 'Test User',
            confidence: 0.90,
          },
          overallConfidence: 0.90,
          rawFields: {},
        };

        const result = validateKYCData(data);

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('PAN number');
      });

      it('should detect invalid PAN format', () => {
        const data: ExtractedKYCData = {
          documentType: 'PAN',
          panNumber: {
            value: 'INVALID123',
            confidence: 0.95,
          },
          name: {
            value: 'Test User',
            confidence: 0.90,
          },
          overallConfidence: 0.92,
          rawFields: {},
        };

        const result = validateKYCData(data);

        expect(result.valid).toBe(false);
        expect(result.invalidFields).toContain('PAN number');
        expect(result.errors.some(e => e.includes('Invalid PAN number format'))).toBe(true);
      });

      it('should detect low confidence PAN number', () => {
        const data: ExtractedKYCData = {
          documentType: 'PAN',
          panNumber: {
            value: 'ABCDE1234F',
            confidence: 0.70, // Below 80% threshold
          },
          name: {
            value: 'Test User',
            confidence: 0.90,
          },
          overallConfidence: 0.80,
          rawFields: {},
        };

        const result = validateKYCData(data);

        expect(result.valid).toBe(false);
        expect(result.lowConfidenceFields).toContain('PAN number');
        expect(result.errors.some(e => e.includes('PAN number confidence'))).toBe(true);
      });
    });

    describe('Aadhar validation', () => {
      it('should validate correct Aadhar data', () => {
        const data: ExtractedKYCData = {
          documentType: 'AADHAR',
          aadharNumber: {
            value: '234123412346', // Valid checksum
            confidence: 0.92,
          },
          name: {
            value: 'Test User',
            confidence: 0.88,
          },
          overallConfidence: 0.90,
          rawFields: {},
        };

        const result = validateKYCData(data);

        expect(result.valid).toBe(true);
        expect(result.missingFields).toHaveLength(0);
        expect(result.invalidFields).toHaveLength(0);
      });

      it('should detect missing Aadhar number', () => {
        const data: ExtractedKYCData = {
          documentType: 'AADHAR',
          name: {
            value: 'Test User',
            confidence: 0.90,
          },
          overallConfidence: 0.90,
          rawFields: {},
        };

        const result = validateKYCData(data);

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('Aadhar number');
      });

      it('should detect invalid Aadhar format', () => {
        const data: ExtractedKYCData = {
          documentType: 'AADHAR',
          aadharNumber: {
            value: '12345', // Too short
            confidence: 0.95,
          },
          name: {
            value: 'Test User',
            confidence: 0.90,
          },
          overallConfidence: 0.92,
          rawFields: {},
        };

        const result = validateKYCData(data);

        expect(result.valid).toBe(false);
        expect(result.invalidFields).toContain('Aadhar number');
        expect(result.errors.some(e => e.includes('Invalid Aadhar number format'))).toBe(true);
      });

      it('should detect invalid Aadhar checksum', () => {
        const data: ExtractedKYCData = {
          documentType: 'AADHAR',
          aadharNumber: {
            value: '123456789012', // Invalid checksum
            confidence: 0.95,
          },
          name: {
            value: 'Test User',
            confidence: 0.90,
          },
          overallConfidence: 0.92,
          rawFields: {},
        };

        const result = validateKYCData(data);

        expect(result.valid).toBe(false);
        expect(result.invalidFields).toContain('Aadhar number');
        expect(result.errors.some(e => e.includes('Invalid Aadhar number checksum'))).toBe(true);
      });

      it('should handle Aadhar with spaces', () => {
        const data: ExtractedKYCData = {
          documentType: 'AADHAR',
          aadharNumber: {
            value: '2341 2341 2346', // Valid with spaces
            confidence: 0.92,
          },
          name: {
            value: 'Test User',
            confidence: 0.88,
          },
          overallConfidence: 0.90,
          rawFields: {},
        };

        const result = validateKYCData(data);

        expect(result.valid).toBe(true);
      });

      it('should detect low confidence Aadhar number', () => {
        const data: ExtractedKYCData = {
          documentType: 'AADHAR',
          aadharNumber: {
            value: '234123412346',
            confidence: 0.75, // Below 80% threshold
          },
          name: {
            value: 'Test User',
            confidence: 0.90,
          },
          overallConfidence: 0.82,
          rawFields: {},
        };

        const result = validateKYCData(data);

        expect(result.valid).toBe(false);
        expect(result.lowConfidenceFields).toContain('Aadhar number');
      });
    });

    describe('Common fields validation', () => {
      it('should detect missing name', () => {
        const data: ExtractedKYCData = {
          documentType: 'PAN',
          panNumber: {
            value: 'ABCDE1234F',
            confidence: 0.95,
          },
          overallConfidence: 0.95,
          rawFields: {},
        };

        const result = validateKYCData(data);

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('name');
      });

      it('should detect empty name', () => {
        const data: ExtractedKYCData = {
          documentType: 'PAN',
          panNumber: {
            value: 'ABCDE1234F',
            confidence: 0.95,
          },
          name: {
            value: '   ', // Empty/whitespace
            confidence: 0.90,
          },
          overallConfidence: 0.92,
          rawFields: {},
        };

        const result = validateKYCData(data);

        expect(result.valid).toBe(false);
        expect(result.invalidFields).toContain('name');
        expect(result.errors.some(e => e.includes('Name field is empty'))).toBe(true);
      });

      it('should detect low confidence name', () => {
        const data: ExtractedKYCData = {
          documentType: 'PAN',
          panNumber: {
            value: 'ABCDE1234F',
            confidence: 0.95,
          },
          name: {
            value: 'Test User',
            confidence: 0.70, // Below 80% threshold
          },
          overallConfidence: 0.82,
          rawFields: {},
        };

        const result = validateKYCData(data);

        expect(result.valid).toBe(false);
        expect(result.lowConfidenceFields).toContain('name');
      });
    });

    describe('Overall confidence validation', () => {
      it('should detect low overall confidence', () => {
        const data: ExtractedKYCData = {
          documentType: 'PAN',
          panNumber: {
            value: 'ABCDE1234F',
            confidence: 0.95,
          },
          name: {
            value: 'Test User',
            confidence: 0.90,
          },
          overallConfidence: 0.75, // Below 80% threshold
          rawFields: {},
        };

        const result = validateKYCData(data);

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Overall extraction confidence'))).toBe(true);
      });
    });

    describe('Unknown document type', () => {
      it('should reject unknown document type', () => {
        const data: ExtractedKYCData = {
          documentType: 'UNKNOWN',
          overallConfidence: 0.90,
          rawFields: {},
        };

        const result = validateKYCData(data);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Unable to identify document type');
      });
    });
  });

  describe('validatePANFormat', () => {
    it('should validate correct PAN formats', () => {
      expect(validatePANFormat('ABCDE1234F')).toBe(true);
      expect(validatePANFormat('ZYXWV9876K')).toBe(true);
      expect(validatePANFormat('PQRST0000A')).toBe(true);
    });

    it('should reject invalid PAN formats', () => {
      expect(validatePANFormat('ABCDE123F')).toBe(false); // Too short
      expect(validatePANFormat('ABCDE12345F')).toBe(false); // Too long
      expect(validatePANFormat('abcde1234f')).toBe(false); // Lowercase
      expect(validatePANFormat('12345ABCDE')).toBe(false); // Wrong order
      expect(validatePANFormat('ABCD1234F')).toBe(false); // Only 4 letters at start
      expect(validatePANFormat('ABCDE1234')).toBe(false); // Missing last letter
      expect(validatePANFormat('')).toBe(false); // Empty
    });
  });

  describe('validateAadharFormat', () => {
    it('should validate correct Aadhar formats', () => {
      expect(validateAadharFormat('123456789012')).toBe(true);
      expect(validateAadharFormat('999999999999')).toBe(true);
      expect(validateAadharFormat('000000000000')).toBe(true);
    });

    it('should reject invalid Aadhar formats', () => {
      expect(validateAadharFormat('12345678901')).toBe(false); // Too short
      expect(validateAadharFormat('1234567890123')).toBe(false); // Too long
      expect(validateAadharFormat('1234 5678 9012')).toBe(false); // With spaces
      expect(validateAadharFormat('ABCD12345678')).toBe(false); // Contains letters
      expect(validateAadharFormat('')).toBe(false); // Empty
    });
  });

  describe('validateAadharChecksum', () => {
    it('should validate correct Aadhar checksums', () => {
      // Valid Aadhar numbers with correct Verhoeff checksums
      // These are mathematically valid checksums (not real Aadhar numbers)
      expect(validateAadharChecksum('234123412346')).toBe(true);
      expect(validateAadharChecksum('123456789010')).toBe(true);
    });

    it('should reject invalid Aadhar checksums', () => {
      // Invalid checksums - last digit is wrong
      expect(validateAadharChecksum('234123412345')).toBe(false);
      expect(validateAadharChecksum('123456789011')).toBe(false);
      expect(validateAadharChecksum('123456789012')).toBe(false);
    });

    it('should handle edge cases', () => {
      // All zeros doesn't have valid checksum
      expect(validateAadharChecksum('000000000000')).toBe(false);
      
      // Single digit change should fail (changing first digit of known valid number)
      expect(validateAadharChecksum('134123412346')).toBe(false); // Changed first digit from 2 to 1
      expect(validateAadharChecksum('334123412346')).toBe(false); // Changed first digit from 2 to 3
    });
  });

  describe('Multiple validation errors', () => {
    it('should report all validation errors', () => {
      const data: ExtractedKYCData = {
        documentType: 'PAN',
        panNumber: {
          value: 'INVALID',
          confidence: 0.70,
        },
        name: {
          value: '',
          confidence: 0.65,
        },
        overallConfidence: 0.70,
        rawFields: {},
      };

      const result = validateKYCData(data);

      expect(result.valid).toBe(false);
      expect(result.invalidFields.length).toBeGreaterThan(0);
      expect(result.lowConfidenceFields.length).toBeGreaterThan(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Missing Fields Clarification Flow', () => {
    it('should identify all missing required fields for PAN', () => {
      const data: ExtractedKYCData = {
        documentType: 'PAN',
        overallConfidence: 0.85,
        rawFields: {},
      };

      const result = validateKYCData(data);

      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain('PAN number');
      expect(result.missingFields).toContain('name');
      expect(result.missingFields.length).toBe(2);
    });

    it('should identify all missing required fields for Aadhar', () => {
      const data: ExtractedKYCData = {
        documentType: 'AADHAR',
        overallConfidence: 0.85,
        rawFields: {},
      };

      const result = validateKYCData(data);

      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain('Aadhar number');
      expect(result.missingFields).toContain('name');
      expect(result.missingFields.length).toBe(2);
    });

    it('should identify only missing name when document number is present', () => {
      const data: ExtractedKYCData = {
        documentType: 'PAN',
        panNumber: {
          value: 'ABCDE1234F',
          confidence: 0.95,
        },
        overallConfidence: 0.95,
        rawFields: {},
      };

      const result = validateKYCData(data);

      expect(result.valid).toBe(false);
      expect(result.missingFields).toEqual(['name']);
      expect(result.missingFields.length).toBe(1);
    });

    it('should identify low confidence fields requiring clarification', () => {
      const data: ExtractedKYCData = {
        documentType: 'PAN',
        panNumber: {
          value: 'ABCDE1234F',
          confidence: 0.75, // Below threshold
        },
        name: {
          value: 'Test User',
          confidence: 0.70, // Below threshold
        },
        overallConfidence: 0.72,
        rawFields: {},
      };

      const result = validateKYCData(data);

      expect(result.valid).toBe(false);
      expect(result.lowConfidenceFields).toContain('PAN number');
      expect(result.lowConfidenceFields).toContain('name');
      expect(result.lowConfidenceFields.length).toBe(2);
      expect(result.errors.some(e => e.includes('PAN number confidence'))).toBe(true);
      expect(result.errors.some(e => e.includes('Name confidence'))).toBe(true);
    });

    it('should identify invalid fields requiring clarification', () => {
      const data: ExtractedKYCData = {
        documentType: 'PAN',
        panNumber: {
          value: 'INVALID123',
          confidence: 0.95,
        },
        name: {
          value: '   ', // Empty/whitespace
          confidence: 0.90,
        },
        overallConfidence: 0.92,
        rawFields: {},
      };

      const result = validateKYCData(data);

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain('PAN number');
      expect(result.invalidFields).toContain('name');
      expect(result.errors.some(e => e.includes('Invalid PAN number format'))).toBe(true);
      expect(result.errors.some(e => e.includes('Name field is empty'))).toBe(true);
    });

    it('should provide detailed error messages for clarification', () => {
      const data: ExtractedKYCData = {
        documentType: 'AADHAR',
        aadharNumber: {
          value: '123456789012', // Invalid checksum
          confidence: 0.75, // Low confidence
        },
        name: {
          value: 'Test User',
          confidence: 0.95,
        },
        overallConfidence: 0.85,
        rawFields: {},
      };

      const result = validateKYCData(data);

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain('Aadhar number');
      expect(result.lowConfidenceFields).toContain('Aadhar number');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('Invalid Aadhar number checksum'))).toBe(true);
      expect(result.errors.some(e => e.includes('Aadhar number confidence'))).toBe(true);
    });

    it('should handle combination of missing, invalid, and low confidence fields', () => {
      const data: ExtractedKYCData = {
        documentType: 'PAN',
        panNumber: {
          value: 'ABC123', // Invalid format
          confidence: 0.70, // Low confidence
        },
        // Missing name field
        overallConfidence: 0.70, // Low overall confidence
        rawFields: {},
      };

      const result = validateKYCData(data);

      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain('name');
      expect(result.invalidFields).toContain('PAN number');
      expect(result.lowConfidenceFields).toContain('PAN number');
      expect(result.errors.length).toBeGreaterThan(2);
    });

    it('should validate successfully when all fields are present and valid', () => {
      const data: ExtractedKYCData = {
        documentType: 'PAN',
        panNumber: {
          value: 'ABCDE1234F',
          confidence: 0.95,
        },
        name: {
          value: 'John Doe',
          confidence: 0.92,
        },
        dateOfBirth: {
          value: '15/08/1985',
          confidence: 0.90,
        },
        overallConfidence: 0.92,
        rawFields: {},
      };

      const result = validateKYCData(data);

      expect(result.valid).toBe(true);
      expect(result.missingFields).toHaveLength(0);
      expect(result.invalidFields).toHaveLength(0);
      expect(result.lowConfidenceFields).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });
  });
});
