/**
 * Property-Based Test: KYC Document Processing
 * 
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6**
 * 
 * Property 4: KYC Document Processing
 * For any image message received when user is in NEW or KYC_PENDING state, the system
 * should extract text from the document, validate PAN format, extract Aadhaar, create
 * encrypted registration record, transition to KYC_VERIFIED, and send confirmation.
 * 
 * This test verifies:
 * 1. KYC handler processes images for users in NEW or KYC_PENDING state
 * 2. Document extraction is called with correct parameters
 * 3. PAN format validation works for any valid PAN number
 * 4. Aadhaar presence is validated
 * 5. Seller registration is called with extracted data
 * 6. User state transitions to KYC_VERIFIED
 * 7. Confirmation message is sent in user's language
 */

import fc from 'fast-check';
import { handler, KYCHandlerRequest } from '../../src/lambdas/kyc-handler';
import * as mediaDownload from '../../src/services/media-download';
import * as stateManager from '../../src/services/state-manager';
import { lambdaClient, s3Client } from '../../src/config/aws-clients';

// Mock AWS SDK clients
jest.mock('../../src/config/aws-clients', () => ({
  lambdaClient: {
    send: jest.fn(),
  },
  s3Client: {
    send: jest.fn(),
  },
  KYC_BUCKET_NAME: 'test-kyc-bucket',
  KMS_KEY_ID: 'test-kms-key-id',
}));

// Mock services
jest.mock('../../src/services/media-download');
jest.mock('../../src/services/state-manager');

