import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchCalendar } from '../services/calendar';
import { buildDisplayData, DEFAULT_PREFS } from '../services/displayData';
import { deleteApiKey, getApiKeys, getPreferences, upsertApiKey, upsertPreferences } from '../services/database';
import router from '../routes/preferences';
import { renderDisplayDataRaw } from '../utils/bmpGenerator';
import { LayoutValidationError, parseDisplayLayout } from '../utils/layoutValidation';
import {
  calendarIdFromWidget, calendarProvider, CalendarWidgetValidationError, MAX_CALENDAR_WIDGETS, parseCalendarWidgets, storedCalendarWidgets,
} from '../utils/calendarWidgets';
import { parseWidgetOptions } from '../utils/widgetOptions';
import { exportDisplayTemplate } from '../utils/displayTemplates';
import type { ApiKey, CalendarWidgetSetting, DisplayLayout, UserPreferences } from '../types';
import { calendarData, timedEvent } from './calendarFixtures';

vi.mock('../middleware/auth', () => ({ requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => { req.clerkUserId = 'clerk-user'; next(); } }));
vi.mock('../routes/preferences-helpers', () => ({ getOrCreateUserFromClerk: vi.fn().mockResolvedValue('owner') }));
vi.mock('../services/database', () => ({ getPreferences: vi.fn(), upsertPreferences: vi.fn(), getApiKeys: vi.fn(), upsertApiKey: vi.fn(), deleteApiKey: vi.fn() }));
vi.mock('../services/calendar', () => ({ fetchCalendar: vi.fn() }));
vi.mock('../services/energinet', () => ({ fetchEnergyPrice: vi.fn() }));
vi.mock('../services/weather', () => ({ fetchWeather: vi.fn() }));

const work: CalendarWidgetSetting = { id: 'work', name: 'Work', timezone: 'Europe/Copenhagen', days: 7, item_limit: 5 };
const family: CalendarWidgetSetting = { id: 'fam2', name: '', timezone: 'UTC', days: 14, item_limit: 10 };
const grid = (...widgets: DisplayLayout['widgets']): DisplayLayout => ({ version: 1, cols: 10, rows: 6, widgets });
const key = (provider: string, api_key = 'https://calendar.example.org/secret') => ({ provider, api_key } as ApiKey);

describe('calendar list validation', () => {
  it('accepts unique calendars and trims names', () => {
    expect(parseCalendarWidgets([{ ...work, name: '  Work  ' }, family])).toEqual([work, family]);
    expect(parseCalendarWidgets([])).toEqual([]);
  });
  it.each([
    ['not a list', {}],
    ['too many calendars', Array.from({ length: MAX_CALENDAR_WIDGETS + 1 }, (_, n) => ({ ...work, id: `c${n}` }))],
    ['duplicate IDs', [work, { ...family, id: 'work' }]],
    ['uppercase ID', [{ ...work, id: 'Work' }]],
    ['ID with a colon', [{ ...work, id: 'a:b' }]],
    ['long name', [{ ...work, name: 'x'.repeat(41) }]],
    ['missing name', [{ id: 'work', timezone: 'UTC', days: 7, item_limit: 5 }]],
    ['unknown field', [{ ...work, url: 'https://calendar.example.org/secret' }]],
    ['unknown time zone', [{ ...work, timezone: 'Mars/Base' }]],
    ['zero days', [{ ...work, days: 0 }]],
    ['31 days', [{ ...work, days: 31 }]],
    ['11 events', [{ ...work, item_limit: 11 }]],
    ['fractional days', [{ ...work, days: 1.5 }]],
  ])('rejects %s', (_name, value) => {
    expect(() => parseCalendarWidgets(value)).toThrow(CalendarWidgetValidationError);
  });
  it('treats invalid stored data as no calendars instead of failing the display', () => {
    expect(storedCalendarWidgets(undefined)).toEqual([]);
    expect(storedCalendarWidgets('garbage')).toEqual([]);
    expect(storedCalendarWidgets([work])).toEqual([work]);
  });
  it('maps only well-formed calendar:<id> widgets to calendar IDs', () => {
    expect(calendarIdFromWidget('calendar:work')).toBe('work');
    expect(calendarProvider('work')).toBe('calendar:work');
    expect(calendarIdFromWidget('calendar')).toBeNull();
    expect(calendarIdFromWidget('calendar:')).toBeNull();
    expect(calendarIdFromWidget('calendar:Work')).toBeNull();
    expect(calendarIdFromWidget('news:work')).toBeNull();
  });
});

