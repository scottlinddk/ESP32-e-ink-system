import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../lib/appContext';
import { useAuth } from '../hooks/useAuth';
import { usePreferences } from '../hooks/usePreferences';
import { getDevices } from '../lib/api';
import { deviceLayoutPath } from '../lib/deviceLayouts';
import { DEFAULT_DISPLAY_PROFILE } from '../lib/displayProfile';
import { PreviewCard } from '../components/dashboard/PreviewCard';
import { TemplatesCard } from '../components/dashboard/TemplatesCard';
import { ScheduleCard } from '../components/dashboard/ScheduleCard';
import { CustomContentCard } from '../components/dashboard/CustomContentCard';
import { DeviceLayoutsCard } from '../components/dashboard/DeviceLayoutsCard';
import { DeviceSlideshowCard } from '../components/dashboard/DeviceSlideshowCard';
import { DisplayProfileCard } from '../components/dashboard/DisplayProfileCard';
import { DisplayTimezoneCard } from '../components/dashboard/DisplayTimezoneCard';
import { DisplayRefreshIntervalCard } from '../components/dashboard/DisplayRefreshIntervalCard';
import { formatRefreshInterval } from '../lib/refreshInterval';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Icon } from '../components/ui/Logo';
import type { Device } from '../types';
import '../styles/dashboard.css';

export function DashboardPage() {
  const { user, isSignedIn } = useAuth();
  // Remount forms and discard in-memory credentials on a Clerk account switch.
  return isSignedIn && user ? <AccountDashboard key={user.id} /> : null;
}

