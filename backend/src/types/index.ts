import type { DisplayProfile } from '../utils/displayProfile';
export interface WidgetLayout {
  i: string;       // 'energy' | 'weather' | 'news' | 'status'
  x: number;       // 0–9
  y: number;       // 0–5
  w: number;       // column span
  h: number;       // row span
  static?: boolean;
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
  show_custom_webhook?: boolean;
  custom_webhook_ttl_minutes?: number;
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
  weather_location: string; // 'lat,lng'
  news_language: string; // 'da' | 'en'
  news_source?: 'newsapi' | 'rss';
  news_feed_url?: string;
  news_item_limit?: number;
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
  now: number; // øre/kWh
  average: number; // average of available intervals today, Europe/Copenhagen
  trend: 'up' | 'down' | 'stable';
}

export interface WeatherData {
  temp: number;
  condition: string;
  windSpeed: number;
  icon: string;
}

export interface NewsItem {
  title: string;
  url: string;
}

export interface MontaChargePoint {
  id: string;
  state: string; // 'available' | 'charging' | 'busy' | 'offline' | 'unknown'
  name: string;
}

export interface MontaSession {
  id: string;
  energyDeliveredKwh: number;
  startedAt: string;
  durationMin: number;
}

export interface MontaData {
  chargePoints: MontaChargePoint[];
  activeSessions: MontaSession[];
  todayKwh: number | null;
}

export interface ZaptecCharger {
  id: string;
  name: string;
  operatingMode: number; // 1=Unknown, 2=Disconnected, 3=Connected/Requesting, 5=Charging, 6=Completed
}

export interface ZaptecSession {
  id: string;
  energyDeliveredKwh: number;
  startDateTime: string;
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
  weather?: WeatherData;
  news?: NewsItem[];
  monta?: MontaData;
  zaptec?: ZaptecData;
  notion?: NotionData;
  calendar?: CalendarData;
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
  firmware_version: string;
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

// Energinet API types
export interface EnergidataRecord {
  TimeDK: string;
  TimeUTC: string;
  PriceArea: string;
  DayAheadPriceDKK: number;
  DayAheadPriceEUR: number;
}

export interface EnergidataResponse {
  total: number;
  limit: number;
  dataset: string;
  records: EnergidataRecord[];
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
