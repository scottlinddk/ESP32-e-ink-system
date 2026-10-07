import type { DisplayProfile } from '../lib/displayProfile';
// ---- Legacy API types (kept for compatibility with existing hooks/api.ts) ----

export interface WidgetLayout {
  i: string;        // 'energy' | 'weather' | 'news' | 'status'
  x: number;        // 0–9
  y: number;        // 0–5
  w: number;        // column span
  h: number;        // row span
  static?: boolean;
  /** Display options for this placement. Mirrors backend/src/utils/widgetOptions.ts. */
  options?: WidgetOptions;
}

export type EnergyView = 'summary' | 'day' | 'rest';

export interface WidgetOptions {
  /** energy: EnergyView; ticker: TickerView, overriding the ticker's own view. */
  view?: EnergyView | TickerView;
  /** news, calendar: most rows drawn; ticker: stocks per page in the condensed view. 1–10. */
  items?: number;
}

export interface DisplayLayout {
  version: 1;
  cols: 10;
  rows: 6;
  widgets: WidgetLayout[];
}

export interface DisplaySchedule {
  enabled: boolean;
  timezone: string;
  pages: Array<{ id: string; name: string; duration_seconds: number; layout: DisplayLayout }>;
  quiet_hours: { enabled: boolean; start: string; end: string };
}

export const DEFAULT_LAYOUT: DisplayLayout = {
  version: 1,
  cols: 10,
  rows: 6,
  widgets: [
    { i: 'energy',  x: 0, y: 0, w: 10, h: 2 },
    { i: 'weather', x: 0, y: 2, w: 10, h: 2 },
    { i: 'news',    x: 0, y: 4, w: 10, h: 1 },
    { i: 'status',  x: 0, y: 5, w: 10, h: 1, static: true },
  ],
};

export interface NewsFeed {
  id: string;
  name: string;
  feed_url: string;
  item_limit: number;
}

export type TickerView = 'full' | 'condensed';

/** A stock ticker widget. The layout widget ID is `ticker:<id>`. Mirrors backend/src/utils/tickerWidgets.ts. */
export interface TickerWidgetSetting {
  id: string;
  name: string;
  symbols: string[];
  view: TickerView;
  per_page: number | null;
  dwell_minutes: number;
  locale: 'da' | 'en';
}

export interface TickerSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  exchangeName: string;
  type: string;
}

export type EnergyPriceSettings = { mode: 'spot' } | {
  mode: 'consumer';
  gridGln: string;
  gridChargeCodes: string[];
  retailerMarkupOre: number;
};

export interface UserPreferences {
  active_layout_id?: string | null;
  display_timezone?: string;
  show_custom_webhook?: boolean;
  custom_webhook_ttl_minutes?: number;
  show_ai_usage?: boolean;
  display_schedule?: DisplaySchedule | null;
  display_profile?: DisplayProfile | null;
  show_custom_text?: boolean;
  custom_text?: string;
  show_custom_image?: boolean;
  custom_image?: CustomImage | null;
  show_energy_price: boolean;
  show_weather: boolean;
  show_news: boolean;
  show_air_quality: boolean;
  show_monta: boolean;
  show_zaptec: boolean;
  energy_price_location: string; // 'DK1' | 'DK2'
  energy_price_settings?: EnergyPriceSettings;
  weather_location: string; // 'lat,lng'
  news_language: string; // 'da' | 'en'
  news_source?: 'newsapi' | 'rss';
  news_feed_url?: string;
  news_item_limit?: number;
  /** Additional RSS/Atom feeds, each placed as its own `news:<id>` widget. */
  news_feeds?: NewsFeed[];
  ticker_widgets?: TickerWidgetSetting[];
  refresh_interval_minutes: number;
  layout: DisplayLayout | null;
  monta_fields: string[];
  zaptec_fields: string[];
  show_notion: boolean;
  show_calendar?: boolean;
  calendar_timezone?: string;
  calendar_days?: number;
  calendar_item_limit?: number;
}

export interface EnergyPrice {
  basis?: 'consumer';
  now: number; // øre/kWh
  average: number;
  trend: 'up' | 'down' | 'stable';
  hours?: Array<{ start: string; hour: number; price: number }>;
}

export interface WeatherData {
  temp: number;
  condition: string;
  windSpeed: number;
  icon: string;
}

