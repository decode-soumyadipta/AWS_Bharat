/**
 * X-Ray Tracing Configuration
 * 
 * Provides utilities for AWS X-Ray tracing integration.
 * Enables distributed tracing across Lambda functions and AWS services.
 * 
 * Requirements: 8.7
 */

// import { XRayClient } from '@aws-sdk/client-xray';

/**
 * X-Ray client for manual instrumentation
 */
/*
export const xrayClient = new XRayClient({
  region: process.env.AWS_REGION || 'ap-south-1',
});
*/

/**
 * Check if X-Ray tracing is enabled
 */
export function isXRayEnabled(): boolean {
  return process.env._X_AMZN_TRACE_ID !== undefined;
}

/**
 * Get current trace ID
 */
export function getTraceId(): string | undefined {
  return process.env._X_AMZN_TRACE_ID;
}

/**
 * Parse trace ID into components
 */
export function parseTraceId(traceId: string): {
  version: string;
  timestamp: string;
  id: string;
  parent?: string;
  sampled?: string;
} | null {
  // Format: Root=1-5e645f3e-1234567890abcdef;Parent=53995c3f42cd8ad8;Sampled=1
  const parts = traceId.split(';');
  const result: any = {};

  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key === 'Root') {
      const rootParts = value.split('-');
      result.version = rootParts[0];
      result.timestamp = rootParts[1];
      result.id = rootParts[2];
    } else if (key === 'Parent') {
      result.parent = value;
    } else if (key === 'Sampled') {
      result.sampled = value;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Add X-Ray trace context to log entries
 */
export function getTraceContext(): Record<string, any> {
  const traceId = getTraceId();
  if (!traceId) {
    return {};
  }

  const parsed = parseTraceId(traceId);
  return {
    traceId,
    ...(parsed && {
      traceVersion: parsed.version,
      traceTimestamp: parsed.timestamp,
      traceIdValue: parsed.id,
      parentId: parsed.parent,
      sampled: parsed.sampled === '1',
    }),
  };
}

/**
 * Lambda function wrapper that adds X-Ray context
 */
export function withXRayTracing<TEvent, TResult>(
  handler: (event: TEvent, context: any) => Promise<TResult>
): (event: TEvent, context: any) => Promise<TResult> {
  return async (event: TEvent, context: any): Promise<TResult> => {
    const traceContext = getTraceContext();
    
    // Add trace context to console logs
    if (traceContext.traceId) {
      console.log('X-Ray Trace Context:', JSON.stringify(traceContext));
    }

    try {
      const result = await handler(event, context);
      return result;
    } catch (error: any) {
      // Add error to X-Ray trace
      if (isXRayEnabled()) {
        console.error('Error in traced function:', {
          error: error.message,
          stack: error.stack,
          ...traceContext,
        });
      }
      throw error;
    }
  };
}

/**
 * Create a subsegment for detailed tracing
 * This is a simplified version - in production, use AWS X-Ray SDK
 */
export async function traceSubsegment<T>(
  name: string,
  fn: () => Promise<T>,
  metadata?: Record<string, any>
): Promise<T> {
  const startTime = Date.now();
  const traceContext = getTraceContext();

  console.log(`[X-Ray Subsegment] Starting: ${name}`, {
    ...traceContext,
    metadata,
  });

  try {
    const result = await fn();
    const duration = Date.now() - startTime;

    console.log(`[X-Ray Subsegment] Completed: ${name}`, {
      ...traceContext,
      duration,
      status: 'success',
    });

    return result;
  } catch (error: any) {
    const duration = Date.now() - startTime;

    console.error(`[X-Ray Subsegment] Failed: ${name}`, {
      ...traceContext,
      duration,
      status: 'error',
      error: error.message,
      errorType: error.name,
    });

    throw error;
  }
}

/**
 * Add annotation to X-Ray trace
 * Annotations are indexed and searchable in X-Ray console
 */
export function addAnnotation(key: string, value: string | number | boolean): void {
  if (!isXRayEnabled()) {
    return;
  }

  console.log('[X-Ray Annotation]', {
    key,
    value,
    ...getTraceContext(),
  });
}

/**
 * Add metadata to X-Ray trace
 * Metadata provides additional context but is not indexed
 */
export function addMetadata(namespace: string, key: string, value: any): void {
  if (!isXRayEnabled()) {
    return;
  }

  console.log('[X-Ray Metadata]', {
    namespace,
    key,
    value,
    ...getTraceContext(),
  });
}

/**
 * Common annotations for voice-first workflow
 */
export const Annotations = {
  /**
   * Add user phone number annotation
   */
  setUser(phone: string): void {
    addAnnotation('user_phone', phone);
  },

  /**
   * Add user state annotation
   */
  setState(state: string): void {
    addAnnotation('user_state', state);
  },

  /**
   * Add operation type annotation
   */
  setOperation(operation: string): void {
    addAnnotation('operation', operation);
  },

  /**
   * Add error code annotation
   */
  setErrorCode(errorCode: string): void {
    addAnnotation('error_code', errorCode);
  },

  /**
   * Add success status annotation
   */
  setSuccess(success: boolean): void {
    addAnnotation('success', success);
  },
};

/**
 * Common metadata for voice-first workflow
 */
export const Metadata = {
  /**
   * Add request details metadata
   */
  setRequestDetails(details: Record<string, any>): void {
    addMetadata('request', 'details', details);
  },

  /**
   * Add response details metadata
   */
  setResponseDetails(details: Record<string, any>): void {
    addMetadata('response', 'details', details);
  },

  /**
   * Add error details metadata
   */
  setErrorDetails(error: Error): void {
    addMetadata('error', 'details', {
      message: error.message,
      name: error.name,
      stack: error.stack,
    });
  },

  /**
   * Add AWS service call metadata
   */
  setAWSServiceCall(service: string, operation: string, params?: Record<string, any>): void {
    addMetadata('aws', service, {
      operation,
      params,
    });
  },
};
