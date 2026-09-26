import { NewsItem, NewsApiResponse, CacheEntry } from '../types/index';
import { createHash } from 'crypto';

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
  apiKey?: string,
  signal?: AbortSignal
): Promise<NewsItem[]> {
  const requestSignal = signal ?? AbortSignal.timeout(10_000);
  requestSignal.throwIfAborted();
  const key = apiKey ?? process.env.NEWS_API_KEY;

  if (!key) {
    throw new Error('News API key is not configured');
  }

  // A cached response must not bypass another user's missing or invalid key.
  const keyId = createHash('sha256').update(key).digest('hex');
  const cacheKey = `news:${language}:${keyId}`;
  const cached = cache.get(cacheKey);
  if (cached && isCacheValid(cached)) {
    return cached.data;
  }

  const country = LANGUAGE_TO_COUNTRY[language] ?? 'dk';
  const url = `${NEWSAPI_BASE_URL}?country=${country}&apiKey=${encodeURIComponent(key)}&pageSize=5`;

  const response = await fetch(url, { signal: requestSignal });
  if (!response.ok) {
    throw new Error(`News API request failed (${response.status})`);
  }

  const json = (await response.json()) as NewsApiResponse;
  requestSignal.throwIfAborted();
  if (json.status !== 'ok' || !Array.isArray(json.articles)) {
    throw new Error('News API returned an invalid response');
  }

  const items: NewsItem[] = json.articles
    .filter((a) => a.title && a.url && a.title !== '[Removed]')
    .slice(0, 3)
    .map((a) => ({ title: a.title, url: a.url }));

  cache.set(cacheKey, { data: items, expiresAt: Date.now() + CACHE_TTL_MS });
  return items;
}

export function clearNewsCache(): void {
  cache.clear();
}
