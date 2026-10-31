import type { WidgetOptions } from '../types';
import { newsFeedIdFromWidget } from './newsFeeds';
import { calendarIdFromWidget } from './calendarWidgets';
import { isWeatherWidget } from './weatherWidgets';
import { tickerIdFromWidget } from './tickerWidgets';
import { isWidgetZoom, MAX_ZOOM, MIN_ZOOM } from './zoom';
import { DEFAULT_ALIGN, isWidgetAlign, isWidgetOutline, WIDGET_ALIGNMENTS, WIDGET_OUTLINES } from './widgetFrame';

// Per-placement display options, stored on a layout widget. They change how a widget is
// drawn, never what is fetched, so a scheduled page can show the same source differently.
// Mirrored in frontend/src/lib/widgetOptions.ts.

export const ENERGY_VIEWS = ['summary', 'day', 'rest'] as const;
export type EnergyView = typeof ENERGY_VIEWS[number];
export const TICKER_VIEWS = ['full', 'condensed', 'cards'] as const;
export const AI_USAGE_VIEWS = ['full', 'condensed'] as const;
/** `full` is the week's dinners, `condensed` tonight's dinner alone, `upcoming` today beside the coming days, `planner` a card per day and `recipe` tonight's recipe. */
export const FAMILY_MEALS_VIEWS = ['full', 'condensed', 'upcoming', 'planner', 'recipe'] as const;
export type FamilyMealsView = typeof FAMILY_MEALS_VIEWS[number];
/** `condensed` shows the time alone, for a status bar made small. */
export const STATUS_VIEWS = AI_USAGE_VIEWS;
/** `list` is the agenda grouped by day, `day` one day by the hour, `days` several side by side, `month` a month grid. */
export const CALENDAR_VIEWS = ['list', 'day', 'days', 'month'] as const;
export type CalendarView = typeof CALENDAR_VIEWS[number];
/**
 * `summary` is the one-line reading (the original look), `current` the large temperature with
 * the readings beside it, `hours` the next 3-hour steps, `daily` the days ahead and `details` a list of readings.
 */
export const WEATHER_VIEWS = ['summary', 'current', 'hours', 'daily', 'details'] as const;
export type WeatherView = typeof WEATHER_VIEWS[number];
/** News headline weight. `bold` is the original look, so it is the default and is not stored. */
export const NEWS_WEIGHTS = ['light', 'regular', 'bold'] as const;
export type NewsWeight = typeof NEWS_WEIGHTS[number];
export const DEFAULT_NEWS_WEIGHT: NewsWeight = 'bold';
export const MAX_WIDGET_ITEMS = 10;
export const MAX_NEWS_COLUMNS = 4;
export const MIN_CALENDAR_DAYS = 2;
export const MAX_CALENDAR_DAYS = 7;
/** Calendar on/off options: event descriptions, times in pills, the 12-hour clock and the footer bar. */
export const CALENDAR_FLAGS = ['descriptions', 'pills', 'clock12', 'footer'] as const;

export type WidgetOptionKind = 'energy' | 'weather' | 'list' | 'calendar' | 'ticker' | 'ai-usage' | 'family-meals' | 'status';

/** Which options a widget accepts, or null when it has none. */
export function widgetOptionKind(widgetId: string): WidgetOptionKind | null {
  if (widgetId === 'energy') return 'energy';
  if (isWeatherWidget(widgetId)) return 'weather';
  if (widgetId === 'calendar' || calendarIdFromWidget(widgetId)) return 'calendar';
  if (widgetId === 'news' || newsFeedIdFromWidget(widgetId)) return 'list';
  if (tickerIdFromWidget(widgetId)) return 'ticker';
  if (widgetId === 'ai-usage') return 'ai-usage';
  if (widgetId === 'family-meals') return 'family-meals';
  if (widgetId === 'status') return 'status';
  return null;
}

const ALLOWED_KEYS: Record<WidgetOptionKind, readonly string[]> = {
  energy: ['view'],
  weather: ['view', 'items'],
  list: ['items', 'columns', 'weight'],
  calendar: ['view', 'items', 'days', 'descriptions', 'pills', 'clock12', 'footer'],
  ticker: ['view', 'items'],
  'ai-usage': ['view'],
  'family-meals': ['view'],
  status: ['view'],
};

