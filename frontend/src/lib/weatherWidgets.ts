// Mirrors backend/src/utils/weatherWidgets.ts. A layout holds each widget once, so showing the
// weather several ways at once takes more placements. They share one location and key; each has
// its own view. `weather` is the original, the others only exist in layouts.
export const WEATHER_WIDGET_IDS = ['weather', 'weather:2', 'weather:3', 'weather:4'] as const;

export function isWeatherWidget(widgetId: string): boolean {
  return (WEATHER_WIDGET_IDS as readonly string[]).includes(widgetId);
}

/** `Weather`, `Weather (2)`, `Weather (3)`, in the language of the editor. */
export function weatherWidgetLabel(widgetId: string, name: string): string {
  const index = WEATHER_WIDGET_IDS.indexOf(widgetId as typeof WEATHER_WIDGET_IDS[number]);
  return index > 0 ? `${name} (${index + 1})` : name;
}
