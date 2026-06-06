import { z } from 'zod';
import type { Widget, PixelRegion, TypographyScale, RenderedWidget, WidgetResult } from '@esp32-eink/types';
import type { WeatherWidgetConfig, WeatherWidgetData, OpenWeatherResponse } from './types';

const OWM_BASE_URL = 'https://api.openweathermap.org/data/2.5/weather';

export const configSchema = z.object({
  location: z.string().regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, 'Must be "lat,lng"'),
  apiKey: z.string().min(1),
});

const CONDITION_MAP: Record<string, string> = {
  Clear: 'clear',
  Clouds: 'cloudy',
  Rain: 'rain',
  Drizzle: 'drizzle',
  Thunderstorm: 'storm',
  Snow: 'snow',
  Mist: 'mist',
  Fog: 'fog',
  Haze: 'haze',
  Dust: 'dust',
  Smoke: 'smoke',
};

async function fetchWeatherData(
  location: string,
  apiKey: string
): Promise<WeatherWidgetData> {
  const [lat, lon] = location.split(',');
  const url = `${OWM_BASE_URL}?lat=${encodeURIComponent(lat.trim())}&lon=${encodeURIComponent(lon.trim())}&appid=${encodeURIComponent(apiKey)}&units=metric`;

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenWeatherMap API error: ${response.status} — ${body}`);
  }

  const json = (await response.json()) as OpenWeatherResponse;

  return {
    temp: Math.round(json.main.temp),
    condition: CONDITION_MAP[json.weather[0]?.main ?? ''] ?? json.weather[0]?.main?.toLowerCase() ?? 'unknown',
    windSpeed: Math.round(json.wind.speed),
    icon: json.weather[0]?.icon ?? '01d',
    locationName: json.name,
  };
}

export const weatherWidget: Widget<WeatherWidgetConfig, WeatherWidgetData> = {
  meta: {
    id: 'weather',
    name: 'Weather',
    description: 'Current weather conditions from OpenWeatherMap.',
    category: 'weather',
  },

  configSchema,

  async fetch(
    config: WeatherWidgetConfig,
    _region: PixelRegion
  ): Promise<WidgetResult<WeatherWidgetData>> {
    try {
      const data = await fetchWeatherData(config.location, config.apiKey);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  render(data: WeatherWidgetData, region: PixelRegion, typography: TypographyScale): RenderedWidget {
    const elements: RenderedWidget['elements'] = [];

    elements.push({
      kind: 'text',
      text: `${data.temp}°C`,
      x: 2,
      y: 2,
      fontSize: typography.xl,
    });
    elements.push({
      kind: 'text',
      text: data.condition,
      x: 2,
      y: typography.xl + 4,
      fontSize: typography.base,
    });

    if (region.heightPx >= 40) {
      elements.push({
        kind: 'text',
        text: `Wind: ${data.windSpeed} m/s`,
        x: 2,
        y: typography.xl + typography.base + 8,
        fontSize: typography.sm,
      });
    }

    return { region, elements };
  },
};
