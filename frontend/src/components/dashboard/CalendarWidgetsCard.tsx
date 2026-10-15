import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { usePreferences, useSavePreferences } from '../../hooks/usePreferences';
import { useApp } from '../../lib/appContext';
import { deleteCalendarWidgetCredential, getCalendarWidgetCredentialStatus, saveCalendarWidgetCredential } from '../../lib/api';
import { CALENDAR_NAME_MAX, emptyCalendar, MAX_CALENDAR_WIDGETS, saveCalendarChanges } from '../../lib/calendarWidgets';
import type { CalendarWidgetSetting } from '../../types';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Field } from '../ui/Field';
import { Input, PasswordInput } from '../ui/input';

/** The calendars to show: the unsaved edit while there is one, else the saved list. */
export function calendarWidgetsFormState(saved: readonly CalendarWidgetSetting[] | undefined, draft: CalendarWidgetSetting[] | null): CalendarWidgetSetting[] {
  return draft ?? [...(saved ?? [])];
}

/** Additional calendars. Each one becomes its own widget in the layout editor. */
export function CalendarWidgetsCard() {
  const { user, isSignedIn } = useAuth();
  return isSignedIn && user ? <CalendarWidgetsContent key={user.id} /> : null;
}

function CalendarWidgetsContent() {
  const { lang } = useApp();
  const da = lang === 'da';
  const { getToken, isSignedIn, user } = useAuth();
  const queryClient = useQueryClient();
  const preferences = usePreferences();
  const savePreferences = useSavePreferences();
  const [draft, setDraft] = useState<CalendarWidgetSetting[] | null>(null);
  // Private URLs stay only in these unsaved inputs, never in app or local storage.
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const calendars = calendarWidgetsFormState(preferences.data?.calendar_widgets, draft);
  const loaded = !!preferences.data && !preferences.isPending && !preferences.isError;
  const token = async () => {
    const value = await getToken();
    if (!value) throw new Error(da ? 'Log ind igen' : 'Please sign in again');
    return value;
  };
  const statusKey = ['calendar-widget-credentials', user?.id];
  const status = useQuery({
    queryKey: statusKey, enabled: isSignedIn,
    queryFn: async () => getCalendarWidgetCredentialStatus(await token()),
  });
  const stored = new Set(Array.isArray(status.data?.configured) ? status.data.configured : []);
  const dirty = draft !== null || Object.values(urls).some((value) => value.trim() !== '');
  const defaultTimezone = preferences.data?.calendar_timezone ?? 'Europe/Copenhagen';

  function edit(next: CalendarWidgetSetting[]) { setDraft(next); setMessage(''); }
  function update(id: string, patch: Partial<CalendarWidgetSetting>) { edit(calendars.map((calendar) => calendar.id === id ? { ...calendar, ...patch } : calendar)); }
  function remove(id: string) {
    edit(calendars.filter((calendar) => calendar.id !== id));
    setUrls(({ [id]: _removed, ...rest }) => rest);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!loaded || !dirty || busy) return;
    setBusy(true); setMessage('');
    const submitted = draft;
    try {
      const { rejected, failures } = await saveCalendarChanges({
        calendars, listChanged: submitted !== null, urls,
        saveList: (list) => savePreferences.mutateAsync({ calendar_widgets: list }),
        saveUrl: async (id, url) => saveCalendarWidgetCredential(await token(), id, url),
      });
      setDraft((current) => current === submitted ? null : current);
      // A rejected URL stays in its input, so it can be corrected without typing it again.
      setUrls(rejected);
      void queryClient.invalidateQueries({ queryKey: statusKey });
      void queryClient.invalidateQueries({ queryKey: ['preview'] });
      setMessage(failures.length
        ? `${da ? 'Indstillinger gemt, men adressen blev afvist for' : 'Settings saved, but the URL was rejected for'}: ${failures.join('; ')}`
        : da ? 'Kalendere gemt' : 'Calendars saved');
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  async function removeUrl(id: string) {
    setBusy(true); setMessage('');
    try {
      await deleteCalendarWidgetCredential(await token(), id);
      void queryClient.invalidateQueries({ queryKey: statusKey });
      void queryClient.invalidateQueries({ queryKey: ['preview'] });
      setMessage(da ? 'Kalenderadresse fjernet' : 'Calendar URL removed');
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Card icon="calendar_add_on" title={da ? 'Flere kalendere' : 'Additional calendars'}
      desc={da ? 'Hver kalender bliver sin egen widget i layout-editoren.' : 'Each calendar becomes its own widget in the layout editor.'}>
      <form onSubmit={submit} className="grid gap-4">
        <p className="m-0 text-sm text-fg2">{da
          ? <>Tilføj en kalender pr. person, arbejde eller hold, og placér dem i <Link className="underline" to="/layout">layout-editoren</Link>. Vælg dér, om en kalender vises som liste, dag, flere dage eller måned. Adressen findes som beskrevet under Kalender ovenfor.</>
          : <>Add a calendar for each person, job or team and place them in the <Link className="underline" to="/layout">layout editor</Link>. Choose there whether a calendar shows as a list, a day, several days or a month. Find the URL as described under Calendar above.</>}</p>
        {preferences.isPending && <p role="status" className="text-sm m-0">{da ? 'Indlæser kalendere…' : 'Loading calendars…'}</p>}
        {(preferences.isError || !preferences.isPending && !preferences.data) && <div className="grid gap-2">
          <p role="alert" className="text-sm text-warning m-0">{da ? 'Kunne ikke indlæse kalendere. Prøv igen før du redigerer.' : 'Could not load calendars. Retry before editing.'}</p>
          <Button variant="outlined" onClick={() => { void preferences.refetch(); }} loading={preferences.isFetching}>{da ? 'Prøv igen' : 'Retry'}</Button>
        </div>}
        <fieldset disabled={!loaded || busy} className="border-0 p-0 m-0 grid gap-3 min-w-0">
          {calendars.map((calendar, index) => {
            const field = (name: string) => `calendar-widget-${calendar.id}-${name}`;
            const hasUrl = stored.has(calendar.id);
            return <fieldset key={calendar.id} className="grid gap-3 border border-divider rounded-md p-3 m-0 min-w-0">
              <legend className="sr-only">{da ? `Kalender ${index + 1}` : `Calendar ${index + 1}`}</legend>
              <div className="grid grid-cols-[2fr_2fr_1fr_1fr] gap-2.5 max-[820px]:grid-cols-2 max-[500px]:grid-cols-1">
                <Field label={da ? 'Navn (valgfrit)' : 'Name (optional)'} htmlFor={field('name')}>
                  <Input id={field('name')} maxLength={CALENDAR_NAME_MAX} value={calendar.name} placeholder={da ? 'Arbejde' : 'Work'}
                    onChange={(e) => update(calendar.id, { name: e.target.value })} />
                </Field>
                <Field label={da ? 'Tidszone (IANA)' : 'Time zone (IANA)'} htmlFor={field('timezone')}>
                  <Input id={field('timezone')} required maxLength={100} value={calendar.timezone} placeholder="Europe/Copenhagen"
                    onChange={(e) => update(calendar.id, { timezone: e.target.value })} />
                </Field>
                <Field label={da ? 'Dage frem (1–30)' : 'Days ahead (1–30)'} htmlFor={field('days')}>
                  <Input id={field('days')} type="number" min={1} max={30} required value={calendar.days}
                    onChange={(e) => update(calendar.id, { days: Number(e.target.value) })} />
                </Field>
                <Field label={da ? 'Aftaler (1–10)' : 'Events (1–10)'} htmlFor={field('limit')}>
                  <Input id={field('limit')} type="number" min={1} max={10} required value={calendar.item_limit}
                    onChange={(e) => update(calendar.id, { item_limit: Number(e.target.value) })} />
                </Field>
              </div>
              <Field label={da ? 'Privat HTTPS-kalenderadresse' : 'Private HTTPS calendar URL'} htmlFor={field('url')}
                helper={status.isError ? (da ? 'Kunne ikke indlæse status' : 'Could not load status')
                  : hasUrl ? (da ? 'Adresse gemt krypteret. Indtast en ny for at erstatte den.' : 'URL stored encrypted. Enter a new one to replace it.')
                    : (da ? 'Ingen adresse gemt endnu' : 'No URL saved yet')}>
                <PasswordInput id={field('url')} value={urls[calendar.id] ?? ''} lang={lang} autoComplete="new-password" placeholder="https://…/calendar.ics"
                  onChange={(e) => { setUrls({ ...urls, [calendar.id]: e.target.value }); setMessage(''); }} />
              </Field>
              <div className="flex flex-wrap gap-2">
                {hasUrl && <Button variant="danger-outlined" size="sm" onClick={() => { void removeUrl(calendar.id); }}>{da ? 'Fjern adresse' : 'Remove URL'}</Button>}
                <Button variant="text" size="sm" icon="delete" onClick={() => remove(calendar.id)}
                  aria-label={da ? `Fjern kalender ${index + 1}` : `Remove calendar ${index + 1}`}>{da ? 'Fjern kalender' : 'Remove calendar'}</Button>
              </div>
            </fieldset>;
          })}
          <div>
            <Button variant="outlined" icon="add" disabled={calendars.length >= MAX_CALENDAR_WIDGETS}
              onClick={() => edit([...calendars, emptyCalendar(calendars, defaultTimezone)])}>
              {da ? 'Tilføj kalender' : 'Add calendar'}
            </Button>
            {calendars.length >= MAX_CALENDAR_WIDGETS && <p className="text-xs text-fg3 m-0 mt-1.5">{da ? `Højst ${MAX_CALENDAR_WIDGETS} ekstra kalendere.` : `At most ${MAX_CALENDAR_WIDGETS} additional calendars.`}</p>}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={busy} disabled={!loaded || !dirty}>{da ? 'Gem kalendere' : 'Save calendars'}</Button>
          {message && <p role="status" className="m-0 text-sm">{message}</p>}
        </div>
        <p className="m-0 text-xs text-fg2">{da
          ? 'Gem, og tilføj derefter kalenderne til dit layout. En fjernet kalender tager sin adresse med sig; dens widget vises som utilgængelig, indtil den fjernes fra layoutet. Adresserne gemmes krypteret og vises aldrig igen.'
          : 'Save, then add the calendars to your layout. A removed calendar takes its URL with it; its widget shows as unavailable until removed from the layout. URLs are stored encrypted and never shown again.'}</p>
      </form>
    </Card>
  );
}
