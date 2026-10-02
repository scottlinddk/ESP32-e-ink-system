import { DisplayProfileCard } from '../components/dashboard/DisplayProfileCard';
import { DisplayTimezoneCard } from '../components/dashboard/DisplayTimezoneCard';
// =========================================================================
// DashboardPage.tsx
// =========================================================================
import React from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/appContext';
import { useAuth } from '../hooks/useAuth';
import { PreviewCard } from '../components/dashboard/PreviewCard';
import { TemplatesCard } from '../components/dashboard/TemplatesCard';
import { ScheduleCard } from '../components/dashboard/ScheduleCard';
import { CustomContentCard } from '../components/dashboard/CustomContentCard';

export function DashboardPage() {
  const { user, isSignedIn } = useAuth();
  // Remount forms and discard in-memory credentials on a Clerk account switch.
  return isSignedIn && user ? <AccountDashboard key={user.id} /> : null;
}

function AccountDashboard() {
  const app = useApp();
  const t = app.t;

  return (
    <div className="max-w-[1180px] mx-auto px-6 pt-6 pb-20 animate-fade-up max-[820px]:px-4 max-[820px]:pt-5 max-[820px]:pb-16">
      <header className="mb-5">
        <h1 className="text-h2 font-light tracking-tight m-0 mb-1.5">{t.dashTitle}</h1>
        <p className="text-fg2 text-body m-0">{t.dashSub}</p>
        <Link to="/integrations" className="inline-block mt-3 text-sm underline">{t.configureIntegrations}</Link>
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)_380px] gap-5 items-start max-[1080px]:grid-cols-1">
        <div className="flex flex-col gap-5 min-w-0">
          <DisplayTimezoneCard />
          <CustomContentCard />
          <TemplatesCard />
          <ScheduleCard />
          <DisplayProfileCard />
        </div>
        <div className="max-[1080px]:static max-[1080px]:order-first sticky top-[calc(64px+var(--space-5))]">
          <PreviewCard />
        </div>
      </div>
    </div>
  );
}
