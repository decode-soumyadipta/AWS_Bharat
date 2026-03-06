
interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

interface MarketPriceResult {
  found: boolean;
  commodity: string;
  minPrice: number | null;
  maxPrice: number | null;
  modalPrice: number | null;  
  market: string;
  state: string;
  arrivalDate: string;
  unit: string;
  sourceUrl: string;
  sourceName: string;
  priceInfo: string;         
  isLive: boolean;           
}

const COMMODITY_NAME_MAP: Record<string, string> = {

  'आम': 'Mango', 'आलू': 'Potato', 'टमाटर': 'Tomato', 'प्याज': 'Onion',
  'गोभी': 'Cauliflower', 'मिर्च': 'Green Chilli', 'भिंडी': 'Bhindi(Ladies Finger)',
  'बैंगन': 'Brinjal', 'गेहूं': 'Wheat', 'चावल': 'Rice', 'दाल': 'Arhar (Tur/Red Gram)(Whole)',
  'चना': 'Bengal Gram(Gram)(Whole)', 'दूध': 'Milk', 'पनीर': 'Paneer', 'घी': 'Ghee',
  'हल्दी': 'Turmeric', 'जीरा': 'Cumin Seed(Jeera)', 'अदरक': 'Ginger(Green)',
  'लहसुन': 'Garlic', 'केला': 'Banana', 'सेब': 'Apple', 'संतरा': 'Orange',
  'अंगूर': 'Grapes', 'पपीता': 'Papaya', 'अनार': 'Pomegranate', 'तरबूज': 'Watermelon',
  'मूंगफली': 'Groundnut', 'सरसों': 'Mustard', 'गाजर': 'Carrot', 'मटर': 'Green Peas',
  'पालक': 'Spinach', 'मूली': 'Raddish', 'शिमला मिर्च': 'Capsicum',
  'नारियल': 'Coconut', 'अमरूद': 'Guava', 'लीची': 'Litchi', 'बादाम': 'Almond(Badam)',

  'aam': 'Mango', 'aloo': 'Potato', 'tamatar': 'Tomato', 'pyaj': 'Onion', 'pyaaz': 'Onion',
  'gobi': 'Cauliflower', 'mirch': 'Green Chilli', 'bhindi': 'Bhindi(Ladies Finger)',
  'baingan': 'Brinjal', 'gehun': 'Wheat', 'chawal': 'Rice', 'dal': 'Arhar (Tur/Red Gram)(Whole)',
  'chana': 'Bengal Gram(Gram)(Whole)', 'doodh': 'Milk', 'paneer': 'Paneer', 'ghee': 'Ghee',
  'haldi': 'Turmeric', 'jeera': 'Cumin Seed(Jeera)', 'adrak': 'Ginger(Green)',
  'lahsun': 'Garlic', 'kela': 'Banana', 'seb': 'Apple', 'santra': 'Orange',
  'angoor': 'Grapes', 'papita': 'Papaya', 'anar': 'Pomegranate', 'tarbooj': 'Watermelon',
  'moongfali': 'Groundnut', 'sarson': 'Mustard', 'gajar': 'Carrot', 'matar': 'Green Peas',
  'palak': 'Spinach', 'mooli': 'Raddish', 'shimla mirch': 'Capsicum',
  'nariyal': 'Coconut', 'amrood': 'Guava', 'lichi': 'Litchi',

  'mango': 'Mango', 'potato': 'Potato', 'tomato': 'Tomato', 'onion': 'Onion',
  'cauliflower': 'Cauliflower', 'chili': 'Green Chilli', 'chilli': 'Green Chilli',
  'okra': 'Bhindi(Ladies Finger)', 'brinjal': 'Brinjal', 'eggplant': 'Brinjal',
  'wheat': 'Wheat', 'rice': 'Rice', 'lentils': 'Arhar (Tur/Red Gram)(Whole)',
  'chickpeas': 'Bengal Gram(Gram)(Whole)', 'milk': 'Milk', 'turmeric': 'Turmeric',
  'cumin': 'Cumin Seed(Jeera)', 'ginger': 'Ginger(Green)', 'garlic': 'Garlic',
  'banana': 'Banana', 'apple': 'Apple', 'orange': 'Orange', 'grapes': 'Grapes',
  'papaya': 'Papaya', 'pomegranate': 'Pomegranate', 'watermelon': 'Watermelon',
  'groundnut': 'Groundnut', 'mustard': 'Mustard', 'carrot': 'Carrot',
  'peas': 'Green Peas', 'spinach': 'Spinach', 'radish': 'Raddish',
  'capsicum': 'Capsicum', 'coconut': 'Coconut', 'guava': 'Guava',

  'कांदा': 'Onion', 'बटाटा': 'Potato', 'भाजी': 'Spinach',
};

