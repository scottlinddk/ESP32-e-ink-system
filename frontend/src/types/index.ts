// ---- Legacy API types (kept for compatibility with existing hooks/api.ts) ----

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
  energy: { on: boolean; zone: string };
  weather: { on: boolean; location: string };
  news: { on: boolean; lang: string; source: string };
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

// Legacy Device type kept for existing hooks
export interface Device {
  id: string;
  device_id: string;
  device_name: string;
  license_key: string;
  firmware_version: string;
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
