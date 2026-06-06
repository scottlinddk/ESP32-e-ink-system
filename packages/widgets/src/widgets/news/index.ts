import { z } from 'zod';
import type { Widget, PixelRegion, TypographyScale, RenderedWidget, WidgetResult } from '@esp32-eink/types';
import type { NewsWidgetConfig, NewsWidgetData, NewsApiResponse } from './types';

const NEWSAPI_BASE_URL = 'https://newsapi.org/v2/top-headlines';

const LANGUAGE_TO_COUNTRY: Record<string, string> = {
  da: 'dk',
  en: 'us',
  de: 'de',
  sv: 'se',
  no: 'no',
  fi: 'fi',
};

export const configSchema = z.object({
  language: z.string().default('da'),
  apiKey: z.string().min(1),
});

async function fetchHeadlines(
  language: string,
  apiKey: string
): Promise<NewsWidgetData> {
  const country = LANGUAGE_TO_COUNTRY[language] ?? 'dk';
  const url = `${NEWSAPI_BASE_URL}?country=${country}&apiKey=${encodeURIComponent(apiKey)}&pageSize=5`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`NewsAPI error: ${response.status}`);
  }

  const json = (await response.json()) as NewsApiResponse;
  if (json.status !== 'ok' || !json.articles?.length) {
    throw new Error('NewsAPI returned no articles');
  }

  const items = json.articles
    .filter((a) => a.title && a.url && a.title !== '[Removed]')
    .slice(0, 3)
    .map((a) => ({ title: a.title, url: a.url }));

  return { items };
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
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  render(data: NewsWidgetData, region: PixelRegion, typography: TypographyScale): RenderedWidget {
    const elements: RenderedWidget['elements'] = [];
    const lineHeight = typography.sm + 4;
    let y = 2;

    for (const item of data.items) {
      if (y + typography.sm > region.heightPx) break;
      elements.push({ kind: 'text', text: item.title, x: 2, y, fontSize: typography.sm });
      y += lineHeight;
    }

    return { region, elements };
  },
};
