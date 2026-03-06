
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { InvokeModelCommand, BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });

const NOVA_MODEL_ID = 'us.amazon.nova-lite-v1:0';

interface PriceSuggestion {
  competitive: 'good' | 'too_high' | 'too_low';
  recommendedMin: number;
  recommendedMax: number;
  reasoning: string; 
  tip: string; 
  marketData: {
    averagePrice: number;
    minPrice: number;
    maxPrice: number;
    sampleSize: number;
  };
  confidence: number;
}

interface MarketplaceProduct {
  id: string;
  name: string;
  price: number;
  quantity: number;
  unit: string;
  category: string;
}

export async function suggestOptimalPrice(
  productName: string,
  category: string,
  quantity: number,
  unit: string,
  sellerPrice: number,
  language: string
): Promise<PriceSuggestion> {
  console.log('Generating price recommendation for:', productName);

  try {

    const similarProducts = await querySimilarProducts(productName, category);

    if (similarProducts.length === 0) {

      return generateNoDataRecommendation(sellerPrice, language);
    }

    const marketData = calculateMarketStats(similarProducts);

    const prompt = buildPriceAnalysisPrompt({
      productName,
      category,
      quantity,
      unit,
      sellerPrice,
      marketData,
      language
    });

    const aiResponse = await invokeNovaLite(prompt);
    const recommendation = parsePriceRecommendation(aiResponse, marketData);

    console.log('Generated price recommendation:', recommendation);
    return recommendation;

  } catch (error) {
    console.error('Price recommendation failed:', error);

    return generateNoDataRecommendation(sellerPrice, language);
  }
}

async function querySimilarProducts(
  productName: string,
  category: string
): Promise<MarketplaceProduct[]> {
  const tableName = process.env.MARKETPLACE_PRODUCTS_TABLE || 'marketplace-products';

  try {
    const command = new ScanCommand({
      TableName: tableName,
      Limit: 50 
    });

    const result = await dynamoClient.send(command);

    if (!result.Items || result.Items.length === 0) {
      return [];
    }

    const products = result.Items.map(item => unmarshall(item)) as any[];

    const similar = products.filter(p => {
      const nameMatch = p.name?.toLowerCase().includes(productName.toLowerCase()) ||
                       productName.toLowerCase().includes(p.name?.toLowerCase());
      const categoryMatch = p.category?.toLowerCase() === category.toLowerCase();

      return nameMatch || categoryMatch;
    });

    return similar.map(p => ({
      id: p.id,
      name: p.name,
      price: parseFloat(p.price) || 0,
      quantity: parseInt(p.quantity) || 0,
      unit: p.unit || '',
      category: p.category || ''
    }));

  } catch (error) {
    console.error('Failed to query marketplace:', error);
    return [];
  }
}

function calculateMarketStats(products: MarketplaceProduct[]) {
  const prices = products.map(p => p.price).filter(p => p > 0);

  if (prices.length === 0) {
    return {
      averagePrice: 0,
      minPrice: 0,
      maxPrice: 0,
      sampleSize: 0
    };
  }

  const sum = prices.reduce((a, b) => a + b, 0);
  const average = sum / prices.length;
  const min = Math.min(...prices);
  const max = Math.max(...prices);

  return {
    averagePrice: Math.round(average * 100) / 100,
    minPrice: min,
    maxPrice: max,
    sampleSize: prices.length
  };
}

