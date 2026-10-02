import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { usePreferences, useSavePreferences } from '../../hooks/usePreferences';
import { useApp } from '../../lib/appContext';
import { deleteCalendarCredential, getCalendarCredentialStatus, saveCalendarCredential } from '../../lib/api';
import type { UserPreferences } from '../../types';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input, PasswordInput } from '../ui/input';
import { Switch } from '../ui/Switch';

type CalendarSettings = Required<Pick<UserPreferences, 'show_calendar' | 'calendar_timezone' | 'calendar_days' | 'calendar_item_limit'>>;

// An edited form owns its values until saved, even if another integration updates preferences.
export function calendarFormSettings(preferences: Partial<UserPreferences> | undefined, draft: CalendarSettings | null): CalendarSettings {
  return draft ?? {
    show_calendar: preferences?.show_calendar ?? false,
    calendar_timezone: preferences?.calendar_timezone ?? 'Europe/Copenhagen',
    calendar_days: preferences?.calendar_days ?? 7,
    calendar_item_limit: preferences?.calendar_item_limit ?? 5,
  };
}

export function CalendarCard() {
  const { user, isSignedIn } = useAuth();
  return isSignedIn && user ? <CalendarCardContent key={user.id} /> : null;
}

function CalendarCardContent() {
  const app = useApp();
  const da = app.lang === 'da';
  const { getToken, isSignedIn, user } = useAuth();
  const queryClient = useQueryClient();
  const preferences = usePreferences();
  const save = useSavePreferences();
  const [draft, setDraft] = useState<CalendarSettings | null>(null);
  const settings = calendarFormSettings(preferences.data, draft);
  // A private URL stays only in this unsaved input, never app/localStorage state.
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState('');
  const disabled = !preferences.data || preferences.isPending || preferences.isError || save.isPending;
  function change(patch: Partial<CalendarSettings>) { setDraft({ ...settings, ...patch }); setMessage(''); }
  const token = async () => {
    const value = await getToken();
    if (!value) throw new Error(da ? 'Log ind igen' : 'Please sign in again');
    return value;
  };
  const status = useQuery({
    queryKey: ['calendar-credentials', user?.id], enabled: isSignedIn,
    queryFn: async () => getCalendarCredentialStatus(await token()),
  });
  const credential = useMutation({
    mutationFn: async (remove: boolean) => remove
      ? deleteCalendarCredential(await token()) : saveCalendarCredential(await token(), url.trim()),
    onSuccess: (result) => {
      setUrl(''); queryClient.setQueryData(['calendar-credentials', user?.id], result);
      void queryClient.invalidateQueries({ queryKey: ['preview'] });
      setMessage(da ? 'Kalenderadresse opdateret' : 'Calendar URL updated');
    },
    onError: (error: Error) => setMessage(error.message),
  });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled || !draft) return;
    setMessage('');
    const submitted = draft;
    try {
      await save.mutateAsync(submitted);
      setDraft((current) => current === submitted ? null : current);
      setMessage(da ? 'Kalenderindstillinger gemt' : 'Calendar settings saved');
    } catch (error) { setMessage((error as Error).message); }
  };
  return (
    <Card icon="calendar_month" title={da ? 'Kalender' : 'Calendar'} desc={da ? 'Vis kommende aftaler fra et ICS-feed.' : 'Show upcoming events from an ICS feed.'}>
      <div className="grid gap-4">
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">{da ? 'Find din kalenderadresse' : 'Find your calendar URL'}</summary>
          <ul className="pl-5 grid gap-2">
            <li><strong>Google Calendar:</strong> {da ? 'Indstillinger → vælg kalender → Integrer kalender → Hemmelig adresse i iCal-format.' : 'Settings → choose calendar → Integrate calendar → Secret address in iCal format.'} <a className="underline" href="https://support.google.com/calendar/answer/37648?hl=en-GB" target="_blank" rel="noreferrer">{da ? 'Google-vejledning' : 'Google guide'}</a></li>
            <li><strong>Outlook:</strong> {da ? 'Indstillinger → Kalender → Delte kalendere → Udgiv en kalender. Kopiér ICS-linket.' : 'Settings → Calendar → Shared calendars → Publish a calendar. Copy the ICS link.'} <a className="underline" href="https://support.microsoft.com/en-us/outlook/sharing/share-an-outlook-calendar-as-view-only-with-others" target="_blank" rel="noreferrer">{da ? 'Microsoft-vejledning' : 'Microsoft guide'}</a></li>
            <li><strong>iCloud:</strong> {da ? 'Åbn kalenderens deling, slå Offentlig kalender til og kopiér linket. Skift webcal:// til https:// før du gemmer.' : 'Open calendar sharing, enable Public Calendar and copy the link. Change webcal:// to https:// before saving.'} <a className="underline" href="https://support.apple.com/en-in/guide/icloud/mm6b1a9479/icloud" target="_blank" rel="noreferrer">{da ? 'Apple-vejledning' : 'Apple guide'}</a></li>
          </ul>
          <p className="text-xs text-fg2">{da ? 'Alle med linket kan læse kalenderen. Hold adressen privat; iCloud og Outlook kræver udgivelse med de valgte delingsrettigheder. Adressen gemmes krypteret her.' : 'Anyone with the link can read the calendar. Keep the URL private; iCloud and Outlook require publishing with your chosen sharing permissions. The URL is stored encrypted here.'}</p>
        </details>
        <form onSubmit={submit} className="grid gap-3">
          <fieldset disabled={disabled} className="border-0 p-0 m-0 grid gap-3">
            <label className="flex gap-3 items-center">
              <Switch checked={settings.show_calendar} onChange={(event) => change({ show_calendar: event.target.checked })} label={da ? 'Aktivér kalender' : 'Enable calendar'} />
              {da ? 'Aktivér kalender' : 'Enable calendar'}
            </label>
            <label htmlFor="calendar-timezone" className="grid gap-1 text-sm">{da ? 'Kalenderens tidszone (IANA)' : 'Calendar time zone (IANA)'}
              <Input id="calendar-timezone" value={settings.calendar_timezone} onChange={(event) => change({ calendar_timezone: event.target.value })} required maxLength={100} placeholder="Europe/Copenhagen" />
            </label>
            <p className="text-xs text-fg2 m-0">{da ? 'Brug f.eks. Europe/Copenhagen eller UTC. Gælder aftaletider og er uafhængig af skærmens statusur.' : 'Use e.g. Europe/Copenhagen or UTC. Used for event times, independently of the display status clock.'}</p>
            <div className="grid grid-cols-2 gap-3">
              <label htmlFor="calendar-days" className="grid gap-1 text-sm">{da ? 'Dage frem (1–30)' : 'Days ahead (1–30)'}
                <Input id="calendar-days" type="number" min={1} max={30} required value={settings.calendar_days} onChange={(event) => change({ calendar_days: Number(event.target.value) })} />
              </label>
              <label htmlFor="calendar-limit" className="grid gap-1 text-sm">{da ? 'Aftaler (1–10)' : 'Events (1–10)'}
                <Input id="calendar-limit" type="number" min={1} max={10} required value={settings.calendar_item_limit} onChange={(event) => change({ calendar_item_limit: Number(event.target.value) })} />
              </label>
            </div>
            <Button type="submit" loading={save.isPending} disabled={disabled || !draft}>{da ? 'Gem indstillinger' : 'Save settings'}</Button>
          </fieldset>
          {preferences.isPending && <p role="status" className="text-sm m-0">{da ? 'Indlæser kalenderindstillinger…' : 'Loading calendar settings…'}</p>}
          {(preferences.isError || !preferences.isPending && !preferences.data) && <div className="grid gap-2">
            <p role="alert" className="text-sm text-warning m-0">{da ? 'Kunne ikke indlæse kalenderindstillinger. Prøv igen før du redigerer.' : 'Could not load calendar settings. Retry before editing.'}</p>
            <Button variant="outlined" onClick={() => { void preferences.refetch(); }} loading={preferences.isFetching}>{da ? 'Prøv igen' : 'Retry'}</Button>
          </div>}
        </form>
        <div className="border-t border-divider pt-4 grid gap-3">
          <p className="text-sm text-fg2 m-0">{status.isError ? (da ? 'Kunne ikke indlæse status' : 'Could not load status') : status.isPending ? (da ? 'Indlæser…' : 'Loading…') : status.data?.configured ? (da ? 'Kalenderadresse gemt krypteret' : 'Calendar URL stored encrypted') : (da ? 'Ingen kalenderadresse gemt' : 'No calendar URL saved')}</p>
          {status.isError && <Button variant="outlined" onClick={() => { void status.refetch(); }} loading={status.isFetching}>{da ? 'Hent status igen' : 'Retry status'}</Button>}
          <label htmlFor="calendar-url" className="grid gap-1 text-sm">{da ? 'Privat HTTPS-kalenderadresse' : 'Private HTTPS calendar URL'}
            <PasswordInput id="calendar-url" value={url} onChange={(event) => setUrl(event.target.value)} lang={app.lang} autoComplete="new-password" placeholder="https://…/calendar.ics" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => credential.mutate(false)} loading={credential.isPending} disabled={!url.trim()}>{da ? 'Gem adresse' : 'Save URL'}</Button>
            {status.data?.configured && <Button variant="danger-outlined" disabled={credential.isPending} onClick={() => credential.mutate(true)}>{da ? 'Fjern adresse' : 'Remove URL'}</Button>}
          </div>
        </div>
        <p className="m-0 text-sm text-fg2">{da ? 'Gem adressen, aktivér kalenderen og gem indstillingerne. Tilføj derefter Kalender i ' : 'Save the URL, enable the calendar and save settings. Then add Calendar in the '}<Link className="underline" to="/layout">{da ? 'layouteditoren' : 'layout editor'}</Link>{da ? '. Større felter giver plads til flere aftaler.' : '. Larger widgets fit more events.'}</p>
        <p className="m-0 text-xs text-fg2">{da ? 'Understøtter HTTPS ICS med heldagsaftaler og daglige, ugentlige, månedlige eller årlige gentagelser. Kalenderen skal kunne læses via linket uden login. Brug UTC/IANA-tidszoner i feedet; Windows-tidszonenavne og avancerede gentagelser kan være utilgængelige.' : 'Supports HTTPS ICS with all-day events and daily, weekly, monthly or yearly recurrences. The link must work without a login. Use UTC/IANA time zones in the feed; Windows time zone names and advanced recurrence rules may be unavailable.'}</p>
        {message && <p role="status" className="m-0 text-sm">{message}</p>}
      </div>
    </Card>
  );
}
