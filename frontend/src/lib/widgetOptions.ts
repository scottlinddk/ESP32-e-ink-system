import type { DisplayLayout, WidgetOptions } from '../types';
import { newsFeedIdFromWidget } from './newsFeeds';
import { tickerIdFromWidget } from './tickerWidgets';

// Mirrors backend/src/utils/widgetOptions.ts. Options belong to one placement in a layout,
// so the same source can be shown differently on another scheduled page.
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
