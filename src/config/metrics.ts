import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const cloudWatchClient = new CloudWatchClient({ region: process.env.AWS_REGION || 'ap-south-1' });

const METRICS_NAMESPACE = 'VyaparVaani';

export enum MetricName {
  TIME_TO_NETWORK = 'TimeToNetwork',
  VOICE_TRANSCRIPTION_FAILURE = 'Voice/TranscriptionFailure',
}

export enum MetricUnit {
  SECONDS = 'Seconds',
  MILLISECONDS = 'Milliseconds',
  COUNT = 'Count',
  PERCENT = 'Percent',
  NONE = 'None',
}

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

  }
}

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

async function measureExecutionTime<T>(
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
