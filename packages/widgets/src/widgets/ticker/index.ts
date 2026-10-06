import type { PixelRegion, RenderedWidget, TypographyScale, Widget, WidgetResult } from '@esp32-eink/types';
import { configSchema, type TickerWidgetConfig } from './config';
import { aggregateStatus } from './marketStatus';
import { QuoteProviderError, type QuoteProvider } from './providers/QuoteProvider';
import { createYahooProvider } from './providers/yahoo';
import { pickPage } from './rotation';
import type { TickerRow, TickerWidgetData } from './types';
import { renderCondensed } from './views/condensed';
import { renderFull } from './views/full';
import { condensedLayout } from './views/layout';

export { configSchema } from './config';
export type { TickerWidgetConfig } from './config';
export type { TickerWidgetData, TickerView } from './types';

export function createTickerWidget(provider: QuoteProvider): Widget<TickerWidgetConfig, TickerWidgetData> {
  return {
    meta: {
      id: 'ticker',
      name: 'Stock ticker',
      description: 'Share prices from Yahoo Finance, including Nasdaq Copenhagen, as a single stock or a condensed list.',
      category: 'finance',
    },

    configSchema,

    async fetch(config: TickerWidgetConfig, region: PixelRegion): Promise<WidgetResult<TickerWidgetData>> {
      const fitting = config.view === 'full' ? 1 : condensedLayout(region).rows;
      const perPage = config.view === 'full' ? 1 : Math.min(config.perPage ?? fitting, fitting);
      const fetchedAt = Date.now();
      const page = pickPage(config.symbols, perPage, config.dwellMinutes, fetchedAt);

      let firstError: string | undefined;
      const rows: TickerRow[] = await Promise.all(
        page.items.map(async (symbol): Promise<TickerRow> => {
          try {
            return { symbol, quote: await provider.quote(symbol) };
          } catch (err) {
            firstError ??= err instanceof QuoteProviderError ? err.message : 'Yahoo Finance is unavailable.';
            return { symbol };
          }
        })
      );

      // Every symbol failing is a source problem; a partial failure is shown row by row.
      if (rows.every((row) => !row.quote)) return { ok: false, error: firstError ?? 'Yahoo Finance is unavailable.' };

      return {
        ok: true,
        data: {
          view: config.view,
          title: config.title,
          locale: config.locale,
          timeZone: config.timeZone,
          rows,
          page: page.page,
          pageCount: page.pageCount,
          marketStatus: aggregateStatus(rows.flatMap((row) => (row.quote ? [row.quote.marketState] : []))),
          fetchedAt,
        },
      };
    },

    // Layout is derived from the region only (not `typography`) so that `fetch`
    // and `render` agree on how many rows a page holds.
    render(data: TickerWidgetData, region: PixelRegion, _typography: TypographyScale): RenderedWidget {
      return data.view === 'condensed' ? renderCondensed(data, region) : renderFull(data, region);
    },
  };
}

export const tickerWidget = createTickerWidget(createYahooProvider());