/** Zoom applies to every widget that draws with the text font; an image is placed by pixel instead. */
export function acceptsZoom(widgetId: string): boolean {
  return widgetId !== 'custom-image';
}

/** Every widget can be positioned in its area and outlined. */
const FRAME_KEYS = ['align', 'outline'] as const;

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
  if (!isRecord(value)) throw new Error('Widget options must be an object.');
  const allowed = [...(kind ? ALLOWED_KEYS[kind] : []), ...(acceptsZoom(widgetId) ? ['zoom'] : []), ...FRAME_KEYS];
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error('Widget options contain unsupported fields.');
  }
  const options: WidgetOptions = {};
  if (value.align !== undefined) {
    if (!isWidgetAlign(value.align)) throw new Error(`Widget alignment must be one of ${WIDGET_ALIGNMENTS.join(', ')}.`);
    // Top left is where a widget draws on its own, so it is never stored.
    if (value.align !== DEFAULT_ALIGN) options.align = value.align;
  }
  if (value.outline !== undefined) {
    if (!isWidgetOutline(value.outline)) throw new Error(`Widget outline must be one of ${WIDGET_OUTLINES.join(', ')}.`);
    // 'none' is kept: it opts this widget out of the layout's outline.
    options.outline = value.outline;
  }
  if (value.zoom !== undefined) {
    if (!isWidgetZoom(value.zoom)) throw new Error(`Widget zoom must be a multiple of 0.2 from ${MIN_ZOOM} to ${MAX_ZOOM}.`);
    options.zoom = value.zoom;
  }
  if (value.view !== undefined) {
    const views: readonly string[] = kind === 'energy' ? ENERGY_VIEWS : kind === 'weather' ? WEATHER_VIEWS : kind === 'calendar' ? CALENDAR_VIEWS
      : kind === 'ai-usage' ? AI_USAGE_VIEWS : kind === 'family-meals' ? FAMILY_MEALS_VIEWS : kind === 'status' ? STATUS_VIEWS : TICKER_VIEWS;
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
  if (value.weight !== undefined) {
    if (typeof value.weight !== 'string' || !(NEWS_WEIGHTS as readonly string[]).includes(value.weight)) {
      throw new Error(`News font weight must be one of ${NEWS_WEIGHTS.join(', ')}.`);
    }
    // The default is what an unset weight draws, so it is never stored.
    if (value.weight !== DEFAULT_NEWS_WEIGHT) options.weight = value.weight as NewsWeight;
  }
  if (value.days !== undefined) {
    if (typeof value.days !== 'number' || !Number.isInteger(value.days) || value.days < MIN_CALENDAR_DAYS || value.days > MAX_CALENDAR_DAYS) {
      throw new Error(`Calendar days must be a whole number from ${MIN_CALENDAR_DAYS} to ${MAX_CALENDAR_DAYS}.`);
    }
    options.days = value.days;
  }
  for (const key of CALENDAR_FLAGS) {
    const flag = value[key];
    if (flag === undefined) continue;
    if (typeof flag !== 'boolean') throw new Error(`Calendar ${key} must be true or false.`);
    // Off is what an unset flag draws, so it is never stored.
    if (flag) options[key] = true;
  }
  return Object.keys(options).length ? options : undefined;
}

export function calendarView(options?: WidgetOptions): CalendarView {
  return (CALENDAR_VIEWS as readonly string[]).includes(options?.view ?? '') ? options!.view as CalendarView : 'list';
}

export function weatherView(options?: WidgetOptions): WeatherView {
  return (WEATHER_VIEWS as readonly string[]).includes(options?.view ?? '') ? options!.view as WeatherView : 'summary';
}

/** The saved view when it is one the meal plan draws; anything else is the week. */
export function familyMealsView(view?: WidgetOptions['view']): FamilyMealsView {
  return (FAMILY_MEALS_VIEWS as readonly string[]).includes(view ?? '') ? view as FamilyMealsView : 'full';
}

export function energyView(options?: WidgetOptions): EnergyView {
  return (ENERGY_VIEWS as readonly string[]).includes(options?.view ?? '') ? options!.view as EnergyView : 'summary';
}
