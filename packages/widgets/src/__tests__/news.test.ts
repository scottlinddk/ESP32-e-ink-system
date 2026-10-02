import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newsWidget } from '../widgets/news';

const region = { widthPx: 250, heightPx: 122 };
const items = [{ title: 'Verified headline', url: 'https://example.com/news' }];
const response = (articles: unknown = items) => new Response(JSON.stringify({ status: 'ok', articles }));
const load = (language = 'en', apiKey = 'private-key') => newsWidget.fetch({ language, apiKey }, region);
beforeEach(() => { vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => response())); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('NewsAPI package widget', () => {
  it.each([['en', 'us'], ['de', 'de'], ['sv', 'se'], ['no', 'no']])('uses explicit %s coverage and a private credential header', async (language, country) => {
    expect(await load(language)).toEqual({ ok: true, data: { items } });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain(`country=${country}`);
    expect(String(url)).not.toContain('private-key');
    expect(init).toMatchObject({ redirect: 'error', headers: { 'X-Api-Key': 'private-key' } });
  });
  it.each(['da', 'fi', 'unsupported'])('explains unsupported %s coverage without substitution', async (language) => {
    expect(await load(language)).toEqual({ ok: false, error: expect.stringContaining('RSS / Atom') });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('checks missing credentials before a request', async () => {
    expect(await load('en', ' ')).toEqual({ ok: false, error: expect.stringContaining('Save a NewsAPI key') });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([[{ title: {}, url: 'https://example.com' }], [{ title: 'a', url: {} }],
    [{ title: 'a', url: 'javascript:alert(1)' }], [{ title: 'a', url: 'https://user:secret@example.com' }]])('rejects malformed titles and URLs', async (article) => {
    vi.mocked(fetch).mockResolvedValueOnce(response([article]));
    expect(await load()).toEqual({ ok: false, error: 'NewsAPI returned invalid data.' });
  });
  it('bounds streamed response size', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('x'.repeat(128 * 1024 + 1)));
    expect(await load()).toEqual({ ok: false, error: 'NewsAPI returned invalid data.' });
  });
  it('keeps a successful empty result and renders its honest status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response([]));
    expect(await load()).toEqual({ ok: true, data: { items: [] } });
    expect(newsWidget.render({ items: [] }, region, { xs: 6, sm: 8, base: 12, lg: 16, xl: 20 }).elements)
      .toContainEqual(expect.objectContaining({ text: 'No headlines' }));
  });
  it('sanitizes provider and network errors', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('secret-body', { status: 401 }));
    expect(await load()).toEqual({ ok: false, error: 'NewsAPI rejected the key or its access.' });
    vi.mocked(fetch).mockRejectedValueOnce(new Error('secret request URL'));
    expect(await load()).toEqual({ ok: false, error: 'NewsAPI is unavailable. Try again later.' });
  });
  it('times out and cancels a stalled body', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream({ cancel })));
    const pending = load();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ ok: false, error: 'NewsAPI timed out. Try again.' });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
