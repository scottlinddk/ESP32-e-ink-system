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
  const { data: serverPrefs, isLoading } = usePreferences();

  // Sync server preferences into context on first successful load
  useEffect(() => {
    if (serverPrefs) {
      app.setPrefs(serverPrefs as typeof app.prefs);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverPrefs]);

  return (
    <div className="max-w-[1180px] mx-auto px-6 pt-6 pb-20 animate-fade-up max-[820px]:px-4 max-[820px]:pt-5 max-[820px]:pb-16">
      <header className="mb-5">
        <h1 className="text-h2 font-light tracking-tight m-0 mb-1.5">{t.dashTitle}</h1>
        <p className="text-fg2 text-body m-0">{t.dashSub}</p>
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)_380px] gap-5 items-start max-[1080px]:grid-cols-1">
        <div className="flex flex-col gap-5 min-w-0">
          <DisplayCard loading={isLoading} />
          <ApiKeysCard />
        </div>
        <div className="max-[1080px]:static max-[1080px]:order-first sticky top-[calc(64px+var(--space-5))]">
          <PreviewCard />
        </div>
      </div>
    </div>
  );
}
