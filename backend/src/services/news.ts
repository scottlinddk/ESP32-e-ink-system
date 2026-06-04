import { NewsItem, NewsApiResponse, CacheEntry } from '../types/index';

const NEWSAPI_BASE_URL = 'https://newsapi.org/v2/top-headlines';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const cache = new Map<string, CacheEntry<NewsItem[]>>();

function isCacheValid<T>(entry: CacheEntry<T>): boolean {
  return Date.now() < entry.expiresAt;
}

const LANGUAGE_TO_COUNTRY: Record<string, string> = {
  da: 'dk',
  en: 'us',
  de: 'de',
  sv: 'se',
  no: 'no',
  fi: 'fi',
};

export async function fetchNews(
  language: string = 'da',
  apiKey?: string
): Promise<NewsItem[]> {
  const key = apiKey ?? process.env.NEWS_API_KEY;

  const cacheKey = `news:${language}`;
  const cached = cache.get(cacheKey);
  if (cached && isCacheValid(cached)) {
    return cached.data;
  }

  if (!key) {
    // Return placeholder headlines if no API key is configured
    console.warn('No NEWS_API_KEY configured — returning placeholder headlines');
    return getPlaceholderHeadlines(language);
  }

  const country = LANGUAGE_TO_COUNTRY[language] ?? 'dk';
  const url = `${NEWSAPI_BASE_URL}?country=${country}&apiKey=${encodeURIComponent(key)}&pageSize=5`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.warn(`NewsAPI error: ${response.status} — falling back to placeholders`);
      return getPlaceholderHeadlines(language);
    }

    const json = (await response.json()) as NewsApiResponse;

    if (json.status !== 'ok' || !json.articles?.length) {
      return getPlaceholderHeadlines(language);
    }

    const items: NewsItem[] = json.articles
      .filter((a) => a.title && a.url && a.title !== '[Removed]')
      .slice(0, 3)
      .map((a) => ({ title: a.title, url: a.url }));

    cache.set(cacheKey, { data: items, expiresAt: Date.now() + CACHE_TTL_MS });

    return items;
  } catch (err) {
    console.error('NewsAPI fetch failed:', err);
    return getPlaceholderHeadlines(language);
  }
}

function getPlaceholderHeadlines(language: string): NewsItem[] {
  if (language === 'da') {
    return [
      { title: 'Energipriserne falder i Danmark', url: '#' },
      { title: 'Nyt vejrsystem på vej over landet', url: '#' },
      { title: 'Teknologivirksomheder investerer i grøn energi', url: '#' },
    ];
  }
  return [
    { title: 'Energy prices falling across Europe', url: '#' },
    { title: 'New weather system approaching', url: '#' },
    { title: 'Tech firms invest in renewable energy', url: '#' },
  ];
}

export function clearNewsCache(): void {
  cache.clear();
}
