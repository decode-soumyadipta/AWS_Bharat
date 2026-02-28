/**
 * Property-Based Tests for Error Handling
 * 
 * Tests universal properties of error handling and retry logic.
 * 
 * **Property 12: Error Handling with User Guidance**
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**
 * 
 * **Property 14: Retry Logic Consistency**
 * **Validates: Requirements 2.6, 7.6, 10.4**
 */

import fc from 'fast-check';
import {
  categorizeError,
  categorizeAwsError,
  ErrorCategory,
  ErrorCodes,
  CategorizedError,
  retryWithBackoff,
  calculateBackoffDelay,
  DEFAULT_RETRY_CONFIG,
  logStructured,
} from '../../src/utils/error-handler';

describe('Property 12: Error Handling with User Guidance', () => {
  /**
   * Property: All errors should be categorized into one of three categories
   */
  it('should categorize all errors into TRANSIENT, PERMANENT, or CRITICAL', () => {
    fc.assert(
      fc.property(
        fc.record({
          name: fc.oneof(
            fc.constant('ThrottlingException'),
            fc.constant('ServiceUnavailable'),
            fc.constant('Timeout'),
            fc.constant('KMSException'),
            fc.constant('AccessDenied'),
            fc.constant('ValidationException'),
            fc.constant('UnknownError')
          ),
          message: fc.string(),
        }),
        (errorData) => {
          const error = new Error(errorData.message);
          error.name = errorData.name;
          
          const category = categorizeError(error);
          
          // Should be one of the three categories
          expect([
            ErrorCategory.TRANSIENT,
            ErrorCategory.PERMANENT,
            ErrorCategory.CRITICAL,
          ]).toContain(category);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Transient errors should be retryable
   */
  it('should mark transient errors as retryable', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'ThrottlingException',
          'TooManyRequests',
          'ServiceUnavailable',
          'Timeout'
        ),
        (errorName) => {
          const error = new Error('Transient error');
          error.name = errorName;
          
          const category = categorizeError(error);
          
          expect(category).toBe(ErrorCategory.TRANSIENT);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property: Critical errors should trigger alerts
   */
  it('should categorize KMS and access errors as critical', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'KMSException',
          'AccessDenied',
          'InternalError',
          'ProvisionedThroughputExceededException'
        ),
        (errorName) => {
          const error = new Error('Critical error');
          error.name = errorName;
          
          const category = categorizeError(error);
          
          expect(category).toBe(ErrorCategory.CRITICAL);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property: CategorizedError should preserve category and context
   */
  it('should preserve error category and context in CategorizedError', () => {
    fc.assert(
      fc.property(
        fc.record({
          message: fc.string({ minLength: 1 }),
          category: fc.constantFrom(
            ErrorCategory.TRANSIENT,
            ErrorCategory.PERMANENT,
            ErrorCategory.CRITICAL
          ),
          code: fc.string({ minLength: 1 }),
          context: fc.dictionary(fc.string(), fc.anything()),
        }),
        (errorData) => {
          const error = new CategorizedError(
            errorData.message,
            errorData.category,
            errorData.code,
            errorData.context
          );
          
          expect(error.message).toBe(errorData.message);
          expect(error.category).toBe(errorData.category);
          expect(error.code).toBe(errorData.code);
          expect(error.context).toEqual(errorData.context);
          expect(error.name).toBe('CategorizedError');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Error codes should map to appropriate categories
   */
  it('should map error codes to correct categories', () => {
    const transientCodes = [
      ErrorCodes.MEDIA_DOWNLOAD_FAILED,
      ErrorCodes.NETWORK_TIMEOUT,
      ErrorCodes.DYNAMODB_THROTTLED,
    ];

    const criticalCodes = [
      ErrorCodes.STATE_UPDATE_FAILED,
      ErrorCodes.KMS_ENCRYPTION_FAILED,
      ErrorCodes.EVENTBRIDGE_PUBLISH_FAILED,
    ];

    const permanentCodes = [
      ErrorCodes.INVALID_PAN_FORMAT,
      ErrorCodes.MEDIA_TOO_LARGE,
      ErrorCodes.MEDIA_UNSUPPORTED_TYPE,
    ];

    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(...transientCodes),
          fc.constantFrom(...criticalCodes),
          fc.constantFrom(...permanentCodes)
        ),
        (errorCode) => {
          const error = new Error('Test error');
          const category = categorizeError(error, errorCode);
          
          if ((transientCodes as string[]).includes(errorCode)) {
            expect(category).toBe(ErrorCategory.TRANSIENT);
          } else if ((criticalCodes as string[]).includes(errorCode)) {
            expect(category).toBe(ErrorCategory.CRITICAL);
          } else {
            expect(category).toBe(ErrorCategory.PERMANENT);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 14: Retry Logic Consistency', () => {
  /**
   * Property: Backoff delay should increase exponentially
   */
  it('should calculate exponentially increasing delays', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 }),
        (attempt) => {
          const delay = calculateBackoffDelay(attempt, {
            ...DEFAULT_RETRY_CONFIG,
            jitter: false, // Disable jitter for predictable testing
          });
          
          const expectedDelay = Math.min(
            DEFAULT_RETRY_CONFIG.baseDelay * Math.pow(DEFAULT_RETRY_CONFIG.backoffMultiplier, attempt),
            DEFAULT_RETRY_CONFIG.maxDelay
          );
          
          expect(delay).toBe(expectedDelay);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property: Backoff delay should respect max delay
   */
  it('should cap delay at maxDelay', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        (attempt) => {
          const delay = calculateBackoffDelay(attempt, {
            ...DEFAULT_RETRY_CONFIG,
            jitter: false,
          });
          
          expect(delay).toBeLessThanOrEqual(DEFAULT_RETRY_CONFIG.maxDelay);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property: Jitter should produce delays within expected range
   */
  it('should apply jitter within 50-100% of base delay', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        (attempt) => {
          const delay = calculateBackoffDelay(attempt, {
            ...DEFAULT_RETRY_CONFIG,
            jitter: true,
          });
          
          const baseDelay = Math.min(
            DEFAULT_RETRY_CONFIG.baseDelay * Math.pow(DEFAULT_RETRY_CONFIG.backoffMultiplier, attempt),
            DEFAULT_RETRY_CONFIG.maxDelay
          );
          
          // Jitter should be between 50% and 100% of base delay
          expect(delay).toBeGreaterThanOrEqual(baseDelay * 0.5);
          expect(delay).toBeLessThanOrEqual(baseDelay);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Retry should succeed if operation eventually succeeds
   */
  it('should succeed if operation succeeds within max attempts', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        async (successOnAttempt) => {
          let attemptCount = 0;
          
          const operation = async () => {
            attemptCount++;
            if (attemptCount < successOnAttempt) {
              const error = new Error('Transient error');
              error.name = 'ThrottlingException';
              throw error;
            }
            return 'success';
          };
          
          const result = await retryWithBackoff(
            operation,
            'test-operation',
            { maxAttempts: 3, baseDelay: 10, maxDelay: 100, backoffMultiplier: 2, jitter: false }
          );
          
          expect(result).toBe('success');
          expect(attemptCount).toBe(successOnAttempt);
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property: Retry should fail after max attempts for transient errors
   */
  it('should fail after max attempts for persistent transient errors', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(null),
        async () => {
          let attemptCount = 0;
          
          const operation = async () => {
            attemptCount++;
            const error = new Error('Persistent transient error');
            error.name = 'ThrottlingException';
            throw error;
          };
          
          await expect(
            retryWithBackoff(
              operation,
              'test-operation',
              { maxAttempts: 3, baseDelay: 10, maxDelay: 100, backoffMultiplier: 2, jitter: false }
            )
          ).rejects.toThrow('Persistent transient error');
          
          expect(attemptCount).toBe(3);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Property: Retry should not retry permanent errors
   */
  it('should not retry permanent errors', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(null),
        async () => {
          let attemptCount = 0;
          
          const operation = async () => {
            attemptCount++;
            const error = new Error('Permanent error');
            error.name = 'ValidationException';
            throw error;
          };
          
          await expect(
            retryWithBackoff(
              operation,
              'test-operation',
              { maxAttempts: 3, baseDelay: 10, maxDelay: 100, backoffMultiplier: 2, jitter: false }
            )
          ).rejects.toThrow('Permanent error');
          
          // Should only attempt once for permanent errors
          expect(attemptCount).toBe(1);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Property: Retry should not retry critical errors
   */
  it('should not retry critical errors', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(null),
        async () => {
          let attemptCount = 0;
          
          const operation = async () => {
            attemptCount++;
            const error = new Error('Critical error');
            error.name = 'KMSException';
            throw error;
          };
          
          await expect(
            retryWithBackoff(
              operation,
              'test-operation',
              { maxAttempts: 3, baseDelay: 10, maxDelay: 100, backoffMultiplier: 2, jitter: false }
            )
          ).rejects.toThrow('Critical error');
          
          // Should only attempt once for critical errors
          expect(attemptCount).toBe(1);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Property: Retry count should never exceed max attempts
   */
  it('should never exceed max attempts for transient errors', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 3, max: 5 }), // Limit range to avoid long test times
        async (maxAttempts) => {
          let attemptCount = 0;
          
          const operation = async () => {
            attemptCount++;
            const error = new Error('Transient error');
            error.name = 'ThrottlingException'; // Use a clear AWS error name
            throw error;
          };
          
          try {
            await retryWithBackoff(
              operation,
              'test-operation',
              { maxAttempts, baseDelay: 5, maxDelay: 50, backoffMultiplier: 2, jitter: false }
            );
            // Should not reach here
            expect(true).toBe(false);
          } catch (error) {
            // Expected to fail after max attempts
            expect(attemptCount).toBe(maxAttempts);
          }
        }
      ),
      { numRuns: 10 }
    );
  });
});
