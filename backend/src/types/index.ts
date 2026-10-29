import type { DisplayProfile } from '../utils/displayProfile';
import type { EnergyPriceSettings } from '../utils/energyPriceSettings';
import type { NewsProblem } from '../utils/newsErrors';
import type { EnergyPriceProblem } from '../utils/energyPriceErrors';
import type { TickerResult } from '../ticker';
import type { CalendarProblem } from '../utils/calendarErrors';
import type { AiUsageData } from '../aiUsage/types';
import type { DisplayLanguage } from '../utils/displayLanguage';
import type { LayoutOutline, WidgetAlign, WidgetOutline } from '../utils/widgetFrame';
export interface WidgetLayout {
  i: string;       // 'energy' | 'weather' | 'news' | 'status'
  x: number;       // 0 to cols - 1
  y: number;       // 0 to rows - 1
  w: number;       // column span
  h: number;       // row span
  static?: boolean;
  /** Display options for this placement; see utils/widgetOptions.ts for what each widget accepts. */
  options?: WidgetOptions;
}

export interface WidgetOptions {
  /** energy: 'summary' | 'day' | 'rest'; weather: 'summary' | 'current' | 'hours' | 'daily' | 'details'; calendar: 'list' | 'day' | 'days' | 'month'; ticker: 'full' | 'condensed' (overrides the ticker's own view); ai-usage: 'full' | 'condensed'; family-meals: 'full' (the week) | 'condensed' (tonight) | 'upcoming' (today beside the coming days) | 'planner' (a card per day) | 'recipe' (tonight's recipe); status: 'full' | 'condensed' (the time alone). */
  view?: 'summary' | 'day' | 'rest' | 'full' | 'condensed' | 'list' | 'days' | 'month' | 'current' | 'hours' | 'daily' | 'details' | 'upcoming' | 'planner' | 'recipe';
  /** news, calendar list view: most rows drawn; ticker: stocks per page in the condensed view; weather hours and daily: most steps or days drawn. 1–10. */
  items?: number;
  /** news: how many columns the headlines are split into, 1–4. Unset is 1. A widget too narrow for that many shows fewer. */
  columns?: number;
  /** news: headline weight. Unset is 'bold', the original look; 'regular' draws the headlines once, without the one-pixel smear; 'light' also drops every other glyph pixel. */
  weight?: 'light' | 'regular' | 'bold';
  /** calendar days view: how many days are shown side by side, 2–7. Unset fits as many as the width allows. */
  days?: number;
  /** calendar list view: draw each event's description under its title. Unset is off. */
  descriptions?: boolean;
  /** calendar list view: draw each event's time in a black pill. Unset is off. */
  pills?: boolean;
  /** calendar: write times as `10:30 AM` instead of `10:30`. Unset is the 24-hour clock. */
  clock12?: boolean;
  /** calendar: a footer bar with the calendar's name. Unset is off. */
  footer?: boolean;
  /** Enlargement of everything the widget draws, 1–4 in steps of 0.2. Overrides the layout's zoom; unset follows it. */
  zoom?: number;
  /** Where the content sits in the widget's area, e.g. 'top-right' or 'middle-center'. Unset is 'top-left', where every widget draws on its own. */
  align?: WidgetAlign;
  /** Outline around the widget. Overrides the layout's outline, so 'none' is stored only to opt out of it. Unset follows the layout. */
  outline?: WidgetOutline;
}

export interface DisplayLayout {
  version: 1;
  /** 10 × 6, 20 × 12 or 40 × 24 (see utils/layoutGrid.ts). */
  cols: number;
  rows: number;
  /** Default zoom for every widget, 1–4. Unset picks one from the panel size (see utils/zoom.ts). */
  zoom?: number;
  /** White text on a black background. Photos keep their own colours. `'sun'` inverts only between sunset and sunrise at the weather location. False is not stored. */
  invert?: boolean | 'sun';
  /** Tekst TV: every widget gets a titled bar with a page number and the status bar becomes the page header. False is not stored. */
  teletext?: boolean;
  /** Default outline for every widget. Unset draws none. */
  outline?: LayoutOutline;
  widgets: WidgetLayout[];
}

/** Show a saved layout from `start` (HH:MM in the schedule time zone) every day, for `duration_seconds`. */
export interface TimedLayout {
  id: string;
  layout_id: string;
  start: string;
  duration_seconds: number;
}

export interface DisplaySchedule {
  enabled: boolean;
  timezone: string;
  pages: Array<{ id: string; name: string; duration_seconds: number; layout: DisplayLayout }>;
  quiet_hours: { enabled: boolean; start: string; end: string };
  /** Applies in single-layout mode too, and overrides the slideshow while a rule is active. Omitted when empty. */
  timed_layouts?: TimedLayout[];
}

