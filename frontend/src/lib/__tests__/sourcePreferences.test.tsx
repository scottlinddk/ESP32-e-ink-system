import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DisplayCard } from '../../components/dashboard/DisplayCard';
import { sourcePreferences, sourcePreferencesToApi } from '../sourcePreferences';
import { STRINGS } from '../strings';
import type { UserPreferences } from '../../types';

const account = vi.hoisted(() => ({ id: 'alice' }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: account.id }, isSignedIn: true, getToken: async () => 'token' }) }));
vi.mock('../appContext', () => ({ useApp: () => ({ t: STRINGS.en, lang: 'en', online: true, toast: vi.fn() }) }));

const saved: Partial<UserPreferences> = {
  show_energy_price: true, energy_price_location: 'DK2',
  energy_price_settings: { mode: 'consumer', gridGln: '5790000705689', gridChargeCodes: ['DT_C_01'], retailerMarkupOre: 7 },
  show_weather: true, weather_location: '56.15,10.21',
  show_news: true, news_source: 'rss', news_feed_url: 'https://example.org/danish.xml', news_item_limit: 5,
  show_monta: true, monta_fields: ['today_stats'], show_zaptec: false, show_notion: true,
};

beforeEach(() => { account.id = 'alice'; });

describe('source settings drafts', () => {
  it('hydrates saved sources directly without browser-local defaults', () => {
    const form = sourcePreferences(saved);
    expect(form.energy).toEqual({ on: true, zone: 'DK2', priceSettings: saved.energy_price_settings });
    expect(form.weather.location).toBe(saved.weather_location);
    expect(form.news).toMatchObject({ on: true, source: 'rss', feedUrl: saved.news_feed_url, itemLimit: 5 });
    expect(form.monta).toEqual({ on: true, fields: ['today_stats'] });
    expect(form.notion.on).toBe(true);
  });

  it('preserves unfinished edits across unrelated saves and uses current saved values after discard', () => {
    const draft = sourcePreferences(saved);
    draft.weather.location = '51.5,-0.12';
    const refreshed = { ...saved, custom_text: 'A separate card saved', weather_location: '48.86,2.35' };
    expect(sourcePreferences(refreshed, draft)).toBe(draft);
    expect(sourcePreferences(undefined, draft).weather.location).toBe('51.5,-0.12');
    expect(sourcePreferences(refreshed, null).weather.location).toBe('48.86,2.35');
  });

  it('omits hidden incomplete weather and RSS drafts so disabling them can be saved', () => {
    const draft = sourcePreferences(saved);
    draft.weather = { on: false, location: 'invalid coordinates' };
    draft.news = { on: false, lang: 'da', source: 'rss', feedUrl: '', itemLimit: 3, feeds: [{ id: 'draft', name: '', feed_url: '', item_limit: 3 }] };
    const payload = sourcePreferencesToApi(draft);
    expect(payload).toMatchObject({ show_weather: false, show_news: false });
    expect(payload).not.toHaveProperty('weather_location');
    for (const key of ['news_source', 'news_feed_url', 'news_language', 'news_item_limit', 'news_feeds']) expect(payload).not.toHaveProperty(key);
  });

  it('round-trips stock ticker widgets and saves them without a hidden page size', () => {
    const tickers = [{ id: 'dk', name: 'Danske', symbols: ['NOVO-B.CO'], view: 'condensed' as const, per_page: 2, dwell_minutes: 15, locale: 'da' as const }];
    expect(sourcePreferences(saved).tickers).toEqual([]);
    const form = sourcePreferences({ ...saved, ticker_widgets: tickers });
    expect(form.tickers).toEqual(tickers);
    form.tickers = [{ ...form.tickers[0], name: ' Mine ', view: 'full' }];
    expect(sourcePreferencesToApi(form).ticker_widgets).toEqual([{ ...tickers[0], name: 'Mine', view: 'full', per_page: null }]);
  });
  it('keeps ticker widgets when news is turned off', () => {
    const form = sourcePreferences({ ...saved, ticker_widgets: [{ id: 'a', name: '', symbols: ['NVDA'], view: 'full', per_page: null, dwell_minutes: 15, locale: 'en' }] });
    form.news = { ...form.news, on: false };
    expect(sourcePreferencesToApi(form).ticker_widgets).toHaveLength(1);
  });
  it('round-trips additional news feeds and trims them for saving', () => {
    const feeds = [{ id: 'dr', name: 'DR', feed_url: 'https://www.dr.dk/nyheder/service/feeds/allenyheder', item_limit: 3 }];
    expect(sourcePreferences(saved).news.feeds).toEqual([]);
    const form = sourcePreferences({ ...saved, news_feeds: feeds });
    expect(form.news.feeds).toEqual(feeds);
    form.news.feeds = [...form.news.feeds, { id: 'bbc', name: ' BBC ', feed_url: ' https://feeds.bbci.co.uk/news/rss.xml ', item_limit: 5 }];
    expect(sourcePreferencesToApi(form).news_feeds).toEqual([...feeds, { id: 'bbc', name: 'BBC', feed_url: 'https://feeds.bbci.co.uk/news/rss.xml', item_limit: 5 }]);
  });

  it('saves only the displayed sources and preserves the complete consumer price profile', () => {
    const payload = sourcePreferencesToApi(sourcePreferences({ ...saved, display_timezone: 'Pacific/Auckland', custom_text: 'private note', show_calendar: true }));
    expect(payload).toMatchObject({ energy_price_settings: saved.energy_price_settings, news_feed_url: saved.news_feed_url, news_item_limit: 5 });
    for (const key of ['display_timezone', 'custom_text', 'show_calendar', 'calendar_timezone', 'refresh_interval']) expect(payload).not.toHaveProperty(key);
  });
});

