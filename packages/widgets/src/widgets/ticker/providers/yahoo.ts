import { marketStateAt } from '../marketStatus';
import type { Quote, SearchRegion, SymbolSearchResult, TradingSessions } from '../types';
import { QuoteProviderError, type QuoteProvider } from './QuoteProvider';

// Yahoo Finance has no public, documented API. These are the unofficial endpoints
// its own website uses; they can change or be rate limited without notice.
const BASE = 'https://query1.finance.yahoo.com';
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 8_000;
const QUOTE_TTL_MS = 60_000;
const SEARCH_TTL_MS = 10 * 60_000;
/** Yahoo's exchange code for Nasdaq Copenhagen. */
const COPENHAGEN = 'CPH';

interface YahooOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface ChartMeta {
  symbol?: string;
  currency?: string;
  exchangeName?: string;
  longName?: string;
  shortName?: string;
  regularMarketPrice?: number;
  previousClose?: number;
  chartPreviousClose?: number;
  currentTradingPeriod?: TradingSessions;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function createYahooProvider({ fetchImpl, now = Date.now }: YahooOptions = {}): QuoteProvider {
  const quotes = new Map<string, { at: number; value: Quote }>();
  const searches = new Map<string, { at: number; value: SymbolSearchResult[] }>();

  async function getJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await (fetchImpl ?? fetch)(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; esp32-eink-ticker)' },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new QuoteProviderError(
          response.status === 429 ? 'Yahoo Finance request limit reached.'
            : response.status === 404 ? 'Symbol not found.'
              : 'Yahoo Finance is unavailable.'
        );
      }
      const body = await response.text();
      if (body.length > MAX_BYTES) throw new QuoteProviderError('Yahoo Finance returned invalid data.');
      return JSON.parse(body);
    } catch (err) {
      if (err instanceof QuoteProviderError) throw err;
      throw new QuoteProviderError(controller.signal.aborted ? 'Yahoo Finance timed out.' : 'Yahoo Finance is unavailable.');
    } finally {
      clearTimeout(timer);
    }
  }

  function parseQuote(symbol: string, json: unknown): Quote {
    const result = (json as { chart?: { result?: Array<{ meta?: ChartMeta; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> } })
      ?.chart?.result?.[0];
    const meta = result?.meta;
    const price = meta?.regularMarketPrice;
    const previousClose = meta?.previousClose ?? meta?.chartPreviousClose;
    if (!meta || !isNumber(price) || !isNumber(previousClose) || previousClose === 0 || typeof meta.currency !== 'string') {
      throw new QuoteProviderError('Yahoo Finance returned invalid data.');
    }
    const change = price - previousClose;
    return {
      symbol: meta.symbol ?? symbol,
      name: meta.longName ?? meta.shortName ?? symbol,
      currency: meta.currency,
      exchange: meta.exchangeName ?? '',
      price,
      previousClose,
      change,
      changePercent: (change / previousClose) * 100,
      marketState: marketStateAt(meta.currentTradingPeriod, now()),
      series: (result?.indicators?.quote?.[0]?.close ?? []).filter(isNumber),
    };
  }

  return {
    async quote(symbol) {
      const hit = quotes.get(symbol);
      if (hit && now() - hit.at < QUOTE_TTL_MS) return hit.value;
      const json = await getJson(`${BASE}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`);
      const value = parseQuote(symbol, json);
      quotes.set(symbol, { at: now(), value });
      return value;
    },

    async search(query, region: SearchRegion = 'any') {
      const q = query.trim();
      if (q.length < 1 || q.length > 40) return [];
      const key = `${region}:${q.toLowerCase()}`;
      const hit = searches.get(key);
      if (hit && now() - hit.at < SEARCH_TTL_MS) return hit.value;

      const json = await getJson(`${BASE}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=20&newsCount=0`);
      const list = (json as { quotes?: Array<Record<string, unknown>> })?.quotes;
      if (!Array.isArray(list)) throw new QuoteProviderError('Yahoo Finance returned invalid data.');

      const value = list
        .filter((item) => typeof item.symbol === 'string' && item.quoteType === 'EQUITY')
        .filter((item) => region === 'any' || item.exchange === COPENHAGEN)
        .map((item): SymbolSearchResult => ({
          symbol: String(item.symbol),
          name: String(item.longname ?? item.shortname ?? item.symbol),
          exchange: String(item.exchange ?? ''),
          exchangeName: String(item.exchDisp ?? item.exchange ?? ''),
          type: String(item.quoteType),
        }));
      searches.set(key, { at: now(), value });
      return value;
    },
  };
}