export interface UserPreferences {
  /** Device-only selection; never persisted to account preferences. */
  active_layout_id?: string | null;
  display_timezone?: string;
  /** Device-only. Words on the display; account preferences have no such column. */
  display_language?: DisplayLanguage;
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
  /** Additional calendars, each placed as its own `calendar:<id>` widget. Their private URLs are stored encrypted in api_keys, never here. */
  calendar_widgets?: CalendarWidgetSetting[];
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
  /** m/s, rounded. */
  windSpeed: number;
  icon: string;
  /** The readings below are left out when the provider does not report them. */
  feelsLike?: number;
  /** Percent. */
  humidity?: number;
  /** hPa at sea level. */
  pressure?: number;
  /** Direction the wind blows from, in degrees. */
  windDeg?: number;
  /** m/s, rounded. */
  windGust?: number;
  /** Cloud cover in percent. */
  cloudiness?: number;
  /** Metres, as reported (the provider caps it at 10 000). */
  visibility?: number;
  /** Rain and snow in the last hour, mm. */
  precipitation?: number;
  /** Unix seconds (UTC). Absent during polar day or night. */
  sunrise?: number;
  sunset?: number;
}

/** One 3-hour step of the provider's 5-day forecast. */
export interface WeatherForecastSlot {
  /** Unix seconds (UTC) at the start of the step. */
  time: number;
  temp: number;
  condition: string;
  icon: string;
  /** Probability of precipitation, percent. */
  pop: number;
  /** Rain and snow expected in the step, mm. */
  precipitation: number;
}

/** European air quality index 1 (good) to 5 (very poor), as the provider reports it. */
export interface AirQuality {
  aqi: 1 | 2 | 3 | 4 | 5;
  /** µg/m³. */
  pm25?: number;
  pm10?: number;
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

/** An additional calendar. The layout widget ID is `calendar:<id>`; its ICS URL is the encrypted api_keys row `calendar:<id>`. */
export interface CalendarWidgetSetting {
  id: string;         // 1–16 lowercase letters/digits
  name: string;       // layout editor label, may be empty
  timezone: string;   // IANA zone used for event times and day boundaries
  days: number;       // 1–30 days ahead for the list view
  item_limit: number; // 1–10 events in the list view
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

/** One evening of the Family Meals weekly overview. `weekday` is 0 for Monday to 6 for Sunday. */
export interface FamilyMealsDay {
  date: string;
  weekday: number;
  /** `empty` is a day the family left without dinner; `unplanned` a day the week has no plan for. */
  kind: 'dinner' | 'leftover' | 'empty' | 'unplanned';
  title: string | null;
  note: string | null;
  dinnerTime: string | null;
  totalTimeMinutes: number | null;
  /** Ingredient lines and diet tags, for the recipe view. Absent while Family Meals does not send them. */
  ingredients?: string[];
  tags?: string[];
}

export interface FamilyMealsData {
  familyName: string | null;
  weekStartDate: string;
  isoWeek: number;
  /** Today in the family's own time zone, as Family Meals sees it. */
  today: string;
  /** False when no plan has been generated for the week. */
  planned: boolean;
  /** Seven days, Monday first. */
  days: FamilyMealsDay[];
}

export interface CalendarEvent {
  title: string;
  start: string; // ISO instant for timed events, YYYY-MM-DD for all-day dates
  end: string; // exclusive for all-day dates
  allDay: boolean;
  dateLabel: string;
  timeLabel: string;
  /** First calendar day in the calendar's time zone, YYYY-MM-DD. */
  day: string;
  /** Last calendar day, inclusive. An event ending exactly at midnight ends the day before. */
  endDay: string;
  /** Minutes after midnight of `day` for a timed event; null for an all-day one. */
  startMinute: number | null;
  /** Minutes after midnight of `endDay` (1440 when it ends at midnight); null for an all-day event. */
  endMinute: number | null;
  /** The event's notes, on one line and at most 200 characters. Absent when it has none. */
  description?: string;
}

export interface CalendarData {
  /** What the calendar is called, for the footer. Set for additional calendars. */
  name?: string;
  timezone: string;
  /** The calendar day and minute of the request, in `timezone`. */
  today: string;
  nowMinute: number;
  /** The configured horizon and row count of the list view. */
  days: number;
  limit: number;
  events: CalendarEvent[];
}

/** One additional calendar: its events, or why there are none. A failed source never shows stale data. */
export interface CalendarResult {
  calendar?: CalendarData;
  error?: CalendarProblem;
}

export interface DisplayData {
  customWebhook?: CustomWebhookData;
  schedule?: { pageId: string; pageName: string; quiet: boolean; nextTransitionAt: string; timed?: boolean };
  customText?: string;
  customImage?: CustomImage;
  price?: EnergyPrice;
  priceError?: EnergyPriceProblem;
  weather?: WeatherData;
  weatherError?: WeatherProblem;
  /** Only fetched when the layout shown has a weather widget that draws a forecast. */
  weatherForecast?: WeatherForecastSlot[];
  weatherForecastError?: WeatherProblem;
  /** Only fetched when the layout shown has a weather widget that draws the details. */
  airQuality?: AirQuality;
  news?: NewsItem[];
  newsError?: NewsProblem;
  /** Headlines per additional feed, keyed by feed ID. */
  newsFeeds?: Record<string, NewsFeedResult>;
  tickers?: Record<string, TickerResult>;
  monta?: MontaData;
  zaptec?: ZaptecData;
  notion?: NotionData;
  notionError?: { code: string; message: string };
  familyMeals?: FamilyMealsData;
  familyMealsError?: { code: string; message: string };
  calendar?: CalendarData;
  /** Additional calendars keyed by calendar widget ID. */
  calendars?: Record<string, CalendarResult>;
  aiUsage?: AiUsageData;
  /** The charge the viewing device last reported. Absent when unknown. */
  battery?: { percent: number };
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
