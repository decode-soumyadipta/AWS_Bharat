/**
 * Background Agent Lambda Handler
 * 
 * Triggered by EventBridge Scheduler every 6 hours.
 * Runs the background intelligence agent for proactive seller alerts:
 * - Weather warnings (Open-Meteo)
 * - Market price updates (data.gov.in)
 * - Personalized crop advisories (Bedrock Nova Lite)
 * 
 * Sends proactive WhatsApp voice messages to active sellers.
 */

import { runBackgroundAgent, type BackgroundAgentResult } from '../services/background-agent';

export const handler = async (event: any): Promise<BackgroundAgentResult> => {
  console.log('🤖 Background Agent Lambda invoked', JSON.stringify({
    triggerSource: event.source || 'manual',
    time: event.time || new Date().toISOString(),
  }));

  try {
    const result = await runBackgroundAgent();
    
    console.log('Background Agent result:', JSON.stringify(result));
    
    // Log summary for CloudWatch metrics
    console.log(JSON.stringify({
      metric: 'BackgroundAgentRun',
      sellersProcessed: result.sellersProcessed,
      alertsSent: result.alertsSent,
      weatherFetched: result.weatherFetched,
      pricesFetched: result.pricesFetched,
      errorCount: result.errors.length,
      timestamp: Date.now(),
    }));

    return result;
  } catch (error: any) {
    console.error('Background Agent failed:', error);
    return {
      sellersProcessed: 0,
      alertsSent: 0,
      weatherFetched: 0,
      pricesFetched: 0,
      errors: [error.message || 'Unknown error'],
    };
  }
};
