
function isXRayEnabled(): boolean {
  return process.env._X_AMZN_TRACE_ID !== undefined;
}

function getTraceId(): string | undefined {
  return process.env._X_AMZN_TRACE_ID;
}

function parseTraceId(traceId: string): {
  version: string;
  timestamp: string;
  id: string;
  parent?: string;
  sampled?: string;
} | null {

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

function getTraceContext(): Record<string, any> {
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

export function withXRayTracing<TEvent, TResult>(
  handler: (event: TEvent, context: any) => Promise<TResult>
): (event: TEvent, context: any) => Promise<TResult> {
  return async (event: TEvent, context: any): Promise<TResult> => {
    const traceContext = getTraceContext();

    if (traceContext.traceId) {
      console.log('X-Ray Trace Context:', JSON.stringify(traceContext));
    }

    try {
      const result = await handler(event, context);
      return result;
    } catch (error: any) {

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

function addAnnotation(key: string, value: string | number | boolean): void {
  if (!isXRayEnabled()) {
    return;
  }

  console.log('[X-Ray Annotation]', {
    key,
    value,
    ...getTraceContext(),
  });
}

function addMetadata(namespace: string, key: string, value: any): void {
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

export const Annotations = {

  setUser(phone: string): void {
    addAnnotation('user_phone', phone);
  },

  setState(state: string): void {
    addAnnotation('user_state', state);
  },

  setOperation(operation: string): void {
    addAnnotation('operation', operation);
  },

  setErrorCode(errorCode: string): void {
    addAnnotation('error_code', errorCode);
  },

  setSuccess(success: boolean): void {
    addAnnotation('success', success);
  },
};

export const Metadata = {

  setRequestDetails(details: Record<string, any>): void {
    addMetadata('request', 'details', details);
  },

  setResponseDetails(details: Record<string, any>): void {
    addMetadata('response', 'details', details);
  },

  setErrorDetails(error: Error): void {
    addMetadata('error', 'details', {
      message: error.message,
      name: error.name,
      stack: error.stack,
    });
  },

  setAWSServiceCall(service: string, operation: string, params?: Record<string, any>): void {
    addMetadata('aws', service, {
      operation,
      params,
    });
  },
};
