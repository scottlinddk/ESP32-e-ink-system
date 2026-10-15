import type { WidgetOptions } from '../types';
import { newsFeedIdFromWidget } from './newsFeeds';
import { calendarIdFromWidget } from './calendarWidgets';
import { isWeatherWidget } from './weatherWidgets';
import { tickerIdFromWidget } from './tickerWidgets';
import { isWidgetZoom, MAX_ZOOM, MIN_ZOOM } from './zoom';

// Per-placement display options, stored on a layout widget. They change how a widget is
// drawn, never what is fetched, so a scheduled page can show the same source differently.
// Mirrored in frontend/src/lib/widgetOptions.ts.

export const ENERGY_VIEWS = ['summary', 'day', 'rest'] as const;
export type EnergyView = typeof ENERGY_VIEWS[number];
export const TICKER_VIEWS = ['full', 'condensed'] as const;
export const AI_USAGE_VIEWS = TICKER_VIEWS;
/** `condensed` shows the time alone, for a status bar made small. */
export const STATUS_VIEWS = TICKER_VIEWS;
/** `list` is the agenda grouped by day, `day` one day by the hour, `days` several side by side, `month` a month grid. */
export const CALENDAR_VIEWS = ['list', 'day', 'days', 'month'] as const;
export type CalendarView = typeof CALENDAR_VIEWS[number];
/**
 * `summary` is the one-line reading (the original look), `current` the large temperature with
 * the readings beside it, `hours` the next 3-hour steps, `daily` the days ahead and `details` a list of readings.
 */
export const WEATHER_VIEWS = ['summary', 'current', 'hours', 'daily', 'details'] as const;
export type WeatherView = typeof WEATHER_VIEWS[number];
export const MAX_WIDGET_ITEMS = 10;
export const MAX_NEWS_COLUMNS = 4;
export const MIN_CALENDAR_DAYS = 2;
export const MAX_CALENDAR_DAYS = 7;

export type WidgetOptionKind = 'energy' | 'weather' | 'list' | 'calendar' | 'ticker' | 'ai-usage' | 'status';

/** Which options a widget accepts, or null when it has none. */
export function widgetOptionKind(widgetId: string): WidgetOptionKind | null {
  if (widgetId === 'energy') return 'energy';
  if (isWeatherWidget(widgetId)) return 'weather';
  if (widgetId === 'calendar' || calendarIdFromWidget(widgetId)) return 'calendar';
  if (widgetId === 'news' || newsFeedIdFromWidget(widgetId)) return 'list';
  if (tickerIdFromWidget(widgetId)) return 'ticker';
  if (widgetId === 'ai-usage') return 'ai-usage';
  if (widgetId === 'status') return 'status';
  return null;
}

const ALLOWED_KEYS: Record<WidgetOptionKind, readonly string[]> = {
  energy: ['view'],
  weather: ['view', 'items'],
  list: ['items', 'columns'],
  calendar: ['view', 'items', 'days'],
  ticker: ['view', 'items'],
  'ai-usage': ['view'],
  status: ['view'],
};

/** Zoom applies to every widget that draws with the text font; an image is placed by pixel instead. */
export function acceptsZoom(widgetId: string): boolean {
  return widgetId !== 'custom-image';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validates untrusted options for one widget. Returns undefined when nothing is set,
 * so an empty object is never stored. Throws a message suitable for the API response.
 */
export function parseWidgetOptions(widgetId: string, value: unknown): WidgetOptions | undefined {
  if (value === undefined || (isRecord(value) && Object.keys(value).length === 0)) return undefined;
  const kind = widgetOptionKind(widgetId);
  if (!isRecord(value) || (!kind && !acceptsZoom(widgetId))) throw new Error('This widget has no display options.');
  const allowed = [...(kind ? ALLOWED_KEYS[kind] : []), ...(acceptsZoom(widgetId) ? ['zoom'] : [])];
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error('Widget options contain unsupported fields.');
  }
  const options: WidgetOptions = {};
  if (value.zoom !== undefined) {
    if (!isWidgetZoom(value.zoom)) throw new Error(`Widget zoom must be a multiple of 0.2 from ${MIN_ZOOM} to ${MAX_ZOOM}.`);
    options.zoom = value.zoom;
  }
  if (value.view !== undefined) {
    const views: readonly string[] = kind === 'energy' ? ENERGY_VIEWS : kind === 'weather' ? WEATHER_VIEWS : kind === 'calendar' ? CALENDAR_VIEWS
      : kind === 'ai-usage' ? AI_USAGE_VIEWS : kind === 'status' ? STATUS_VIEWS : TICKER_VIEWS;
    if (typeof value.view !== 'string' || !views.includes(value.view)) throw new Error('Widget view is not supported.');
    options.view = value.view as WidgetOptions['view'];
  }
  if (value.items !== undefined) {
    if (typeof value.items !== 'number' || !Number.isInteger(value.items) || value.items < 1 || value.items > MAX_WIDGET_ITEMS) {
      throw new Error(`Widget item count must be a whole number from 1 to ${MAX_WIDGET_ITEMS}.`);
    }
    options.items = value.items;
  }
  if (value.columns !== undefined) {
    if (typeof value.columns !== 'number' || !Number.isInteger(value.columns) || value.columns < 1 || value.columns > MAX_NEWS_COLUMNS) {
      throw new Error(`News columns must be a whole number from 1 to ${MAX_NEWS_COLUMNS}.`);
    }
    options.columns = value.columns;
  }
  if (value.days !== undefined) {
    if (typeof value.days !== 'number' || !Number.isInteger(value.days) || value.days < MIN_CALENDAR_DAYS || value.days > MAX_CALENDAR_DAYS) {
      throw new Error(`Calendar days must be a whole number from ${MIN_CALENDAR_DAYS} to ${MAX_CALENDAR_DAYS}.`);
    }
    options.days = value.days;
  }
  return Object.keys(options).length ? options : undefined;
}

export function calendarView(options?: WidgetOptions): CalendarView {
  return (CALENDAR_VIEWS as readonly string[]).includes(options?.view ?? '') ? options!.view as CalendarView : 'list';
}

export function weatherView(options?: WidgetOptions): WeatherView {
  return (WEATHER_VIEWS as readonly string[]).includes(options?.view ?? '') ? options!.view as WeatherView : 'summary';
}

export function energyView(options?: WidgetOptions): EnergyView {
  return (ENERGY_VIEWS as readonly string[]).includes(options?.view ?? '') ? options!.view as EnergyView : 'summary';
}
