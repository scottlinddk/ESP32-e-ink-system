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
    <div className="max-w-[1180px] mx-auto px-6 pt-8 pb-20 animate-page-enter">
      <header className="mb-5">
        <h1 className="text-[2rem] font-light tracking-tight m-0 mb-1.5">{t.dashTitle}</h1>
        <p className="text-fg-2 text-base m-0">{t.dashSub}</p>
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)_380px] gap-5 items-start max-[1080px]:grid-cols-1">
        <div className="flex flex-col gap-5 min-w-0">
          <DisplayCard loading={prefsLoading} />
          <ApiKeysCard />
        </div>
        <div className="sticky top-[calc(64px+24px)]">
          <PreviewCard />
        </div>
      </div>
    </div>
  );
}
