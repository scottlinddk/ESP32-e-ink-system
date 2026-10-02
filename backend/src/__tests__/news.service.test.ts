import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearNewsCache, fetchNews } from '../services/news';
import { newsProblem } from '../utils/newsErrors';

const articles = [{ title: 'Verified headline', url: 'https://example.com/news' }];
const response = (items: unknown = articles) => new Response(JSON.stringify({ status: 'ok', articles: items }));
beforeEach(() => {
  clearNewsCache();
  vi.stubEnv('NEWS_API_KEY', '');
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => response()));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('news source integrity', () => {
  it.each([['en', 'us'], ['de', 'de'], ['sv', 'se'], ['no', 'no']])('requests supported %s coverage without placing credentials in URLs', async (language, country) => {
    expect(await fetchNews(language, 'secret-key')).toEqual(articles);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain(`country=${country}`);
    expect(String(url)).not.toContain('secret-key');
    expect(init?.headers).toMatchObject({ 'X-Api-Key': 'secret-key' });
    expect(init?.redirect).toBe('error');
  });

  it.each(['da', 'fi', 'fr', '__proto__'])('explains unsupported %s coverage without substituting a country', async (language) => {
    await expect(fetchNews(language, 'key')).rejects.toMatchObject({ code: 'unsupported_coverage', message: expect.stringContaining('RSS') });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('isolates the cache by language and credential, and expires stale headlines', async () => {
    vi.useFakeTimers();
    expect(await fetchNews('en', 'alice')).toEqual(articles);
    expect(await fetchNews('en', 'alice')).toEqual(articles);
    await fetchNews('de', 'alice');
    await fetchNews('en', 'bob');
    expect(fetch).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(60 * 60 * 1000);
    await fetchNews('en', 'alice');
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('does not let another credential cache hide missing or invalid keys', async () => {
    await fetchNews('en', 'alice');
    await expect(fetchNews('en')).rejects.toMatchObject({ code: 'missing_key' });
    vi.mocked(fetch).mockResolvedValue(new Response('secret provider body', { status: 401 }));
    await expect(fetchNews('en', 'bob')).rejects.toMatchObject({ code: 'invalid_key' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('bounds retained credential-specific cache entries', async () => {
    await fetchNews('en', 'first');
    for (let i = 0; i < 200; i++) await fetchNews('en', `account-${i}`);
    await fetchNews('en', 'first');
    expect(fetch).toHaveBeenCalledTimes(202);
  });

  it.each([[403, 'invalid_key'], [429, 'rate_limited'], [500, 'unavailable']] as const)('sanitizes HTTP %s diagnostics', async (status, code) => {
    vi.mocked(fetch).mockResolvedValue(new Response('secret response', { status }));
    const error = await fetchNews('en', 'key').catch((e) => e);
    expect(error.code).toBe(code);
    expect(error.message).not.toContain('secret');
  });

  it('sanitizes transport errors and does not cache failures', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Connection to secret-key failed'));
    await expect(fetchNews('en', 'key')).rejects.toMatchObject({ code: 'unavailable' });
    expect(await fetchNews('en', 'key')).toEqual(articles);
    expect(newsProblem(new Error('RSS private feed URL'))).toEqual({ code: 'unavailable', message: expect.not.stringContaining('private') });
  });

  it.each([null, {}, [null], [{ title: {}, url: 'https://example.com' }], [{ title: 'Title', url: {} }],
    [{ title: 'Title', url: 'javascript:alert(1)' }], [{ title: 'Title', url: 'https://secret:token@example.com' }],
    [{ title: 'Title', url: 'invalid url' }], Array(101).fill(articles[0])].map((items) => ({ items })))('rejects malformed headlines: $items', async ({ items }) => {
    vi.mocked(fetch).mockResolvedValue(response(items));
    await expect(fetchNews('en', 'key')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('bounds text, drops removed articles, limits results, and preserves a successful empty response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response([{ title: '[Removed]', url: '' }, { title: '  A\n\u0000 B  ', url: 'https://example.com' }, ...Array(4).fill({ title: 'x'.repeat(600), url: 'https://example.com' })]));
    const items = await fetchNews('en', 'key');
    expect(items).toHaveLength(3);
    expect(items[0].title).toBe('A B');
    expect(items[1].title).toHaveLength(512);
    vi.mocked(fetch).mockResolvedValueOnce(response([]));
    expect(await fetchNews('en', 'other')).toEqual([]);
  });

  it.each([new Response('not JSON'), new Response(JSON.stringify({ status: 'error', message: 'secret' })),
    new Response('x'.repeat(128 * 1024 + 1)), new Response('{}', { headers: { 'Content-Length': String(128 * 1024 + 1) } })])('rejects invalid or excessive provider bodies', async (body) => {
    vi.mocked(fetch).mockResolvedValue(body);
    await expect(fetchNews('en', 'key')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('cancels a stalled response body and does not cache it', async () => {
    const cancel = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream({ cancel })));
    const controller = new AbortController();
    const pending = fetchNews('en', 'key', controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort();
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
    expect(await fetchNews('en', 'key')).toEqual(articles);
  });

  it('bounds an unresponsive fetch and rejects an already cancelled caller without a request', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));
    const pending = fetchNews('en', 'key');
    const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    await expect(fetchNews('en', 'key', AbortSignal.abort())).rejects.toMatchObject({ code: 'timeout' });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
