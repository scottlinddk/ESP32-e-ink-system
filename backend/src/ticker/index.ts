import type { TickerWidgetSetting } from '../types';
import { aggregateStatus } from './marketStatus';
import { QuoteProviderError, type QuoteProvider } from './providers/QuoteProvider';
import { createYahooProvider } from './providers/yahoo';
import type { PixelRegion, RenderedWidget } from './render';
import { pickPage } from './rotation';
import type { SearchRegion, TickerRow, TickerWidgetData } from './types';
import { renderCondensed } from './views/condensed';
import { renderFull } from './views/full';
import { condensedLayout } from './views/layout';

// Mirrors packages/widgets/src/widgets/ticker. The backend is deployed on its own
// (Vercel root and Docker image are `backend/`), so it cannot import the workspace
// package; keep behavioural changes in sync with it.

/** All rows of one widget. The page is chosen when drawing, because only then is the widget's size known. */
export interface TickerSnapshot { rows: TickerRow[]; fetchedAt: number }
export type TickerResult = { snapshot: TickerSnapshot } | { error: string };

const FALLBACK_ERROR = 'Yahoo Finance is unavailable.';
const defaultProvider = createYahooProvider();

/**
 * Loads every symbol of every widget once (a symbol shared by several widgets is a
 * single request; the provider also caches). A widget fails only if all its symbols fail.
 */
export async function loadTickerSnapshots(
  widgets: readonly TickerWidgetSetting[],
  provider: QuoteProvider = defaultProvider,
  now: () => number = Date.now
): Promise<Record<string, TickerResult>> {
  const symbols = [...new Set(widgets.flatMap((widget) => widget.symbols))];
  const loaded = new Map<string, TickerRow | string>();
  await Promise.all(symbols.map(async (symbol) => {
    try {
      loaded.set(symbol, { symbol, quote: await provider.quote(symbol) });
    } catch (err) {
      loaded.set(symbol, err instanceof QuoteProviderError ? err.message : FALLBACK_ERROR);
    }
  }));

  const fetchedAt = now();
  const result: Record<string, TickerResult> = {};
  for (const widget of widgets) {
    const outcomes = widget.symbols.map((symbol) => loaded.get(symbol)!);
    const rows = widget.symbols.map((symbol, index): TickerRow => {
      const outcome = outcomes[index];
      return typeof outcome === 'string' ? { symbol } : outcome;
    });
    // Every symbol failing is a source problem; a partial failure is shown row by row.
    const firstError = outcomes.find((outcome): outcome is string => typeof outcome === 'string');
    result[widget.id] = rows.every((row) => !row.quote)
      ? { error: firstError ?? FALLBACK_ERROR }
      : { snapshot: { rows, fetchedAt } };
  }
  return result;
}

export function renderTicker(
  widget: TickerWidgetSetting,
  snapshot: TickerSnapshot,
  region: PixelRegion,
  timeZone: string,
  nowMs: number = Date.now()
): RenderedWidget {
  const fitting = widget.view === 'full' ? 1 : condensedLayout(region).rows;
  const perPage = widget.view === 'full' ? 1 : Math.min(widget.per_page ?? fitting, fitting);
  const page = pickPage(snapshot.rows, perPage, widget.dwell_minutes, nowMs);
  const data: TickerWidgetData = {
    view: widget.view,
    title: widget.name || 'Stock ticker',
    locale: widget.locale,
    timeZone,
    rows: page.items,
    page: page.page,
    pageCount: page.pageCount,
    marketStatus: aggregateStatus(page.items.flatMap((row) => (row.quote ? [row.quote.marketState] : []))),
    fetchedAt: snapshot.fetchedAt,
  };
  return widget.view === 'condensed' ? renderCondensed(data, region) : renderFull(data, region);
}

export function renderTickerUnavailable(region: PixelRegion, message?: string): RenderedWidget {
  const elements: RenderedWidget['elements'] = [{ kind: 'text', text: 'Stocks: unavailable', x: 2, y: 2, fontSize: 8 }];
  if (message && region.heightPx >= 22) elements.push({ kind: 'text', text: message, x: 2, y: 13, fontSize: 8 });
  return { region, elements };
}

/** Symbol search for the dashboard. Uses the shared provider so repeated queries hit its cache. */
export function searchTickers(query: string, region: SearchRegion = 'any') {
  return defaultProvider.search(query, region);
}