function buildPriceAnalysisPrompt(data: {
  productName: string;
  category: string;
  quantity: number;
  unit: string;
  sellerPrice: number;
  marketData: any;
  language: string;
}): string {
  const languageMap: Record<string, string> = {
    'hi-IN': 'Hindi',
    'mr-IN': 'Marathi',
    'en-IN': 'English'
  };

  const language = languageMap[data.language] || 'Hindi';

  return `You are a pricing advisor for rural Indian sellers on an e-commerce platform.

Seller's Product:
- Name: ${data.productName}
- Category: ${data.category}
- Quantity: ${data.quantity} ${data.unit}
- Seller's Price: ₹${data.sellerPrice}

Market Data (from ${data.marketData.sampleSize} similar products):
- Average Price: ₹${data.marketData.averagePrice}
- Price Range: ₹${data.marketData.minPrice} - ₹${data.marketData.maxPrice}

Analyze and provide pricing recommendation in ${language}:

1. Is the seller's price competitive?
   - "good" if within 15% of average
   - "too_high" if more than 20% above average
   - "too_low" if more than 20% below average

2. Recommended price range (min and max)
   - Should be realistic and competitive
   - Consider seller needs profit margin

3. Brief reasoning in simple ${language} (2-3 sentences)
   - Why this price range?
   - What market factors to consider?

4. One actionable tip for the seller in ${language}

Provide response in this JSON format:
{
  "competitive": "good|too_high|too_low",
  "recommendedMin": number,
  "recommendedMax": number,
  "reasoning": "explanation in ${language}",
  "tip": "actionable advice in ${language}"
}

Important:
- Be honest and helpful
- Consider seller needs to make profit
- Consider buyer wants fair price
- Suggest prices that are competitive but fair
- Use simple language the seller can understand
- Be encouraging and supportive

Generate the recommendation now:`;
}

async function invokeNovaLite(prompt: string): Promise<string> {
  const requestBody = {
    messages: [
      {
        role: 'user',
        content: [{ text: prompt }]
      }
    ],
    inferenceConfig: {
      max_new_tokens: 400,
      temperature: 0.7,
      top_p: 0.9
    }
  };

  console.log('Calling Nova Lite for price analysis...');

  const command = new InvokeModelCommand({
    modelId: NOVA_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody)
  });

  const response = await bedrockClient.send(command);

  if (!response.body) {
    throw new Error('Empty response from Nova Lite');
  }

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const text = responseBody.output?.message?.content?.[0]?.text;

  if (!text) {
    throw new Error('No text in Nova Lite response');
  }

  return text;
}

function parsePriceRecommendation(
  response: string,
  marketData: any
): PriceSuggestion {
  try {

    let jsonText = response.trim();

    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```\n?/g, '');
    }

    const parsed = JSON.parse(jsonText);

    return {
      competitive: parsed.competitive || 'good',
      recommendedMin: parsed.recommendedMin || marketData.minPrice,
      recommendedMax: parsed.recommendedMax || marketData.maxPrice,
      reasoning: parsed.reasoning || '',
      tip: parsed.tip || '',
      marketData,
      confidence: 0.85
    };

  } catch (error) {
    console.error('Failed to parse price recommendation:', error);

    return {
      competitive: 'good',
      recommendedMin: Math.round(marketData.averagePrice * 0.9),
      recommendedMax: Math.round(marketData.averagePrice * 1.1),
      reasoning: 'Based on market average',
      tip: 'Price competitively to attract buyers',
      marketData,
      confidence: 0.5
    };
  }
}

function generateNoDataRecommendation(
  sellerPrice: number,
  language: string
): PriceSuggestion {

  const validPrice = Math.max(10, Math.abs(sellerPrice));

  const templates: Record<string, any> = {
    'hi-IN': {
      reasoning: 'बाज़ार में अभी इस उत्पाद के लिए पर्याप्त डेटा नहीं है। आपकी कीमत उचित लग रही है।',
      tip: 'अपनी कीमत देखें कि खरीदार कैसे प्रतिक्रिया देते हैं और आवश्यकता अनुसार समायोजित करें।'
    },
    'mr-IN': {
      reasoning: 'बाजारात या उत्पादनासाठी पुरेसा डेटा नाही. तुमची किंमत योग्य दिसते.',
      tip: 'खरेदीदार कसे प्रतिसाद देतात ते पहा आणि आवश्यकतेनुसार समायोजित करा.'
    },
    'en-IN': {
      reasoning: 'Not enough market data available for this product yet. Your price seems reasonable.',
      tip: 'Monitor how buyers respond and adjust as needed.'
    }
  };

  const template = templates[language] || templates['hi-IN'];

  return {
    competitive: 'good',
    recommendedMin: Math.round(validPrice * 0.9),
    recommendedMax: Math.round(validPrice * 1.1),
    reasoning: template.reasoning,
    tip: template.tip,
    marketData: {
      averagePrice: validPrice,
      minPrice: validPrice,
      maxPrice: validPrice,
      sampleSize: 0
    },
    confidence: 0.3
  };
}
