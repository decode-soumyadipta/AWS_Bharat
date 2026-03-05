/**
 * Background Agent Service — Proactive Seller Intelligence
 * 
 * Runs on a schedule (every 6 hours via EventBridge) to:
 * 1. Fetch weather forecasts for seller locations (Open-Meteo API — free, no key)
 * 2. Fetch live market prices for sellers' crops (data.gov.in API)
 * 3. Generate personalized alerts via Bedrock Nova Lite
 * 4. Send proactive WhatsApp voice messages to sellers
 * 
 * Uses GSI5 (ACTIVE_SELLERS) to efficiently query all active sellers.
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { docClient, eventBridgeClient, bedrockClient } from '../config/aws-clients';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { SellerProfile, SellerLocation } from '../models/seller';
import { fetchLiveMarketPrice } from '../tools/web-search';

const TABLE_NAME = process.env.TABLE_NAME || 'vyapar-vaani-data';
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'vyapar-vaani-events';

// ── Weather API (Open-Meteo — free, no API key, unlimited) ──

interface WeatherForecast {
  location: string;
  temperature: number;       // °C
  humidity: number;           // %
  precipitation: number;      // mm
  windSpeed: number;          // km/h
  weatherCode: number;        // WMO code
  description: string;        // Human-readable
  maxTemp: number;
  minTemp: number;
  alerts: string[];           // Generated alerts
}

const WMO_WEATHER_CODES: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  66: 'Light freezing rain', 67: 'Heavy freezing rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
  80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
};

// Default coordinates for major Indian agricultural states
const STATE_COORDINATES: Record<string, { lat: number; lon: number }> = {
  'Maharashtra': { lat: 19.75, lon: 75.71 },
  'Uttar Pradesh': { lat: 26.85, lon: 80.91 },
  'Madhya Pradesh': { lat: 23.47, lon: 77.95 },
  'Rajasthan': { lat: 27.02, lon: 74.22 },
  'Karnataka': { lat: 15.32, lon: 75.71 },
  'Gujarat': { lat: 22.26, lon: 71.19 },
  'Tamil Nadu': { lat: 11.13, lon: 78.66 },
  'Andhra Pradesh': { lat: 15.91, lon: 79.74 },
  'Punjab': { lat: 31.15, lon: 75.34 },
  'Haryana': { lat: 29.06, lon: 76.09 },
  'Bihar': { lat: 25.10, lon: 85.31 },
  'West Bengal': { lat: 22.99, lon: 87.75 },
  'Telangana': { lat: 18.11, lon: 79.02 },
  'Odisha': { lat: 20.94, lon: 84.09 },
  'Chhattisgarh': { lat: 21.27, lon: 81.87 },
  'default': { lat: 20.59, lon: 78.96 }, // Centre of India
};

/**
 * Fetch weather forecast from Open-Meteo API
 */
