/**
 * Error Handling and Monitoring Utilities
 * 
 * Provides structured error handling with categorization, logging, and monitoring.
 * Implements retry logic with exponential backoff for transient errors.
 * 
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.7
 */

import { publishMetric, MetricName, MetricUnit } from '../config/metrics';

/**
 * Error categories for different handling strategies
 */
export enum ErrorCategory {
  TRANSIENT = 'TRANSIENT',     // Retry automatically (network, throttling)
  PERMANENT = 'PERMANENT',      // Notify user immediately (invalid format, unsupported type)
  CRITICAL = 'CRITICAL',        // Alert monitoring (DynamoDB failures, KMS errors)
}

/**
 * Structured error with category and context
 */
export class CategorizedError extends Error {
  constructor(
    message: string,
    public readonly category: ErrorCategory,
    public readonly code: string,
    public readonly context?: Record<string, any>,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'CategorizedError';
    Object.setPrototypeOf(this, CategorizedError.prototype);
  }
}

/**
 * Error codes for specific error scenarios
 */
export const ErrorCodes = {
  // Media download errors
  MEDIA_DOWNLOAD_FAILED: 'MEDIA_DOWNLOAD_FAILED',
  MEDIA_URL_EXPIRED: 'MEDIA_URL_EXPIRED',
  MEDIA_TOO_LARGE: 'MEDIA_TOO_LARGE',
  MEDIA_UNSUPPORTED_TYPE: 'MEDIA_UNSUPPORTED_TYPE',
  
  // KYC errors
  DOCUMENT_EXTRACTION_FAILED: 'DOCUMENT_EXTRACTION_FAILED',
  INVALID_PAN_FORMAT: 'INVALID_PAN_FORMAT',
  MISSING_AADHAAR: 'MISSING_AADHAAR',
  KYC_REGISTRATION_FAILED: 'KYC_REGISTRATION_FAILED',
  
  // Voice processing errors
  TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
  UNSUPPORTED_AUDIO_FORMAT: 'UNSUPPORTED_AUDIO_FORMAT',
  INTENT_CLASSIFICATION_FAILED: 'INTENT_CLASSIFICATION_FAILED',
  ENTITY_EXTRACTION_FAILED: 'ENTITY_EXTRACTION_FAILED',
  
  // State management errors
  STATE_RETRIEVAL_FAILED: 'STATE_RETRIEVAL_FAILED',
  STATE_UPDATE_FAILED: 'STATE_UPDATE_FAILED',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  
  // Image processing errors
  IMAGE_ENHANCEMENT_FAILED: 'IMAGE_ENHANCEMENT_FAILED',
  INVALID_IMAGE_FORMAT: 'INVALID_IMAGE_FORMAT',
  
  // Catalog errors
  CATALOG_CREATION_FAILED: 'CATALOG_CREATION_FAILED',
  ONDC_BROADCAST_FAILED: 'ONDC_BROADCAST_FAILED',
  
  // AWS service errors
  DYNAMODB_THROTTLED: 'DYNAMODB_THROTTLED',
  S3_UPLOAD_FAILED: 'S3_UPLOAD_FAILED',
  KMS_ENCRYPTION_FAILED: 'KMS_ENCRYPTION_FAILED',
  LAMBDA_INVOCATION_FAILED: 'LAMBDA_INVOCATION_FAILED',
  EVENTBRIDGE_PUBLISH_FAILED: 'EVENTBRIDGE_PUBLISH_FAILED',
  
  // Generic errors
  UNEXPECTED_ERROR: 'UNEXPECTED_ERROR',
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
} as const;

/**
 * Structured log entry for CloudWatch Logs
 */
interface LogEntry {
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
  message: string;
  errorCode?: string;
  errorCategory?: ErrorCategory;
  context?: Record<string, any>;
  traceId?: string;
  requestId?: string;
}

/**
 * Log structured message to CloudWatch
 */
export function logStructured(
  level: LogEntry['level'],
  message: string,
  context?: Record<string, any>,
  errorCode?: string,
  errorCategory?: ErrorCategory
): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    errorCode,
    errorCategory,
    context,
    traceId: process.env._X_AMZN_TRACE_ID,
    requestId: process.env.AWS_REQUEST_ID,
  };

  // Use console.log for structured JSON logging
  console.log(JSON.stringify(entry));
}

/**
 * Categorize AWS SDK errors
 */
export function categorizeAwsError(error: any): ErrorCategory {
  const errorName = error.name || error.code || '';
  const errorMessage = error.message || '';
  const errorCode = error.code || '';

  // Transient errors - retry automatically
  if (
    errorName.includes('Throttling') ||
    errorName.includes('TooManyRequests') ||
    errorName.includes('ServiceUnavailable') ||
    errorName.includes('Timeout') ||
    errorName === 'Timeout' ||
    errorMessage.toLowerCase().includes('timeout') ||
    errorMessage.includes('ECONNRESET') ||
    errorMessage.includes('ETIMEDOUT') ||
    errorCode === 'ECONNRESET' ||
    errorCode === 'ETIMEDOUT'
  ) {
    return ErrorCategory.TRANSIENT;
  }

  // Critical errors - alert monitoring
  if (
    errorName.includes('KMS') ||
    errorName.includes('AccessDenied') ||
    errorName === 'AccessDenied' ||
    errorName.includes('InternalError') ||
    errorName === 'ProvisionedThroughputExceededException'
  ) {
    return ErrorCategory.CRITICAL;
  }

  // Permanent errors - notify user
  return ErrorCategory.PERMANENT;
}

