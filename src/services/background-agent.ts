/**
 * Background Agent Service — Proactive Seller Intelligence
 * 
 * Runs on a schedule (daily at 7 PM IST via EventBridge) to:
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
import { addConversationMessage } from './conversation-memory';

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
  const hasWeatherData = weather !== null;
  const hasPriceUpdate = priceUpdates.length > 0;

  if (!hasWeatherData && !hasPriceUpdate) return null;

  const langMap = { hi: 'शुद्ध हिंदी (Devanagari script)', mr: 'मराठी (Devanagari script)', en: 'English' };
  const langName = langMap[seller.language] || 'शुद्ध हिंदी (Devanagari script)';

  let contextBlock = `Seller name: ${seller.name}\nLanguage: ${langName}\n`;
  
  if (seller.cropsGrown?.length) {
    contextBlock += `Crops/Products: ${seller.cropsGrown.join(', ')}\n`;
  }
  if (seller.location) {
    contextBlock += `Location: ${seller.location.district || ''} ${seller.location.state || ''}\n`;
  }

  if (weather && hasWeatherData) {
    contextBlock += `\nWeather (${weather.location}):\n`;
    contextBlock += `Current: ${weather.description}, ${Math.round(weather.temperature)}°C, Humidity ${weather.humidity}%\n`;
    contextBlock += `Max: ${Math.round(weather.maxTemp)}°C, Min: ${Math.round(weather.minTemp)}°C\n`;
    if (weather.alerts.length > 0) {
      contextBlock += `Alerts:\n${weather.alerts.map(a => `- ${a}`).join('\n')}\n`;
    } else {
      contextBlock += `No severe weather alerts.\n`;
    }
  }

  if (hasPriceUpdate) {
    contextBlock += `\nMarket Prices:\n`;
    priceUpdates.forEach(p => {
      contextBlock += `- ${p.crop}: ${p.priceInfo}\n`;
    });
  }

  const prompt = `You are Vyapar Vaani, a caring AI assistant for rural Indian sellers.
Generate a COMPREHENSIVE evening daily update WhatsApp voice message for this seller.

IMPORTANT: Write ENTIRELY in ${langName}. 
${seller.language === 'hi' ? '- हर शब्द देवनागरी हिंदी में लिखो। कोई English या Roman Hindi नहीं।' : seller.language === 'mr' ? '- प्रत्येक शब्द मराठी देवनागरी मध्ये लिहा. English किंवा Roman नाही.' : '- Write in simple English.'}

${contextBlock}

Rules:
- Write like a caring village elder giving evening updates on a phone call. Warm, unhurried, detailed.
- Address the seller by name with respect (जी).
- Structure: शुभ संध्या greeting → मौसम/weather → हर फसल का भाव/each crop price → खेती सलाह/farming tip → शुभकामना/sign-off.
- Cover ALL information provided above. Do not skip any crop price or weather detail.
- Give 2-3 actionable farming tips based on weather and crops.
- ${seller.language === 'hi' ? 'संख्या हिंदी में बोलो: "पच्चीस डिग्री" not "25°C", "पचास रुपये" not "₹50", "बीस मिलीमीटर" not "20mm"' : seller.language === 'mr' ? 'संख्या मराठी मध्ये: "पंचवीस अंश" not "25°C"' : 'Say numbers in words.'}
- NO emoji, NO formatting, NO bullet points, NO colons, NO asterisks. Just natural spoken sentences.
- Write 8-12 sentences. This is a comprehensive daily voice briefing, not a short alert.
- End with an encouraging sign-off.

Generate the complete message:`;

  try {
    const response = await bedrockClient.send(new ConverseCommand({
      modelId: 'amazon.nova-lite-v1:0',
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 800, temperature: 0.7 },
    }));

    const text = response.output?.message?.content?.[0]?.text?.trim();
    return text || null;
  } catch (error) {
    console.warn('Bedrock alert generation failed:', error);
    // Fallback: construct a simple alert without AI
    if (hasWeatherData && weather) {
      const alert = weather.alerts[0];
      const greetings: Record<string, string> = {
        hi: `${seller.name} जी, आज का मौसम अपडेट`,
        mr: `${seller.name} जी, आजचा हवामान अपडेट`,
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
          type: 'voice',
          content: { text: alert.message },
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

    // Store alert in conversation memory so agent can reference it later
    try {
      await addConversationMessage(alert.phone, {
        timestamp: Date.now(),
        role: 'system',
        content: alert.message,
        metadata: {
          event: 'background_alert',
          alertType: alert.alertType,
          source: 'background-agent',
        },
      });
    } catch (memErr) {
      console.warn('Failed to store alert in conversation memory:', memErr);
    }
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
 * Called by the scheduled Lambda daily at 7 PM IST, or on-demand via enhanced agent.
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
          (weather && priceUpdates.length) ? 'combined' :
          weather ? 'weather' : 'price';

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

/**
 * On-demand daily update for a single seller.
 * Called by enhanced agent when user asks "mausam batao", "update do", "aaj ka bhav" etc.
 * Returns the generated Hindi alert text (or null if nothing to report).
 */