const FALLBACK_PRICES: Record<string, { min: number; max: number; unit: string; season?: string; category: string }> = {
  'Mango': { min: 40, max: 150, unit: 'kg', season: 'Apr-Jul', category: 'fruits' },
  'Banana': { min: 20, max: 60, unit: 'dozen', category: 'fruits' },
  'Apple': { min: 80, max: 200, unit: 'kg', category: 'fruits' },
  'Orange': { min: 30, max: 80, unit: 'kg', season: 'Nov-Mar', category: 'fruits' },
  'Grapes': { min: 40, max: 120, unit: 'kg', season: 'Jan-Apr', category: 'fruits' },
  'Papaya': { min: 20, max: 50, unit: 'kg', category: 'fruits' },
  'Pomegranate': { min: 80, max: 200, unit: 'kg', category: 'fruits' },
  'Watermelon': { min: 10, max: 30, unit: 'kg', season: 'Mar-Jun', category: 'fruits' },
  'Tomato': { min: 15, max: 80, unit: 'kg', category: 'vegetables' },
  'Onion': { min: 15, max: 60, unit: 'kg', category: 'vegetables' },
  'Potato': { min: 15, max: 40, unit: 'kg', category: 'vegetables' },
  'Cauliflower': { min: 15, max: 50, unit: 'kg', category: 'vegetables' },
  'Green Chilli': { min: 30, max: 100, unit: 'kg', category: 'vegetables' },
  'Bhindi(Ladies Finger)': { min: 25, max: 60, unit: 'kg', category: 'vegetables' },
  'Brinjal': { min: 20, max: 50, unit: 'kg', category: 'vegetables' },
  'Wheat': { min: 25, max: 40, unit: 'kg', category: 'grains' },
  'Rice': { min: 30, max: 80, unit: 'kg', category: 'grains' },
  'Arhar (Tur/Red Gram)(Whole)': { min: 60, max: 150, unit: 'kg', category: 'grains' },
  'Bengal Gram(Gram)(Whole)': { min: 40, max: 80, unit: 'kg', category: 'grains' },
  'Turmeric': { min: 100, max: 250, unit: 'kg', category: 'spices' },
  'Cumin Seed(Jeera)': { min: 200, max: 500, unit: 'kg', category: 'spices' },
  'Ginger(Green)': { min: 40, max: 120, unit: 'kg', category: 'spices' },
  'Garlic': { min: 60, max: 200, unit: 'kg', category: 'spices' },
  'Carrot': { min: 20, max: 50, unit: 'kg', category: 'vegetables' },
  'Green Peas': { min: 30, max: 80, unit: 'kg', category: 'vegetables' },
  'Spinach': { min: 15, max: 40, unit: 'kg', category: 'vegetables' },
  'Raddish': { min: 10, max: 30, unit: 'kg', category: 'vegetables' },
  'Capsicum': { min: 30, max: 80, unit: 'kg', category: 'vegetables' },
  'Coconut': { min: 15, max: 35, unit: 'piece', category: 'fruits' },
  'Guava': { min: 30, max: 80, unit: 'kg', category: 'fruits' },
  'Groundnut': { min: 50, max: 120, unit: 'kg', category: 'grains' },
  'Mustard': { min: 40, max: 90, unit: 'kg', category: 'grains' },
};

