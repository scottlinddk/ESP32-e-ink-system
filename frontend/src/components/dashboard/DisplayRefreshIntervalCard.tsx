import React, { useEffect, useState } from 'react';
import { usePreferences, useSavePreferences } from '../../hooks/usePreferences';
import { useApp } from '../../lib/appContext';
import { DEFAULT_REFRESH_INTERVAL_MINUTES, formatRefreshInterval, isSelectableRefreshInterval, refreshIntervalChoices } from '../../lib/refreshInterval';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Select } from '../ui/select';

export function DisplayRefreshIntervalCard({ deviceId }: { deviceId?: string }) {
  const { lang } = useApp();
  const da = lang === 'da';
  const preferences = usePreferences(deviceId);
  const save = useSavePreferences(deviceId);
  const saved = preferences.data?.refresh_interval_minutes;
  const [minutes, setMinutes] = useState(() => saved ?? DEFAULT_REFRESH_INTERVAL_MINUTES);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (preferences.data && !dirty) setMinutes(preferences.data.refresh_interval_minutes ?? DEFAULT_REFRESH_INTERVAL_MINUTES);
  }, [preferences.data, dirty]);

  function change(value: number) { setMinutes(value); setDirty(value !== saved); setMessage(''); setError(''); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    if (!isSelectableRefreshInterval(minutes)) { setError(da ? 'Vælg et interval mellem 5 og 60 minutter.' : 'Choose an interval between 5 and 60 minutes.'); return; }
    try {
      await save.mutateAsync({ refresh_interval_minutes: minutes });
      setDirty(false);
      setMessage(da ? 'Opdateringsintervallet er gemt.' : 'Refresh interval saved.');
    } catch (failure) { setError((failure as Error).message); }
  }
  const disabled = preferences.isPending || preferences.isError || save.isPending;
  const options = refreshIntervalChoices(saved).map((value) => ({
    value: String(value),
    label: isSelectableRefreshInterval(value) ? formatRefreshInterval(value, da) : `${formatRefreshInterval(value, da)} (${da ? 'nuværende' : 'current'})`,
  }));

  return <Card icon="update" title={da ? 'Opdateringsinterval' : 'Refresh interval'}
    desc={da ? 'Hvor ofte enheden henter nyt indhold og opdaterer skærmen.' : 'How often the device fetches new content and redraws the screen.'}>
    <form onSubmit={submit} className="grid gap-3">
      <fieldset disabled={disabled} className="border-0 p-0 m-0 grid gap-3">
        <label htmlFor="display-refresh-interval" className="grid gap-1 text-sm">{da ? 'Opdatér hver' : 'Refresh every'}
          <Select id="display-refresh-interval" value={String(minutes)} options={options} onChange={(event) => change(Number(event.target.value))} />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={save.isPending} disabled={!dirty || disabled}>{da ? 'Gem interval' : 'Save interval'}</Button>
        </div>
      </fieldset>
      <p className="text-xs text-fg2 m-0">{da
        ? 'Kortere intervaller bruger mere batteri. Den nye værdi gælder fra enhedens næste opdatering. Et slideshow kan skifte side tidligere.'
        : 'Shorter intervals use more battery. The new value applies from the device’s next check-in. A slideshow may switch pages sooner.'}</p>
      {preferences.isError && <p role="alert">{da ? 'Kunne ikke indlæse opdateringsintervallet.' : 'Could not load the saved refresh interval.'}</p>}
      {error && <p role="alert" className="text-sm text-warning m-0">{error}</p>}
      {message && <p role="status" className="text-sm m-0">{message}</p>}
    </form>
  </Card>;
}
