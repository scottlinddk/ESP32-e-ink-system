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

export interface UserPreferences {
  show_energy_price: boolean;
  show_weather: boolean;
  show_news: boolean;
  show_calendar: boolean;
  show_air_quality: boolean;
  show_monta: boolean;
  show_zaptec: boolean;
  energy_price_location: string; // 'DK1' | 'DK2'
  weather_location: string; // 'lat,lng'
  news_language: string; // 'da' | 'en'
  refresh_interval_minutes: number;
  layout: DisplayLayout | null;
  monta_fields: string[]; // e.g. ['charger_status', 'active_session', 'today_stats']
  zaptec_fields: string[]; // e.g. ['charger_status', 'active_session', 'installation_info']
  ics_calendar_url?: string;
  show_notion: boolean;
}

export interface EnergyPrice {
  now: number; // øre/kWh
  average: number;
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

export interface IcsCalendarEvent {
  summary: string;
  timeLabel: string; // "HH:MM" or "All day"
  isToday: boolean;
}

export interface IcsCalendarData {
  label: string;
  today: string;
  events: IcsCalendarEvent[];
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

export interface DisplayData {
  price?: EnergyPrice;
  weather?: WeatherData;
  news?: NewsItem[];
  monta?: MontaData;
  zaptec?: ZaptecData;
  calendar?: IcsCalendarData;
  notion?: NotionData;
  nextRefresh: number;
}

export interface Device {
  id: string;
  user_id: string;
  device_id: string;
  device_name: string;
  license_key: string;
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
  HourDK: string;
  HourUTC: string;
  PriceArea: string;
  SpotPriceDKK: number;
  SpotPriceEUR: number;
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
