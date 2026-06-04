export interface UserPreferences {
  show_energy_price: boolean;
  show_weather: boolean;
  show_news: boolean;
  show_calendar: boolean;
  show_air_quality: boolean;
  energy_price_location: string; // 'DK1' | 'DK2'
  weather_location: string; // 'lat,lng'
  news_language: string; // 'da' | 'en'
  refresh_interval_minutes: number;
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

export interface DisplayData {
  price?: EnergyPrice;
  weather?: WeatherData;
  news?: NewsItem[];
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