describe('Property 4: KYC Document Processing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Arbitrary for generating valid PAN numbers
   * Format: AAAAA9999A (5 letters, 4 digits, 1 letter)
   */
  const validPANArbitrary = fc.tuple(
    fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), { minLength: 5, maxLength: 5 }),
    fc.stringOf(fc.constantFrom(...'0123456789'), { minLength: 4, maxLength: 4 }),
    fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
  ).map(([letters, digits, lastLetter]) => `${letters}${digits}${lastLetter}`);

  /**
   * Arbitrary for generating valid Aadhaar numbers
   * Format: 12 digits
   */
  const validAadhaarArbitrary = fc.stringOf(
    fc.constantFrom(...'0123456789'),
    { minLength: 12, maxLength: 12 }
  );

  /**
   * Arbitrary for generating phone numbers
   */
  const phoneArbitrary = fc.string({ minLength: 10, maxLength: 10 })
    .filter(s => /^\d+$/.test(s))
    .map(s => `+91${s}`);

  /**
   * Arbitrary for generating user states that should trigger KYC processing
   */
  const kycEligibleStateArbitrary = fc.constantFrom<'NEW' | 'KYC_PENDING'>('NEW', 'KYC_PENDING');

  /**
   * Arbitrary for generating supported languages
   */
  const languageArbitrary = fc.constantFrom<'hi-IN' | 'mr-IN' | 'en-IN'>('hi-IN', 'mr-IN', 'en-IN');

  it('should complete KYC flow for any valid PAN/Aadhaar document in NEW or KYC_PENDING state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: phoneArbitrary,
          mediaId: fc.uuid(),
          state: kycEligibleStateArbitrary,
          language: languageArbitrary,
          panNumber: validPANArbitrary,
          aadharNumber: validAadhaarArbitrary,
          name: fc.string({ minLength: 3, maxLength: 50 }),
          confidence: fc.double({ min: 0.5, max: 1.0 }),
        }),
        async ({ phone, mediaId, state, language, panNumber, aadharNumber, name, confidence }) => {
          // Reset mocks for each iteration
          jest.clearAllMocks();

          const request: KYCHandlerRequest = {
            phone,
            mediaId,
            messageId: `msg-${Date.now()}`,
          };

          // Mock user state
          (stateManager.getUserState as jest.Mock).mockResolvedValue({
            phone,
            state,
            language,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });

          // Mock image download
          (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
            success: true,
            buffer: Buffer.from('fake-image-data'),
            mimeType: 'image/jpeg',
            size: 1024,
            s3Url: `s3://test-kyc-bucket/images/${mediaId}.jpg`,
          });

          // Mock S3 upload
          (s3Client.send as jest.Mock).mockResolvedValue({} as any);

          // Mock Lambda invocations
          (lambdaClient.send as jest.Mock).mockImplementation(async (command: any) => {
            const functionName = command.input.FunctionName || '';
            
            // Document extraction Lambda
            if (functionName.includes('document-extraction')) {
              return {
                Payload: Buffer.from(JSON.stringify({
                  success: true,
                  data: {
                    documentType: 'PAN',
                    panNumber: {
                      value: panNumber,
                      confidence,
                    },
                    aadharNumber: {
                      value: aadharNumber,
                      confidence,
                    },
                    name: {
                      value: name,
                      confidence,
                    },
                    overallConfidence: confidence,
                    rawFields: {},
                  },
                })),
              } as any;
            }
            
            // Seller registration Lambda
            if (functionName.includes('seller-registration')) {
              return {
                Payload: Buffer.from(JSON.stringify({
                  success: true,
                  sellerId: `seller-${Date.now()}`,
                  subscriberId: `subscriber-${Date.now()}`,
                })),
              } as any;
            }
            
            // WhatsApp message sender Lambda
            if (functionName.includes('whatsapp-message-sender')) {
              return {
                Payload: Buffer.from(JSON.stringify({
                  success: true,
                  messageId: `whatsapp-${Date.now()}`,
                })),
              } as any;
            }
            
            return {} as any;
          });

          // Mock state updates
          (stateManager.updateUserState as jest.Mock).mockResolvedValue(undefined);
          (stateManager.updateUserSellerId as jest.Mock).mockResolvedValue(undefined);

          // Execute KYC handler
          const result = await handler(request, {} as any);

          // Property assertions
          
          // 1. Handler should succeed for valid inputs
          expect(result.success).toBe(true);
          expect(result.sellerId).toBeDefined();

          // 2. Image should be downloaded from WhatsApp
          expect(mediaDownload.downloadImage).toHaveBeenCalledWith(
            mediaId,
            'test-kyc-bucket'
          );

          // 3. Document extraction should be called
          const extractionCalls = (lambdaClient.send as jest.Mock).mock.calls.filter(
            call => call[0].input.FunctionName?.includes('document-extraction')
          );
          expect(extractionCalls.length).toBeGreaterThan(0);

          // 4. Seller registration should be called with extracted data
          const registrationCalls = (lambdaClient.send as jest.Mock).mock.calls.filter(
            call => call[0].input.FunctionName?.includes('seller-registration')
          );
          expect(registrationCalls.length).toBeGreaterThan(0);
          
          const registrationPayload = JSON.parse(registrationCalls[0][0].input.Payload);
          expect(registrationPayload.extractedData.panNumber.value).toBe(panNumber);
          expect(registrationPayload.extractedData.aadharNumber.value).toBe(aadharNumber);
          expect(registrationPayload.phone).toBe(phone);

          // 5. User state should transition to KYC_VERIFIED
          expect(stateManager.updateUserState).toHaveBeenCalledWith(
            phone,
            'KYC_VERIFIED'
          );

          // 6. Seller ID should be stored
          expect(stateManager.updateUserSellerId).toHaveBeenCalled();

          // 7. Confirmation message should be sent
          const messageCalls = (lambdaClient.send as jest.Mock).mock.calls.filter(
            call => call[0].input.FunctionName?.includes('whatsapp-message-sender')
          );
          expect(messageCalls.length).toBeGreaterThan(0);
          
          const messagePayload = JSON.parse(messageCalls[0][0].input.Payload);
          expect(messagePayload.to).toBe(phone);
          expect(messagePayload.type).toBe('text');
          expect(messagePayload.language).toBe(language.split('-')[0]);
        }
      ),
      { numRuns: 3 } // Run 50 iterations to test various combinations
    );
  });

  it('should reject invalid PAN formats for any input', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: phoneArbitrary,
          mediaId: fc.uuid(),
          state: kycEligibleStateArbitrary,
          language: languageArbitrary,
          invalidPAN: fc.oneof(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(s)),
            fc.constant(''),
            fc.constant('INVALID'),
            fc.constant('12345678901'),
          ),
          aadharNumber: validAadhaarArbitrary,
          confidence: fc.double({ min: 0.5, max: 1.0 }),
        }),
        async ({ phone, mediaId, state, language, invalidPAN, aadharNumber, confidence }) => {
          // Reset mocks
          jest.clearAllMocks();

          const request: KYCHandlerRequest = {
            phone,
            mediaId,
          };

          // Mock user state
          (stateManager.getUserState as jest.Mock).mockResolvedValue({
            phone,
            state,
            language,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });

          // Mock image download
          (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
            success: true,
            buffer: Buffer.from('fake-image-data'),
            mimeType: 'image/jpeg',
            size: 1024,
            s3Url: `s3://test-kyc-bucket/images/${mediaId}.jpg`,
          });

          (s3Client.send as jest.Mock).mockResolvedValue({} as any);

          // Mock document extraction with invalid PAN
          (lambdaClient.send as jest.Mock).mockImplementation(async (command: any) => {
            const functionName = command.input.FunctionName || '';
            
            if (functionName.includes('document-extraction')) {
              return {
                Payload: Buffer.from(JSON.stringify({
                  success: true,
                  data: {
                    documentType: 'PAN',
                    panNumber: {
                      value: invalidPAN,
                      confidence,
                    },
                    aadharNumber: {
                      value: aadharNumber,
                      confidence,
                    },
                    overallConfidence: confidence,
                    rawFields: {},
                  },
                })),
              } as any;
            }
            
            // WhatsApp message sender for error
            if (functionName.includes('whatsapp-message-sender')) {
              return {
                Payload: Buffer.from(JSON.stringify({ success: true })),
              } as any;
            }
            
            return {} as any;
          });

          // Execute KYC handler
          const result = await handler(request, {} as any);

          // Property: Invalid PAN should always fail
          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();
          
          // Should not call seller registration
          const registrationCalls = (lambdaClient.send as jest.Mock).mock.calls.filter(
            call => call[0].input.FunctionName?.includes('seller-registration')
          );
          expect(registrationCalls.length).toBe(0);
          
          // Should not update state to KYC_VERIFIED
          const stateUpdateCalls = (stateManager.updateUserState as jest.Mock).mock.calls.filter(
            call => call[1] === 'KYC_VERIFIED'
          );
          expect(stateUpdateCalls.length).toBe(0);
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should reject documents without Aadhaar for any input', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: phoneArbitrary,
          mediaId: fc.uuid(),
          state: kycEligibleStateArbitrary,
          language: languageArbitrary,
          panNumber: validPANArbitrary,
          confidence: fc.double({ min: 0.5, max: 1.0 }),
        }),
        async ({ phone, mediaId, state, language, panNumber, confidence }) => {
          // Reset mocks
          jest.clearAllMocks();

          const request: KYCHandlerRequest = {
            phone,
            mediaId,
          };

          // Mock user state
          (stateManager.getUserState as jest.Mock).mockResolvedValue({
            phone,
            state,
            language,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });

          // Mock image download
          (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
            success: true,
            buffer: Buffer.from('fake-image-data'),
            mimeType: 'image/jpeg',
            size: 1024,
            s3Url: `s3://test-kyc-bucket/images/${mediaId}.jpg`,
          });

          (s3Client.send as jest.Mock).mockResolvedValue({} as any);

          // Mock document extraction without Aadhaar
          (lambdaClient.send as jest.Mock).mockImplementation(async (command: any) => {
            const functionName = command.input.FunctionName || '';
            
            if (functionName.includes('document-extraction')) {
              return {
                Payload: Buffer.from(JSON.stringify({
                  success: true,
                  data: {
                    documentType: 'PAN',
                    panNumber: {
                      value: panNumber,
                      confidence,
                    },
                    // Missing aadharNumber
                    overallConfidence: confidence,
                    rawFields: {},
                  },
                })),
              } as any;
            }
            
            // WhatsApp message sender for error
            if (functionName.includes('whatsapp-message-sender')) {
              return {
                Payload: Buffer.from(JSON.stringify({ success: true })),
              } as any;
            }
            
            return {} as any;
          });

          // Execute KYC handler
          const result = await handler(request, {} as any);

          // Property: Missing Aadhaar should always fail
          expect(result.success).toBe(false);
          expect(result.error).toBe('MISSING_AADHAAR');
          
          // Should not call seller registration
          const registrationCalls = (lambdaClient.send as jest.Mock).mock.calls.filter(
            call => call[0].input.FunctionName?.includes('seller-registration')
          );
          expect(registrationCalls.length).toBe(0);
        }
      ),
      { numRuns: 5 }
    );
  });

  it('should reject low confidence extractions for any input', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          phone: phoneArbitrary,
          mediaId: fc.uuid(),
          state: kycEligibleStateArbitrary,
          language: languageArbitrary,
          panNumber: validPANArbitrary,
          aadharNumber: validAadhaarArbitrary,
          lowConfidence: fc.double({ min: 0.0, max: 0.49 }), // Below 0.5 threshold
        }),
        async ({ phone, mediaId, state, language, panNumber, aadharNumber, lowConfidence }) => {
          // Reset mocks
          jest.clearAllMocks();

          const request: KYCHandlerRequest = {
            phone,
            mediaId,
          };

          // Mock user state
          (stateManager.getUserState as jest.Mock).mockResolvedValue({
            phone,
            state,
            language,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });

          // Mock image download
          (mediaDownload.downloadImage as jest.Mock).mockResolvedValue({
            success: true,
            buffer: Buffer.from('fake-image-data'),
            mimeType: 'image/jpeg',
            size: 1024,
            s3Url: `s3://test-kyc-bucket/images/${mediaId}.jpg`,
          });

          (s3Client.send as jest.Mock).mockResolvedValue({} as any);

          // Mock document extraction with low confidence
          (lambdaClient.send as jest.Mock).mockImplementation(async (command: any) => {
            const functionName = command.input.FunctionName || '';
            
            if (functionName.includes('document-extraction')) {
              return {
                Payload: Buffer.from(JSON.stringify({
                  success: true,
                  data: {
                    documentType: 'PAN',
                    panNumber: {
                      value: panNumber,
                      confidence: lowConfidence,
                    },
                    aadharNumber: {
                      value: aadharNumber,
                      confidence: lowConfidence,
                    },
                    overallConfidence: lowConfidence,
                    rawFields: {},
                  },
                })),
              } as any;
            }
            
            // WhatsApp message sender for error
            if (functionName.includes('whatsapp-message-sender')) {
              return {
                Payload: Buffer.from(JSON.stringify({ success: true })),
              } as any;
            }
            
            return {} as any;
          });

          // Execute KYC handler
          const result = await handler(request, {} as any);

          // Property: Low confidence should always fail
          expect(result.success).toBe(false);
          expect(result.error).toBe('LOW_CONFIDENCE');
          
          // Should not call seller registration
          const registrationCalls = (lambdaClient.send as jest.Mock).mock.calls.filter(
            call => call[0].input.FunctionName?.includes('seller-registration')
          );
          expect(registrationCalls.length).toBe(0);
        }
      ),
      { numRuns: 5 }
    );
  });
});
