// =========================================================================
// DashboardPage.tsx
// =========================================================================
import React, { useState, useEffect } from 'react';
import { useApp } from '../lib/appContext';
import { DisplayCard } from '../components/dashboard/DisplayCard';
import { ApiKeysCard } from '../components/dashboard/ApiKeysCard';
import { PreviewCard } from '../components/dashboard/PreviewCard';

export function DashboardPage() {
  const app = useApp();
  const t = app.t;
  const [prefsLoading, setPrefsLoading] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => setPrefsLoading(false), 950);
    return () => clearTimeout(id);
  }, []);

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
