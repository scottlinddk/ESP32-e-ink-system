import type { TickerWidgetSetting } from '../types';

// Mirrors backend/src/utils/tickerWidgets.ts. Each ticker is placed in a layout
// as its own `ticker:<id>` widget.
export const MAX_TICKER_WIDGETS = 6;
export const MAX_TICKER_SYMBOLS = 10;
export const TICKER_NAME_MAX = 24;
const TICKER_WIDGET_PREFIX = 'ticker:';
const TICKER_ID = /^[a-z0-9]{1,16}$/;
export const SYMBOL_PATTERN = /^[A-Za-z0-9^][A-Za-z0-9.\-=^]{0,19}$/;

export function tickerWidgetId(id: string): string { return `${TICKER_WIDGET_PREFIX}${id}`; }

export function tickerIdFromWidget(widgetId: string): string | null {
  if (!widgetId.startsWith(TICKER_WIDGET_PREFIX)) return null;
  const id = widgetId.slice(TICKER_WIDGET_PREFIX.length);
  return TICKER_ID.test(id) ? id : null;
}

/** A short random ID that is not already used by another ticker. */
export function createTickerId(existing: readonly TickerWidgetSetting[]): string {
  const used = new Set(existing.map((ticker) => ticker.id));
  for (;;) {
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    if (!used.has(id)) return id;
  }
}

export function emptyTicker(existing: readonly TickerWidgetSetting[], locale: 'da' | 'en'): TickerWidgetSetting {
  return { id: createTickerId(existing), name: '', symbols: [], view: 'full', per_page: null, dwell_minutes: 15, locale };
}

/** `NOVO-B.CO` is shown as `NOVO-B`; other exchange suffixes are kept. */
export function displaySymbol(symbol: string): string { return symbol.replace(/\.CO$/i, ''); }

/** The name, or the first symbols when no name is set. */
export function tickerLabel(ticker: TickerWidgetSetting): string {
  if (ticker.name.trim()) return ticker.name.trim();
  const shown = ticker.symbols.slice(0, 3).map(displaySymbol).join(', ');
  return shown ? `${shown}${ticker.symbols.length > 3 ? '…' : ''}` : ticker.id;
}

/** Normalises what a user typed into a symbol, or null when it cannot be one. */
export function normalizeSymbol(input: string): string | null {
  const symbol = input.trim().toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

/** Condensed rows only matter for the condensed view; a full view always shows one stock. */
export function tickerWidgetsForSave(tickers: readonly TickerWidgetSetting[]): TickerWidgetSetting[] {
  return tickers.map((ticker) => ({
    ...ticker,
    name: ticker.name.trim(),
    per_page: ticker.view === 'condensed' ? ticker.per_page : null,
  }));
}

export function tickersMissingSymbols(tickers: readonly TickerWidgetSetting[]): boolean {
  return tickers.some((ticker) => ticker.symbols.length === 0);
}
