import type { TickerWidgetSetting } from '../types';

// Stock ticker widgets. Each one is placed in a layout as its own `ticker:<id>`
// widget. The caps bound the Yahoo requests made for one display refresh.
export const MAX_TICKER_WIDGETS = 6;
export const MAX_TICKER_SYMBOLS = 10;
export const TICKER_WIDGET_PREFIX = 'ticker:';
export const TICKER_NAME_MAX = 24;
const TICKER_ID = /^[a-z0-9]{1,16}$/;
const SYMBOL = /^[A-Za-z0-9^][A-Za-z0-9.\-=^]{0,19}$/;

export class TickerWidgetValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'TickerWidgetValidationError'; }
}

export function tickerWidgetId(id: string): string { return `${TICKER_WIDGET_PREFIX}${id}`; }

/** The ticker ID referenced by a `ticker:<id>` widget, or null for any other widget. */
export function tickerIdFromWidget(widgetId: string): string | null {
  if (!widgetId.startsWith(TICKER_WIDGET_PREFIX)) return null;
  const id = widgetId.slice(TICKER_WIDGET_PREFIX.length);
  return TICKER_ID.test(id) ? id : null;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const KEYS = ['id', 'name', 'symbols', 'view', 'per_page', 'dwell_minutes', 'locale'];

/** Strictly validate an untrusted ticker list before saving it. */
export function parseTickerWidgets(value: unknown): TickerWidgetSetting[] {
  if (!Array.isArray(value) || value.length > MAX_TICKER_WIDGETS) {
    throw new TickerWidgetValidationError(`Stock widgets must be a list of at most ${MAX_TICKER_WIDGETS}.`);
  }
  const ids = new Set<string>();
  return value.map((input) => {
    if (!record(input) || Object.keys(input).some((key) => !KEYS.includes(key))) {
      throw new TickerWidgetValidationError('Each stock widget may only contain id, name, symbols, view, per_page, dwell_minutes and locale.');
    }
    const { id, name, symbols, view, per_page: perPage, dwell_minutes: dwell, locale } = input;
    if (typeof id !== 'string' || !TICKER_ID.test(id) || ids.has(id)) {
      throw new TickerWidgetValidationError('Each stock widget needs a unique ID of 1–16 lowercase letters or digits.');
    }
    if (typeof name !== 'string' || name.trim().length > TICKER_NAME_MAX) {
      throw new TickerWidgetValidationError(`Stock widget names must be at most ${TICKER_NAME_MAX} characters.`);
    }
    if (!Array.isArray(symbols) || symbols.length < 1 || symbols.length > MAX_TICKER_SYMBOLS
      || symbols.some((s) => typeof s !== 'string' || !SYMBOL.test(s.trim()))) {
      throw new TickerWidgetValidationError(`Each stock widget needs 1–${MAX_TICKER_SYMBOLS} valid ticker symbols.`);
    }
    if (view !== 'full' && view !== 'condensed') {
      throw new TickerWidgetValidationError('Stock widget view must be "full" or "condensed".');
    }
    if (perPage !== undefined && perPage !== null && (typeof perPage !== 'number' || !Number.isInteger(perPage) || perPage < 1 || perPage > 8)) {
      throw new TickerWidgetValidationError('Stocks per page must be 1–8.');
    }
    if (typeof dwell !== 'number' || !Number.isInteger(dwell) || dwell < 1 || dwell > 1440) {
      throw new TickerWidgetValidationError('Page duration must be 1–1440 minutes.');
    }
    if (locale !== 'da' && locale !== 'en') {
      throw new TickerWidgetValidationError('Stock widget locale must be "da" or "en".');
    }
    ids.add(id);
    return {
      id, name: name.trim(), view, per_page: perPage ?? null, dwell_minutes: dwell, locale,
      symbols: [...new Set((symbols as string[]).map((s) => s.trim().toUpperCase()))],
    };
  });
}

/** Stored rows were validated on save; tolerate legacy or hand-edited data when rendering. */
export function storedTickerWidgets(value: unknown): TickerWidgetSetting[] {
  try { return value === undefined || value === null ? [] : parseTickerWidgets(value); }
  catch { return []; }
}