async function fetchWeather(location: SellerLocation): Promise<WeatherForecast | null> {
  try {
    const lat = location.latitude || STATE_COORDINATES[location.state || 'default']?.lat || STATE_COORDINATES['default'].lat;
    const lon = location.longitude || STATE_COORDINATES[location.state || 'default']?.lon || STATE_COORDINATES['default'].lon;
    const locationName = location.district || location.state || 'India';

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=Asia/Kolkata&forecast_days=3`;

    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;

    const data: any = await response.json();
    const current = data.current;
    const daily = data.daily;

    const weatherCode = current?.weather_code || 0;
    const description = WMO_WEATHER_CODES[weatherCode] || 'Unknown';
    const temp = current?.temperature_2m || 0;
    const humidity = current?.relative_humidity_2m || 0;
    const precipitation = current?.precipitation || 0;
    const windSpeed = current?.wind_speed_10m || 0;
    const maxTemp = daily?.temperature_2m_max?.[0] || temp;
    const minTemp = daily?.temperature_2m_min?.[0] || temp;

    // Generate weather alerts
    const alerts: string[] = [];
    
    // Heavy rain alert
    const tomorrowPrecip = daily?.precipitation_sum?.[1] || 0;
    if (tomorrowPrecip > 20) {
      alerts.push(`Heavy rain expected tomorrow (${Math.round(tomorrowPrecip)}mm). Protect outdoor crops and stored produce.`);
    } else if (tomorrowPrecip > 5) {
      alerts.push(`Moderate rain expected tomorrow (${Math.round(tomorrowPrecip)}mm). Good for crops but cover harvested produce.`);
    }

    // Extreme heat alert
    const tomorrowMax = daily?.temperature_2m_max?.[1] || maxTemp;
    if (tomorrowMax > 42) {
      alerts.push(`Extreme heat warning: ${Math.round(tomorrowMax)}°C expected tomorrow. Increase irrigation, provide shade to seedlings.`);
    } else if (tomorrowMax > 38) {
      alerts.push(`High temperature alert: ${Math.round(tomorrowMax)}°C tomorrow. Ensure adequate watering for crops.`);
    }

    // Cold/frost alert
    const tomorrowMin = daily?.temperature_2m_min?.[1] || minTemp;
    if (tomorrowMin < 5) {
      alerts.push(`Frost risk: Temperature may drop to ${Math.round(tomorrowMin)}°C. Cover sensitive crops tonight.`);
    }

    // Storm alert
    const tomorrowCode = daily?.weather_code?.[1] || 0;
    if (tomorrowCode >= 95) {
      alerts.push(`Thunderstorm warning for tomorrow. Secure greenhouse structures and harvest ripe produce early.`);
    }

    // High wind alert
    if (windSpeed > 40) {
      alerts.push(`Strong winds (${Math.round(windSpeed)} km/h). Stake tall plants, secure covers on produce.`);
    }

    return {
      location: locationName,
      temperature: temp,
      humidity,
      precipitation,
      windSpeed,
      weatherCode,
      description,
      maxTemp,
      minTemp,
      alerts,
    };
  } catch (error) {
    console.warn(`Weather fetch failed for ${location.state}:`, error);
    return null;
  }
}

// ── Active Sellers Query ──

interface ActiveSeller {
  phone: string;
  name: string;
  language: 'hi' | 'mr' | 'en';
  location?: SellerLocation;
  cropsGrown?: string[];
  sellerId: string;
}

/**
 * Query all active sellers using GSI5
 */
async function getActiveSellers(): Promise<ActiveSeller[]> {
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI5',
      KeyConditionExpression: 'GSI5PK = :pk',
      ExpressionAttributeValues: { ':pk': 'ACTIVE_SELLERS' },
      Limit: 100, // Process up to 100 sellers per run
    }));

    return (result.Items || []).map((item: any) => ({
      phone: item.phone,
      name: item.name,
      language: item.language || 'hi',
      location: item.location,
      cropsGrown: item.cropsGrown,
      sellerId: item.sellerId,
    }));
  } catch (error) {
    console.error('Failed to query active sellers:', error);
    return [];
  }
}

// ── Alert Generation (Bedrock Nova Lite) ──

interface SellerAlert {
  phone: string;
  name: string;
  language: 'hi' | 'mr' | 'en';
  message: string;
  alertType: 'weather' | 'price' | 'crop_advisory' | 'combined';
}

/**
 * Generate a personalized alert message using Bedrock Nova Lite
 */
async function generateAlertMessage(
  seller: ActiveSeller,
  weather: WeatherForecast | null,
  priceUpdates: Array<{ crop: string; priceInfo: string }>,
): Promise<string | null> {
  // Only generate if there's something meaningful to tell
  const hasWeatherAlert = weather && weather.alerts.length > 0;
  const hasPriceUpdate = priceUpdates.length > 0;

  if (!hasWeatherAlert && !hasPriceUpdate) return null;

  const langMap = { hi: 'Hinglish (Hindi written in Roman script)', mr: 'Marathi', en: 'English' };
  const langName = langMap[seller.language] || 'Hinglish';

  let contextBlock = `Seller name: ${seller.name}\nLanguage: ${langName}\n`;
  
  if (seller.cropsGrown?.length) {
    contextBlock += `Crops/Products: ${seller.cropsGrown.join(', ')}\n`;
  }
  if (seller.location) {
    contextBlock += `Location: ${seller.location.district || ''} ${seller.location.state || ''}\n`;
  }

  if (weather && hasWeatherAlert) {
    contextBlock += `\nWeather (${weather.location}):\n`;
    contextBlock += `Current: ${weather.description}, ${Math.round(weather.temperature)}°C, Humidity ${weather.humidity}%\n`;
    contextBlock += `Alerts:\n${weather.alerts.map(a => `- ${a}`).join('\n')}\n`;
  }

  if (hasPriceUpdate) {
    contextBlock += `\nMarket Prices:\n`;
    priceUpdates.forEach(p => {
      contextBlock += `- ${p.crop}: ${p.priceInfo}\n`;
    });
  }

  const prompt = `You are Vyapar Vaani, a friendly AI assistant for rural Indian sellers.
Generate a SHORT proactive WhatsApp voice message (max 4 sentences) for this seller in ${langName}.

${contextBlock}

Rules:
- Write like you are SPEAKING on a phone call. Natural, warm, conversational.
- Address the seller by name.
- Mention the most important weather alert first if applicable.
- If crop prices have changed significantly, mention it.
- Give ONE actionable tip related to their crops/weather.
- NO emoji, NO formatting, NO bullet points, NO colons. Just natural spoken sentences.
- Say numbers in words: "pachees degree" not "25°C", "pachaas rupaye" not "₹50"
- Keep it under 4 sentences. This will be read aloud.

Generate the message:`;

  try {
    const response = await bedrockClient.send(new ConverseCommand({
      modelId: 'amazon.nova-lite-v1:0',
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 300, temperature: 0.7 },
    }));

    const text = response.output?.message?.content?.[0]?.text?.trim();
    return text || null;
  } catch (error) {
    console.warn('Bedrock alert generation failed:', error);
    // Fallback: construct a simple alert without AI
    if (hasWeatherAlert && weather) {
      const alert = weather.alerts[0];
      const greetings: Record<string, string> = {
        hi: `${seller.name} ji, aaj ka mausam update`,
        mr: `${seller.name} ji, aajcha hawaaman update`,
        en: `${seller.name}, today's weather update`,
      };
      return `${greetings[seller.language]}. ${alert}`;
    }
    return null;
  }
}