export async function generateOnDemandUpdate(
  phone: string,
  sellerName: string,
  language: 'hi' | 'mr' | 'en',
  location?: SellerLocation,
  cropsGrown?: string[],
): Promise<string | null> {
  console.log(`📢 On-demand update requested for ${sellerName} (${phone})`);

  // ── FALLBACK: If no location provided, create a default-India location ─────
  // This lets fetchWeather always have coordinates (STATE_COORDINATES['default'])
  let effectiveLocation = location;
  if (!effectiveLocation) {
    console.log('📍 No location set — using default India centre for weather');
    effectiveLocation = { state: 'default' } as SellerLocation;
  }

  // ── FALLBACK: If no cropsGrown, try fetching seller's catalog product names ─
  let effectiveCrops = cropsGrown;
  if (!effectiveCrops || effectiveCrops.length === 0) {
    try {
      const { getCatalogItemsBySeller } = await import('./dynamodb-repository');
      const catalogItems = await getCatalogItemsBySeller(phone);
      if (catalogItems && catalogItems.length > 0) {
        effectiveCrops = catalogItems.map((item: any) => item.productName || item.name).filter(Boolean).slice(0, 5);
        console.log('🌾 Fallback cropsGrown from catalog:', effectiveCrops);
      }
    } catch (e) {
      console.warn('Could not fetch catalog items for crop fallback:', e);
    }
    // If still empty, use common Indian crops
    if (!effectiveCrops || effectiveCrops.length === 0) {
      effectiveCrops = ['tomato', 'onion', 'potato'];
      console.log('🌾 Using default common crops:', effectiveCrops);
    }
  }

  const seller: ActiveSeller = {
    phone,
    name: sellerName,
    language,
    location: effectiveLocation,
    cropsGrown: effectiveCrops,
    sellerId: '',
  };

  // Fetch weather — always attempted now thanks to fallback location
  let weather: WeatherForecast | null = null;
  weather = await fetchWeather(effectiveLocation);

  // Fetch prices — always attempted now thanks to fallback crops
  const priceUpdates: Array<{ crop: string; priceInfo: string }> = [];
  for (const crop of effectiveCrops.slice(0, 5)) {
    try {
      const priceResult = await fetchLiveMarketPrice(crop);
      if (priceResult.found) {
        priceUpdates.push({ crop, priceInfo: priceResult.priceInfo });
      }
    } catch {
      // Skip individual crop price failures
    }
  }

  // If STILL no data despite fallbacks, return helpful guidance
  if (!weather && priceUpdates.length === 0) {
    const noUpdate: Record<string, string> = {
      hi: `${sellerName} जी, अभी मौसम और बाज़ार की जानकारी मिलने में दिक्कत आ रही है। कृपया थोड़ी देर बाद पूछें। अगर आप अपना गाँव या शहर बता दें तो बेहतर जानकारी दे सकता हूँ।`,
      mr: `${sellerName} जी, सध्या हवामान आणि बाजारभाव मिळवण्यात अडचण येत आहे. कृपया थोड्या वेळाने विचारा. तुमचे गाव किंवा शहर सांगा म्हणजे चांगली माहिती देता येईल.`,
      en: `${sellerName}, having trouble getting weather and market info right now. Please try again shortly. Tell me your village or city for better updates.`,
    };
    return noUpdate[language] || noUpdate['hi'];
  }

  // Force-generate even if no weather alerts (user asked explicitly)
  const hasWeatherData = weather !== null;
  const hasPriceData = priceUpdates.length > 0;

  // Build context manually to bypass the "only generate if alerts" check
  const langMap = { hi: 'शुद्ध हिंदी (Devanagari script)', mr: 'मराठी (Devanagari script)', en: 'English' };
  const langName = langMap[language] || 'शुद्ध हिंदी (Devanagari script)';

  let contextBlock = `Seller name: ${seller.name}\nLanguage: ${langName}\n`;
  if (cropsGrown?.length) contextBlock += `Crops/Products: ${cropsGrown.join(', ')}\n`;
  if (location) contextBlock += `Location: ${location.district || ''} ${location.state || ''}\n`;

  if (hasWeatherData && weather) {
    contextBlock += `\nWeather (${weather.location}):\n`;
    contextBlock += `Current: ${weather.description}, ${Math.round(weather.temperature)}°C, Humidity ${weather.humidity}%\n`;
    if (weather.alerts.length > 0) {
      contextBlock += `Alerts:\n${weather.alerts.map(a => `- ${a}`).join('\n')}\n`;
    } else {
      contextBlock += `No severe weather alerts today.\n`;
    }
  }

  if (hasPriceData) {
    contextBlock += `\nMarket Prices:\n`;
    priceUpdates.forEach(p => { contextBlock += `- ${p.crop}: ${p.priceInfo}\n`; });
  }

  const prompt = `You are Vyapar Vaani, a caring AI assistant for rural Indian sellers.
The seller has ASKED for their daily update. Generate a COMPREHENSIVE voice message in ${langName}.

IMPORTANT: Write ENTIRELY in ${langName}. 
${language === 'hi' ? '- हर शब्द देवनागरी हिंदी में लिखो। कोई English या Roman Hindi नहीं।' : language === 'mr' ? '- प्रत्येक शब्द मराठी देवनागरी मध्ये लिहा. English किंवा Roman नाही.' : '- Write in simple English.'}

${contextBlock}

Rules:
- Write like a caring village elder speaking on phone. Warm, unhurried, detailed.
- Address the seller by name with respect (जी).
- Cover ALL weather and price information provided above. Do not skip anything.
- Give 2-3 actionable farming tips based on weather and crops.
- ${language === 'hi' ? 'संख्या हिंदी में बोलो: "पच्चीस डिग्री" not "25°C", "पचास रुपये" not "₹50"' : language === 'mr' ? 'संख्या मराठी मध्ये: "पंचवीस अंश" not "25°C"' : 'Say numbers in words.'}
- NO emoji, NO formatting, NO bullet points, NO colons, NO asterisks.
- Write 8-12 sentences. Comprehensive daily briefing.
- End with an encouraging sign-off.

Generate the complete message:`;

  try {
    const response = await bedrockClient.send(new ConverseCommand({
      modelId: 'amazon.nova-lite-v1:0',
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 800, temperature: 0.7 },
    }));
    return response.output?.message?.content?.[0]?.text?.trim() || null;
  } catch (error) {
    console.warn('On-demand alert generation failed:', error);
    return null;
  }
}
