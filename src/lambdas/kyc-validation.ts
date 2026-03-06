
import { ExtractedKYCData, ExtractedField } from '../models/kyc';

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const AADHAR_REGEX = /^\d{12}$/;

const CONFIDENCE_THRESHOLD = 0.8;

export interface KYCValidationResult {
  valid: boolean;
  missingFields: string[];
  invalidFields: string[];
  lowConfidenceFields: string[];
  errors: string[];
}

export interface KYCValidationRequest {
  extractedData: ExtractedKYCData;
  sellerId: string;
}

interface KYCValidationResponse {
  success: boolean;
  validationResult?: KYCValidationResult;
  error?: {
    code: string;
    message: string;
  };
}

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

export function validateKYCData(data: ExtractedKYCData): KYCValidationResult {
  const result: KYCValidationResult = {
    valid: true,
    missingFields: [],
    invalidFields: [],
    lowConfidenceFields: [],
    errors: [],
  };

  if (data.documentType === 'UNKNOWN') {
    result.valid = false;
    result.errors.push('Unable to identify document type');
    return result;
  }

  if (data.documentType === 'PAN') {
    validatePANData(data, result);
  } else if (data.documentType === 'AADHAR') {
    validateAadharData(data, result);
  }

  validateCommonFields(data, result);

  if (data.overallConfidence < CONFIDENCE_THRESHOLD) {
    result.valid = false;
    result.errors.push(
      `Overall extraction confidence (${(data.overallConfidence * 100).toFixed(1)}%) is below threshold (${CONFIDENCE_THRESHOLD * 100}%)`
    );
  }

  return result;
}

function validatePANData(
  data: ExtractedKYCData,
  result: KYCValidationResult
): void {

  if (!data.panNumber) {
    result.valid = false;
    result.missingFields.push('PAN number');
    return;
  }

  if (!validatePANFormat(data.panNumber.value)) {
    result.valid = false;
    result.invalidFields.push('PAN number');
    result.errors.push(
      `Invalid PAN number format: ${data.panNumber.value}. Expected format: AAAAA9999A`
    );
  }

  if (data.panNumber.confidence < CONFIDENCE_THRESHOLD) {
    result.valid = false;
    result.lowConfidenceFields.push('PAN number');
    result.errors.push(
      `PAN number confidence (${(data.panNumber.confidence * 100).toFixed(1)}%) is below threshold (${CONFIDENCE_THRESHOLD * 100}%)`
    );
  }
}

function validateAadharData(
  data: ExtractedKYCData,
  result: KYCValidationResult
): void {

  if (!data.aadharNumber) {
    result.valid = false;
    result.missingFields.push('Aadhar number');
    return;
  }

  const aadharNumber = data.aadharNumber.value.replace(/\s/g, '');

  if (!validateAadharFormat(aadharNumber)) {
    result.valid = false;
    result.invalidFields.push('Aadhar number');
    result.errors.push(
      `Invalid Aadhar number format: ${data.aadharNumber.value}. Expected format: 12 digits`
    );
    return;
  }

  if (!validateAadharChecksum(aadharNumber)) {
    result.valid = false;
    result.invalidFields.push('Aadhar number');
    result.errors.push(
      `Invalid Aadhar number checksum: ${data.aadharNumber.value}`
    );
  }

  if (data.aadharNumber.confidence < CONFIDENCE_THRESHOLD) {
    result.valid = false;
    result.lowConfidenceFields.push('Aadhar number');
    result.errors.push(
      `Aadhar number confidence (${(data.aadharNumber.confidence * 100).toFixed(1)}%) is below threshold (${CONFIDENCE_THRESHOLD * 100}%)`
    );
  }
}

function validateCommonFields(
  data: ExtractedKYCData,
  result: KYCValidationResult
): void {

  if (!data.name) {
    result.valid = false;
    result.missingFields.push('name');
  } else {

    if (!data.name.value || data.name.value.trim().length === 0) {
      result.valid = false;
      result.invalidFields.push('name');
      result.errors.push('Name field is empty');
    }

    if (data.name.confidence < CONFIDENCE_THRESHOLD) {
      result.valid = false;
      result.lowConfidenceFields.push('name');
      result.errors.push(
        `Name confidence (${(data.name.confidence * 100).toFixed(1)}%) is below threshold (${CONFIDENCE_THRESHOLD * 100}%)`
      );
    }
  }
}

export function validatePANFormat(panNumber: string): boolean {
  return PAN_REGEX.test(panNumber);
}

export function validateAadharFormat(aadharNumber: string): boolean {
  return AADHAR_REGEX.test(aadharNumber);
}

export function validateAadharChecksum(aadharNumber: string): boolean {

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

  const inv = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

  const digits = aadharNumber.split('').map(Number);

  let c = 0;
  for (let i = 0; i < digits.length; i++) {
    const digit = digits[digits.length - 1 - i];
    c = d[c][p[i % 8][digit]];
  }

  return c === 0;
}
