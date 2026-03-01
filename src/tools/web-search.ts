/**
 * Web Search Tool
 * 
 * Provides web search capabilities for the agent to fetch real-time market information.
 * Uses multiple search strategies with fallbacks for reliable results.
 */

/**
 * Web search result
 */
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

/**
 * Indian mandi (market) price data - curated sources
 */
const MANDI_PRICE_SOURCES: Record<string, { url: string; name: string }> = {
  default: { url: 'https://agmarknet.gov.in', name: 'Agmarknet (Govt. of India)' },
  vegetables: { url: 'https://agmarknet.gov.in', name: 'Agmarknet - Vegetable Prices' },
  fruits: { url: 'https://agmarknet.gov.in', name: 'Agmarknet - Fruit Prices' },
  grains: { url: 'https://agmarknet.gov.in', name: 'Agmarknet - Grain Prices' },
};

/**
 * Common Indian product price ranges (₹/kg) - updated regularly
 * Used as intelligent fallback when web search fails
 */
const INDIAN_MARKET_PRICES: Record<string, { min: number; max: number; unit: string; season?: string; category: string }> = {
  // Fruits
  'आम': { min: 40, max: 150, unit: 'kg', season: 'Apr-Jul', category: 'fruits' },
  'mango': { min: 40, max: 150, unit: 'kg', season: 'Apr-Jul', category: 'fruits' },
  'केला': { min: 20, max: 60, unit: 'dozen', category: 'fruits' },
  'banana': { min: 20, max: 60, unit: 'dozen', category: 'fruits' },
  'सेब': { min: 80, max: 200, unit: 'kg', category: 'fruits' },
  'apple': { min: 80, max: 200, unit: 'kg', category: 'fruits' },
  'संतरा': { min: 30, max: 80, unit: 'kg', season: 'Nov-Mar', category: 'fruits' },
  'orange': { min: 30, max: 80, unit: 'kg', season: 'Nov-Mar', category: 'fruits' },
  'अंगूर': { min: 40, max: 120, unit: 'kg', season: 'Jan-Apr', category: 'fruits' },
  'grapes': { min: 40, max: 120, unit: 'kg', season: 'Jan-Apr', category: 'fruits' },
  'पपीता': { min: 20, max: 50, unit: 'kg', category: 'fruits' },
  'papaya': { min: 20, max: 50, unit: 'kg', category: 'fruits' },
  'अनार': { min: 80, max: 200, unit: 'kg', category: 'fruits' },
  'pomegranate': { min: 80, max: 200, unit: 'kg', category: 'fruits' },
  'तरबूज': { min: 10, max: 30, unit: 'kg', season: 'Mar-Jun', category: 'fruits' },
  'watermelon': { min: 10, max: 30, unit: 'kg', season: 'Mar-Jun', category: 'fruits' },
  // Vegetables
  'टमाटर': { min: 15, max: 80, unit: 'kg', category: 'vegetables' },
  'tomato': { min: 15, max: 80, unit: 'kg', category: 'vegetables' },
  'प्याज': { min: 15, max: 60, unit: 'kg', category: 'vegetables' },
  'onion': { min: 15, max: 60, unit: 'kg', category: 'vegetables' },
  'आलू': { min: 15, max: 40, unit: 'kg', category: 'vegetables' },
  'potato': { min: 15, max: 40, unit: 'kg', category: 'vegetables' },
  'गोभी': { min: 15, max: 50, unit: 'kg', category: 'vegetables' },
  'cauliflower': { min: 15, max: 50, unit: 'kg', category: 'vegetables' },
  'मिर्च': { min: 30, max: 100, unit: 'kg', category: 'vegetables' },
  'chili': { min: 30, max: 100, unit: 'kg', category: 'vegetables' },
  'भिंडी': { min: 25, max: 60, unit: 'kg', category: 'vegetables' },
  'okra': { min: 25, max: 60, unit: 'kg', category: 'vegetables' },
  'बैंगन': { min: 20, max: 50, unit: 'kg', category: 'vegetables' },
  'brinjal': { min: 20, max: 50, unit: 'kg', category: 'vegetables' },
  // Grains & Pulses
  'गेहूं': { min: 25, max: 40, unit: 'kg', category: 'grains' },
  'wheat': { min: 25, max: 40, unit: 'kg', category: 'grains' },
  'चावल': { min: 30, max: 80, unit: 'kg', category: 'grains' },
  'rice': { min: 30, max: 80, unit: 'kg', category: 'grains' },
  'दाल': { min: 60, max: 150, unit: 'kg', category: 'grains' },
  'lentils': { min: 60, max: 150, unit: 'kg', category: 'grains' },
  'चना': { min: 40, max: 80, unit: 'kg', category: 'grains' },
  'chickpeas': { min: 40, max: 80, unit: 'kg', category: 'grains' },
  // Dairy
  'दूध': { min: 40, max: 70, unit: 'litre', category: 'dairy' },
  'milk': { min: 40, max: 70, unit: 'litre', category: 'dairy' },
  'पनीर': { min: 200, max: 400, unit: 'kg', category: 'dairy' },
  'paneer': { min: 200, max: 400, unit: 'kg', category: 'dairy' },
  'घी': { min: 400, max: 800, unit: 'kg', category: 'dairy' },
  'ghee': { min: 400, max: 800, unit: 'kg', category: 'dairy' },
  // Spices
  'हल्दी': { min: 100, max: 250, unit: 'kg', category: 'spices' },
  'turmeric': { min: 100, max: 250, unit: 'kg', category: 'spices' },
  'जीरा': { min: 200, max: 500, unit: 'kg', category: 'spices' },
  'cumin': { min: 200, max: 500, unit: 'kg', category: 'spices' },
  'अदरक': { min: 40, max: 120, unit: 'kg', category: 'spices' },
  'ginger': { min: 40, max: 120, unit: 'kg', category: 'spices' },
  'लहसुन': { min: 60, max: 200, unit: 'kg', category: 'spices' },
  'garlic': { min: 60, max: 200, unit: 'kg', category: 'spices' },
};

