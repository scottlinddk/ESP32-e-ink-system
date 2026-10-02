import { z } from 'zod';
import type { Widget, PixelRegion, TypographyScale, RenderedWidget, WidgetResult } from '@esp32-eink/types';
import type { NewsWidgetConfig, NewsWidgetData } from './types';

const NEWSAPI_BASE_URL = 'https://newsapi.org/v2/top-headlines';

const LANGUAGE_TO_COUNTRY: Record<string, string> = { en: 'us', de: 'de', sv: 'se', no: 'no' };
const MAX_RESPONSE_BYTES = 128 * 1024;
// Only our fixed diagnostics are safe to return; provider/network errors may contain credentials.
class NewsError extends Error {}

export const configSchema = z.object({
  language: z.string().default('da'),
  apiKey: z.string().trim().min(1),
});

async function fetchHeadlines(
  language: string,
  apiKey: string
): Promise<NewsWidgetData> {
  const country = Object.prototype.hasOwnProperty.call(LANGUAGE_TO_COUNTRY, language) ? LANGUAGE_TO_COUNTRY[language] : undefined;
  if (!country) throw new NewsError('NewsAPI does not support this coverage. Use RSS / Atom for Danish or Finnish news.');
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new NewsError('Save a NewsAPI key or select an RSS / Atom feed.');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const cancelled = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new NewsError('NewsAPI timed out. Try again.')); }, 10_000);
  });
  try {
    const load = async (): Promise<NewsWidgetData> => {
      const response = await fetch(`${NEWSAPI_BASE_URL}?country=${country}&pageSize=5`, {
        headers: { Accept: 'application/json', 'X-Api-Key': apiKey.trim() }, redirect: 'error', signal: controller.signal,
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new NewsError(response.status === 401 || response.status === 403 ? 'NewsAPI rejected the key or its access.'
          : response.status === 429 ? 'NewsAPI request limit reached.' : 'NewsAPI is unavailable. Try again later.');
      }
      if (controller.signal.aborted || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES || !response.body) {
        void response.body?.cancel().catch(() => {});
        throw new NewsError('NewsAPI returned invalid data.');
      }
      const reader = response.body.getReader();
      const cancelBody = () => { void reader.cancel().catch(() => {}); };
      controller.signal.addEventListener('abort', cancelBody, { once: true });
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          controller.signal.throwIfAborted();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE_BYTES) { cancelBody(); throw new NewsError('NewsAPI returned invalid data.'); }
          chunks.push(value);
        }
      } finally { controller.signal.removeEventListener('abort', cancelBody); reader.releaseLock(); }
      let json: { status?: unknown; articles?: unknown } | null;
      try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new NewsError('NewsAPI returned invalid data.'); }
      if (json?.status !== 'ok' || !Array.isArray(json.articles) || json.articles.length > 100) throw new NewsError('NewsAPI returned invalid data.');
      const items: NewsWidgetData['items'] = [];
      for (const article of json.articles) {
        if (!article || typeof article.title !== 'string' || typeof article.url !== 'string') throw new NewsError('NewsAPI returned invalid data.');
        const title = article.title.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 512);
        if (!title || title === '[Removed]') continue;
        if (article.url.length > 2048) throw new NewsError('NewsAPI returned invalid data.');
        let url: URL;
        try { url = new URL(article.url); } catch { throw new NewsError('NewsAPI returned invalid data.'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new NewsError('NewsAPI returned invalid data.');
        if (items.length < 3) items.push({ title, url: url.href });
      }
      return { items };
    };
    return await Promise.race([load(), cancelled]);
  } finally { clearTimeout(timer!); }
}

export const newsWidget: Widget<NewsWidgetConfig, NewsWidgetData> = {
  meta: {
    id: 'news',
    name: 'News Headlines',
    description: 'Top headlines from NewsAPI.',
    category: 'general',
  },

  configSchema,

  async fetch(
    config: NewsWidgetConfig,
    _region: PixelRegion
  ): Promise<WidgetResult<NewsWidgetData>> {
    try {
      const data = await fetchHeadlines(config.language, config.apiKey);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err instanceof NewsError ? err.message : 'NewsAPI is unavailable. Try again later.' };
    }
  },

  render(data: NewsWidgetData, region: PixelRegion, typography: TypographyScale): RenderedWidget {
    const elements: RenderedWidget['elements'] = [];
    const lineHeight = typography.sm + 4;
    let y = 2;

    if (!data.items.length) elements.push({ kind: 'text', text: 'No headlines', x: 2, y, fontSize: typography.sm });

    for (const item of data.items) {
      if (y + typography.sm > region.heightPx) break;
      elements.push({ kind: 'text', text: item.title, x: 2, y, fontSize: typography.sm });
      y += lineHeight;
    }

    return { region, elements };
  },
};
