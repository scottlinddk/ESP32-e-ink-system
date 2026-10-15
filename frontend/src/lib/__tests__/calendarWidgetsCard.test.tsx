import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarWidgetsCard, calendarWidgetsFormState } from '../../components/dashboard/CalendarWidgetsCard';
import { MAX_CALENDAR_WIDGETS } from '../calendarWidgets';
import type { CalendarWidgetSetting } from '../../types';

const session = vi.hoisted(() => ({
  userId: 'alice', signedIn: true, lang: 'en', pending: false, error: false, configured: ['work'] as unknown, statusError: false,
  data: undefined as Record<string, unknown> | undefined,
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: session.userId }, isSignedIn: session.signedIn, getToken: async () => 'token' }) }));
vi.mock('../../hooks/usePreferences', () => ({
  usePreferences: () => ({ data: session.data, isPending: session.pending, isError: session.error, isFetching: false, refetch: vi.fn() }),
  useSavePreferences: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: () => ({ data: session.statusError ? undefined : { configured: session.configured }, isPending: false, isError: session.statusError }),
}));
vi.mock('../appContext', () => ({ useApp: () => ({ lang: session.lang }) }));

const work: CalendarWidgetSetting = { id: 'work', name: 'Work', timezone: 'Europe/Copenhagen', days: 7, item_limit: 5 };
const home: CalendarWidgetSetting = { id: 'home', name: '', timezone: 'UTC', days: 14, item_limit: 3 };
const render = () => renderToStaticMarkup(<MemoryRouter><CalendarWidgetsCard /></MemoryRouter>);
beforeEach(() => {
  Object.assign(session, { userId: 'alice', signedIn: true, lang: 'en', pending: false, error: false, configured: ['work'], statusError: false, data: { calendar_widgets: [work, home], calendar_timezone: 'America/New_York' } });
});

describe('additional calendar form state', () => {
  it('shows the saved calendars until there is an unsaved edit, which survives refetches', () => {
    expect(calendarWidgetsFormState([work], null)).toEqual([work]);
    expect(calendarWidgetsFormState(undefined, null)).toEqual([]);
    const draft = [{ ...work, name: 'Edited' }];
    expect(calendarWidgetsFormState([work, home], draft)).toBe(draft);
    expect(calendarWidgetsFormState(undefined, draft)).toBe(draft);
  });
  it('never hands out the saved list itself, so an edit cannot change the cache', () => {
    const saved = [work];
    expect(calendarWidgetsFormState(saved, null)).not.toBe(saved);
  });
});

describe('additional calendars card', () => {
  it('renders a row for each saved calendar with its settings', () => {
    const html = render();
    expect(html).toContain('Additional calendars');
    expect(html).toContain('id="calendar-widget-work-name"');
    expect(html).toContain('value="Work"');
    expect(html).toContain('value="Europe/Copenhagen"');
    expect(html).toContain('id="calendar-widget-home-timezone"');
    expect(html).toContain('value="14"');
    expect(html).toContain('aria-label="Remove calendar 2"');
  });
  it('says which calendars have a stored URL, without ever showing it', () => {
    const html = render();
    expect(html).toContain('URL stored encrypted. Enter a new one to replace it.');
    expect(html).toContain('No URL saved yet');
    expect(html).toContain('Remove URL');
    expect(html.match(/Remove URL/g)).toHaveLength(1);
    expect(html).toMatch(/<input[^>]*id="calendar-widget-work-url"[^>]*type="password"[^>]*value=""|<input[^>]*type="password"[^>]*id="calendar-widget-work-url"[^>]*value=""/);
  });
  it('keeps the private URL inputs out of autofill', () => {
    expect(render().match(/autoComplete="new-password"/g)).toHaveLength(2);
  });
  it('disables Save until something changes', () => {
    expect(render()).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });
  it('offers to add a calendar, and links to the layout editor', () => {
    const html = render();
    expect(html).toContain('Add calendar');
    expect(html).toContain('href="/layout"');
    expect(html).not.toContain('At most 8 additional calendars.');
  });
  it('stops adding at the limit', () => {
    session.data = { calendar_widgets: Array.from({ length: MAX_CALENDAR_WIDGETS }, (_, n) => ({ ...work, id: `c${n}` })) };
    const html = render();
    expect(html).toContain('At most 8 additional calendars.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:<span[^>]*>add<\/span>)?Add calendar/);
  });
  it('shows an empty list as just the add button', () => {
    session.data = { calendar_widgets: [] };
    const html = render();
    expect(html).toContain('Add calendar');
    expect(html).not.toContain('Remove calendar');
  });
  it('treats preferences from before calendars existed as an empty list', () => {
    session.data = { show_calendar: true };
    expect(render()).not.toContain('Remove calendar');
  });
  it.each(['loading', 'error', 'missing'] as const)('disables editing while preferences are %s', (state) => {
    session.data = state === 'missing' ? undefined : session.data;
    session.pending = state === 'loading'; session.error = state === 'error';
    if (state !== 'missing') session.data = undefined;
    const html = render();
    expect(html).toMatch(/<fieldset disabled=""/);
    if (state === 'loading') expect(html).toContain('Loading calendars');
    else expect(html).toContain('Retry before editing');
  });
  it('copes with a status that cannot be loaded or has an unexpected shape', () => {
    session.statusError = true;
    expect(render()).toContain('Could not load status');
    session.statusError = false; session.configured = true;
    expect(render()).toContain('No URL saved yet');
  });
  it('is translated', () => {
    session.lang = 'da';
    const html = render();
    for (const text of ['Flere kalendere', 'Tidszone (IANA)', 'Privat HTTPS-kalenderadresse', 'Tilføj kalender', 'Gem kalendere', 'Fjern kalender']) expect(html).toContain(text);
  });
  it('is discarded on account changes and sign-out', () => {
    const alice = CalendarWidgetsCard()!.key;
    session.userId = 'bob';
    expect(CalendarWidgetsCard()!.key).not.toBe(alice);
    session.signedIn = false;
    expect(CalendarWidgetsCard()).toBeNull();
  });
});
