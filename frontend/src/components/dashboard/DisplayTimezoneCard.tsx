import React, { useEffect, useState } from 'react';
import { usePreferences, useSavePreferences } from '../../hooks/usePreferences';
import { useApp } from '../../lib/appContext';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

const TIMEZONES = ['Europe/Copenhagen', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];

export function DisplayTimezoneCard({ deviceId }: { deviceId?: string }) {
  const { lang } = useApp();
  const da = lang === 'da';
  const preferences = usePreferences(deviceId);
  const save = useSavePreferences(deviceId);
  const [timezone, setTimezone] = useState('Europe/Copenhagen');
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (preferences.data && !dirty) setTimezone(preferences.data.display_timezone ?? 'Europe/Copenhagen');
  }, [preferences.data, dirty]);

  function change(value: string) { setTimezone(value); setDirty(true); setMessage(''); setError(''); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    try {
      await save.mutateAsync({ display_timezone: timezone.trim() });
      setDirty(false);
      setMessage(da ? 'Skærmens tidszone er gemt.' : 'Display time zone saved.');
    } catch (failure) { setError((failure as Error).message); }
  }
  const disabled = preferences.isPending || preferences.isError || save.isPending;

  return <Card icon="schedule" title={da ? 'Skærmens tidszone' : 'Display time zone'}
    desc={da ? 'Vælg tidszonen for statusuret på skærmen og tidspunktet i forhåndsvisningen.' : 'Choose the time zone for the display status clock and preview timestamp.'}>
    <form onSubmit={submit} className="grid gap-3">
      <fieldset disabled={disabled} className="border-0 p-0 m-0 grid gap-3">
        <label htmlFor="display-timezone" className="grid gap-1 text-sm">{da ? 'Tidszone (IANA)' : 'Time zone (IANA)'}
          <Input id="display-timezone" list="display-timezones" maxLength={64} required value={timezone}
            onChange={(event) => change(event.target.value)} placeholder="Europe/Copenhagen" />
        </label>
        <datalist id="display-timezones">{TIMEZONES.map((zone) => <option key={zone} value={zone} />)}</datalist>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outlined" onClick={() => change(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Copenhagen')}>
            {da ? 'Brug browserens tidszone' : 'Use browser time zone'}
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!dirty || disabled}>{da ? 'Gem tidszone' : 'Save time zone'}</Button>
        </div>
      </fieldset>
      <p className="text-xs text-fg2 m-0">{da
        ? 'Sommertid håndteres automatisk. Kalender og stille timer har hver deres tidszone i deres indstillinger.'
        : 'Daylight saving time is automatic. Calendar and quiet hours each have their own time zone settings.'}</p>
      {preferences.isError && <p role="alert">{da ? 'Kunne ikke indlæse tidszonen.' : 'Could not load the saved time zone.'}</p>}
      {error && <p role="alert" className="text-sm text-warning m-0">{error}</p>}
      {message && <p role="status" className="text-sm m-0">{message}</p>}
    </form>
  </Card>;
}