export type WeatherErrorCode = 'missing_key' | 'invalid_location' | 'invalid_key' | 'rate_limited' | 'unavailable' | 'timeout' | 'invalid_response';
export interface WeatherError { code: WeatherErrorCode; message: string; }
export type EnergyPriceErrorCode = 'invalid_settings' | 'missing_tariff' | 'unavailable' | 'timeout' | 'invalid_response';
/** missingCodes lists configured grid tariff codes without a current tariff for the configured GLN. */
export interface EnergyPriceProblem { code: EnergyPriceErrorCode; message: string; missingCodes?: string[] }

export interface NewsItem {
  title: string;
  url: string;
}

export interface DisplayData {
  customWebhook?: CustomWebhookData;
  schedule?: { pageId: string; pageName: string; quiet: boolean; nextTransitionAt: string };
  customText?: string;
  customImage?: CustomImage;
  price?: EnergyPrice;
  priceError?: EnergyPriceProblem;
  weather?: WeatherData;
  weatherError?: WeatherError;
  news?: NewsItem[];
  calendar?: { timezone: string; events: Array<{ title: string; start: string; end: string; allDay: boolean; dateLabel: string; timeLabel: string }> };
  aiUsage?: AiUsageData;
  nextRefresh: number;
}

// Mirrors backend/src/aiUsage/types.ts.
export type AiUsageProvider = 'claude' | 'openai';
export interface AiUsageProviderView {
  provider: AiUsageProvider;
  label: string;
  limits: Array<{ label: string; usedPercent: number | null; resetsAt: string }>;
  limitsObservedAt: string | null;
  today: { tokens: number; costUsd: number | null; partial: boolean } | null;
  monthCostUsd: number | null;
  adminError?: { code: string; message: string };
}
export interface AiUsageData { providers: AiUsageProviderView[] }
export interface AiUsageStatus {
  configured: boolean;
  tokenCreatedAt: string | null;
  receivedAt: string | null;
  reports: Record<AiUsageProvider, { limitsObservedAt: string | null; machines: Array<{ name: string; day: string; observedAt: string }> }>;
  adminKeys: Record<AiUsageProvider, boolean>;
}

export interface CustomImage {
  width: number;
  height: number;
  // Base64, MSB-first, 1=white, tight rows of ceil(width / 8) bytes.
  pixels: string;
  fit: 'contain' | 'cover';
}

export interface SensorRow { label: string; value: string; unit?: string; }
export interface CustomWebhookData {
  state: 'fresh' | 'stale' | 'unavailable';
  rows: SensorRow[];
  observedAt: string | null;
  receivedAt: string | null;
  expiresAt: string | null;
}
export interface CustomWebhookStatus {
  configured: boolean;
  tokenCreatedAt: string | null;
  state: CustomWebhookData['state'];
  observedAt: string | null;
  receivedAt: string | null;
  expiresAt: string | null;
  rowCount: number;
}

export interface MaskedApiKey {
  id: string;
  provider: string;
  api_key: string; // masked like "sk_tes••••••••"
  created_at: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

// ---- App-level types for the new design system ----

export interface Preferences {
  energy: { on: boolean; zone: string; priceSettings?: EnergyPriceSettings };
  weather: { on: boolean; location: string };
  news: { on: boolean; lang: string; source: string; feedUrl?: string; itemLimit?: number; feeds: NewsFeed[] };
  monta: { on: boolean; fields: string[] };
  zaptec: { on: boolean; fields: string[] };
  notion: { on: boolean };
  tickers: TickerWidgetSetting[];
}

export interface AppDevice {
  id: string;
  name: { en: string; da: string };
  license: string;
  firmware: string;
  lastSeenMin: number;
}

export interface ApiKeyEntry {
  status: string;
  key: string;
}

export interface ToastData {
  id?: number;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  msg?: string;
  persist?: boolean;
  ttl?: number;
  action?: { label: string; onClick: () => void };
}

export interface AppUser {
  name: string;
  email: string;
}

export interface UsageData {
  apiCalls: number;
  apiLimit: number;
  deviceLimit: number;
}

export interface Device {
  id: string;
  device_id: string;
  device_name: string;
  ble_name: string | null;
  license_key: string | null;
  firmware_version: string | null;
  last_seen_at: string | null;
}

export interface FirmwareVersion {
  id: string;
  version: string;
  download_path: string;
  checksum: string | null;
  release_notes: string | null;
  active: boolean;
  created_at: string;
  is_default?: boolean;
}

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'esp-web-install-button': { manifest: string; [key: string]: unknown };
    }
  }
}
