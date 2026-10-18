import React, { useRef, useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { usePreferences, useSavePreferences } from '../../hooks/usePreferences';
import { useApp } from '../../lib/appContext';
import { getPreferences } from '../../lib/api';
import { savedDeviceSchedule } from '../../lib/deviceSlideshow';
import {
  DURATION_UNITS, MAX_TIMED_LAYOUTS, MAX_TIMED_SECONDS, MIN_TIMED_SECONDS, TimedLayoutConflictError,
  newTimedLayout, savedTimedLayouts, splitDuration, timedLayoutChanges, toSeconds, type DurationUnit,
} from '../../lib/deviceTimedLayouts';
import type { TimedLayout } from '../../types';
import { Card } from '../ui/card';
import { Button } from '../ui/button';

const UNIT_LABELS: Record<DurationUnit, { en: string; da: string }> = {
  seconds: { en: 'seconds', da: 'sekunder' }, minutes: { en: 'minutes', da: 'minutter' }, hours: { en: 'hours', da: 'timer' },
};

export function DeviceTimedLayoutsCard({ deviceId }: { deviceId: string }) {
  const { lang } = useApp();
  const da = lang === 'da';
  const { getToken } = useAuth();
  const query = usePreferences(deviceId);
  const save = useSavePreferences(deviceId);
  const [draft, setDraft] = useState<TimedLayout[] | null>(null);
  // The chosen unit is kept per rule; the duration itself is always stored in seconds.
  const [units, setUnits] = useState<Record<string, DurationUnit>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const schedule = savedDeviceSchedule(query.data);
  const rules = draft ?? savedTimedLayouts(query.data);
  const disabled = query.isPending || query.isError || !query.data || busy || save.isPending;
  const inputClass = 'border border-divider rounded px-3 py-2 bg-transparent text-sm w-full';
  const unitOf = (rule: TimedLayout) => units[rule.id] ?? splitDuration(rule.duration_seconds).unit;

  function update(next: TimedLayout[]) { setDraft(next); setNotice(''); setError(''); }
  function change(id: string, patch: Partial<TimedLayout>) { update(rules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule)); }
  async function reload() {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await query.refetch();
      if (result.isError) throw result.error;
      if (mounted.current) { setDraft(null); setUnits({}); }
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
      await save.mutateAsync(timedLayoutChanges(latest.preferences, draft));
      if (mounted.current) { setDraft(null); setUnits({}); setNotice(da ? 'Tidsstyrede layouts gemt.' : 'Timed layouts saved.'); }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof TimedLayoutConflictError && da
        ? 'Et gemt layout er fjernet. Genindlæs gemte indstillinger, før du redigerer tidsstyrede layouts igen.' : (failure as Error).message);
    } finally { if (mounted.current) setBusy(false); }
  }

  return <Card icon="schedule" title={da ? 'Tidsstyrede layouts' : 'Timed layouts'}
    desc={da ? 'Vis et gemt layout på et bestemt tidspunkt hver dag, i et bestemt stykke tid.' : 'Show a saved layout at a set time every day, for a set length of time.'}>
    {query.isPending && <p role="status">{da ? 'Indlæser tidsstyrede layouts…' : 'Loading timed layouts…'}</p>}
    {query.isError && <p role="alert">{da ? 'Kunne ikke hente enhedens indstillinger.' : 'Could not load this device’s settings.'}</p>}
    <form onSubmit={(event) => void persist(event)} className="grid gap-3">
      <fieldset disabled={disabled} className="border-0 p-0 m-0 grid gap-3">
        <p className="text-xs text-fg2 m-0">{da
          ? `Tiderne følger tidszonen ${schedule.timezone}, som du vælger under Slideshow. Et tidsstyret layout gælder både i Fast layout og i Slideshow, og slideshowet fortsætter bagefter. Et tidsstyret layout går forud for alt andet, også stille timer.`
          : `Times follow the ${schedule.timezone} time zone, which you choose under Slideshow. A timed layout applies in both Single layout and Slideshow, and the slideshow carries on afterwards. A timed layout overrules everything else, quiet hours included.`}</p>
        {!schedule.pages.length && <p className="text-sm m-0">{da ? 'Opret mindst ét layout under Gemte layouts for at tidsstyre det.' : 'Create at least one layout in Saved layouts to schedule it.'}</p>}
        {!rules.length && !!schedule.pages.length && <p className="text-sm m-0">{da ? 'Ingen tidsstyrede layouts endnu.' : 'No timed layouts yet.'}</p>}
        <ol className="list-none p-0 m-0 grid gap-2">
          {rules.map((rule, index) => {
            const unit = unitOf(rule);
            const amount = rule.duration_seconds / toSeconds(1, unit);
            return <li key={rule.id} className="border border-divider rounded p-3 grid gap-2">
              <label className="text-xs">{da ? 'Layout' : 'Layout'}<select className={inputClass} value={rule.layout_id}
                onChange={(event) => change(rule.id, { layout_id: event.target.value })}>
                {schedule.pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}
              </select></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs">{da ? 'Starter kl.' : 'Starts at'}<input type="time" className={inputClass} required value={rule.start}
                  aria-label={`${da ? 'Starttid' : 'Start time'} ${index + 1}`} onChange={(event) => change(rule.id, { start: event.target.value })} /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs">{da ? 'Varighed' : 'Duration'}<input type="number" className={inputClass} required step="any"
                    min={MIN_TIMED_SECONDS / toSeconds(1, unit)} max={MAX_TIMED_SECONDS / toSeconds(1, unit)} value={Number.isFinite(amount) ? amount : ''}
                    aria-label={`${da ? 'Varighed' : 'Duration'} ${index + 1}`}
                    onChange={(event) => change(rule.id, { duration_seconds: toSeconds(Number(event.target.value), unit) })} /></label>
                  <label className="text-xs">{da ? 'Enhed' : 'Unit'}<select className={inputClass} value={unit}
                    aria-label={`${da ? 'Enhed' : 'Unit'} ${index + 1}`}
                    onChange={(event) => setUnits({ ...units, [rule.id]: event.target.value as DurationUnit })}>
                    {DURATION_UNITS.map((item) => <option key={item} value={item}>{UNIT_LABELS[item][da ? 'da' : 'en']}</option>)}
                  </select></label>
                </div>
              </div>
              <div><Button size="sm" variant="text" onClick={() => update(rules.filter((item) => item.id !== rule.id))}
                aria-label={`${da ? 'Fjern tidsstyret layout' : 'Remove timed layout'} ${index + 1}`}>{da ? 'Fjern' : 'Remove'}</Button></div>
            </li>;
          })}
        </ol>
        <div><Button variant="outlined" disabled={disabled || !schedule.pages.length || rules.length >= MAX_TIMED_LAYOUTS}
          onClick={() => update([...rules, newTimedLayout(schedule.pages[0].id, crypto.randomUUID())])}>{da ? 'Tilføj tidsstyret layout' : 'Add timed layout'}</Button></div>
        <p className="text-xs text-fg2 m-0">{da
          ? '10 sekunder til 23 timer og 59 minutter. Overlapper to vinduer, vinder det der startede sidst. Enheden henter layoutet ved sin næste serverforespørgsel. Følger den serverens ventetid, vågner den ved start og slut, men en enhed der spørger sjældnere kan misse et kort vindue, og en sovende enhed kan ikke vækkes herfra. Bluetooth kræver et manuelt tryk.'
          : '10 seconds to 23 hours 59 minutes. If two windows overlap, the one that started last wins. The device picks the layout on its next server request. One that obeys the server’s refresh delay wakes for each start and end, but a device that polls less often can miss a short window, and a sleeping device cannot be woken here. Bluetooth needs a manual push.'}</p>
        <Button type="submit" loading={busy || save.isPending} disabled={disabled || !draft}>{da ? 'Gem tidsstyrede layouts' : 'Save timed layouts'}</Button>
      </fieldset>
      <Button variant="text" disabled={busy || query.isFetching} onClick={() => void reload()}>{da ? 'Genindlæs gemte indstillinger' : 'Reload saved settings'}</Button>
      {draft && <p role="status" className="text-xs m-0">{da ? 'Ændringerne er ikke gemt.' : 'Changes are not saved yet.'}</p>}
      {error && <p role="alert" className="text-sm text-warning m-0">{error}</p>}
      {notice && <p role="status" className="text-sm m-0">{notice}</p>}
    </form>
  </Card>;
}
