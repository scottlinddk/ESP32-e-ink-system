import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePreferences, useSavePreferences } from '../../hooks/usePreferences';
import { DEFAULT_LAYOUT, DisplaySchedule } from '../../types';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { useApp } from '../../lib/appContext';

export function ScheduleCard() {
  const { lang } = useApp();
  const da = lang === 'da';
  const preferences = usePreferences();
  const save = useSavePreferences();
  const navigate = useNavigate();
  const [schedule, setSchedule] = useState<DisplaySchedule>({
    enabled: false, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', pages: [],
    quiet_hours: { enabled: false, start: '22:00', end: '07:00' },
  });
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!dirty && preferences.data?.display_schedule) setSchedule(preferences.data.display_schedule);
    if (!dirty && preferences.data && !preferences.data.display_schedule) setSchedule((current) => ({ ...current, enabled: false, pages: [] }));
  }, [preferences.data, dirty]);

  function update(next: DisplaySchedule) { setSchedule(next); setDirty(true); setSaved(false); setError(null); }
  function move(index: number, change: number) {
    const pages = [...schedule.pages];
    [pages[index], pages[index + change]] = [pages[index + change], pages[index]];
    update({ ...schedule, pages });
  }
  function add() {
    if (schedule.pages.length >= 12) return;
    update({ ...schedule, pages: [...schedule.pages, {
      id: crypto.randomUUID(), name: `${da ? 'Side' : 'Page'} ${schedule.pages.length + 1}`, duration_seconds: 900,
      layout: structuredClone(preferences.data?.layout ?? DEFAULT_LAYOUT),
    }] });
  }
  async function persist(editPageId?: string) {
    setError(null); setSaved(false);
    try {
      await save.mutateAsync({ display_schedule: schedule });
      setDirty(false); setSaved(true);
      if (editPageId) navigate(`/layout?page=${encodeURIComponent(editPageId)}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save schedule'); }
  }
  const disabled = save.isPending || preferences.isPending || preferences.isError;
  const inputClass = 'border border-divider rounded px-2 py-1 bg-transparent text-sm w-full';

  return (
    <Card icon="schedule" title={da ? 'Sider og tidsplan' : 'Pages and schedule'}
      desc={da ? 'Rotér gemte layouts, og sæt opdateringer på pause om natten.' : 'Rotate saved layouts and pause scheduled updates overnight.'}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-fg2 m-0">{da
          ? 'Tidsplanen vælger siden ved næste serverforespørgsel. Bluetooth kræver stadig et manuelt tryk; Wi-Fi-klienter skal følge den returnerede opdateringstid.'
          : 'The schedule selects the page on each server request. Bluetooth still needs a manual push; Wi-Fi clients must follow the returned refresh delay.'}</p>
        <fieldset disabled={disabled} className="border-0 p-0 m-0 flex flex-col gap-3">
          <label className="text-sm flex gap-2 items-center"><input type="checkbox" checked={schedule.enabled}
            onChange={(event) => update({ ...schedule, enabled: event.target.checked })} />{da ? 'Aktivér siderotation' : 'Enable page rotation'}</label>
          <label className="text-sm">{da ? 'Tidszone' : 'Time zone'}
            <input className={inputClass} maxLength={64} value={schedule.timezone} placeholder="Europe/Copenhagen"
              onChange={(event) => update({ ...schedule, timezone: event.target.value })} />
          </label>
          <label className="text-sm flex gap-2 items-center"><input type="checkbox" checked={schedule.quiet_hours.enabled}
            onChange={(event) => update({ ...schedule, quiet_hours: { ...schedule.quiet_hours, enabled: event.target.checked } })} />{da ? 'Aktivér stille timer' : 'Enable quiet hours'}</label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs">{da ? 'Start' : 'Start'}<input type="time" className={inputClass} value={schedule.quiet_hours.start}
              onChange={(event) => update({ ...schedule, quiet_hours: { ...schedule.quiet_hours, start: event.target.value } })} /></label>
            <label className="text-xs">{da ? 'Slut' : 'End'}<input type="time" className={inputClass} value={schedule.quiet_hours.end}
              onChange={(event) => update({ ...schedule, quiet_hours: { ...schedule.quiet_hours, end: event.target.value } })} /></label>
          </div>
          <p className="text-xs text-fg2 m-0">{da ? 'I stille timer beholdes siden fra starttidspunktet. Rotation fortsætter efter pausen.' : 'Quiet hours keep the page selected at the start. Rotation resumes after the pause.'}</p>
          {schedule.pages.map((page, index) => (
            <div key={page.id} className="border border-divider rounded-md p-3 flex flex-col gap-2">
              <div className="grid grid-cols-[1fr_120px] gap-3">
                <label className="text-xs">{da ? 'Sidenavnet' : 'Page name'}<input className={inputClass} maxLength={80} value={page.name}
                  onChange={(event) => update({ ...schedule, pages: schedule.pages.map((item) => item.id === page.id ? { ...item, name: event.target.value } : item) })} /></label>
                <label className="text-xs">{da ? 'Sekunder' : 'Seconds'}<input type="number" min={60} max={86400} step={1} className={inputClass} value={page.duration_seconds}
                  onChange={(event) => update({ ...schedule, pages: schedule.pages.map((item) => item.id === page.id ? { ...item, duration_seconds: Number(event.target.value) } : item) })} /></label>
              </div>
              <span className="text-xs text-fg3">{page.layout.widgets.map((widget) => widget.i).join(', ') || '—'}</span>
              <div className="flex flex-wrap gap-2">
                <Button variant="text" size="sm" disabled={index === 0 || disabled} onClick={() => move(index, -1)} aria-label={`Move ${page.name} up`}>↑</Button>
                <Button variant="text" size="sm" disabled={index === schedule.pages.length - 1 || disabled} onClick={() => move(index, 1)} aria-label={`Move ${page.name} down`}>↓</Button>
                <Button variant="outlined" size="sm" disabled={disabled} onClick={() => void persist(page.id)}>{da ? 'Gem og redigér layout' : 'Save and edit layout'}</Button>
                <Button variant="text" size="sm" disabled={disabled} onClick={() => update({ ...schedule, pages: schedule.pages.filter((item) => item.id !== page.id) })}>{da ? 'Fjern' : 'Remove'}</Button>
              </div>
            </div>
          ))}
          <Button variant="outlined" size="sm" disabled={schedule.pages.length >= 12 || disabled} onClick={add}>{da ? 'Tilføj det gemte layout som side' : 'Add saved layout as page'}</Button>
          <Button disabled={disabled || !dirty} loading={save.isPending} onClick={() => void persist()}>{da ? 'Gem tidsplan' : 'Save schedule'}</Button>
        </fieldset>
        {preferences.isError && <p role="alert" className="text-xs text-warning">{da ? 'Kunne ikke hente indstillinger.' : 'Could not load saved settings.'}</p>}
        {error && <p role="alert" className="text-xs text-warning m-0">{error}</p>}
        {saved && <p role="status" className="text-xs m-0">{da ? 'Tidsplan gemt' : 'Schedule saved'}</p>}
      </div>
    </Card>
  );
}
