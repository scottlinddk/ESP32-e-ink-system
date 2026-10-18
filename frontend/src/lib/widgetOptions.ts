import type { CalendarView, DisplayLayout, FamilyMealsView, WeatherView, WidgetOptions } from '../types';
import { newsFeedIdFromWidget } from './newsFeeds';
import { calendarIdFromWidget } from './calendarWidgets';
import { tickerIdFromWidget } from './tickerWidgets';
import { isWeatherWidget } from './weatherWidgets';

// Mirrors backend/src/utils/widgetOptions.ts. Options belong to one placement in a layout,
// so the same source can be shown differently on another scheduled page.
export const MAX_WIDGET_ITEMS = 10;
export const MAX_NEWS_COLUMNS = 4;
export const MIN_CALENDAR_DAYS = 2;
export const MAX_CALENDAR_DAYS = 7;
/** Calendar on/off options. Off is not stored. */
export const CALENDAR_FLAGS = ['descriptions', 'pills', 'clock12', 'footer'] as const;
export const CALENDAR_VIEWS: readonly CalendarView[] = ['list', 'day', 'days', 'month'];
export const WEATHER_VIEWS: readonly WeatherView[] = ['summary', 'current', 'hours', 'daily', 'details'];

export const FAMILY_MEALS_VIEWS: readonly FamilyMealsView[] = ['full', 'condensed', 'upcoming', 'planner', 'recipe'];

/** The saved view when the meal plan draws it; anything else, including no view, is the week. */
export function familyMealsView(view: string | undefined): FamilyMealsView {
  return (FAMILY_MEALS_VIEWS as readonly string[]).includes(view ?? '') ? view as FamilyMealsView : 'full';
}

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