describe('layouts with several calendar widgets', () => {
  it('accepts the original calendar together with calendar widgets', () => {
    const layout = grid({ i: 'calendar', x: 0, y: 0, w: 5, h: 3 }, { i: 'calendar:work', x: 5, y: 0, w: 5, h: 3 }, { i: 'calendar:fam2', x: 0, y: 3, w: 10, h: 3 });
    expect(parseDisplayLayout(layout)).toEqual(layout);
  });
  it.each(['calendar:', 'calendar:Work', 'calendar:a:b', 'calendar:' + 'a'.repeat(17), 'cal:work'])('rejects malformed widget ID %s', (i) => {
    expect(() => parseDisplayLayout(grid({ i, x: 0, y: 0, w: 2, h: 1 }))).toThrow(LayoutValidationError);
  });
  it('rejects the same calendar placed twice', () => {
    expect(() => parseDisplayLayout(grid({ i: 'calendar:work', x: 0, y: 0, w: 2, h: 1 }, { i: 'calendar:work', x: 2, y: 0, w: 2, h: 1 })))
      .toThrow(LayoutValidationError);
  });
});

describe('calendar view options', () => {
  it.each(['calendar', 'calendar:work'])('accepts every view, rows and days on %s', (id) => {
    for (const view of ['list', 'day', 'days', 'month']) expect(parseWidgetOptions(id, { view })).toEqual({ view });
    expect(parseWidgetOptions(id, { view: 'days', days: 3, items: 4, zoom: 2 })).toEqual({ zoom: 2, view: 'days', items: 4, days: 3 });
  });
  it.each([
    ['calendar', { view: 'summary' }],
    ['calendar', { view: 'full' }],
    ['calendar', { days: 1 }],
    ['calendar', { days: 8 }],
    ['calendar', { days: 2.5 }],
    ['calendar:work', { view: 'rest' }],
    ['news', { days: 3 }],
    ['news', { view: 'list' }],
    ['energy', { view: 'month' }],
  ])('rejects %s options %j', (id, options) => {
    expect(() => parseWidgetOptions(id, options)).toThrow();
  });
  it('keeps a calendar view in a parsed layout', () => {
    const layout = grid({ i: 'calendar:work', x: 0, y: 0, w: 10, h: 6, options: { view: 'month' } });
    expect(parseDisplayLayout(layout).widgets[0].options).toEqual({ view: 'month' });
  });
});

