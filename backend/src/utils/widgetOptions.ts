import type { WidgetOptions } from '../types';
import { newsFeedIdFromWidget } from './newsFeeds';
import { tickerIdFromWidget } from './tickerWidgets';
import { isZoom, MAX_ZOOM, MIN_ZOOM } from './zoom';

// Per-placement display options, stored on a layout widget. They change how a widget is
// drawn, never what is fetched, so a scheduled page can show the same source differently.
// Mirrored in frontend/src/lib/widgetOptions.ts.

export const ENERGY_VIEWS = ['summary', 'day', 'rest'] as const;
export type EnergyView = typeof ENERGY_VIEWS[number];
export const TICKER_VIEWS = ['full', 'condensed'] as const;
export const AI_USAGE_VIEWS = TICKER_VIEWS;
export const MAX_WIDGET_ITEMS = 10;

export type WidgetOptionKind = 'energy' | 'list' | 'ticker' | 'ai-usage';

/** Which options a widget accepts, or null when it has none. */
export function widgetOptionKind(widgetId: string): WidgetOptionKind | null {
  if (widgetId === 'energy') return 'energy';
  if (widgetId === 'news' || widgetId === 'calendar' || newsFeedIdFromWidget(widgetId)) return 'list';
  if (tickerIdFromWidget(widgetId)) return 'ticker';
  if (widgetId === 'ai-usage') return 'ai-usage';
  return null;
}

const ALLOWED_KEYS: Record<WidgetOptionKind, readonly string[]> = {
  energy: ['view'],
  list: ['items'],
  ticker: ['view', 'items'],
  'ai-usage': ['view'],
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
    if (!isZoom(value.zoom)) throw new Error(`Widget zoom must be a whole number from ${MIN_ZOOM} to ${MAX_ZOOM}.`);
    options.zoom = value.zoom;
  }
  if (value.view !== undefined) {
    const views: readonly string[] = kind === 'energy' ? ENERGY_VIEWS : kind === 'ai-usage' ? AI_USAGE_VIEWS : TICKER_VIEWS;
    if (typeof value.view !== 'string' || !views.includes(value.view)) throw new Error('Widget view is not supported.');
    options.view = value.view as WidgetOptions['view'];
  }
  if (value.items !== undefined) {
    if (typeof value.items !== 'number' || !Number.isInteger(value.items) || value.items < 1 || value.items > MAX_WIDGET_ITEMS) {
      throw new Error(`Widget item count must be a whole number from 1 to ${MAX_WIDGET_ITEMS}.`);
    }
    options.items = value.items;
  }
  return Object.keys(options).length ? options : undefined;
}

export function energyView(options?: WidgetOptions): EnergyView {
  return (ENERGY_VIEWS as readonly string[]).includes(options?.view ?? '') ? options!.view as EnergyView : 'summary';
}