describe('direct source settings visits', () => {
  function render(client: QueryClient) {
    return renderToStaticMarkup(<QueryClientProvider client={client}><DisplayCard /></QueryClientProvider>);
  }

  it('renders the signed-in account\'s saved location and RSS source on first render', () => {
    const client = new QueryClient();
    client.setQueryData(['preferences', 'alice'], saved);
    client.setQueryData(['api-keys', 'alice'], []);
    const html = render(client);
    expect(html).toContain('value="56.15,10.21"');
    expect(html).toContain('value="https://example.org/danish.xml"');
    expect(html).not.toMatch(/<fieldset disabled=""/);
    client.clear();
  });

  it('lists every saved additional news feed with its own address and an add button', () => {
    const client = new QueryClient();
    client.setQueryData(['preferences', 'alice'], { ...saved, news_feeds: [
      { id: 'dr', name: 'DR', feed_url: 'https://www.dr.dk/nyheder/service/feeds/allenyheder', item_limit: 3 },
      { id: 'bbc', name: '', feed_url: 'https://feeds.bbci.co.uk/news/rss.xml', item_limit: 5 },
    ] });
    const html = render(client);
    expect(html).toContain('Additional news feeds');
    expect(html).toContain('value="https://www.dr.dk/nyheder/service/feeds/allenyheder"');
    expect(html).toContain('value="https://feeds.bbci.co.uk/news/rss.xml"');
    expect(html).toContain('Remove news feed 2');
    expect(html).toContain('Add news feed');
    client.clear();
  });

  it('does not show a previous account\'s cached source settings while loading', () => {
    const client = new QueryClient();
    client.setQueryData(['preferences', 'alice'], saved);
    account.id = 'bob';
    const html = render(client);
    expect(html).not.toContain('56.15,10.21');
    expect(html).not.toContain('danish.xml');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Save/);
    expect(html).not.toContain('id="loc"');
    client.clear();
  });

  it('shows Retry and prevents editing/saving when the latest preference request fails even with cached data', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['preferences', 'alice'], saved);
    await expect(client.fetchQuery({ queryKey: ['preferences', 'alice'], queryFn: async () => { throw new Error('offline'); } })).rejects.toThrow('offline');
    const html = render(client);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Retry');
    expect(html).toMatch(/<fieldset disabled=""/);
    client.clear();
  });
});