describe('display data for additional calendars', () => {
  const prefs: UserPreferences = { ...DEFAULT_PREFS, show_energy_price: false, show_weather: false, show_news: false, calendar_widgets: [work, family], layout: grid({ i: 'calendar:work', x: 0, y: 0, w: 5, h: 3 }, { i: 'calendar:fam2', x: 5, y: 0, w: 5, h: 3 }) };
  beforeEach(() => { vi.mocked(fetchCalendar).mockReset(); });

  it('only fetches additional calendars placed on the selected layout, including draft overrides', async () => {
    vi.mocked(fetchCalendar).mockResolvedValue(calendarData());
    const keys = { 'calendar:work': 'https://calendar.example.org/work', 'calendar:fam2': 'https://calendar.example.org/family' };
    const selected = grid({ i: 'calendar:work', x: 0, y: 0, w: 10, h: 6 });
    const data = await buildDisplayData('user', prefs, keys, selected);
    expect(Object.keys(data.calendars!)).toEqual(['work']);
    expect(fetchCalendar).toHaveBeenCalledTimes(1);
    vi.mocked(fetchCalendar).mockClear();
    await buildDisplayData('user', prefs, keys, null);
    await buildDisplayData('user', prefs, keys, grid());
    expect(fetchCalendar).not.toHaveBeenCalled();
  });
  it('fetches each calendar with its own URL and settings and keeps one failure isolated', async () => {
    vi.mocked(fetchCalendar).mockImplementation(async (url) => {
      if (url.endsWith('/family')) throw new Error('SECRET https://calendar.example.org/family failure');
      return calendarData([timedEvent('Planning', 600, 660)]);
    });
    const keys = { 'calendar:work': 'https://calendar.example.org/work', 'calendar:fam2': 'https://calendar.example.org/family' };
    const data = await buildDisplayData('user', prefs, keys);
    expect(fetchCalendar).toHaveBeenCalledWith('https://calendar.example.org/work', expect.objectContaining({ timezone: 'Europe/Copenhagen', days: 7, limit: 5, maxEvents: 300 }), expect.any(AbortSignal));
    expect(fetchCalendar).toHaveBeenCalledWith('https://calendar.example.org/family', expect.objectContaining({ timezone: 'UTC', days: 14, limit: 10 }), expect.any(AbortSignal));
    expect(data.calendars?.work.calendar?.events[0].title).toBe('Planning');
    expect(data.calendars?.fam2).toEqual({ error: { code: 'unavailable', message: expect.any(String) } });
    expect(JSON.stringify(data)).not.toContain('SECRET');
    expect(JSON.stringify(data)).not.toContain('calendar.example.org');
  });
  it('keeps the reason a calendar failed, for the main calendar and the extra ones, and never the URL', async () => {
    const failure = Object.assign(new Error('SECRET https://calendar.example.org/main'), { reason: 'too_many_events' });
    vi.mocked(fetchCalendar).mockRejectedValue(failure);
    const keys = { calendar: 'https://calendar.example.org/main', 'calendar:work': 'https://calendar.example.org/work' };
    const data = await buildDisplayData('user', { ...prefs, show_calendar: true, calendar_widgets: [work] }, keys);
    expect(data.calendarError).toEqual({ code: 'unavailable', message: expect.any(String), reason: 'too_many_events' });
    expect(data.calendars?.work.error).toMatchObject({ code: 'unavailable', reason: 'too_many_events' });
    expect(JSON.stringify(data)).not.toContain('SECRET');
    expect(JSON.stringify(data)).not.toContain('calendar.example.org');
    // A reason that is not a plain code is dropped, not drawn.
    vi.mocked(fetchCalendar).mockRejectedValue(Object.assign(new Error('x'), { reason: 'https://calendar.example.org/main?token=1' }));
    expect((await buildDisplayData('user', { ...prefs, show_calendar: true, calendar_widgets: [] }, keys)).calendarError).not.toHaveProperty('reason');
  });
  it('tells the main calendar to add a URL when it is switched on without one', async () => {
    const data = await buildDisplayData('user', { ...prefs, show_calendar: true, calendar_widgets: [] }, {});
    expect(fetchCalendar).not.toHaveBeenCalled();
    expect(data.calendarError?.code).toBe('not_configured');
    expect((await buildDisplayData('user', { ...prefs, show_calendar: false, calendar_widgets: [] }, {})).calendarError).toBeUndefined();
  });
  it('marks a calendar without a saved URL instead of fetching it', async () => {
    const data = await buildDisplayData('user', { ...prefs, calendar_widgets: [work] }, {});
    expect(fetchCalendar).not.toHaveBeenCalled();
    expect(data.calendars?.work.error?.code).toBe('not_configured');
  });
  it('does not fetch anything when no calendars are configured, and ignores the legacy URL', async () => {
    const data = await buildDisplayData('user', { ...prefs, calendar_widgets: [] }, { calendar: 'https://calendar.example.org/legacy' });
    expect(fetchCalendar).not.toHaveBeenCalled();
    expect(data.calendars).toBeUndefined();
  });
  it('uses the calendar widget settings, not the legacy ones, and never the legacy URL', async () => {
    vi.mocked(fetchCalendar).mockResolvedValue(calendarData());
    await buildDisplayData('user', { ...prefs, show_calendar: true, calendar_widgets: [work] }, { calendar: 'https://calendar.example.org/legacy', 'calendar:work': 'https://calendar.example.org/work' });
    expect(vi.mocked(fetchCalendar).mock.calls.map(([url]) => url).sort()).toEqual(['https://calendar.example.org/legacy', 'https://calendar.example.org/work']);
  });
});