/**
 * Categorize application errors
 */
export function categorizeError(error: any, errorCode?: string): ErrorCategory {
  // If already categorized, return the category
  if (error instanceof CategorizedError) {
    return error.category;
  }

  // Categorize by error code first
  if (errorCode) {
    switch (errorCode) {
      // Transient
      case ErrorCodes.MEDIA_DOWNLOAD_FAILED:
      case ErrorCodes.NETWORK_TIMEOUT:
      case ErrorCodes.DYNAMODB_THROTTLED:
        return ErrorCategory.TRANSIENT;

      // Critical
      case ErrorCodes.STATE_UPDATE_FAILED:
      case ErrorCodes.STATE_RETRIEVAL_FAILED:
      case ErrorCodes.KMS_ENCRYPTION_FAILED:
      case ErrorCodes.EVENTBRIDGE_PUBLISH_FAILED:
        return ErrorCategory.CRITICAL;

      // Permanent
      default:
        return ErrorCategory.PERMANENT;
    }
  }

  // Check if it's an AWS SDK error or has AWS-like error names
  const errorName = error.name || error.code || '';
  const errorMessage = error.message || '';
  const errorCodeProp = error.code || '';
  
  // Check for AWS SDK metadata
  const isAwsError = error.$metadata || errorName.includes('Exception');
  
  // Check for network errors by error code
  if (errorCodeProp === 'ECONNRESET' || errorCodeProp === 'ETIMEDOUT') {
    return ErrorCategory.TRANSIENT;
  }
  
  // If it looks like an AWS error or has specific error names, use AWS categorization
  if (isAwsError || 
      errorName.includes('Throttling') ||
      errorName.includes('TooManyRequests') ||
      errorName.includes('ServiceUnavailable') ||
      errorName.includes('Timeout') ||
      errorName === 'Timeout' ||
      errorName.includes('KMS') ||
      errorName.includes('AccessDenied') ||
      errorName === 'AccessDenied' ||
      errorName.includes('InternalError')) {
    return categorizeAwsError(error);
  }

  // Default to permanent for unknown errors
  return ErrorCategory.PERMANENT;
}

/**
 * Handle error with appropriate logging and metrics
 */
export async function handleError(
  error: any,
  operation: string,
  context?: Record<string, any>
): Promise<void> {
  const errorCode = error.code || ErrorCodes.UNEXPECTED_ERROR;
  const category = categorizeError(error, errorCode);
  const retryable = category === ErrorCategory.TRANSIENT;

  // Log structured error
  logStructured(
    category === ErrorCategory.CRITICAL ? 'CRITICAL' : 'ERROR',
    `${operation} failed: ${error.message}`,
    {
      ...context,
      errorName: error.name,
      errorStack: error.stack,
    },
    errorCode,
    category
  );

  // Publish error metric
  try {
    await publishMetric(
      MetricName.VOICE_TRANSCRIPTION_FAILURE, // Generic metric, should be parameterized
      1,
      MetricUnit.COUNT,
      {
        operation,
        errorCode,
        errorCategory: category,
        retryable: retryable.toString(),
      }
    );
  } catch (metricError) {
    console.error('Failed to publish error metric:', metricError);
  }
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Calculate exponential backoff delay with optional jitter
 */
export function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  const delay = Math.min(
    config.baseDelay * Math.pow(config.backoffMultiplier, attempt),
    config.maxDelay
  );

  if (config.jitter) {
    return delay * (0.5 + Math.random() * 0.5);
  }

  return delay;
}

/**
 * Retry a function with exponential backoff
 * Only retries on transient errors
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  operation: string,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  context?: Record<string, any>
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      const result = await fn();
      
      // Log success if this was a retry
      if (attempt > 0) {
        logStructured(
          'INFO',
          `${operation} succeeded after ${attempt + 1} attempts`,
          context
        );
      }
      
      return result;
    } catch (error: any) {
      lastError = error;
      const category = categorizeError(error);

      // Don't retry permanent or critical errors
      if (category !== ErrorCategory.TRANSIENT) {
        logStructured(
          category === ErrorCategory.CRITICAL ? 'CRITICAL' : 'ERROR',
          `${operation} failed with non-retryable error: ${error.message}`,
          { ...context, attempt: attempt + 1, errorCategory: category },
          error.code
        );
        throw error;
      }

      // Don't retry if this was the last attempt
      if (attempt >= config.maxAttempts - 1) {
        break;
      }

      const delay = calculateBackoffDelay(attempt, config);
      logStructured(
        'WARN',
        `${operation} failed (attempt ${attempt + 1}/${config.maxAttempts}), retrying in ${delay}ms`,
        { ...context, errorMessage: error.message, delay }
      );

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // All retries exhausted
  await handleError(lastError, operation, {
    ...context,
    attemptsExhausted: config.maxAttempts,
  });
  
  throw lastError;
}

/**
 * Wrap a function with error handling and metrics
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  operation: string,
  context?: Record<string, any>
): Promise<T> {
  const startTime = Date.now();
  
  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    
    // Log success
    logStructured('INFO', `${operation} completed successfully`, {
      ...context,
      duration,
    });
    
    // Publish success metric
    await publishMetric(
      MetricName.TIME_TO_NETWORK, // Generic metric, should be parameterized
      duration,
      MetricUnit.MILLISECONDS,
      {
        operation,
        status: 'success',
      }
    );
    
    return result;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    await handleError(error, operation, {
      ...context,
      duration,
    });
    
    throw error;
  }
}
