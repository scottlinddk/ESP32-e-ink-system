import { describe, expect, it } from 'vitest';
import type { TickerWidgetSetting } from '../../types';
import { createTickerId, displaySymbol, emptyTicker, normalizeSymbol, tickerIdFromWidget, tickerLabel, tickersMissingSymbols, tickerWidgetId, tickerWidgetsForSave } from '../tickerWidgets';

const ticker = (patch: Partial<TickerWidgetSetting> = {}): TickerWidgetSetting =>
  ({ id: 'dk', name: '', symbols: ['NOVO-B.CO', 'DSV.CO'], view: 'condensed', per_page: 3, dwell_minutes: 15, locale: 'da', ...patch });

describe('stock ticker helpers', () => {
  it('maps tickers to their own layout widget IDs and back', () => {
    expect(tickerWidgetId('dk')).toBe('ticker:dk');
    expect(tickerIdFromWidget('ticker:dk')).toBe('dk');
    for (const bad of ['ticker', 'ticker:', 'ticker:DK', 'news:dk']) expect(tickerIdFromWidget(bad)).toBeNull();
  });
  it('creates IDs the backend accepts and never reuses one', () => {
    const existing = [emptyTicker([], 'da')];
    const id = createTickerId(existing);
    expect(id).toMatch(/^[a-z0-9]{1,16}$/);
    expect(id).not.toBe(existing[0].id);
    expect(tickerIdFromWidget(tickerWidgetId(id))).toBe(id);
  });
  it('starts a new ticker as a full view in the interface language', () => {
    expect(emptyTicker([], 'en')).toMatchObject({ view: 'full', symbols: [], per_page: null, dwell_minutes: 15, locale: 'en' });
  });
  it('shortens only the Copenhagen suffix', () => {
    expect(displaySymbol('NOVO-B.CO')).toBe('NOVO-B');
    expect(displaySymbol('VOD.L')).toBe('VOD.L');
  });
  it('labels a ticker by name, then by its first symbols', () => {
    expect(tickerLabel(ticker({ name: ' Danske ' }))).toBe('Danske');
    expect(tickerLabel(ticker())).toBe('NOVO-B, DSV');
    expect(tickerLabel(ticker({ symbols: ['A', 'B', 'C', 'D'] }))).toBe('A, B, C…');
    expect(tickerLabel(ticker({ symbols: [] }))).toBe('dk');
  });
  it('accepts only symbols the backend accepts', () => {
    expect(normalizeSymbol(' novo-b.co ')).toBe('NOVO-B.CO');
    expect(normalizeSymbol('^GSPC')).toBe('^GSPC');
    for (const bad of ['', 'bad symbol', '../x', 'a'.repeat(21), '-X']) expect(normalizeSymbol(bad)).toBeNull();
  });
  it('trims names and drops the page size of a full view when saving', () => {
    const saved = tickerWidgetsForSave([ticker({ name: ' Mine ' }), ticker({ id: 'us', view: 'full', per_page: 4 })]);
    expect(saved[0]).toMatchObject({ name: 'Mine', per_page: 3 });
    expect(saved[1].per_page).toBeNull();
  });
  it('detects a ticker without symbols', () => {
    expect(tickersMissingSymbols([ticker()])).toBe(false);
    expect(tickersMissingSymbols([ticker(), ticker({ id: 'x', symbols: [] })])).toBe(true);
  });
});
