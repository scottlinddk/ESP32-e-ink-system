import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationsPage } from '../../pages/IntegrationsPage';
import { STRINGS } from '../strings';

const state = vi.hoisted(() => ({ signedIn: true, userId: 'alice' as string | undefined, lang: 'en' as 'en' | 'da' }));
const saved = { show_energy_price: true, energy_price_location: 'DK2', show_weather: true, weather_location: '0,0',
  show_news: true, news_source: 'rss', news_feed_url: 'https://example.org/rss', news_language: 'en',
  show_monta: true, show_zaptec: true, show_notion: true, show_calendar: true,
  calendar_timezone: 'UTC', calendar_days: 14, calendar_item_limit: 3, display_timezone: 'UTC' };
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({
  user: state.userId ? { id: state.userId } : undefined, isSignedIn: state.signedIn, getToken: async () => 'PRIVATE_AUTH_TOKEN',
}) }));
vi.mock('../../hooks/usePreferences', () => ({
  usePreferences: () => ({ data: saved, isPending: false, isLoading: false, isError: false, refetch: vi.fn() }),
  useSavePreferences: () => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() }),
  useApiKeys: () => ({ data: [{ provider: 'openweathermap', api_key: 'masked-key' }], dataUpdatedAt: 1 }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { configured: true, state: 'unavailable', rowCount: 0 }, isPending: false, isLoading: false, isError: false, refetch: vi.fn() }),
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
  useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }),
}));
vi.mock('../appContext', () => ({ useApp: () => ({ lang: state.lang, t: STRINGS[state.lang], online: true, setApiKeys: vi.fn(), toast: vi.fn() }) }));
const render = () => renderToStaticMarkup(<MemoryRouter initialEntries={['/integrations']}><IntegrationsPage /></MemoryRouter>);
beforeEach(() => { state.signedIn = true; state.userId = 'alice'; state.lang = 'en'; });

describe('Integrations page with its real setup forms', () => {
  it('requires an authenticated account', () => {
    state.signedIn = false;
    expect(render()).toBe('');
    state.signedIn = true; state.userId = undefined;
    expect(render()).toBe('');
  });

  it('opens directly with saved source values and mounts every source/credential section only once', () => {
    const html = render();
    for (const id of ['sources', 'credentials', 'credentials-monta', 'credentials-zaptec', 'credentials-notion',
      'credentials-openweather', 'credentials-newsapi', 'calendar', 'home-assistant', 'zone', 'loc',
      'calendar-url', 'calendar-timezone', 'custom-webhook-ttl', 'custom-webhook-endpoint']) {
      expect(html.split(`id="${id}"`)).toHaveLength(2);
    }
    expect(html).toContain('<option value="DK2" selected="">');
    expect(html).toContain('value="0,0"');
    expect(html).toContain('value="https://example.org/rss"');
    expect(html).toContain('value="UTC"');
    expect(html).not.toContain('PRIVATE_AUTH_TOKEN');
  });

  it.each(['en', 'da'] as const)('maps providers to widgets and complete setup sections in %s', (lang) => {
    state.lang = lang;
    const t = STRINGS[lang];
    const html = render();
    for (const widget of [t.layoutWidgetEnergy, t.layoutWidgetWeather, t.layoutWidgetNews, t.srcMonta, t.srcZaptec, t.srcNotion]) {
      expect(html).toContain(`${t.integrationWidget}: ${widget}`);
    }
    for (const section of ['sources', 'credentials', 'calendar', 'home-assistant', 'credentials-openweather', 'credentials-monta', 'credentials-zaptec', 'credentials-notion']) {
      expect(html).toContain(`href="#${section}"`);
    }
    expect(html).toContain(t.integrationStepEnable);
    expect(html).toContain(t.integrationLocalWidgetsHelp);
    expect(html).toContain(lang === 'da' ? 'Find din kalenderadresse' : 'Find your calendar URL');
    expect(html).toContain(lang === 'da' ? 'Opsæt Home Assistant trin for trin' : 'Set up Home Assistant step by step');
    expect(html).toContain('ntn_');
    expect(html).toContain('Manage data sources');
    expect(html).not.toContain('not supported yet');
    expect(html).toContain('href="/layout"');
    expect(html).toContain('href="/dashboard"');
  });

  it('links exact provider/setup references and explains deployment and price limits', () => {
    const html = render();
    for (const url of [
      'https://www.energidataservice.dk/tso-electricity/DayAheadPrices', 'https://openweathermap.org/api/current',
      'https://newsapi.org/pricing', 'https://docs.public-api.monta.com/reference/home',
      'https://docs.zaptec.com/docs/getting-started', 'https://developers.notion.com/guides/get-started/internal-connections',
      'https://github.com/scottlinddk/ESP32-e-ink-system/blob/main/docs/INTEGRATIONS.md',
      'https://www.home-assistant.io/integrations/rest_command/',
    ]) expect(html).toContain(`href="${url}"`);
    expect(html).toContain('includes VAT and excludes fixed subscriptions');
    expect(html).toContain('Use RSS for Danish and Finnish news');
    expect(html).toContain('production needs an appropriate plan');
    expect(html).toContain('The URL is stored encrypted here');
    expect(html).toContain('next fetch or Bluetooth transfer');
  });
});
