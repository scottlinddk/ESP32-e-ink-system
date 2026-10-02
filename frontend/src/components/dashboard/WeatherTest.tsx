import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useApiKeys } from '../../hooks/usePreferences';
import { useApp } from '../../lib/appContext';
import { testWeather } from '../../lib/api';
import { createWeatherTest, WeatherTestState } from '../../lib/weatherTest';
import { Button } from '../ui/button';

export function WeatherTest({ location }: { location: string }) {
  const { user, isSignedIn } = useAuth();
  const keys = useApiKeys();
  // Discard both results and in-flight work whenever their inputs change.
  return isSignedIn && user
    ? <AccountWeatherTest key={`${user.id}:${location}:${keys.dataUpdatedAt}`} location={location} /> : null;
}

function AccountWeatherTest({ location }: { location: string }) {
  const { t } = useApp();
  const { getToken } = useAuth();
  const [state, setState] = useState<WeatherTestState>({ status: 'idle' });
  const test = useMemo(() => createWeatherTest(setState), []);
  useEffect(() => () => test.dispose(), [test]);
  const format = new Intl.NumberFormat(t.locale, { maximumFractionDigits: 1 });
  function run() {
    void test.run(async (signal) => {
      const token = await getToken();
      signal.throwIfAborted();
      if (!token) throw new Error('Not authenticated');
      return (await testWeather(token, location, signal)).weather;
    });
  }
  return <div className="grid gap-2">
    <p className="text-xs text-fg2 m-0">{t.weatherTestHelp}</p>
    <Button variant="outlined" size="sm" onClick={run} loading={state.status === 'loading'}>
      {state.status === 'loading' ? t.weatherTesting : t.weatherTest}
    </Button>
    {state.status === 'error' && <p role="alert" className="text-xs text-warning m-0">{t.weatherErrors[state.code]}</p>}
    {state.status === 'success' && <p role="status" className="text-xs text-fg2 m-0">
      {t.weatherTestSuccess} {format.format(state.weather.temp)} °C · {state.weather.condition} · {format.format(state.weather.windSpeed)} m/s
    </p>}
  </div>;
}
