import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const cloudWatchClient = new CloudWatchClient({ region: process.env.AWS_REGION || 'ap-south-1' });

export const METRICS_NAMESPACE = 'VyaparVaani';

export enum MetricName {
  TIME_TO_NETWORK = 'TimeToNetwork',
  CATALOG_REJECTION_RATE = 'CatalogRejectionRate',
  IMAGE_ENHANCEMENT_SUCCESS_RATE = 'ImageEnhancementSuccessRate',
  ORDER_ACCEPTANCE_RATE = 'OrderAcceptanceRate',
  VOICE_INTERACTIONS_PER_CATALOG = 'VoiceInteractionsPerCatalog',
  KYC_EXTRACTION_FAILURE = 'KYC/ExtractionFailure',
  VOICE_TRANSCRIPTION_FAILURE = 'Voice/TranscriptionFailure',
  IMAGE_ENHANCEMENT_FAILURE = 'Image/EnhancementFailure',
  BECKN_VALIDATION_FAILURE = 'Beckn/ValidationFailure',
  ONDC_REGISTRY_UNAVAILABLE = 'ONDC/RegistryUnavailable',
  WHATSAPP_DELIVERY_FAILURE = 'WhatsApp/DeliveryFailure',
  // Voice-first workflow metrics
  STATE_TRANSITION = 'StateTransition',
  STATE_TRANSITION_DURATION = 'StateTransitionDuration',
  ERROR_RATE = 'ErrorRate',
  MEDIA_DOWNLOAD_DURATION = 'MediaDownloadDuration',
  TRANSCRIPTION_DURATION = 'TranscriptionDuration',
  KYC_PROCESSING_DURATION = 'KYCProcessingDuration',
  IMAGE_ENHANCEMENT_DURATION = 'ImageEnhancementDuration',
  CATALOG_CREATION_DURATION = 'CatalogCreationDuration',
  RETRY_COUNT = 'RetryCount',
  ACTIVE_USERS_BY_STATE = 'ActiveUsersByState',
}

export enum MetricUnit {
  SECONDS = 'Seconds',
  MILLISECONDS = 'Milliseconds',
  COUNT = 'Count',
  PERCENT = 'Percent',
  NONE = 'None',
}

/**
 * Publish a metric to CloudWatch
 */
export async function publishMetric(
  metricName: MetricName,
  value: number,
  unit: MetricUnit = MetricUnit.COUNT,
  dimensions?: Record<string, string>
): Promise<void> {
  const metricData = {
    MetricName: metricName,
    Value: value,
    Unit: unit,
    Timestamp: new Date(),
    Dimensions: dimensions
      ? Object.entries(dimensions).map(([Name, Value]) => ({ Name, Value }))
      : undefined,
  };

  try {
    await cloudWatchClient.send(
      new PutMetricDataCommand({
        Namespace: METRICS_NAMESPACE,
        MetricData: [metricData],
      })
    );
  } catch (error) {
    console.error('Failed to publish metric:', error);
    // Don't throw - metrics failures shouldn't break the application
  }
}

/**
 * Publish multiple metrics in a single call
 */
export async function publishMetrics(
  metrics: Array<{
    name: MetricName;
    value: number;
    unit?: MetricUnit;
    dimensions?: Record<string, string>;
  }>
): Promise<void> {
  const metricData = metrics.map((metric) => ({
    MetricName: metric.name,
    Value: metric.value,
    Unit: metric.unit || MetricUnit.COUNT,
    Timestamp: new Date(),
    Dimensions: metric.dimensions
      ? Object.entries(metric.dimensions).map(([Name, Value]) => ({ Name, Value }))
      : undefined,
  }));

  try {
    await cloudWatchClient.send(
      new PutMetricDataCommand({
        Namespace: METRICS_NAMESPACE,
        MetricData: metricData,
      })
    );
  } catch (error) {
    console.error('Failed to publish metrics:', error);
  }
}

/**
 * Helper to measure execution time and publish as metric
 */
export async function measureExecutionTime<T>(
  metricName: MetricName,
  operation: () => Promise<T>,
  dimensions?: Record<string, string>
): Promise<T> {
  const startTime = Date.now();
  try {
    const result = await operation();
    const duration = Date.now() - startTime;
    await publishMetric(metricName, duration, MetricUnit.MILLISECONDS, dimensions);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    await publishMetric(metricName, duration, MetricUnit.MILLISECONDS, {
      ...dimensions,
      status: 'error',
    });
    throw error;
  }
}
