import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearNewsCache, fetchNews } from '../services/news';

const articles = [{ title: 'Verified headline', url: 'https://example.com/news' }];

beforeEach(() => {
  clearNewsCache();
  vi.stubEnv('NEWS_API_KEY', '');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'ok', articles }),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('news source integrity', () => {
  it('returns and caches real headlines for the same language and credential', async () => {
    expect(await fetchNews('da', 'test-key')).toEqual(articles);
    expect(await fetchNews('da', 'test-key')).toEqual(articles);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports missing credentials even if another user has cached headlines', async () => {
    await fetchNews('da', 'test-key');
    await expect(fetchNews('da')).rejects.toThrow('not configured');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not let a cached response hide an invalid credential', async () => {
    await fetchNews('da', 'test-key');
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response);
    await expect(fetchNews('da', 'invalid-key')).rejects.toThrow('(401)');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reports network errors without inventing headlines', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Connection failed'));
    await expect(fetchNews('da', 'test-key')).rejects.toThrow('Connection failed');
  });

  it('reports upstream errors returned with a successful HTTP status', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ status: 'error' }) } as Response);
    await expect(fetchNews('da', 'test-key')).rejects.toThrow('invalid response');
  });

  it('preserves a valid empty result instead of substituting sample stories', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ status: 'ok', articles: [] }) } as Response);
    expect(await fetchNews('da', 'test-key')).toEqual([]);
  });
});
