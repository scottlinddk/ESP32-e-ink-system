import type { NewsItem, CacheEntry } from '../types/index';
import { createHash } from 'node:crypto';
import { NewsSourceError } from '../utils/newsErrors';

const NEWSAPI_BASE_URL = 'https://newsapi.org/v2/top-headlines';
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 128 * 1024;
const cache = new Map<string, CacheEntry<NewsItem[]>>();
// https://newsapi.org/docs/endpoints/sources lists these countries/languages, not DK/FI.
const LANGUAGE_TO_COUNTRY: Record<string, string> = { en: 'us', de: 'de', sv: 'se', no: 'no' };

async function readHeadlines(response: Response, signal: AbortSignal): Promise<NewsItem[]> {
  if (signal.aborted || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES || !response.body) {
    void response.body?.cancel().catch(() => {});
    throw new NewsSourceError(signal.aborted ? 'timeout' : 'invalid_response');
  }
  const reader = response.body.getReader();
  const cancelBody = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancelBody, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { cancelBody(); throw new NewsSourceError('invalid_response'); }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', cancelBody); reader.releaseLock(); }
  let json: { status?: unknown; articles?: unknown } | null;
  try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new NewsSourceError('invalid_response'); }
  if (json?.status !== 'ok' || !Array.isArray(json.articles) || json.articles.length > 100) {
    throw new NewsSourceError('invalid_response');
  }
  const items: NewsItem[] = [];
  for (const article of json.articles) {
    if (!article || typeof article.title !== 'string' || typeof article.url !== 'string') {
      throw new NewsSourceError('invalid_response');
    }
    const title = article.title.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 512);
    if (!title || title === '[Removed]') continue;
    if (article.url.length > 2048) throw new NewsSourceError('invalid_response');
    let url: URL;
    try { url = new URL(article.url); } catch { throw new NewsSourceError('invalid_response'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new NewsSourceError('invalid_response');
    if (items.length < 3) items.push({ title, url: url.href });
  }
  return items;
}

export async function fetchNews(language = 'da', apiKey?: string, signal?: AbortSignal): Promise<NewsItem[]> {
  if (signal?.aborted) throw new NewsSourceError('timeout');
  const country = Object.prototype.hasOwnProperty.call(LANGUAGE_TO_COUNTRY, language) ? LANGUAGE_TO_COUNTRY[language] : undefined;
  if (!country) throw new NewsSourceError('unsupported_coverage');
  const key = (apiKey ?? process.env.NEWS_API_KEY)?.trim();
  if (!key) throw new NewsSourceError('missing_key');
  const cacheKey = `${language}:${createHash('sha256').update(key).digest('hex')}`;
  for (const [entryKey, entry] of cache) if (entry.expiresAt <= Date.now()) cache.delete(entryKey);
  const cached = cache.get(cacheKey);
  if (cached) return cached.data;

  const url = new URL(NEWSAPI_BASE_URL);
  url.search = new URLSearchParams({ country, pageSize: '5' }).toString();
  const controller = new AbortController();
  const abort = () => controller.abort(new NewsSourceError('timeout'));
  const timer = setTimeout(abort, 10_000);
  signal?.addEventListener('abort', abort, { once: true });
  const cancelled = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(new NewsSourceError('timeout')), { once: true });
  });
  try {
    const load = async () => {
      // Keep credentials out of URLs, errors and logs.
      const response = await fetch(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json', 'X-Api-Key': key } });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new NewsSourceError(response.status === 401 || response.status === 403 ? 'invalid_key'
          : response.status === 429 ? 'rate_limited' : 'unavailable');
      }
      return readHeadlines(response, controller.signal);
    };
    const items = await Promise.race([load(), cancelled]);
    controller.signal.throwIfAborted();
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, { data: items, expiresAt: Date.now() + CACHE_TTL_MS });
    return items;
  } catch (error) {
    throw error instanceof NewsSourceError ? error : new NewsSourceError('unavailable');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function clearNewsCache(): void { cache.clear(); }