/**
 * Send a proactive WhatsApp alert via EventBridge
 */
async function sendAlert(alert: SellerAlert): Promise<void> {
  try {
    await eventBridgeClient.send(new PutEventsCommand({
      Entries: [{
        Source: 'vyapar.vaani.internal',
        DetailType: 'whatsapp.message.send',
        EventBusName: EVENT_BUS_NAME,
        Detail: JSON.stringify({
          to: alert.phone,
          message: alert.message,
          type: 'voice',
          language: alert.language,
          metadata: {
            source: 'background-agent',
            alertType: alert.alertType,
            timestamp: Date.now(),
          },
        }),
      }],
    }));
    console.log(`📤 Alert sent to ${alert.name} (${alert.phone}): ${alert.alertType}`);
  } catch (error) {
    console.error(`Failed to send alert to ${alert.phone}:`, error);
  }
}

// ── Main Background Agent Runner ──

export interface BackgroundAgentResult {
  sellersProcessed: number;
  alertsSent: number;
  weatherFetched: number;
  pricesFetched: number;
  errors: string[];
}

/**
 * Main entry point: process all active sellers and send proactive alerts.
 * Called by the scheduled Lambda every 6 hours.
 */
export async function runBackgroundAgent(): Promise<BackgroundAgentResult> {
  const result: BackgroundAgentResult = {
    sellersProcessed: 0,
    alertsSent: 0,
    weatherFetched: 0,
    pricesFetched: 0,
    errors: [],
  };

  console.log('🤖 Background Agent starting...');

  // 1. Get all active sellers
  const sellers = await getActiveSellers();
  console.log(`Found ${sellers.length} active sellers`);

  if (sellers.length === 0) {
    console.log('No active sellers found. Exiting.');
    return result;
  }

  // 2. Cache weather by state/location to avoid duplicate API calls
  const weatherCache = new Map<string, WeatherForecast | null>();

  for (const seller of sellers) {
    try {
      result.sellersProcessed++;

      // 3. Fetch weather (cached by state)
      let weather: WeatherForecast | null = null;
      if (seller.location) {
        const cacheKey = seller.location.state || seller.location.district || 'default';
        if (weatherCache.has(cacheKey)) {
          weather = weatherCache.get(cacheKey)!;
        } else {
          weather = await fetchWeather(seller.location);
          weatherCache.set(cacheKey, weather);
          if (weather) result.weatherFetched++;
        }
      }

      // 4. Fetch prices for seller's crops
      const priceUpdates: Array<{ crop: string; priceInfo: string }> = [];
      if (seller.cropsGrown?.length) {
        for (const crop of seller.cropsGrown.slice(0, 3)) { // Max 3 crops per seller
          try {
            const priceResult = await fetchLiveMarketPrice(crop);
            if (priceResult.found) {
              priceUpdates.push({ crop, priceInfo: priceResult.priceInfo });
              result.pricesFetched++;
            }
          } catch {
            // Skip individual crop price failures
          }
        }
      }

      // 5. Generate personalized alert
      const message = await generateAlertMessage(seller, weather, priceUpdates);

      if (message) {
        const alertType: SellerAlert['alertType'] = 
          (weather?.alerts?.length && priceUpdates.length) ? 'combined' :
          weather?.alerts?.length ? 'weather' : 'price';

        await sendAlert({
          phone: seller.phone,
          name: seller.name,
          language: seller.language,
          message,
          alertType,
        });
        result.alertsSent++;
      }

      // Rate limit: small delay between sellers to avoid API throttling
      if (sellers.indexOf(seller) < sellers.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

    } catch (error: any) {
      const errorMsg = `Error processing ${seller.name} (${seller.phone}): ${error.message}`;
      console.error(errorMsg);
      result.errors.push(errorMsg);
    }
  }

  console.log(`🤖 Background Agent complete: ${result.sellersProcessed} sellers, ${result.alertsSent} alerts sent`);
  return result;
}