function AccountDashboard() {
  const { t, lang } = useApp();
  const da = lang === 'da';
  const { getToken, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('device');
  const devices = useQuery({ queryKey: ['devices', user?.id], queryFn: async () => {
    const token = await getToken(); if (!token) throw new Error('Please sign in again.');
    return getDevices(token);
  } });
  const selected = devices.data?.devices.find((device) => device.id === selectedId);

  return (
    <div className="dashboard-page animate-fade-up">
      <header className="dashboard-heading">
        <div>
          <p className="dashboard-eyebrow">{da ? 'DIT DISPLAY-WORKSPACE' : 'YOUR DISPLAY WORKSPACE'}</p>
          <h1>{t.dashTitle}<span className="dashboard-heading-dot" aria-hidden="true" /></h1>
          <p className="dashboard-subtitle">{t.dashSub}</p>
        </div>
        <Link to="/integrations" className="dashboard-link-button"><Icon name="hub" />{t.configureIntegrations}<Icon name="arrow_outward" /></Link>
      </header>

      <section className="dashboard-device-picker" aria-label={da ? 'Vælg enhed' : 'Choose a device'}>
        <div className="dashboard-device-count">
          <span className="dashboard-icon-tile"><Icon name="cast" /></span>
          <div><span>{da ? 'Dine enheder' : 'Your devices'}</span><strong>{devices.isPending || devices.isError ? '—' : devices.data?.devices.length ?? 0}<small>{da ? 'registreret' : 'registered'}</small></strong></div>
        </div>
        <label className="dashboard-device-select">{da ? 'Enhed der redigeres og forhåndsvises' : 'Device to edit and preview'}
          <select className="select-native" value={selectedId ?? ''} disabled={devices.isPending || devices.isError}
            onChange={(event) => { const next = new URLSearchParams(params); if (event.target.value) next.set('device', event.target.value); else next.delete('device'); setParams(next); }}>
            <option value="">{da ? 'Vælg en enhed…' : 'Select a device…'}</option>
            {selectedId && !selected && <option value={selectedId}>{da ? 'Enheden er ikke tilgængelig' : 'Device unavailable'}</option>}
            {devices.data?.devices.map((device) => <option key={device.id} value={device.id}>{device.device_name} · {device.device_id} · {device.id.slice(0, 8)}</option>)}
          </select>
        </label>
        <Link to="/devices" className="dashboard-manage-link">{da ? 'Administrér enheder' : 'Manage devices'}<Icon name="arrow_forward" /></Link>
      </section>
      {devices.isPending && <p className="dashboard-notice" role="status">{t.loadingDevices}</p>}
      {devices.isError && <p className="dashboard-notice" role="alert">{t.devFetchError} <Button variant="text" onClick={() => void devices.refetch()}>{t.retry}</Button></p>}
      {!devices.isPending && !devices.isError && !selected && <section className="dashboard-empty" role={selectedId ? 'alert' : undefined}>
        <span className="dashboard-empty-art" aria-hidden="true"><Icon name="preview" /></span>
        <h2>{selectedId ? (da ? 'Vælg en tilgængelig enhed' : 'Choose an available device') : (da ? 'Et lille display. Dit eget overblik.' : 'A small display. Your big picture.')}</h2>
        <p>{selectedId ? (da ? 'Denne enhed findes ikke på din konto. Vælg en anden enhed.' : 'This device is not available on your account. Choose another device.')
          : (da ? 'Vælg en enhed for at se dens layouts og aktuelle forhåndsvisning.' : 'Choose a device to see its layouts and current preview.')}</p>
        <Link to="/devices" className="dashboard-link-button">{t.nav.devices}<Icon name="arrow_forward" /></Link>
      </section>}
      {selected && !devices.isError && <DeviceWorkspace key={`${user?.id}:${selected.id}`} device={selected} />}

      <details className="dashboard-shared">
        <summary><span><Icon name="folder_shared" />{da ? 'Fælles indhold og standardindstillinger' : 'Shared content and defaults'}</span><Icon name="expand_more" /></summary>
        <div className="dashboard-shared-body">
          <p>{da
            ? 'Datakilder, noter og billeder deles af kontoens enheder. Skabeloner og den fælles tidsplan ændrer standardindstillingerne for enheder, der endnu ikke har egne indstillinger.'
            : 'Data sources, notes and images are shared across your devices. Templates and the shared schedule change defaults for devices that do not yet have their own settings.'}</p>
          <Link to="/layout" className="dashboard-manage-link">{da ? 'Redigér fælles grundlayout' : 'Edit shared base layout'}<Icon name="arrow_outward" /></Link>
          <div className="grid gap-5 mt-4"><CustomContentCard /><TemplatesCard /><ScheduleCard /></div>
        </div>
      </details>
    </div>
  );
}

function DeviceWorkspace({ device }: { device: Device }) {
  const deviceId = device.id;
  const { lang, t } = useApp();
  const query = usePreferences(deviceId);
  const da = lang === 'da';
  const [view, setView] = useState('overview');
  const preferences = query.data;
  const pages = preferences?.display_schedule?.pages ?? [];
  const profile = preferences?.display_profile ?? DEFAULT_DISPLAY_PROFILE;
  const slideshow = preferences?.display_schedule?.enabled;
  const activeLayout = pages.find((page) => page.id === preferences?.active_layout_id);
  const quiet = preferences?.display_schedule?.quiet_hours;
  const lastSeen = device.last_seen_at ? new Date(device.last_seen_at) : null;
  const views = [
    { id: 'overview', icon: 'dashboard', label: da ? 'Overblik' : 'Overview' },
    { id: 'layouts', icon: 'grid_view', label: da ? 'Gemte layouts' : 'Saved layouts' },
    { id: 'slideshow', icon: 'slideshow', label: 'Slideshow' },
    { id: 'settings', icon: 'tune', label: da ? 'Skærmindstillinger' : 'Display settings' },
  ];

  return <section className="dashboard-workspace" aria-label={`${da ? 'Enhed' : 'Device'}: ${device.device_name}`}>
    <div className="dashboard-workspace-heading"><h2>{device.device_name}</h2><span>{da ? 'Enhedens workspace' : 'Device workspace'}</span></div>
    {query.isPending ? <p className="dashboard-notice" role="status">{t.loading}</p> : query.isError || !preferences ? <p className="dashboard-notice" role="alert">{da ? 'Kunne ikke hente enhedens indstillinger.' : 'Could not load this device’s settings.'} <Button onClick={() => void query.refetch()}>{t.retry}</Button></p> : <>
      <div className="dashboard-metrics">
        {[
          { icon: 'grid_view', label: da ? 'Gemte layouts' : 'Saved layouts', value: String(pages.length), detail: da ? 'Plus dit grundlayout' : 'Plus your base layout', tone: 'blue' },
          { icon: 'aspect_ratio', label: da ? 'Skærmopløsning' : 'Display resolution', value: `${profile.width} × ${profile.height}`, detail: `${profile.rotation}° · ${da ? 'Monokrom' : 'Monochrome'}`, tone: 'violet' },
          { icon: 'update', label: da ? 'Opdateringsinterval' : 'Refresh interval', value: preferences.refresh_interval_minutes ? formatRefreshInterval(preferences.refresh_interval_minutes, da) : '—', detail: da ? 'Gemt interval' : 'Saved refresh interval', tone: 'green' },
          { icon: 'slideshow', label: da ? 'Visningstilstand' : 'Display mode', value: slideshow ? 'Slideshow' : (da ? 'Fast layout' : 'Single layout'), detail: slideshow ? (da ? 'Rotation af gemte layouts' : 'Rotating saved layouts') : (activeLayout?.name ?? (da ? 'Grundlayout' : 'Base layout')), tone: 'peach' },
        ].map((metric) => <div className={`dashboard-metric dashboard-metric--${metric.tone}`} key={metric.icon}>
          <div className="dashboard-metric-label"><span>{metric.label}</span><Icon name={metric.icon} /></div>
          <strong>{metric.value}</strong><span className="dashboard-metric-detail">{metric.detail}</span>
        </div>)}
      </div>

      <div className="dashboard-view-switcher" role="group" aria-label={da ? 'Workspace-visning' : 'Workspace view'}>
        {views.map((item) => <button type="button" key={item.id} aria-pressed={view === item.id} aria-controls={`workspace-${item.id}`} onClick={() => setView(item.id)}><Icon name={item.icon} />{item.label}</button>)}
      </div>

      {/* Keep panels mounted so switching views preserves unsaved form edits. */}
      <div id="workspace-overview" hidden={view !== 'overview'}>
        <div className="dashboard-overview-grid">
          <PreviewCard deviceId={deviceId} deviceName={device.device_name} hardwareId={device.device_id} expectedDeviceName={device.ble_name} />
          <div className="dashboard-overview-aside">
            <Card className="dashboard-details-card" icon="tune" title={da ? 'Dit display, indstillet' : 'Your display, at a glance'} desc={da ? 'Gemte indstillinger for denne enhed.' : 'Saved settings for this device.'}>
              <dl className="dashboard-details-list">
                <div><dt>{da ? 'Valgt fast layout' : 'Selected single layout'}</dt><dd>{activeLayout?.name ?? (da ? 'Grundlayout' : 'Base layout')}</dd></div>
                <div><dt>{da ? 'Skærmens tidszone' : 'Display time zone'}</dt><dd>{preferences.display_timezone ?? 'Europe/Copenhagen'}</dd></div>
                <div><dt>{da ? 'Stille timer' : 'Quiet hours'}</dt><dd>{slideshow && quiet?.enabled ? `${quiet.start}–${quiet.end}` : (da ? 'Fra' : 'Off')}{slideshow && quiet?.enabled && <small>{preferences.display_schedule?.timezone}</small>}</dd></div>
                <div><dt>Firmware</dt><dd>{device.firmware_version || (da ? 'Ikke rapporteret' : 'Not reported')}</dd></div>
                <div><dt>{da ? 'Seneste kontakt' : 'Last device report'}</dt><dd>{lastSeen && Number.isFinite(lastSeen.getTime()) ? <time dateTime={lastSeen.toISOString()}>{lastSeen.toLocaleString(t.locale)}</time> : (da ? 'Ikke rapporteret' : 'Not reported')}</dd></div>
              </dl>
              <button className="dashboard-text-button" type="button" onClick={() => setView('settings')}>{da ? 'Tilpas skærmindstillinger' : 'Adjust display settings'}<Icon name="arrow_forward" /></button>
            </Card>
            <div className="dashboard-layout-callout">
              <span className="dashboard-callout-icon" aria-hidden="true"><Icon name="grid_view" /></span>
              <h3>{da ? 'Gør plads til det vigtige.' : 'Make room for what matters.'}</h3>
              <p>{da ? 'Saml dine widgets i et layout, der passer til din hverdag.' : 'Bring your widgets together in a layout that fits your day.'}</p>
              <Link to={deviceLayoutPath(deviceId, activeLayout?.id)}>{t.layoutEditLayout}<Icon name="arrow_outward" /></Link>
            </div>
          </div>
        </div>
      </div>
      <div id="workspace-layouts" hidden={view !== 'layouts'}><DeviceLayoutsCard deviceId={deviceId} /></div>
      <div id="workspace-slideshow" hidden={view !== 'slideshow'}><DeviceSlideshowCard deviceId={deviceId} /></div>
      <div id="workspace-settings" hidden={view !== 'settings'}>
        <div className="dashboard-settings-grid"><DisplayRefreshIntervalCard deviceId={deviceId} /><DisplayTimezoneCard deviceId={deviceId} /><DisplayProfileCard deviceId={deviceId} /></div>
        <p className="dashboard-scope-note">{da ? 'Indstillingerne gælder kun denne enhed. Første gang du gemmer, kopieres kontoens standardindstillinger til enheden.' : 'Settings apply only to this device. Your first save copies the account defaults to this device.'}</p>
        <p className="dashboard-hardware-id">{da ? 'Hardware-ID' : 'Hardware ID'}: <code>{device.device_id}</code> · UUID: <code>{deviceId}</code></p>
      </div>
    </>}
  </section>;
}
