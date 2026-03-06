
import { publishMetric, publishMetrics, MetricName, MetricUnit } from '../config/metrics';
import { UserStateType } from '../services/state-manager';
import { logStructured } from './error-handler';

const VoiceWorkflowMetrics = {
  STATE_TRANSITION: 'StateTransition',
  STATE_TRANSITION_DURATION: 'StateTransitionDuration',
  ERROR_RATE: 'ErrorRate',
  MEDIA_DOWNLOAD_DURATION: 'MediaDownloadDuration',
  TRANSCRIPTION_DURATION: 'TranscriptionDuration',
  KYC_PROCESSING_DURATION: 'KYCProcessingDuration',
  IMAGE_ENHANCEMENT_DURATION: 'ImageEnhancementDuration',
  CATALOG_CREATION_DURATION: 'CatalogCreationDuration',
  RETRY_COUNT: 'RetryCount',
  ACTIVE_USERS_BY_STATE: 'ActiveUsersByState',
} as const;

export async function publishStateTransitionMetric(
  phone: string,
  fromState: UserStateType,
  toState: UserStateType,
  duration?: number
): Promise<void> {
  const metrics = [
    {
      name: VoiceWorkflowMetrics.STATE_TRANSITION as any,
      value: 1,
      unit: MetricUnit.COUNT,
      dimensions: {
        fromState,
        toState,
      },
    },
  ];

  if (duration !== undefined) {
    metrics.push({
      name: VoiceWorkflowMetrics.STATE_TRANSITION_DURATION as any,
      value: duration,
      unit: MetricUnit.MILLISECONDS,
      dimensions: {
        fromState,
        toState,
      },
    });
  }

  try {
    await publishMetrics(metrics);

    logStructured('INFO', 'State transition recorded', {
      phone,
      fromState,
      toState,
      duration,
    });
  } catch (error) {
    console.error('Failed to publish state transition metric:', error);
  }
}

async function publishErrorRateMetric(
  operation: string,
  errorCode: string,
  errorCategory: string
): Promise<void> {
  try {
    await publishMetric(
      VoiceWorkflowMetrics.ERROR_RATE as any,
      1,
      MetricUnit.COUNT,
      {
        operation,
        errorCode,
        errorCategory,
      }
    );
  } catch (error) {
    console.error('Failed to publish error rate metric:', error);
  }
}

async function publishRetryMetric(
  operation: string,
  attemptNumber: number,
  success: boolean
): Promise<void> {
  try {
    await publishMetric(
      VoiceWorkflowMetrics.RETRY_COUNT as any,
      attemptNumber,
      MetricUnit.COUNT,
      {
        operation,
        success: success.toString(),
      }
    );
  } catch (error) {
    console.error('Failed to publish retry metric:', error);
  }
}

async function publishOperationDuration(
  operation: string,
  duration: number,
  success: boolean,
  additionalDimensions?: Record<string, string>
): Promise<void> {
  const metricName = getOperationMetricName(operation);

  try {
    await publishMetric(
      metricName as any,
      duration,
      MetricUnit.MILLISECONDS,
      {
        operation,
        status: success ? 'success' : 'failure',
        ...additionalDimensions,
      }
    );
  } catch (error) {
    console.error('Failed to publish operation duration metric:', error);
  }
}

function getOperationMetricName(operation: string): string {
  const metricMap: Record<string, string> = {
    'media_download': VoiceWorkflowMetrics.MEDIA_DOWNLOAD_DURATION,
    'transcription': VoiceWorkflowMetrics.TRANSCRIPTION_DURATION,
    'kyc_processing': VoiceWorkflowMetrics.KYC_PROCESSING_DURATION,
    'image_enhancement': VoiceWorkflowMetrics.IMAGE_ENHANCEMENT_DURATION,
    'catalog_creation': VoiceWorkflowMetrics.CATALOG_CREATION_DURATION,
  };

  return metricMap[operation] || 'OperationDuration';
}

export async function trackOperation<T>(
  operation: string,
  fn: () => Promise<T>,
  context?: Record<string, any>
): Promise<T> {
  const startTime = Date.now();
  let success = false;

  try {
    const result = await fn();
    success = true;
    return result;
  } finally {
    const duration = Date.now() - startTime;

    await publishOperationDuration(
      operation,
      duration,
      success,
      context
    );

    logStructured(
      success ? 'INFO' : 'ERROR',
      `Operation ${operation} ${success ? 'completed' : 'failed'}`,
      {
        ...context,
        duration,
        success,
      }
    );
  }
}

const XRayTracing = {

  getTraceId(): string | undefined {
    return process.env._X_AMZN_TRACE_ID;
  },

  addAnnotation(key: string, value: string | number | boolean): void {

    logStructured('DEBUG', 'X-Ray annotation', {
      annotationKey: key,
      annotationValue: value,
      traceId: this.getTraceId(),
    });
  },

  addMetadata(namespace: string, key: string, value: any): void {
    logStructured('DEBUG', 'X-Ray metadata', {
      namespace,
      metadataKey: key,
      metadataValue: value,
      traceId: this.getTraceId(),
    });
  },

  async traceSubsegment<T>(
    name: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const result = await fn();
      const duration = Date.now() - startTime;

      logStructured('DEBUG', `Subsegment ${name} completed`, {
        subsegment: name,
        duration,
        traceId: this.getTraceId(),
      });

      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;

      logStructured('ERROR', `Subsegment ${name} failed`, {
        subsegment: name,
        duration,
        error: error.message,
        traceId: this.getTraceId(),
      });

      throw error;
    }
  },
};

async function publishHealthMetric(
  component: string,
  healthy: boolean,
  details?: Record<string, any>
): Promise<void> {
  try {
    await publishMetric(
      'ComponentHealth' as any,
      healthy ? 1 : 0,
      MetricUnit.COUNT,
      {
        component,
        status: healthy ? 'healthy' : 'unhealthy',
      }
    );

    logStructured(
      healthy ? 'INFO' : 'WARN',
      `Component ${component} health check: ${healthy ? 'healthy' : 'unhealthy'}`,
      details
    );
  } catch (error) {
    console.error('Failed to publish health metric:', error);
  }
}

class MetricsBatcher {
  private metrics: Array<{
    name: string;
    value: number;
    unit: MetricUnit;
    dimensions?: Record<string, string>;
  }> = [];

  private flushInterval: NodeJS.Timeout | null = null;
  private readonly maxBatchSize = 20; 
  private readonly flushIntervalMs = 5000; 

  constructor() {
    this.startAutoFlush();
  }

  add(
    name: string,
    value: number,
    unit: MetricUnit = MetricUnit.COUNT,
    dimensions?: Record<string, string>
  ): void {
    this.metrics.push({ name, value, unit, dimensions });

    if (this.metrics.length >= this.maxBatchSize) {
      this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.metrics.length === 0) {
      return;
    }

    const batch = this.metrics.splice(0, this.maxBatchSize);

    try {
      await publishMetrics(batch as any);
      logStructured('DEBUG', `Flushed ${batch.length} metrics`);
    } catch (error) {
      console.error('Failed to flush metrics batch:', error);
    }
  }

  private startAutoFlush(): void {
    this.flushInterval = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    await this.flush();
  }
}
