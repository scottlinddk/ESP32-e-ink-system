import type { Preferences, UserPreferences } from '../types';
import { energyPriceSettingsForSave } from './energyPriceSettings';
import { newsFeedsForSave } from './newsFeeds';

// A local edit takes precedence until saved or discarded. Other cards can save
// preferences without replacing this form's unfinished work.
export function sourcePreferences(saved: Partial<UserPreferences> = {}, draft?: Preferences | null): Preferences {
  return draft ?? {
    energy: { on: saved.show_energy_price ?? true, zone: saved.energy_price_location ?? 'DK1', priceSettings: saved.energy_price_settings ?? { mode: 'spot' } },
    weather: { on: saved.show_weather ?? true, location: saved.weather_location ?? '55.3,10.4' },
    news: { on: saved.show_news ?? true, lang: saved.news_language ?? 'da', source: saved.news_source ?? 'newsapi', feedUrl: saved.news_feed_url ?? '', itemLimit: saved.news_item_limit ?? 3, feeds: saved.news_feeds ?? [] },
    monta: { on: saved.show_monta ?? false, fields: saved.monta_fields ?? ['charger_status', 'active_session'] },
    zaptec: { on: saved.show_zaptec ?? false, fields: saved.zaptec_fields ?? ['charger_status', 'active_session'] },
    notion: { on: saved.show_notion ?? false },
  };
}

export function sourcePreferencesToApi(prefs: Preferences): Partial<UserPreferences> {
  return {
    show_energy_price: prefs.energy.on,
    energy_price_location: prefs.energy.zone,
    energy_price_settings: energyPriceSettingsForSave(prefs.energy.on, prefs.energy.priceSettings),
    show_weather: prefs.weather.on,
    // Hidden incomplete coordinates must not overwrite the saved location.
    ...(prefs.weather.on ? { weather_location: prefs.weather.location } : {}),
    show_news: prefs.news.on,
    ...(prefs.news.on ? {
      news_language: prefs.news.lang,
      news_source: prefs.news.source === 'rss' ? 'rss' as const : 'newsapi' as const,
      news_feed_url: (prefs.news.feedUrl ?? '').trim(),
      news_item_limit: prefs.news.itemLimit ?? 3,
      news_feeds: newsFeedsForSave(prefs.news.feeds),
    } : {}),
    show_monta: prefs.monta.on, monta_fields: prefs.monta.fields,
    show_zaptec: prefs.zaptec.on, zaptec_fields: prefs.zaptec.fields,
    show_notion: prefs.notion.on,
  };
}
