import type { WidgetOptions } from '../types';
import { newsFeedIdFromWidget } from './newsFeeds';
import { tickerIdFromWidget } from './tickerWidgets';

// Per-placement display options, stored on a layout widget. They change how a widget is
// drawn, never what is fetched, so a scheduled page can show the same source differently.
// Mirrored in frontend/src/lib/widgetOptions.ts.

export const ENERGY_VIEWS = ['summary', 'day', 'rest'] as const;
export type EnergyView = typeof ENERGY_VIEWS[number];
export const TICKER_VIEWS = ['full', 'condensed'] as const;
export const MAX_WIDGET_ITEMS = 10;

export type WidgetOptionKind = 'energy' | 'list' | 'ticker';

/** Which options a widget accepts, or null when it has none. */
export function widgetOptionKind(widgetId: string): WidgetOptionKind | null {
  if (widgetId === 'energy') return 'energy';
  if (widgetId === 'news' || widgetId === 'calendar' || newsFeedIdFromWidget(widgetId)) return 'list';
  if (tickerIdFromWidget(widgetId)) return 'ticker';
  return null;
}

const ALLOWED_KEYS: Record<WidgetOptionKind, readonly string[]> = {
  energy: ['view'],
  list: ['items'],
  ticker: ['view', 'items'],
};

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
  if (!kind || !isRecord(value)) throw new Error('This widget has no display options.');
  if (Object.keys(value).some((key) => !ALLOWED_KEYS[kind].includes(key))) {
    throw new Error('Widget options contain unsupported fields.');
  }
  const options: WidgetOptions = {};
  if (value.view !== undefined) {
    const views: readonly string[] = kind === 'energy' ? ENERGY_VIEWS : TICKER_VIEWS;
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
