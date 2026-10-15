import type { DisplayLayout } from '../types';

// A layout holds each widget once, so showing the weather several ways at once (the current
// reading beside the forecast, say) takes more placements. They share the one location and key,
// and each has its own view. `weather` is the original; the others only exist in layouts.
export const WEATHER_WIDGET_IDS = ['weather', 'weather:2', 'weather:3', 'weather:4'] as const;
export const EXTRA_WEATHER_WIDGETS = WEATHER_WIDGET_IDS.length - 1;

export function isWeatherWidget(widgetId: string): boolean {
  return (WEATHER_WIDGET_IDS as readonly string[]).includes(widgetId);
}

/** The extra data a view draws, beyond the current reading every view has. */
// Keyed by the view names of WEATHER_VIEWS in widgetOptions.ts, which imports this file.
const NEEDS: Record<string, { forecast: boolean; air: boolean }> = {
  summary: { forecast: false, air: false },
  current: { forecast: false, air: false },
  hours: { forecast: true, air: false },
  daily: { forecast: true, air: false },
  details: { forecast: false, air: true },
};

/**
 * What the weather widgets of a layout need fetched. Each extra is a separate provider request, so
 * a layout that only draws the current reading never makes one: the default stays a single call.
 */
export function weatherNeeds(layout: DisplayLayout | null | undefined): { forecast: boolean; air: boolean } {
  const needs = { forecast: false, air: false };
  for (const widget of layout?.widgets ?? []) {
    if (!isWeatherWidget(widget.i)) continue;
    const view = NEEDS[widget.options?.view ?? 'summary'] ?? NEEDS.summary;
    needs.forecast ||= view.forecast;
    needs.air ||= view.air;
  }
  return needs;
}