describe('rendering additional calendar widgets', () => {
  const layout = grid({ i: 'calendar:work', x: 0, y: 0, w: 10, h: 3 });
  const blank = renderDisplayDataRaw({ nextRefresh: 1000 }, grid());
  const shown = (title: string) => renderDisplayDataRaw({ nextRefresh: 1000, calendars: { work: { calendar: calendarData([timedEvent(title, 600, 660)]) } } }, layout);
  it('draws the events of the referenced calendar only', () => {
    expect(shown('Planning')).not.toEqual(blank);
    expect(shown('Planning')).not.toEqual(shown('Review'));
    expect(renderDisplayDataRaw({ nextRefresh: 1000, calendar: calendarData([timedEvent('Planning', 600, 660)]) }, layout)).not.toEqual(shown('Planning'));
  });
  it('shows a removed, failed or unconfigured calendar as unavailable', () => {
    const missing = renderDisplayDataRaw({ nextRefresh: 1000 }, layout);
    expect(missing).not.toEqual(blank);
    expect(renderDisplayDataRaw({ nextRefresh: 1000, calendars: { work: { error: { code: 'not_configured', message: '' } } } }, layout)).not.toEqual(missing);
  });
});

describe('saving additional calendars and their URLs', () => {
  let server: Server;
  let url: string;
  beforeAll(async () => {
    const app = express(); app.use(express.json()); app.use('/preferences', router);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/preferences`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  beforeEach(() => {
    vi.mocked(upsertPreferences).mockReset().mockResolvedValue({} as UserPreferences);
    vi.mocked(getPreferences).mockReset().mockResolvedValue(null);
    vi.mocked(getApiKeys).mockReset().mockResolvedValue([]);
    vi.mocked(upsertApiKey).mockReset();
    vi.mocked(deleteApiKey).mockReset();
  });
  const send = (path: string, method: string, body?: unknown) => fetch(`${url}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

  it('defaults to no additional calendars', async () => {
    expect((await (await fetch(url)).json() as { preferences: UserPreferences }).preferences.calendar_widgets).toEqual([]);
  });
  it('saves a validated list for the authenticated owner', async () => {
    expect((await send('', 'POST', { calendar_widgets: [{ ...work, name: ' Work ' }, family] })).status).toBe(200);
    expect(upsertPreferences).toHaveBeenCalledWith('owner', { calendar_widgets: [work, family] });
  });
  it('rejects an invalid list without saving or touching stored URLs', async () => {
    const response = await send('', 'POST', { calendar_widgets: [{ ...work, timezone: 'Nowhere/Land' }] });
    expect(response.status).toBe(400);
    expect(upsertPreferences).not.toHaveBeenCalled();
    expect(deleteApiKey).not.toHaveBeenCalled();
  });
  it('removes the stored URL of a calendar taken off the list, and keeps the others', async () => {
    vi.mocked(getApiKeys).mockResolvedValue([key('calendar:work'), key('calendar:gone'), key('calendar'), key('newsapi')]);
    await send('', 'POST', { calendar_widgets: [work] });
    expect(deleteApiKey).toHaveBeenCalledTimes(1);
    expect(deleteApiKey).toHaveBeenCalledWith('owner', 'calendar:gone');
  });
  it('removes every additional URL when the list is emptied, but not the original calendar URL', async () => {
    vi.mocked(getApiKeys).mockResolvedValue([key('calendar:work'), key('calendar')]);
    await send('', 'POST', { calendar_widgets: [] });
    expect(vi.mocked(deleteApiKey).mock.calls).toEqual([['owner', 'calendar:work']]);
  });
  it('still saves the settings when a leftover URL cannot be removed', async () => {
    vi.mocked(getApiKeys).mockResolvedValue([key('calendar:gone')]);
    vi.mocked(deleteApiKey).mockRejectedValue(new Error('database down'));
    expect((await send('', 'POST', { calendar_widgets: [] })).status).toBe(200);
  });
  it('leaves URLs alone when the request does not touch the list', async () => {
    vi.mocked(getApiKeys).mockResolvedValue([key('calendar:work')]);
    await send('', 'POST', { show_calendar: true });
    expect(deleteApiKey).not.toHaveBeenCalled();
  });
  it('keeps calendars out of exported templates', () => {
    expect(exportDisplayTemplate({ ...DEFAULT_PREFS, calendar_widgets: [work] }).settings).not.toHaveProperty('calendar_widgets');
  });

  describe('calendar URLs', () => {
    const secret = 'https://calendar.example.org/private/secret-token';
    beforeEach(() => { vi.mocked(getPreferences).mockResolvedValue({ calendar_widgets: [work] } as UserPreferences); });

    it('lists only which calendars have a URL, never the URL', async () => {
      vi.mocked(getApiKeys).mockResolvedValue([key('calendar:work', secret), key('calendar', secret), key('newsapi')]);
      const response = await send('/calendar-credentials/widgets', 'GET');
      expect(await response.json()).toEqual({ configured: ['work'] });
    });
    it('stores the URL under the calendar\'s own provider', async () => {
      const response = await send('/calendar-credentials/widgets/work', 'POST', { url: secret });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ configured: true });
      expect(upsertApiKey).toHaveBeenCalledWith('owner', 'calendar:work', secret);
    });
    it('refuses a URL for a calendar that is not saved', async () => {
      expect((await send('/calendar-credentials/widgets/other', 'POST', { url: secret })).status).toBe(404);
      expect((await send('/calendar-credentials/widgets/BAD', 'POST', { url: secret })).status).toBe(404);
      expect(upsertApiKey).not.toHaveBeenCalled();
    });
    it.each(['http://calendar.example.org/x', 'https://127.0.0.1/private', 'https://user:password@example.org/x', null])('rejects unsafe URL %s without echoing it', async (value) => {
      const response = await send('/calendar-credentials/widgets/work', 'POST', { url: value });
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain('127.0.0.1');
      expect(upsertApiKey).not.toHaveBeenCalled();
    });
    it('removes the URL, even of a calendar already taken off the list', async () => {
      expect(await (await send('/calendar-credentials/widgets/gone', 'DELETE')).json()).toEqual({ configured: false });
      expect(deleteApiKey).toHaveBeenCalledWith('owner', 'calendar:gone');
      expect((await send('/calendar-credentials/widgets/BAD!', 'DELETE')).status).toBe(404);
    });
    it('redacts storage failures', async () => {
      vi.mocked(upsertApiKey).mockRejectedValue(new Error(`private ${secret}`));
      const response = await send('/calendar-credentials/widgets/work', 'POST', { url: secret });
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain('secret-token');
    });
    it('hides calendar URLs from the API key list', async () => {
      vi.mocked(getApiKeys).mockResolvedValue([key('calendar:work', secret), key('calendar', secret), key('newsapi', 'newsapi-key-1234')]);
      const keys = (await (await send('/api-keys', 'GET')).json() as { api_keys: Array<{ provider: string }> }).api_keys;
      expect(keys.map((entry) => entry.provider)).toEqual(['newsapi']);
    });
  });
});
