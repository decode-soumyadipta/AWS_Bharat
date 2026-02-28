/**
 * Unit Tests for Error Scenarios
 * 
 * Tests specific error handling scenarios and edge cases.
 * 
 * **Validates: Requirements 8.6, 8.8**
 */

import {
  categorizeError,
  ErrorCategory,
  ErrorCodes,
  CategorizedError,
  logStructured,
} from '../../src/utils/error-handler';

describe('Error Scenarios', () => {
  describe('Unexpected State Recovery', () => {
    /**
     * Requirement 8.6: When the system is in an unexpected state, 
     * THE System SHALL send a message asking the user to start over
     */
    it('should categorize unexpected state errors as permanent', () => {
      const error = new Error('Unexpected state transition');
      const category = categorizeError(error, ErrorCodes.INVALID_STATE_TRANSITION);
      
      expect(category).toBe(ErrorCategory.PERMANENT);
    });

    it('should handle missing user state gracefully', () => {
      const error = new Error('User state not found');
      const category = categorizeError(error, ErrorCodes.STATE_RETRIEVAL_FAILED);
      
      // State retrieval failures should be critical
      expect(category).toBe(ErrorCategory.CRITICAL);
    });

    it('should provide context for state errors', () => {
      const error = new CategorizedError(
        'Invalid state transition from ACTIVE to NEW',
        ErrorCategory.PERMANENT,
        ErrorCodes.INVALID_STATE_TRANSITION,
        {
          currentState: 'ACTIVE',
          attemptedState: 'NEW',
          phone: '+911234567890',
        }
      );

      expect(error.context).toEqual({
        currentState: 'ACTIVE',
        attemptedState: 'NEW',
        phone: '+911234567890',
      });
      expect(error.retryable).toBe(false);
    });
  });

  describe('Unrecognized Command Help', () => {
    /**
     * Requirement 8.8: When a user sends an unrecognized command, 
     * THE System SHALL send a help message with available actions
     */
    it('should categorize unrecognized commands as permanent errors', () => {
      const error = new Error('Unrecognized command');
      const category = categorizeError(error);
      
      expect(category).toBe(ErrorCategory.PERMANENT);
    });

    it('should not retry unrecognized commands', () => {
      const error = new CategorizedError(
        'Unrecognized command: /invalid',
        ErrorCategory.PERMANENT,
        'UNRECOGNIZED_COMMAND',
        { command: '/invalid' },
        false // not retryable
      );

      expect(error.retryable).toBe(false);
      expect(error.category).toBe(ErrorCategory.PERMANENT);
    });
  });

  describe('Media Download Errors', () => {
    it('should categorize expired URL as permanent error', () => {
      const error = new CategorizedError(
        'Media URL has expired',
        ErrorCategory.PERMANENT,
        ErrorCodes.MEDIA_URL_EXPIRED,
        { mediaId: 'test-media-123' }
      );

      expect(error.category).toBe(ErrorCategory.PERMANENT);
      expect(error.code).toBe(ErrorCodes.MEDIA_URL_EXPIRED);
    });

    it('should categorize oversized file as permanent error', () => {
      const error = new CategorizedError(
        'File size exceeds limit',
        ErrorCategory.PERMANENT,
        ErrorCodes.MEDIA_TOO_LARGE,
        { size: 20 * 1024 * 1024, limit: 16 * 1024 * 1024 }
      );

      expect(error.category).toBe(ErrorCategory.PERMANENT);
      expect(error.code).toBe(ErrorCodes.MEDIA_TOO_LARGE);
      expect(error.context?.size).toBe(20 * 1024 * 1024);
    });

    it('should categorize unsupported type as permanent error', () => {
      const error = new CategorizedError(
        'Unsupported media type',
        ErrorCategory.PERMANENT,
        ErrorCodes.MEDIA_UNSUPPORTED_TYPE,
        { mimeType: 'video/mp4' }
      );

      expect(error.category).toBe(ErrorCategory.PERMANENT);
      expect(error.code).toBe(ErrorCodes.MEDIA_UNSUPPORTED_TYPE);
    });
  });

  describe('KYC Processing Errors', () => {
    it('should categorize invalid PAN format as permanent error', () => {
      const error = new CategorizedError(
        'Invalid PAN format',
        ErrorCategory.PERMANENT,
        ErrorCodes.INVALID_PAN_FORMAT,
        { panNumber: 'INVALID123' }
      );

      expect(error.category).toBe(ErrorCategory.PERMANENT);
      expect(error.code).toBe(ErrorCodes.INVALID_PAN_FORMAT);
    });

    it('should categorize document extraction failure as transient', () => {
      const error = new Error('Document extraction service unavailable');
      error.name = 'ServiceUnavailable';
      const category = categorizeError(error);

      expect(category).toBe(ErrorCategory.TRANSIENT);
    });

    it('should categorize KMS encryption failure as critical', () => {
      const error = new Error('KMS key not accessible');
      error.name = 'KMSException';
      const category = categorizeError(error);

      expect(category).toBe(ErrorCategory.CRITICAL);
    });
  });

  describe('Voice Processing Errors', () => {
    it('should categorize transcription timeout as transient', () => {
      const error = new Error('Transcription job timed out');
      error.name = 'Timeout';
      const category = categorizeError(error);

      expect(category).toBe(ErrorCategory.TRANSIENT);
    });

    it('should categorize unsupported audio format as permanent', () => {
      const error = new CategorizedError(
        'Unsupported audio format',
        ErrorCategory.PERMANENT,
        ErrorCodes.UNSUPPORTED_AUDIO_FORMAT,
        { mimeType: 'audio/wav' }
      );

      expect(error.category).toBe(ErrorCategory.PERMANENT);
      expect(error.code).toBe(ErrorCodes.UNSUPPORTED_AUDIO_FORMAT);
    });
  });

  describe('DynamoDB Errors', () => {
    it('should categorize throttling as transient', () => {
      const error = new Error('Request rate exceeded');
      error.name = 'ThrottlingException';
      const category = categorizeError(error);

      expect(category).toBe(ErrorCategory.TRANSIENT);
    });

    it('should categorize provisioned throughput exceeded as critical', () => {
      const error = new Error('Provisioned throughput exceeded');
      error.name = 'ProvisionedThroughputExceededException';
      const category = categorizeError(error);

      expect(category).toBe(ErrorCategory.CRITICAL);
    });

    it('should categorize conditional check failed as permanent', () => {
      const error = new Error('Conditional check failed');
      error.name = 'ConditionalCheckFailedException';
      const category = categorizeError(error);

      expect(category).toBe(ErrorCategory.PERMANENT);
    });
  });

  describe('Network Errors', () => {
    it('should categorize connection reset as transient', () => {
      const error = new Error('Connection reset by peer');
      (error as any).code = 'ECONNRESET';
      const category = categorizeError(error);

      expect(category).toBe(ErrorCategory.TRANSIENT);
    });

    it('should categorize timeout as transient', () => {
      const error = new Error('Request timed out');
      (error as any).code = 'ETIMEDOUT';
      const category = categorizeError(error);

      expect(category).toBe(ErrorCategory.TRANSIENT);
    });
  });

  describe('Structured Logging', () => {
    it('should log with all required fields', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logStructured(
        'ERROR',
        'Test error message',
        { userId: '123', operation: 'test' },
        ErrorCodes.UNEXPECTED_ERROR,
        ErrorCategory.PERMANENT
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"level":"ERROR"')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"message":"Test error message"')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"errorCode":"UNEXPECTED_ERROR"')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"errorCategory":"PERMANENT"')
      );

      consoleSpy.mockRestore();
    });

    it('should include trace ID when available', () => {
      const originalTraceId = process.env._X_AMZN_TRACE_ID;
      process.env._X_AMZN_TRACE_ID = 'Root=1-test-trace-id';

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      logStructured('INFO', 'Test message');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"traceId":"Root=1-test-trace-id"')
      );

      consoleSpy.mockRestore();
      if (originalTraceId) {
        process.env._X_AMZN_TRACE_ID = originalTraceId;
      } else {
        delete process.env._X_AMZN_TRACE_ID;
      }
    });
  });

  describe('Error Context Preservation', () => {
    it('should preserve all error context through categorization', () => {
      const originalError = new CategorizedError(
        'Test error',
        ErrorCategory.TRANSIENT,
        'TEST_ERROR',
        {
          phone: '+911234567890',
          messageId: 'msg-123',
          attempt: 2,
        },
        true
      );

      expect(originalError.message).toBe('Test error');
      expect(originalError.category).toBe(ErrorCategory.TRANSIENT);
      expect(originalError.code).toBe('TEST_ERROR');
      expect(originalError.context).toEqual({
        phone: '+911234567890',
        messageId: 'msg-123',
        attempt: 2,
      });
      expect(originalError.retryable).toBe(true);
    });

    it('should maintain error stack trace', () => {
      const error = new CategorizedError(
        'Test error with stack',
        ErrorCategory.PERMANENT,
        'TEST_ERROR'
      );

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('Test error with stack');
    });
  });
});
