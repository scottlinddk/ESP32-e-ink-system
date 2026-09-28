import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { usePreferences, useSavePreferences } from '../../hooks/usePreferences';
import { useApp } from '../../lib/appContext';
import { deleteCalendarCredential, getCalendarCredentialStatus, saveCalendarCredential } from '../../lib/api';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input, PasswordInput } from '../ui/input';
import { Switch } from '../ui/Switch';

export function CalendarCard() {
  const app = useApp();
  const da = app.lang === 'da';
  const { getToken, isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const { data: preferences, isLoading } = usePreferences();
  const save = useSavePreferences();
  const [enabled, setEnabled] = useState(false);
  const [timezone, setTimezone] = useState('Europe/Copenhagen');
  const [days, setDays] = useState(7);
  const [limit, setLimit] = useState(5);
  // A private URL stays only in this unsaved input, never app/localStorage state.
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!preferences) return;
    setEnabled(preferences.show_calendar ?? false);
    setTimezone(preferences.calendar_timezone ?? 'Europe/Copenhagen');
    setDays(preferences.calendar_days ?? 7);
    setLimit(preferences.calendar_item_limit ?? 5);
  }, [preferences]);
  const token = async () => {
    const value = await getToken();
    if (!value) throw new Error(da ? 'Log ind igen' : 'Please sign in again');
    return value;
  };
  const status = useQuery({
    queryKey: ['calendar-credentials'], enabled: isSignedIn,
    queryFn: async () => getCalendarCredentialStatus(await token()),
  });
  const credential = useMutation({
    mutationFn: async (remove: boolean) => remove
      ? deleteCalendarCredential(await token()) : saveCalendarCredential(await token(), url.trim()),
    onSuccess: (result) => {
      setUrl(''); queryClient.setQueryData(['calendar-credentials'], result);
      void queryClient.invalidateQueries({ queryKey: ['preview'] });
      setMessage(da ? 'Kalenderadresse opdateret' : 'Calendar URL updated');
    },
    onError: (error: Error) => setMessage(error.message),
  });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setMessage('');
    try {
      await save.mutateAsync({ show_calendar: enabled, calendar_timezone: timezone, calendar_days: days, calendar_item_limit: limit });
      setMessage(da ? 'Kalenderindstillinger gemt' : 'Calendar settings saved');
    } catch (error) { setMessage((error as Error).message); }
  };
  return (
    <Card icon="calendar_month" title={da ? 'Kalender' : 'Calendar'} desc={da ? 'Vis kommende aftaler fra et ICS-feed.' : 'Show upcoming events from an ICS feed.'}>
      <div className="grid gap-4">
        <form onSubmit={submit} className="grid gap-3">
          <label className="flex gap-3 items-center">
            <Switch checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={isLoading} label={da ? 'Aktivér kalender' : 'Enable calendar'} />
            {da ? 'Aktivér kalender' : 'Enable calendar'}
          </label>
          <label htmlFor="calendar-timezone" className="grid gap-1 text-sm">{da ? 'Tidszone' : 'Timezone'}
            <Input id="calendar-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} required placeholder="Europe/Copenhagen" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label htmlFor="calendar-days" className="grid gap-1 text-sm">{da ? 'Dage frem (1–30)' : 'Days ahead (1–30)'}
              <Input id="calendar-days" type="number" min={1} max={30} required value={days} onChange={(event) => setDays(Number(event.target.value))} />
            </label>
            <label htmlFor="calendar-limit" className="grid gap-1 text-sm">{da ? 'Aftaler (1–10)' : 'Events (1–10)'}
              <Input id="calendar-limit" type="number" min={1} max={10} required value={limit} onChange={(event) => setLimit(Number(event.target.value))} />
            </label>
          </div>
          <Button type="submit" loading={save.isPending} disabled={isLoading}>{da ? 'Gem indstillinger' : 'Save settings'}</Button>
        </form>
        <div className="border-t border-divider pt-4 grid gap-3">
          <p className="text-sm text-fg2 m-0">{status.isError ? (da ? 'Kunne ikke indlæse status' : 'Could not load status') : status.isPending ? (da ? 'Indlæser…' : 'Loading…') : status.data?.configured ? (da ? 'Kalenderadresse gemt krypteret' : 'Calendar URL stored encrypted') : (da ? 'Ingen kalenderadresse gemt' : 'No calendar URL saved')}</p>
          <label htmlFor="calendar-url" className="grid gap-1 text-sm">{da ? 'Privat HTTPS-kalenderadresse' : 'Private HTTPS calendar URL'}
            <PasswordInput id="calendar-url" value={url} onChange={(event) => setUrl(event.target.value)} lang={app.lang} autoComplete="new-password" placeholder="https://…/calendar.ics" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => credential.mutate(false)} loading={credential.isPending} disabled={!url.trim()}>{da ? 'Gem adresse' : 'Save URL'}</Button>
            {status.data?.configured && <Button variant="danger-outlined" disabled={credential.isPending} onClick={() => credential.mutate(true)}>{da ? 'Fjern adresse' : 'Remove URL'}</Button>}
          </div>
        </div>
        <p className="m-0 text-sm text-fg2">{da ? 'Tilføj Kalender i ' : 'Add Calendar in the '}<Link className="underline" to="/layout">{da ? 'layouteditoren' : 'layout editor'}</Link>{da ? '. Større felter giver plads til flere aftaler.' : '. Larger widgets fit more events.'}</p>
        {message && <p role="status" className="m-0 text-sm">{message}</p>}
      </div>
    </Card>
  );
}
