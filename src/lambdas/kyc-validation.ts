/**
 * KYC Validation Lambda
 * 
 * This Lambda function validates extracted KYC data from document extraction.
 * It performs format validation, checksum verification, and completeness checks.
 * 
 * Features:
 * - Validates PAN number format using regex (AAAAA9999A)
 * - Validates Aadhar number format and checksum (Verhoeff algorithm)
 * - Checks for required fields (name, document number)
 * - Validates extraction confidence scores (> 80% threshold)
 * - Returns validation result with missing fields list
 * 
 * Validates: Requirements 1.3
 */

import { ExtractedKYCData, ExtractedField } from '../models/kyc';

/**
 * PAN card number format: AAAAA9999A
 * - 5 uppercase letters
 * - 4 digits
 * - 1 uppercase letter
 */
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * Aadhar card number format: 12 digits (no spaces)
 */
const AADHAR_REGEX = /^\d{12}$/;

/**
 * Minimum confidence threshold for extracted fields (80%)
 */
const CONFIDENCE_THRESHOLD = 0.8;

/**
 * Validation result interface
 */
export interface KYCValidationResult {
  valid: boolean;
  missingFields: string[];
  invalidFields: string[];
  lowConfidenceFields: string[];
  errors: string[];
}

/**
 * KYC validation request
 */
export interface KYCValidationRequest {
  extractedData: ExtractedKYCData;
  sellerId: string;
}

/**
 * KYC validation response
 */
export interface KYCValidationResponse {
  success: boolean;
  validationResult?: KYCValidationResult;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Lambda handler for KYC validation
 */
export const handler = async (
  event: KYCValidationRequest
): Promise<KYCValidationResponse> => {
  console.log('KYC validation request:', JSON.stringify(event, null, 2));

  try {
    const validationResult = validateKYCData(event.extractedData);
    
    console.log('Validation result:', JSON.stringify(validationResult, null, 2));
    
    return {
      success: true,
      validationResult,
    };
  } catch (error: any) {
    console.error('KYC validation failed:', error);
    
    return {
      success: false,
      error: {
        code: error.name || 'VALIDATION_ERROR',
        message: error.message || 'Failed to validate KYC data',
      },
    };
  }
};

/**
 * Validate extracted KYC data
 */
export function validateKYCData(data: ExtractedKYCData): KYCValidationResult {
  const result: KYCValidationResult = {
    valid: true,
    missingFields: [],
    invalidFields: [],
    lowConfidenceFields: [],
    errors: [],
  };

  // Check document type
  if (data.documentType === 'UNKNOWN') {
    result.valid = false;
    result.errors.push('Unable to identify document type');
    return result;
  }

  // Validate based on document type
  if (data.documentType === 'PAN') {
    validatePANData(data, result);
  } else if (data.documentType === 'AADHAR') {
    validateAadharData(data, result);
  }

  // Validate common required fields
  validateCommonFields(data, result);

  // Check overall confidence
  if (data.overallConfidence < CONFIDENCE_THRESHOLD) {
    result.valid = false;
    result.errors.push(
      `Overall extraction confidence (${(data.overallConfidence * 100).toFixed(1)}%) is below threshold (${CONFIDENCE_THRESHOLD * 100}%)`
    );
  }

  return result;
}

/**
 * Validate PAN-specific data
 */
function validatePANData(
  data: ExtractedKYCData,
  result: KYCValidationResult
): void {
  // Check if PAN number exists
  if (!data.panNumber) {
    result.valid = false;
    result.missingFields.push('PAN number');
    return;
  }

  // Validate PAN number format
  if (!validatePANFormat(data.panNumber.value)) {
    result.valid = false;
    result.invalidFields.push('PAN number');
    result.errors.push(
      `Invalid PAN number format: ${data.panNumber.value}. Expected format: AAAAA9999A`
    );
  }

  // Check PAN number confidence
  if (data.panNumber.confidence < CONFIDENCE_THRESHOLD) {
    result.valid = false;
    result.lowConfidenceFields.push('PAN number');
    result.errors.push(
      `PAN number confidence (${(data.panNumber.confidence * 100).toFixed(1)}%) is below threshold (${CONFIDENCE_THRESHOLD * 100}%)`
    );
  }
}

/**
 * Validate Aadhar-specific data
 */
function validateAadharData(
  data: ExtractedKYCData,
  result: KYCValidationResult
): void {
  // Check if Aadhar number exists
  if (!data.aadharNumber) {
    result.valid = false;
    result.missingFields.push('Aadhar number');
    return;
  }

  // Remove spaces and validate format
  const aadharNumber = data.aadharNumber.value.replace(/\s/g, '');

  // Validate Aadhar number format
  if (!validateAadharFormat(aadharNumber)) {
    result.valid = false;
    result.invalidFields.push('Aadhar number');
    result.errors.push(
      `Invalid Aadhar number format: ${data.aadharNumber.value}. Expected format: 12 digits`
    );
    return;
  }

  // Validate Aadhar checksum using Verhoeff algorithm
  if (!validateAadharChecksum(aadharNumber)) {
    result.valid = false;
    result.invalidFields.push('Aadhar number');
    result.errors.push(
      `Invalid Aadhar number checksum: ${data.aadharNumber.value}`
    );
  }

  // Check Aadhar number confidence
  if (data.aadharNumber.confidence < CONFIDENCE_THRESHOLD) {
    result.valid = false;
    result.lowConfidenceFields.push('Aadhar number');
    result.errors.push(
      `Aadhar number confidence (${(data.aadharNumber.confidence * 100).toFixed(1)}%) is below threshold (${CONFIDENCE_THRESHOLD * 100}%)`
    );
  }
}

/**
 * Validate common required fields
 */
function validateCommonFields(
  data: ExtractedKYCData,
  result: KYCValidationResult
): void {
  // Check if name exists
  if (!data.name) {
    result.valid = false;
    result.missingFields.push('name');
  } else {
    // Validate name is not empty
    if (!data.name.value || data.name.value.trim().length === 0) {
      result.valid = false;
      result.invalidFields.push('name');
      result.errors.push('Name field is empty');
    }

    // Check name confidence
    if (data.name.confidence < CONFIDENCE_THRESHOLD) {
      result.valid = false;
      result.lowConfidenceFields.push('name');
      result.errors.push(
        `Name confidence (${(data.name.confidence * 100).toFixed(1)}%) is below threshold (${CONFIDENCE_THRESHOLD * 100}%)`
      );
    }
  }
}

/**
 * Validate PAN number format
 */
export function validatePANFormat(panNumber: string): boolean {
  return PAN_REGEX.test(panNumber);
}

/**
 * Validate Aadhar number format
 */
export function validateAadharFormat(aadharNumber: string): boolean {
  return AADHAR_REGEX.test(aadharNumber);
}

/**
 * Validate Aadhar number checksum using Verhoeff algorithm
 * 
 * The Verhoeff algorithm is a checksum formula for error detection
 * used in Aadhar numbers. It detects all single-digit errors and
 * most transposition errors.
 */
export function validateAadharChecksum(aadharNumber: string): boolean {
  // Verhoeff multiplication table
  const d = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  ];

  // Verhoeff permutation table
  const p = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
  ];

  // Verhoeff inverse table
  const inv = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

  // Convert string to array of digits
  const digits = aadharNumber.split('').map(Number);

  // Calculate checksum
  let c = 0;
  for (let i = 0; i < digits.length; i++) {
    const digit = digits[digits.length - 1 - i];
    c = d[c][p[i % 8][digit]];
  }

  // Valid if checksum is 0
  return c === 0;
}
