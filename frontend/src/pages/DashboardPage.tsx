// =========================================================================
// DashboardPage.tsx
// =========================================================================
import React, { useEffect } from 'react';
import { useApp } from '../lib/appContext';
import { usePreferences } from '../hooks/usePreferences';
import { DisplayCard } from '../components/dashboard/DisplayCard';
import { ApiKeysCard } from '../components/dashboard/ApiKeysCard';
import { PreviewCard } from '../components/dashboard/PreviewCard';

export function DashboardPage() {
  const app = useApp();
  const t = app.t;
  const { isLoading: prefsLoading, data: serverPrefs } = usePreferences();

  // Sync API prefs into app context when they arrive (without overwriting unsaved local edits)
  useEffect(() => {
    if (!serverPrefs) return;
    app.setPrefs({
      energy: {
        on: serverPrefs.show_energy_price,
        zone: serverPrefs.energy_price_location || app.prefs.energy.zone,
      },
      weather: {
        on: serverPrefs.show_weather,
        location: serverPrefs.weather_location || app.prefs.weather.location,
      },
      news: {
        on: serverPrefs.show_news,
        lang: serverPrefs.news_language || app.prefs.news.lang,
        source: app.prefs.news.source,
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverPrefs]);

  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">{t.dashTitle}</h1>
        <p className="page__sub">{t.dashSub}</p>
      </header>
      <div className="dash-grid">
        <div className="dash-col">
          <DisplayCard loading={prefsLoading} />
          <ApiKeysCard />
        </div>
        <div className="preview-col">
          <PreviewCard />
        </div>
      </div>
    </div>
  );
}
