import type { CalendarView, DisplayLayout, WidgetOptions } from '../types';
import { newsFeedIdFromWidget } from './newsFeeds';
import { calendarIdFromWidget } from './calendarWidgets';
import { tickerIdFromWidget } from './tickerWidgets';

// Mirrors backend/src/utils/widgetOptions.ts. Options belong to one placement in a layout,
// so the same source can be shown differently on another scheduled page.
export const MAX_WIDGET_ITEMS = 10;
export const MAX_NEWS_COLUMNS = 4;
export const MIN_CALENDAR_DAYS = 2;
export const MAX_CALENDAR_DAYS = 7;
export const CALENDAR_VIEWS: readonly CalendarView[] = ['list', 'day', 'days', 'month'];

export type WidgetOptionKind = 'energy' | 'list' | 'calendar' | 'ticker' | 'ai-usage' | 'status';

/** Which options a widget accepts, or null when it has none. */
export function widgetOptionKind(widgetId: string): WidgetOptionKind | null {
  if (widgetId === 'energy') return 'energy';
  if (widgetId === 'calendar' || calendarIdFromWidget(widgetId)) return 'calendar';
  if (widgetId === 'news' || newsFeedIdFromWidget(widgetId)) return 'list';
  if (tickerIdFromWidget(widgetId)) return 'ticker';
  if (widgetId === 'ai-usage') return 'ai-usage';
  if (widgetId === 'status') return 'status';
  return null;
}

/** Every widget that draws with the text font can be zoomed; an image is placed by pixel instead. */
export function widgetAcceptsZoom(widgetId: string): boolean {
  return widgetId !== 'custom-image';
}

/**
 * Applies a change to one widget's options. A field set to undefined is removed, and a
 * widget left without options loses the property, so the saved layout stays minimal.
 */
export function updateWidgetOptions(layout: DisplayLayout, widgetId: string, change: WidgetOptions): DisplayLayout {
  return {
    ...layout,
    widgets: layout.widgets.map((widget) => {
      if (widget.i !== widgetId) return widget;
      const merged = { ...widget.options, ...change };
      const options = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined)) as WidgetOptions;
      const { options: _previous, ...rest } = widget;
      return Object.keys(options).length ? { ...rest, options } : rest;
    }),
  };
}
