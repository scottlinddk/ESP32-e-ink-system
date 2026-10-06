import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TickerWidgetsFields } from '../../components/dashboard/TickerWidgetsFields';
import { MAX_TICKER_WIDGETS } from '../tickerWidgets';
import { STRINGS } from '../strings';
import type { TickerWidgetSetting } from '../../types';

const settings = vi.hoisted(() => ({ lang: 'en' as 'en' | 'da' }));
vi.mock('../appContext', () => ({ useApp: () => ({ t: STRINGS[settings.lang], lang: settings.lang, online: true, toast: vi.fn() }) }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner' }, isSignedIn: true, getToken: async () => 'token' }) }));
beforeEach(() => { settings.lang = 'en'; });

const base: TickerWidgetSetting = { id: 'dk', name: 'Danske', symbols: ['NOVO-B.CO', 'DSV.CO'], view: 'condensed', per_page: null, dwell_minutes: 15, locale: 'da' };
const render = (tickers: TickerWidgetSetting[]) => renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}><TickerWidgetsFields tickers={tickers} onChange={() => {}} /></QueryClientProvider>);

describe('stock ticker settings', () => {
  it('offers to add the first widget when there are none', () => {
    const html = render([]);
    expect(html).toContain('Add stock widget');
    expect(html).not.toContain('Save, then add the widget');
  });
  it('shows the watchlist with Danish stocks readable, and the Danish-only search on by default', () => {
    const html = render([base]);
    expect(html).toContain('Stocks (2/10)');
    expect(html).toContain('>NOVO-B<');
    expect(html).toContain('aria-label="Remove NOVO-B.CO"');
    expect(html).toContain('Danish stocks only (Nasdaq Copenhagen)');
    expect(html).toMatch(/id="ticker-dk-search-dk"[^>]*checked/);
  });
  it('lets the user choose between the full and condensed views', () => {
    const html = render([base]);
    expect(html).toContain('Full (one stock)');
    expect(html).toContain('Condensed (list)');
    expect(html).toMatch(/<option value="condensed" selected/);
  });
  it('shows stocks per page for the condensed view only', () => {
    expect(render([base])).toContain('Stocks per page');
    expect(render([{ ...base, view: 'full' }])).not.toContain('Stocks per page');
  });
  it('explains page cycling only when there is more than one stock, and keeps a custom duration selectable', () => {
    expect(render([base])).toContain('only changes when the display receives a new image');
    const single = render([{ ...base, symbols: ['NVDA'] }]);
    expect(single).not.toContain('Change page every');
    expect(render([{ ...base, dwell_minutes: 7 }])).toContain('<option value="7" selected');
  });
  it('asks for a first stock when the watchlist is empty', () => {
    expect(render([{ ...base, symbols: [] }])).toContain('Add at least one stock.');
  });
  it('is available in Danish', () => {
    settings.lang = 'da';
    const html = render([base]);
    expect(html).toContain('Aktiekurser');
    expect(html).toContain('Kun danske aktier (Nasdaq København)');
    expect(html).toContain('Kompakt (liste)');
  });
  it('stops adding widgets at the limit', () => {
    const many = Array.from({ length: MAX_TICKER_WIDGETS }, (_, n) => ({ ...base, id: `t${n}` }));
    const html = render(many);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*(<[^>]+>[^<]*)*Add stock widget/);
    expect(html).toContain(`At most ${MAX_TICKER_WIDGETS} stock widgets.`);
  });
});