const DATA_GOV_API_URL = 'https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070';
const DATA_GOV_API_KEY = process.env.DATA_GOV_API_KEY || '579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b';
const AGMARKNET_URL = 'https://agmarknet.gov.in';

export async function fetchLiveMarketPrice(productName: string): Promise<MarketPriceResult> {
  const key = productName.toLowerCase().trim();
  const commodity = COMMODITY_NAME_MAP[key] || productName;

  console.log(`📊 Fetching live price for: "${productName}" → commodity: "${commodity}"`);

  try {

    const today = new Date();
    const dateStr = `${today.getDate().toString().padStart(2, '0')}/${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getFullYear()}`;

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getDate().toString().padStart(2, '0')}/${(yesterday.getMonth() + 1).toString().padStart(2, '0')}/${yesterday.getFullYear()}`;

    for (const dateQuery of [dateStr, yesterdayStr]) {
      const url = `${DATA_GOV_API_URL}?api-key=${DATA_GOV_API_KEY}&format=json&limit=5&filters[commodity]=${encodeURIComponent(commodity)}&filters[arrival_date]=${encodeURIComponent(dateQuery)}`;

      console.log(`🌐 Querying data.gov.in for ${commodity} on ${dateQuery}`);

      let response: Response | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        response = await fetch(url, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(5000),
        });
        if (response.status === 429) {
          const backoff = (attempt + 1) * 1000; 
          console.warn(`data.gov.in rate limited (429), retrying in ${backoff}ms (attempt ${attempt + 1}/2)`);
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }
        break;
      }

      if (!response || !response.ok) {
        console.warn(`data.gov.in returned ${response?.status || 'no response'}`);
        continue;
      }

      const data: any = await response.json();
      const records = data.records || [];

      if (records.length > 0) {

        let globalMin = Infinity;
        let globalMax = 0;
        let modalSum = 0;
        let modalCount = 0;
        let bestMarket = records[0].market || 'Unknown';
        let bestState = records[0].state || 'India';
        const arrivalDate = records[0].arrival_date || dateQuery;

        for (const rec of records) {
          const rMin = parseFloat(rec.min_price) || 0;
          const rMax = parseFloat(rec.max_price) || 0;
          const rModal = parseFloat(rec.modal_price) || 0;
          if (rMin > 0 && rMin < globalMin) globalMin = rMin;
          if (rMax > globalMax) { globalMax = rMax; bestMarket = rec.market || bestMarket; bestState = rec.state || bestState; }
          if (rModal > 0) { modalSum += rModal; modalCount++; }
        }
        if (globalMin === Infinity) globalMin = globalMax;

        const minPerKg = Math.floor(globalMin / 100);
        const maxPerKg = Math.ceil(globalMax / 100);
        const modalPerKg = Math.round((modalCount > 0 ? modalSum / modalCount : (globalMin + globalMax) / 2) / 100);

        const market = bestMarket;
        const state = bestState;
        const priceDisplay = minPerKg === maxPerKg ? `₹${minPerKg}/kg` : `₹${minPerKg}-₹${maxPerKg}/kg`;
        const priceInfo = `${priceDisplay} (मंडी भाव ₹${modalPerKg}/kg) — ${market}, ${state} (${arrivalDate})`;
        const sourceUrl = `${AGMARKNET_URL}/SearchCmmMkt.aspx?Ession_id=1&commodity=${encodeURIComponent(commodity)}&state=--Select--&district=--Select--&market=--Select--&DateFrom=${dateQuery}&DateTo=${dateQuery}&trend=0&collegession_id=1&commoditygroup=--Select--`;

        console.log(`✅ Live price found: ${priceInfo}`);

        return {
          found: true,
          commodity,
          minPrice: minPerKg,
          maxPrice: maxPerKg,
          modalPrice: modalPerKg,
          market,
          state,
          arrivalDate,
          unit: 'kg',
          sourceUrl,
          sourceName: 'data.gov.in / Agmarknet (भारत सरकार)',
          priceInfo,
          isLive: true,
        };
      }
    }

    const fallbackUrl = `${DATA_GOV_API_URL}?api-key=${DATA_GOV_API_KEY}&format=json&limit=3&filters[commodity]=${encodeURIComponent(commodity)}&sort[arrival_date]=desc`;

    let fallbackResponse: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      fallbackResponse = await fetch(fallbackUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (fallbackResponse.status === 429) {
        const backoff = (attempt + 1) * 1000;
        console.warn(`data.gov.in fallback rate limited (429), retrying in ${backoff}ms (attempt ${attempt + 1}/2)`);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      break;
    }

    if (fallbackResponse && fallbackResponse.ok) {
      const fallbackData: any = await fallbackResponse.json();
      const records = fallbackData.records || [];

      if (records.length > 0) {

        let globalMin = Infinity;
        let globalMax = 0;
        let modalSum = 0;
        let modalCount = 0;
        let bestMarket = records[0].market || 'Unknown';
        let bestState = records[0].state || 'India';
        const arrivalDate = records[0].arrival_date || 'recent';

        for (const rec of records) {
          const rMin = parseFloat(rec.min_price) || 0;
          const rMax = parseFloat(rec.max_price) || 0;
          const rModal = parseFloat(rec.modal_price) || 0;
          if (rMin > 0 && rMin < globalMin) globalMin = rMin;
          if (rMax > globalMax) { globalMax = rMax; bestMarket = rec.market || bestMarket; bestState = rec.state || bestState; }
          if (rModal > 0) { modalSum += rModal; modalCount++; }
        }
        if (globalMin === Infinity) globalMin = globalMax;

        const minPerKg = Math.floor(globalMin / 100);
        const maxPerKg = Math.ceil(globalMax / 100);
        const modalPerKg = Math.round((modalCount > 0 ? modalSum / modalCount : (globalMin + globalMax) / 2) / 100);
        const market = bestMarket;
        const state = bestState;

        const priceDisplay = minPerKg === maxPerKg ? `₹${minPerKg}/kg` : `₹${minPerKg}-₹${maxPerKg}/kg`;
        const priceInfo = `${priceDisplay} (मंडी भाव ₹${modalPerKg}/kg) — ${market}, ${state} (${arrivalDate})`;

        console.log(`✅ Recent price found (not today): ${priceInfo}`);

        return {
          found: true,
          commodity,
          minPrice: minPerKg,
          maxPrice: maxPerKg,
          modalPrice: modalPerKg,
          market,
          state,
          arrivalDate,
          unit: 'kg',
          sourceUrl: AGMARKNET_URL,
          sourceName: 'data.gov.in / Agmarknet (भारत सरकार)',
          priceInfo,
          isLive: true,
        };
      }
    }

    console.log(`⚠️ No API results for "${commodity}", using fallback`);
  } catch (error: any) {
    console.warn(`⚠️ data.gov.in API failed for "${commodity}":`, error.message);
  }

  return getFallbackPrice(productName, commodity);
}

function getFallbackPrice(productName: string, commodity: string): MarketPriceResult {
  const priceData = FALLBACK_PRICES[commodity];

  if (!priceData) {
    return {
      found: false,
      commodity,
      minPrice: null,
      maxPrice: null,
      modalPrice: null,
      market: '',
      state: '',
      arrivalDate: '',
      unit: '',
      sourceUrl: AGMARKNET_URL,
      sourceName: 'Agmarknet',
      priceInfo: '',
      isLive: false,
    };
  }

  const seasonNote = priceData.season ? ` (Season: ${priceData.season})` : '';
  const priceInfo = `₹${priceData.min}-₹${priceData.max}/${priceData.unit}${seasonNote}`;

  return {
    found: true,
    commodity,
    minPrice: priceData.min,
    maxPrice: priceData.max,
    modalPrice: Math.round((priceData.min + priceData.max) / 2),
    market: 'Average',
    state: 'India',
    arrivalDate: 'seasonal estimate',
    unit: priceData.unit,
    sourceUrl: AGMARKNET_URL,
    sourceName: 'Agmarknet (अनुमानित भाव)',
    priceInfo,
    isLive: false,
  };
}

export function getLocalMarketPrice(product: string): {
  found: boolean;
  priceInfo: string;
  sourceUrl: string;
  sourceName: string;
} {

  const key = product.toLowerCase().trim();
  const commodity = COMMODITY_NAME_MAP[key] || product;
  const result = getFallbackPrice(product, commodity);

  return {
    found: result.found,
    priceInfo: result.priceInfo,
    sourceUrl: result.sourceUrl,
    sourceName: result.sourceName,
  };
}

export async function remote_web_search(params: { query: string }): Promise<WebSearchResult[]> {
  console.log('🔍 Web search:', params.query);

  const braveResults = await searchBrave(params.query);
  if (braveResults.length > 0) {
    console.log(`✅ Brave search: ${braveResults.length} results`);
    return braveResults;
  }

  const ddgResults = await searchDuckDuckGoHTML(params.query);
  if (ddgResults.length > 0) {
    console.log(`✅ DDG HTML search: ${ddgResults.length} results`);
    return ddgResults;
  }

  const ddgInstant = await searchDuckDuckGoInstant(params.query);
  if (ddgInstant.length > 0) {
    console.log(`✅ DDG Instant search: ${ddgInstant.length} results`);
    return ddgInstant;
  }

  console.log('⚠️ All web search strategies returned 0 results');
  return [];
}

async function searchBrave(query: string): Promise<WebSearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    return [];
  }

  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
      {
        headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' },
      }
    );
    if (!response.ok) return [];
    const data: any = await response.json();
    return (data.web?.results || []).slice(0, 5).map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.description || '',
      publishedDate: r.page_age,
    }));
  } catch {
    return [];
  }
}

async function searchDuckDuckGoHTML(query: string): Promise<WebSearchResult[]> {
  try {
    const response = await fetch(
      `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; VyaparVaani/1.0)',
        },
      }
    );
    if (!response.ok) return [];
    const html = await response.text();

    const results: WebSearchResult[] = [];
    const linkRegex = /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
    const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

    let linkMatch;
    const links: { url: string; title: string }[] = [];
    while ((linkMatch = linkRegex.exec(html)) !== null) {
      links.push({ url: linkMatch[1], title: linkMatch[2].trim() });
    }

    let snippetMatch;
    const snippets: string[] = [];
    while ((snippetMatch = snippetRegex.exec(html)) !== null) {
      snippets.push(snippetMatch[1].replace(/<[^>]+>/g, '').trim());
    }

    for (let i = 0; i < Math.min(links.length, 5); i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] || links[i].title,
      });
    }

    return results;
  } catch {
    return [];
  }
}

async function searchDuckDuckGoInstant(query: string): Promise<WebSearchResult[]> {
  try {
    const response = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    );
    if (!response.ok) return [];
    const data: any = await response.json();
    const results: WebSearchResult[] = [];

    if (data.Abstract) {
      results.push({
        title: data.Heading || 'Search Result',
        url: data.AbstractURL || '',
        snippet: data.Abstract,
      });
    }
    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      data.RelatedTopics.slice(0, 3).forEach((topic: any) => {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.split(' - ')[0] || 'Related',
            url: topic.FirstURL,
            snippet: topic.Text,
          });
        }
      });
    }
    return results;
  } catch {
    return [];
  }
}
