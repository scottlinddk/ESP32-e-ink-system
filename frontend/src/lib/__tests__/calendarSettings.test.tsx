import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarCard, calendarFormSettings } from '../../components/dashboard/CalendarCard';

const session = vi.hoisted(() => ({
  userId: 'alice', signedIn: true, lang: 'en', pending: false, error: false,
  data: { show_calendar: true, calendar_timezone: 'America/New_York', calendar_days: 14, calendar_item_limit: 3 } as Record<string, unknown> | undefined,
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: session.userId }, isSignedIn: session.signedIn, getToken: async () => 'token' }) }));
vi.mock('../../hooks/usePreferences', () => ({
  usePreferences: () => ({ data: session.data, isPending: session.pending, isError: session.error, isFetching: false, refetch: vi.fn() }),
  useSavePreferences: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }),
  useQuery: () => ({ data: { configured: true }, isPending: false, isError: false, refetch: vi.fn() }),
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock('../appContext', () => ({ useApp: () => ({ lang: session.lang }) }));
const saved = { show_calendar: true, calendar_timezone: 'America/New_York', calendar_days: 14, calendar_item_limit: 3 };
const render = () => renderToStaticMarkup(<MemoryRouter><CalendarCard /></MemoryRouter>);
beforeEach(() => {
  session.userId = 'alice'; session.signedIn = true; session.lang = 'en';
  session.data = saved; session.pending = false; session.error = false;
});

describe('calendar settings synchronization', () => {
  it('loads only calendar fields and keeps unsaved edits across unrelated saves and refetches', () => {
    expect(calendarFormSettings(saved, null)).toEqual(saved);
    const draft = { ...saved, calendar_timezone: 'Europe/Copenhagen', calendar_days: 30 };
    const refreshed = { ...saved, show_weather: false, calendar_days: 7 };
    expect(calendarFormSettings(refreshed, draft)).toBe(draft);
    expect(calendarFormSettings(undefined, draft)).toBe(draft);
    expect(calendarFormSettings({ ...refreshed, ...draft }, null)).toEqual(draft);
    expect(calendarFormSettings(undefined, null)).toEqual({ show_calendar: false, calendar_timezone: 'Europe/Copenhagen', calendar_days: 7, calendar_item_limit: 5 });
  });

  it.each(['loading', 'error', 'missing'] as const)('disables the entire settings form when preferences are %s', (state) => {
    session.data = undefined;
    session.pending = state === 'loading'; session.error = state === 'error';
    const html = render();
    expect(html).toMatch(/<fieldset disabled=""/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    if (state === 'loading') expect(html).toContain('Loading calendar settings');
    else { expect(html).toContain('Retry before editing'); expect(html).toContain('>Retry</button>'); }
  });

  it('renders saved settings and keeps Save disabled until a user edits', () => {
    const html = render();
    expect(html).not.toMatch(/<fieldset disabled=""/);
    expect(html).toContain('value="America/New_York"');
    expect(html).toContain('value="14"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it('discards the form and private input on account changes and sign-out', () => {
    const alice = CalendarCard()!.key;
    session.userId = 'bob';
    expect(CalendarCard()!.key).not.toBe(alice);
    session.signedIn = false;
    expect(CalendarCard()).toBeNull();
  });
});

describe('calendar setup guide', () => {
  it('links official provider guides and the Calendar widget with current compatibility/privacy guidance', () => {
    const html = render();
    expect(html).toContain('Secret address in iCal format');
    expect(html).toContain('support.google.com/calendar/answer/37648');
    expect(html).toContain('support.microsoft.com/en-us/outlook/sharing/');
    expect(html).toContain('support.apple.com/en-in/guide/icloud/');
    expect(html).toContain('Change webcal:// to https://');
    expect(html).toContain('Anyone with the link can read the calendar');
    expect(html).toContain('known Windows time zone names from Outlook are supported');
    expect(html).toContain('Unknown or custom time zones');
    expect(html).toContain('href="/layout"');
  });

  it('localizes guidance and loading failures in Danish', () => {
    session.lang = 'da'; session.data = undefined; session.error = true;
    const html = render();
    expect(html).toContain('Find din kalenderadresse');
    expect(html).toContain('Hemmelig adresse i iCal-format');
    expect(html).toContain('Prøv igen før du redigerer');
    expect(html).toContain('Alle med linket kan læse kalenderen');
    expect(html).not.toContain('Save settings');
  });
});