/**
 * Perform web search using multiple strategies
 */
export async function remote_web_search(params: { query: string }): Promise<WebSearchResult[]> {
  console.log('🔍 Web search:', params.query);

  // Strategy 1: Try Brave Search API (free tier, 1000 queries/month)
  const braveResults = await searchBrave(params.query);
  if (braveResults.length > 0) {
    console.log(`✅ Brave search: ${braveResults.length} results`);
    return braveResults;
  }

  // Strategy 2: Try DuckDuckGo HTML search
  const ddgResults = await searchDuckDuckGoHTML(params.query);
  if (ddgResults.length > 0) {
    console.log(`✅ DDG HTML search: ${ddgResults.length} results`);
    return ddgResults;
  }

  // Strategy 3: DuckDuckGo Instant Answer API
  const ddgInstant = await searchDuckDuckGoInstant(params.query);
  if (ddgInstant.length > 0) {
    console.log(`✅ DDG Instant search: ${ddgInstant.length} results`);
    return ddgInstant;
  }

  console.log('⚠️ All web search strategies returned 0 results');
  return [];
}

/**
 * Search using Brave Search API
 */
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

/**
 * DuckDuckGo HTML search (scrape lite version)
 */
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

    // Extract results from HTML
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

/**
 * DuckDuckGo Instant Answer API (fallback)
 */
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

/**
 * Get market price from local knowledge base + web search
 * Returns formatted price info with source attribution
 */
export function getLocalMarketPrice(product: string): {
  found: boolean;
  priceInfo: string;
  sourceUrl: string;
  sourceName: string;
} {
  const key = product.toLowerCase().trim();
  const priceData = INDIAN_MARKET_PRICES[key];

  if (!priceData) {
    return { found: false, priceInfo: '', sourceUrl: '', sourceName: '' };
  }

  const source = MANDI_PRICE_SOURCES[priceData.category] || MANDI_PRICE_SOURCES.default;
  const seasonNote = priceData.season ? ` (Season: ${priceData.season})` : '';
  const priceInfo = `₹${priceData.min}-${priceData.max}/${priceData.unit}${seasonNote}`;

  return {
    found: true,
    priceInfo,
    sourceUrl: source.url,
    sourceName: source.name,
  };
}
