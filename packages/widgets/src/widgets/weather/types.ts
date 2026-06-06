export interface OpenWeatherResponse {
  main: { temp: number; feels_like: number; humidity: number };
  weather: Array<{ id: number; main: string; description: string; icon: string }>;
  wind: { speed: number; deg: number };
  name: string;
}

export interface WeatherWidgetData {
  temp: number;
  condition: string;
  windSpeed: number;
  icon: string;
  locationName: string;
}

export interface WeatherWidgetConfig {
  /** Latitude and longitude as "lat,lng", e.g. "55.3,10.4" */
  location: string;
  /** OpenWeatherMap API key (resolved from the user's stored keys by the caller) */
  apiKey: string;
}
