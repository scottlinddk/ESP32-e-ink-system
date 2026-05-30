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
  device_id: string;
  device_name: string;
  license_key: string;
  firmware_version: string;
  last_seen_at: string | null;
}

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
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
