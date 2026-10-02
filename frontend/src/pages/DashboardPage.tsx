import { DisplayProfileCard } from '../components/dashboard/DisplayProfileCard';
import { DisplayTimezoneCard } from '../components/dashboard/DisplayTimezoneCard';
// =========================================================================
// DashboardPage.tsx
// =========================================================================
import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../lib/appContext';
import { useAuth } from '../hooks/useAuth';
import { PreviewCard } from '../components/dashboard/PreviewCard';
import { TemplatesCard } from '../components/dashboard/TemplatesCard';
import { ScheduleCard } from '../components/dashboard/ScheduleCard';
import { CustomContentCard } from '../components/dashboard/CustomContentCard';
import { DeviceLayoutsCard } from '../components/dashboard/DeviceLayoutsCard';
import { usePreferences } from '../hooks/usePreferences';
import { getDevices } from '../lib/api';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';

export function DashboardPage() {
  const { user, isSignedIn } = useAuth();
  // Remount forms and discard in-memory credentials on a Clerk account switch.
  return isSignedIn && user ? <AccountDashboard key={user.id} /> : null;
}

function AccountDashboard() {
  const app = useApp();
  const t = app.t;
  const da = app.lang === 'da';
  const { getToken, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('device');
  const devices = useQuery({ queryKey: ['devices', user?.id], queryFn: async () => {
    const token = await getToken(); if (!token) throw new Error('Please sign in again.');
    return getDevices(token);
  } });
  const selected = devices.data?.devices.find((device) => device.id === selectedId);

  return (
    <div className="max-w-[1180px] mx-auto px-6 pt-6 pb-20 animate-fade-up max-[820px]:px-4 max-[820px]:pt-5 max-[820px]:pb-16">
      <header className="mb-5">
        <h1 className="text-h2 font-light tracking-tight m-0 mb-1.5">{t.dashTitle}</h1>
        <p className="text-fg2 text-body m-0">{t.dashSub}</p>
        <Link to="/integrations" className="inline-block mt-3 text-sm underline">{t.configureIntegrations}</Link>
      </header>
      <Card className="mb-5" title={da ? 'Vælg enhed' : 'Choose a device'}>
        <label className="text-sm grid gap-2">{da ? 'Enhed der redigeres og forhåndsvises' : 'Device to edit and preview'}
          <select className="border border-divider rounded px-3 py-2 bg-transparent" value={selectedId ?? ''} disabled={devices.isPending || devices.isError}
            onChange={(event) => { const next = new URLSearchParams(params); if (event.target.value) next.set('device', event.target.value); else next.delete('device'); setParams(next); }}>
            <option value="">{da ? 'Vælg en enhed…' : 'Select a device…'}</option>
            {selectedId && !selected && <option value={selectedId}>{da ? 'Enheden er ikke tilgængelig' : 'Device unavailable'}</option>}
            {devices.data?.devices.map((device) => <option key={device.id} value={device.id}>{device.device_name}</option>)}
          </select>
        </label>
        {devices.isPending && <p role="status">{t.loadingDevices}</p>}
        {devices.isError && <p role="alert">{t.devFetchError} <Button variant="text" onClick={() => void devices.refetch()}>{t.retry}</Button></p>}
        {!devices.isPending && !devices.isError && !selected && <p role={selectedId ? 'alert' : undefined} className="text-sm text-fg2">
          {selectedId ? (da ? 'Denne enhed findes ikke på din konto. Vælg en anden enhed.' : 'This device is not available on your account. Choose another device.')
            : (da ? 'Vælg en enhed for at se dens layouts og aktuelle forhåndsvisning.' : 'Choose a device to see its layouts and current preview.')} <Link to="/devices" className="underline">{t.nav.devices}</Link>
        </p>}
      </Card>
      {selected && !devices.isError && <DeviceWorkspace key={`${user?.id}:${selected.id}`} deviceId={selected.id} name={selected.device_name} />}
      <details className="mt-6 border border-divider rounded-md p-4">
        <summary className="cursor-pointer font-medium">{da ? 'Fælles indhold og standardindstillinger' : 'Shared content and defaults'}</summary>
        <p className="text-sm text-fg2">{da
          ? 'Datakilder, noter og billeder deles af kontoens enheder. Skabeloner og den fælles tidsplan ændrer standardindstillingerne for enheder, der endnu ikke har egne indstillinger.'
          : 'Data sources, notes and images are shared across your devices. Templates and the shared schedule change defaults for devices that do not yet have their own settings.'}</p>
        <Link to="/layout" className="text-sm underline">{da ? 'Redigér fælles grundlayout' : 'Edit shared base layout'}</Link>
        <div className="grid gap-5 mt-4"><CustomContentCard /><TemplatesCard /><ScheduleCard /></div>
      </details>
    </div>
  );
}

function DeviceWorkspace({ deviceId, name }: { deviceId: string; name: string }) {
  const { lang, t } = useApp();
  const query = usePreferences(deviceId);
  const da = lang === 'da';
  return <section aria-label={`${da ? 'Enhed' : 'Device'}: ${name}`}>
    <h2 className="text-h2 font-light mt-0">{name}</h2>
    <p className="text-sm text-fg2">{da ? 'Layouts, skærmprofil og tidszone her gælder kun denne enhed. Første gang du gemmer, kopieres kontoens standardindstillinger til enheden.' : 'Layouts, display profile and time zone here apply only to this device. Your first save copies the account defaults to this device.'}</p>
    {query.isPending ? <p role="status">{t.loading}</p> : query.isError || !query.data ? <p role="alert">{da ? 'Kunne ikke hente enhedens indstillinger.' : 'Could not load this device’s settings.'} <Button onClick={() => void query.refetch()}>{t.retry}</Button></p> :
      <div className="grid grid-cols-[minmax(0,1fr)_380px] gap-5 items-start max-[1080px]:grid-cols-1">
        <div className="flex flex-col gap-5 min-w-0"><DeviceLayoutsCard deviceId={deviceId} /><DisplayTimezoneCard deviceId={deviceId} /><DisplayProfileCard deviceId={deviceId} /></div>
        <div className="max-[1080px]:static max-[1080px]:order-first sticky top-[calc(64px+var(--space-5))]"><PreviewCard deviceId={deviceId} deviceName={name} /></div>
      </div>}
  </section>;
}
