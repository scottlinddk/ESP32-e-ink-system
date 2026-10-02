import React, { useRef, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { usePreferences, useSavePreferences } from '../../hooks/usePreferences';
import { useApp } from '../../lib/appContext';
import { getPreferences } from '../../lib/api';
import { deviceLayoutPath } from '../../lib/deviceLayouts';
import { deviceSlideshowChanges, savedDeviceSchedule, SlideshowConflictError } from '../../lib/deviceSlideshow';
import type { DisplaySchedule } from '../../types';
import { Card } from '../ui/card';
import { Button } from '../ui/button';

export function DeviceSlideshowCard({ deviceId }: { deviceId: string }) {
  const { lang } = useApp();
  const da = lang === 'da';
  const { getToken } = useAuth();
  const query = usePreferences(deviceId);
  const save = useSavePreferences(deviceId);
  const [draft, setDraft] = useState<DisplaySchedule | null>(null);
  const [originalIds, setOriginalIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const saved = savedDeviceSchedule(query.data);
  const schedule = draft ?? saved;
  const fixedName = saved.pages.find((page) => page.id === query.data?.active_layout_id)?.name ?? (da ? 'Grundlayout' : 'Base layout');
  const disabled = query.isPending || query.isError || !query.data || busy || save.isPending;
  const inputClass = 'border border-divider rounded px-3 py-2 bg-transparent text-sm w-full';

  function update(next: DisplaySchedule) {
    if (!draft) setOriginalIds(saved.pages.map((page) => page.id));
    setDraft(next); setNotice(''); setError('');
  }
  function move(index: number, delta: number) {
    const pages = [...schedule.pages];
    [pages[index], pages[index + delta]] = [pages[index + delta], pages[index]];
    update({ ...schedule, pages });
  }
  async function reload() {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await query.refetch();
      if (result.isError) throw result.error;
      if (mounted.current) { setDraft(null); setOriginalIds([]); }
    } catch (failure) { if (mounted.current) setError((failure as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function persist(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || disabled) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const token = await getToken();
      if (!token) throw new Error(da ? 'Log ind igen.' : 'Please sign in again.');
      const latest = await getPreferences(token, deviceId);
      if (!mounted.current) return;
      await save.mutateAsync(deviceSlideshowChanges(latest.preferences, draft, originalIds));
      if (mounted.current) { setDraft(null); setOriginalIds([]); setNotice(da ? 'Visningstilstand gemt.' : 'Display mode saved.'); }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof SlideshowConflictError && da
        ? 'Gemte layouts er tilføjet eller fjernet. Genindlæs gemte indstillinger, før du redigerer slideshowet igen.' : (failure as Error).message);
    } finally { if (mounted.current) setBusy(false); }
  }

  return <Card icon="slideshow" title={da ? 'Visningstilstand og slideshow' : 'Display mode and slideshow'}
    desc={da ? 'Vælg et fast layout eller rotation af alle enhedens gemte layouts.' : 'Choose a single layout or rotate all saved layouts on this device.'}>
    {query.isPending && <p role="status">{da ? 'Indlæser visningstilstand…' : 'Loading display mode…'}</p>}
    {query.data && !query.isError && <p className="text-sm mt-0"><strong>{da ? 'Gemt tilstand: ' : 'Saved mode: '}</strong>{saved.enabled ? (da ? 'Slideshow' : 'Slideshow') : `${da ? 'Fast layout' : 'Single layout'} · ${fixedName}`}</p>}
    {query.isError && <p role="alert">{da ? 'Kunne ikke hente enhedens indstillinger.' : 'Could not load this device’s settings.'}</p>}
    <form onSubmit={(event) => void persist(event)} className="grid gap-3">
      <fieldset disabled={disabled} className="border-0 p-0 m-0 grid gap-3">
        <label className="text-sm">{da ? 'Visningstilstand' : 'Display mode'}<select className={inputClass} value={schedule.enabled ? 'slideshow' : 'single'}
          onChange={(event) => update({ ...schedule, enabled: event.target.value === 'slideshow' })}>
          <option value="single">{da ? 'Fast layout' : 'Single layout'}</option>
          <option value="slideshow" disabled={!schedule.pages.length}>Slideshow</option>
        </select></label>
        <p className="text-xs text-fg2 m-0">{da
          ? 'Alle gemte layouts indgår i slideshowet i rækkefølgen nedenfor. Tilføj, omdøb eller fjern layouts under Gemte layouts. Fast layout bruger dit senest valgte layout; vælg et andet under Gemte layouts.'
          : 'All saved layouts take part in the slideshow in the order below. Add, rename or remove layouts in Saved layouts. Single layout uses your last selected layout; choose another in Saved layouts.'}</p>
        {!schedule.pages.length && <p className="text-sm m-0">{da ? 'Opret mindst ét layout under Gemte layouts for at aktivere slideshow.' : 'Create at least one layout in Saved layouts to enable the slideshow.'}</p>}
        <h3 className="text-sm font-medium m-0">{da ? 'Rækkefølge og varighed' : 'Page order and duration'}</h3>
        <ol className="list-none p-0 m-0 grid gap-2">
          {schedule.pages.map((page, index) => <li key={page.id} className="border border-divider rounded p-3 grid gap-2">
            <span className="text-sm">{index + 1}. {page.name}</span>
            <label className="text-xs">{da ? 'Sekunder' : 'Seconds'}<input className={inputClass} type="number" required min={60} max={86400} step={1} value={page.duration_seconds}
              onChange={(event) => update({ ...schedule, pages: schedule.pages.map((item) => item.id === page.id ? { ...item, duration_seconds: Number(event.target.value) } : item) })} /></label>
            <div className="flex flex-wrap gap-2 items-center">
              <Button size="sm" variant="text" disabled={disabled || index === 0} aria-label={`${da ? 'Flyt op' : 'Move up'}: ${page.name}`} onClick={() => move(index, -1)}>↑</Button>
              <Button size="sm" variant="text" disabled={disabled || index === schedule.pages.length - 1} aria-label={`${da ? 'Flyt ned' : 'Move down'}: ${page.name}`} onClick={() => move(index, 1)}>↓</Button>
              <Link to={deviceLayoutPath(deviceId, page.id)} className="text-sm underline">{da ? 'Redigér layout' : 'Edit layout'}</Link>
            </div>
          </li>)}
        </ol>
        <p className="text-xs text-fg2 m-0">{da ? '60–86400 sekunder pr. layout. Enheden vælger den gemte side ved næste serverforespørgsel; en sovende enhed kan ikke vækkes herfra. Bluetooth kræver et manuelt tryk.'
          : '60–86400 seconds per layout. The device selects the saved page on its next server request; a sleeping device cannot be woken here. Bluetooth needs a manual push.'}</p>
        <label className="text-sm">{da ? 'Tidszone for stille timer' : 'Quiet-hours time zone'}<input className={inputClass} required maxLength={64} value={schedule.timezone} placeholder="Europe/Copenhagen"
          onChange={(event) => update({ ...schedule, timezone: event.target.value })} /></label>
        <label className="text-sm flex gap-2 items-center"><input type="checkbox" checked={schedule.quiet_hours.enabled}
          onChange={(event) => update({ ...schedule, quiet_hours: { ...schedule.quiet_hours, enabled: event.target.checked } })} />{da ? 'Aktivér stille timer' : 'Enable quiet hours'}</label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs">{da ? 'Start' : 'Start'}<input type="time" className={inputClass} required value={schedule.quiet_hours.start}
            onChange={(event) => update({ ...schedule, quiet_hours: { ...schedule.quiet_hours, start: event.target.value } })} /></label>
          <label className="text-xs">{da ? 'Slut' : 'End'}<input type="time" className={inputClass} required value={schedule.quiet_hours.end}
            onChange={(event) => update({ ...schedule, quiet_hours: { ...schedule.quiet_hours, end: event.target.value } })} /></label>
        </div>
        <p className="text-xs text-fg2 m-0">{da ? 'Stille timer gælder kun slideshow og sætter automatiske opdateringer på pause. Tidszonen er uafhængig af statusuret og kalenderen.'
          : 'Quiet hours apply only to slideshow and pause automatic updates. This time zone is independent of the display clock and calendar.'}</p>
        <Button type="submit" loading={busy || save.isPending} disabled={disabled || !draft}>{da ? 'Gem visningstilstand' : 'Save display mode'}</Button>
      </fieldset>
      <Button variant="text" disabled={busy || query.isFetching} onClick={() => void reload()}>{da ? 'Genindlæs gemte indstillinger' : 'Reload saved settings'}</Button>
      {draft && <p role="status" className="text-xs m-0">{da ? 'Ændringerne er ikke gemt.' : 'Changes are not saved yet.'}</p>}
      {error && <p role="alert" className="text-sm text-warning m-0">{error}</p>}
      {notice && <p role="status" className="text-sm m-0">{notice}</p>}
    </form>
  </Card>;
}
