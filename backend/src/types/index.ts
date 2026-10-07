import type { DisplayProfile } from '../utils/displayProfile';
import type { EnergyPriceSettings } from '../utils/energyPriceSettings';
import type { NewsProblem } from '../utils/newsErrors';
import type { EnergyPriceProblem } from '../utils/energyPriceErrors';
import type { TickerResult } from '../ticker';
import type { AiUsageData } from '../aiUsage/types';
export interface WidgetLayout {
  i: string;       // 'energy' | 'weather' | 'news' | 'status'
  x: number;       // 0–9
  y: number;       // 0–5
  w: number;       // column span
  h: number;       // row span
  static?: boolean;
  /** Display options for this placement; see utils/widgetOptions.ts for what each widget accepts. */
  options?: WidgetOptions;
}

export interface WidgetOptions {
  /** energy: 'summary' | 'day' | 'rest'; ticker: 'full' | 'condensed' (overrides the ticker's own view); ai-usage: 'full' | 'condensed'. */
  view?: 'summary' | 'day' | 'rest' | 'full' | 'condensed';
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

export interface UserPreferences {
  /** Device-only selection; never persisted to account preferences. */
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
  monta_fields: string[]; // e.g. ['charger_status', 'active_session', 'today_stats']
  zaptec_fields: string[]; // e.g. ['charger_status', 'active_session', 'installation_info']
  show_notion: boolean;
  show_calendar?: boolean;
  calendar_timezone?: string;
  calendar_days?: number;
  calendar_item_limit?: number;
}

export interface EnergyPrice {
  basis?: 'consumer'; // Estimated variable cost incl. VAT; absent means untaxed spot.
  now: number; // øre/kWh
  average: number; // average of available intervals today, Europe/Copenhagen
  trend: 'up' | 'down' | 'stable';
  /** Hourly averages for the Danish calendar day, in order; 23 or 25 entries on DST days. */
  hours?: EnergyPriceHour[];
}

export interface EnergyPriceHour {
  start: string; // ISO instant of the hour start
  hour: number;  // 0–23, Europe/Copenhagen
  price: number; // øre/kWh, mean of the hour's intervals, same basis as `now`
}

export interface WeatherData {
  temp: number;
  condition: string;
  windSpeed: number;
  icon: string;
}

export type WeatherErrorCode = 'missing_key' | 'invalid_location' | 'invalid_key' | 'rate_limited'
  | 'unavailable' | 'timeout' | 'invalid_response';
export interface WeatherProblem { code: WeatherErrorCode; message: string }

export interface NewsItem {
  title: string;
  url: string;
}

export interface NewsFeed {
  id: string;        // 1–16 lowercase letters/digits; layout widget ID is `news:<id>`
  name: string;      // optional label for the layout editor, may be empty
  feed_url: string;  // public HTTPS RSS 2.0 / Atom 1.0
  item_limit: number; // 1–10
}

export interface TickerWidgetSetting {
  id: string;            // 1–16 lowercase letters/digits; layout widget ID is `ticker:<id>`
  name: string;          // layout editor label and condensed header, may be empty
  symbols: string[];     // Yahoo symbols, e.g. NOVO-B.CO (Nasdaq Copenhagen)
  view: 'full' | 'condensed';
  per_page: number | null; // condensed only; null fits as many rows as the widget allows
  dwell_minutes: number;   // how long a page stays before the next is due
  locale: 'da' | 'en';
}

export interface NewsFeedResult {
  items?: NewsItem[];
  error?: NewsProblem;
}

export interface MontaChargePoint {
  id: string;
  state: string; // 'available' | 'charging' | 'busy' | 'offline' | 'unknown'
  name: string;
}

export interface MontaSession {
  id: string;
  energyDeliveredKwh: number | null;
  startedAt: string | null;
  durationMin: number | null;
}

export interface MontaData {
  chargePoints: MontaChargePoint[];
  activeSessions: MontaSession[];
  todayKwh: number | null;
}

export interface ZaptecCharger {
  id: string;
  name: string;
  operatingMode: number; // 0=Unknown, 1=Disconnected, 2=Requesting, 3=Charging, 5=Finished
}

export interface ZaptecSession {
  id: string;
  energyDeliveredKwh: number | null;
  startDateTime: string | null;
  chargerName: string;
}

export interface ZaptecData {
  chargers: ZaptecCharger[];
  activeSession: ZaptecSession | null;
  installationName: string | null;
}

export interface NotionRow {
  id: string;
  title: string;
  subtitle?: string;
}

export interface NotionData {
  rows: NotionRow[];
  databaseName?: string;
}

export interface CalendarEvent {
  title: string;
  start: string; // ISO instant for timed events, YYYY-MM-DD for all-day dates
  end: string; // exclusive for all-day dates
  allDay: boolean;
  dateLabel: string;
  timeLabel: string;
}

export interface CalendarData { timezone: string; events: CalendarEvent[] }

export interface DisplayData {
  customWebhook?: CustomWebhookData;
  schedule?: { pageId: string; pageName: string; quiet: boolean; nextTransitionAt: string };
  customText?: string;
  customImage?: CustomImage;
  price?: EnergyPrice;
  priceError?: EnergyPriceProblem;
  weather?: WeatherData;
  weatherError?: WeatherProblem;
  news?: NewsItem[];
  newsError?: NewsProblem;
  /** Headlines per additional feed, keyed by feed ID. */
  newsFeeds?: Record<string, NewsFeedResult>;
  tickers?: Record<string, TickerResult>;
  monta?: MontaData;
  zaptec?: ZaptecData;
  notion?: NotionData;
  notionError?: { code: string; message: string };
  calendar?: CalendarData;
  aiUsage?: AiUsageData;
  nextRefresh: number;
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

export interface Device {
  id: string;
  user_id: string;
  device_id: string;
  device_name: string;
  license_key: string | null;
  ble_name: string | null;
  firmware_version: string | null;
  last_seen_at: string | null;
}

export interface FirmwareVersion {
  id: string;
  user_id: string;
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

export interface ApiKey {
  id: string;
  user_id: string;
  provider: string;
  api_key: string;
  created_at: string;
}

export interface DisplayImageResponse {
  image_url: string;
  filename: string;
  refresh_rate: number; // seconds
  status: number;       // 0 = OK
}

export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

// OpenWeatherMap API types
export interface OpenWeatherResponse {
  main: {
    temp: number;
    feels_like: number;
    humidity: number;
  };
  weather: Array<{
    id: number;
    main: string;
    description: string;
    icon: string;
  }>;
  wind: {
    speed: number;
    deg: number;
  };
  name: string;
}

// NewsAPI types
export interface NewsApiArticle {
  title: string;
  url: string;
  publishedAt: string;
  source: {
    name: string;
  };
}

export interface NewsApiResponse {
  status: string;
  totalResults: number;
  articles: NewsApiArticle[];
}

// Express augmentation for Clerk auth
declare global {
  namespace Express {
    interface Request {
      clerkUserId?: string;
      supabaseUserId?: string;
    }
  }
}
