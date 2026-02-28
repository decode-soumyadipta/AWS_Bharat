/**
 * CloudWatch Alarms Configuration
 * 
 * Defines alarms for monitoring error rates, state transitions, and system health.
 * 
 * Requirements: 8.5, 8.7
 */

import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface AlarmConfig {
  /**
   * Email addresses to receive alarm notifications
   */
  alarmEmails: string[];
  
  /**
   * Namespace for CloudWatch metrics
   */
  namespace: string;
  
  /**
   * Environment name (dev, staging, prod)
   */
  environment: string;
}

/**
 * Create CloudWatch alarms for voice-first workflow monitoring
 */
export class VoiceWorkflowAlarms extends Construct {
  public readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, config: AlarmConfig) {
    super(scope, id);

    // SNS Topic for alarm notifications
    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      displayName: `Vyapar-Vaani ${config.environment} Alarms`,
      topicName: `vyapar-vaani-${config.environment}-alarms`,
    });

    // Subscribe email addresses
    config.alarmEmails.forEach((email, index) => {
      this.alarmTopic.addSubscription(
        new subscriptions.EmailSubscription(email)
      );
    });

    // High Error Rate Alarm
    this.createHighErrorRateAlarm(config);

    // State Transition Failure Alarm
    this.createStateTransitionFailureAlarm(config);

    // Media Download Failure Alarm
    this.createMediaDownloadFailureAlarm(config);

    // KYC Processing Failure Alarm
    this.createKYCProcessingFailureAlarm(config);

    // Transcription Failure Alarm
    this.createTranscriptionFailureAlarm(config);

    // Image Enhancement Failure Alarm
    this.createImageEnhancementFailureAlarm(config);

    // DynamoDB Throttling Alarm
    this.createDynamoDBThrottlingAlarm(config);

    // Lambda Error Rate Alarm
    this.createLambdaErrorRateAlarm(config);

    // Lambda Duration Alarm
    this.createLambdaDurationAlarm(config);
  }

  /**
   * Create alarm for high overall error rate
   */
  private createHighErrorRateAlarm(config: AlarmConfig): void {
    const metric = new cloudwatch.Metric({
      namespace: config.namespace,
      metricName: 'ErrorRate',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const alarm = new cloudwatch.Alarm(this, 'HighErrorRateAlarm', {
      alarmName: `${config.environment}-high-error-rate`,
      alarmDescription: 'Triggers when error rate exceeds 5% in 5 minutes',
      metric,
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    alarm.addAlarmAction(new cloudwatch.SnsAction(this.alarmTopic));
  }

  /**
   * Create alarm for state transition failures
   */
  private createStateTransitionFailureAlarm(config: AlarmConfig): void {
    const metric = new cloudwatch.Metric({
      namespace: config.namespace,
      metricName: 'ErrorRate',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
      dimensionsMap: {
        errorCode: 'STATE_UPDATE_FAILED',
      },
    });

    const alarm = new cloudwatch.Alarm(this, 'StateTransitionFailureAlarm', {
      alarmName: `${config.environment}-state-transition-failure`,
      alarmDescription: 'Triggers when state transitions fail',
      metric,
      threshold: 3,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    alarm.addAlarmAction(new cloudwatch.SnsAction(this.alarmTopic));
  }

  /**
   * Create alarm for media download failures
   */
  private createMediaDownloadFailureAlarm(config: AlarmConfig): void {
    const metric = new cloudwatch.Metric({
      namespace: config.namespace,
      metricName: 'ErrorRate',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
      dimensionsMap: {
        operation: 'media_download',
      },
    });

    const alarm = new cloudwatch.Alarm(this, 'MediaDownloadFailureAlarm', {
      alarmName: `${config.environment}-media-download-failure`,
      alarmDescription: 'Triggers when media downloads fail repeatedly',
      metric,
      threshold: 10,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    alarm.addAlarmAction(new cloudwatch.SnsAction(this.alarmTopic));
  }

  /**
   * Create alarm for KYC processing failures
   */
  private createKYCProcessingFailureAlarm(config: AlarmConfig): void {
    const metric = new cloudwatch.Metric({
      namespace: config.namespace,
      metricName: 'KYC/ExtractionFailure',
      statistic: 'Sum',
      period: cdk.Duration.minutes(10),
    });

    const alarm = new cloudwatch.Alarm(this, 'KYCProcessingFailureAlarm', {
      alarmName: `${config.environment}-kyc-processing-failure`,
      alarmDescription: 'Triggers when KYC processing fails frequently',
      metric,
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    alarm.addAlarmAction(new cloudwatch.SnsAction(this.alarmTopic));
  }

  /**
   * Create alarm for transcription failures
   */
  private createTranscriptionFailureAlarm(config: AlarmConfig): void {
    const metric = new cloudwatch.Metric({
      namespace: config.namespace,
      metricName: 'Voice/TranscriptionFailure',
      statistic: 'Sum',
      period: cdk.Duration.minutes(10),
    });

    const alarm = new cloudwatch.Alarm(this, 'TranscriptionFailureAlarm', {
      alarmName: `${config.environment}-transcription-failure`,
      alarmDescription: 'Triggers when voice transcription fails frequently',
      metric,
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    alarm.addAlarmAction(new cloudwatch.SnsAction(this.alarmTopic));
  }

  /**
   * Create alarm for image enhancement failures
   */
  private createImageEnhancementFailureAlarm(config: AlarmConfig): void {
    const metric = new cloudwatch.Metric({
      namespace: config.namespace,
      metricName: 'Image/EnhancementFailure',
      statistic: 'Sum',
      period: cdk.Duration.minutes(10),
    });

    const alarm = new cloudwatch.Alarm(this, 'ImageEnhancementFailureAlarm', {
      alarmName: `${config.environment}-image-enhancement-failure`,
      alarmDescription: 'Triggers when image enhancement fails frequently',
      metric,
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    alarm.addAlarmAction(new cloudwatch.SnsAction(this.alarmTopic));
  }

  /**
   * Create alarm for DynamoDB throttling
   */
  private createDynamoDBThrottlingAlarm(config: AlarmConfig): void {
    const metric = new cloudwatch.Metric({
      namespace: 'AWS/DynamoDB',
      metricName: 'UserErrors',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
      dimensionsMap: {
        TableName: 'vyapar-vaani-data',
      },
    });

    const alarm = new cloudwatch.Alarm(this, 'DynamoDBThrottlingAlarm', {
      alarmName: `${config.environment}-dynamodb-throttling`,
      alarmDescription: 'Triggers when DynamoDB requests are throttled',
      metric,
      threshold: 10,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    alarm.addAlarmAction(new cloudwatch.SnsAction(this.alarmTopic));
  }

  /**
   * Create alarm for Lambda error rate
   */
  private createLambdaErrorRateAlarm(config: AlarmConfig): void {
    const metric = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Errors',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const alarm = new cloudwatch.Alarm(this, 'LambdaErrorRateAlarm', {
      alarmName: `${config.environment}-lambda-error-rate`,
      alarmDescription: 'Triggers when Lambda functions have high error rate',
      metric,
      threshold: 10,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    alarm.addAlarmAction(new cloudwatch.SnsAction(this.alarmTopic));
  }

  /**
   * Create alarm for Lambda duration (timeout risk)
   */
  private createLambdaDurationAlarm(config: AlarmConfig): void {
    const metric = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Duration',
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });

    const alarm = new cloudwatch.Alarm(this, 'LambdaDurationAlarm', {
      alarmName: `${config.environment}-lambda-duration`,
      alarmDescription: 'Triggers when Lambda functions approach timeout',
      metric,
      threshold: 240000, // 4 minutes (assuming 5 min timeout)
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    alarm.addAlarmAction(new cloudwatch.SnsAction(this.alarmTopic));
  }

  /**
   * Add Lambda-specific alarms for a function
   */
  public addLambdaAlarms(lambdaFunction: lambda.Function, functionName: string): void {
    // Error rate alarm for specific function
    const errorMetric = lambdaFunction.metricErrors({
      period: cdk.Duration.minutes(5),
      statistic: 'Sum',
    });

    const errorAlarm = new cloudwatch.Alarm(this, `${functionName}ErrorAlarm`, {
      alarmName: `${functionName}-errors`,
      alarmDescription: `Triggers when ${functionName} has errors`,
      metric: errorMetric,
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    errorAlarm.addAlarmAction(new cloudwatch.SnsAction(this.alarmTopic));

    // Throttle alarm for specific function
    const throttleMetric = lambdaFunction.metricThrottles({
      period: cdk.Duration.minutes(5),
      statistic: 'Sum',
    });

    const throttleAlarm = new cloudwatch.Alarm(this, `${functionName}ThrottleAlarm`, {
      alarmName: `${functionName}-throttles`,
      alarmDescription: `Triggers when ${functionName} is throttled`,
      metric: throttleMetric,
      threshold: 3,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    throttleAlarm.addAlarmAction(new cloudwatch.SnsAction(this.alarmTopic));
  }
}

/**
 * Create a composite alarm for critical system health
 */
export function createSystemHealthAlarm(
  scope: Construct,
  alarms: cloudwatch.IAlarm[],
  alarmTopic: sns.Topic,
  environment: string
): cloudwatch.CompositeAlarm {
  const compositeAlarm = new cloudwatch.CompositeAlarm(scope, 'SystemHealthAlarm', {
    alarmName: `${environment}-system-health`,
    alarmDescription: 'Triggers when multiple critical alarms are in ALARM state',
    compositeAlarmName: `${environment}-system-health-composite`,
    alarmRule: cloudwatch.AlarmRule.anyOf(
      ...alarms.map(alarm => cloudwatch.AlarmRule.fromAlarm(alarm, cloudwatch.AlarmState.ALARM))
    ),
  });

  compositeAlarm.addAlarmAction(new cloudwatch.SnsAction(alarmTopic));

  return compositeAlarm;
}
