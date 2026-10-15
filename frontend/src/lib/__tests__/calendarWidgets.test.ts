import { describe, expect, it, vi } from 'vitest';
import {
  calendarIdFromWidget, calendarLabel, calendarWidgetId, calendarWidgetsForSave, createCalendarId, emptyCalendar, MAX_CALENDAR_WIDGETS, saveCalendarChanges,
} from '../calendarWidgets';
import type { CalendarWidgetSetting } from '../../types';

const work: CalendarWidgetSetting = { id: 'work', name: 'Work', timezone: 'Europe/Copenhagen', days: 7, item_limit: 5 };
const home: CalendarWidgetSetting = { id: 'home', name: '', timezone: 'UTC', days: 14, item_limit: 3 };

describe('calendar widget ids', () => {
  it('maps only well-formed calendar:<id> widgets to calendar IDs, like the backend', () => {
    expect(calendarWidgetId('work')).toBe('calendar:work');
    expect(calendarIdFromWidget('calendar:work')).toBe('work');
    for (const widget of ['calendar', 'calendar:', 'calendar:Work', 'calendar:a:b', 'calendar:' + 'a'.repeat(17), 'news:work']) {
      expect(calendarIdFromWidget(widget)).toBeNull();
    }
  });
  it('creates unique IDs the backend accepts', () => {
    const existing: CalendarWidgetSetting[] = [];
    for (let n = 0; n < 50; n++) {
      const id = createCalendarId(existing);
      expect(id).toMatch(/^[a-z0-9]{1,16}$/);
      expect(existing.some((calendar) => calendar.id === id)).toBe(false);
      existing.push({ ...work, id });
    }
  });
  it('starts a new calendar with the standard horizon in the given time zone', () => {
    expect(emptyCalendar([], 'UTC')).toMatchObject({ name: '', timezone: 'UTC', days: 7, item_limit: 5 });
    expect(emptyCalendar([]).timezone).toBe('Europe/Copenhagen');
  });
  it('allows as many calendars as the backend', () => {
    expect(MAX_CALENDAR_WIDGETS).toBe(8);
  });
});

describe('calendar labels and saving', () => {
  it('labels an unnamed calendar by its position', () => {
    expect(calendarLabel(work, 0)).toBe('Work');
    expect(calendarLabel(home, 1)).toBe('#2');
    expect(calendarLabel({ ...home, name: '   ' }, 2)).toBe('#3');
  });
  it('trims names and time zones and keeps everything else', () => {
    expect(calendarWidgetsForSave([{ ...work, name: '  Work ', timezone: ' UTC ' }])).toEqual([{ ...work, name: 'Work', timezone: 'UTC' }]);
  });
});

describe('saving calendars and their URLs', () => {
  const urls = { work: ' https://calendar.example.org/work ', home: '' };
  const run = (overrides: Partial<Parameters<typeof saveCalendarChanges>[0]> = {}) => {
    const calls: string[] = [];
    const saveList = vi.fn(async () => { calls.push('list'); });
    const saveUrl = vi.fn(async (id: string) => { calls.push(`url:${id}`); });
    const promise = saveCalendarChanges({ calendars: [work, home], listChanged: true, urls, saveList, saveUrl, ...overrides });
    return { promise, calls, saveList, saveUrl };
  };

  it('saves the list before any URL, and only the URLs that were typed, trimmed', async () => {
    const { promise, calls, saveList, saveUrl } = run();
    expect(await promise).toEqual({ rejected: {}, failures: [] });
    expect(calls).toEqual(['list', 'url:work']);
    expect(saveList).toHaveBeenCalledWith([work, home]);
    expect(saveUrl).toHaveBeenCalledWith('work', 'https://calendar.example.org/work');
  });
  it('leaves the list alone when only a URL was typed', async () => {
    const { promise, calls } = run({ listChanged: false });
    await promise;
    expect(calls).toEqual(['url:work']);
  });
  it('sends no URL when the list cannot be saved', async () => {
    const saveUrl = vi.fn();
    await expect(saveCalendarChanges({ calendars: [work], listChanged: true, urls, saveList: async () => { throw new Error('Calendars must be a list'); }, saveUrl }))
      .rejects.toThrow('Calendars must be a list');
    expect(saveUrl).not.toHaveBeenCalled();
  });
  it('keeps a refused URL for correction and still saves the others', async () => {
    const saveUrl = vi.fn(async (id: string) => { if (id === 'work') throw new Error('Calendar URL must be a public HTTPS URL'); });
    const result = await saveCalendarChanges({
      calendars: [work, home], listChanged: false, urls: { work: 'http://bad', home: 'https://calendar.example.org/home' }, saveList: vi.fn(), saveUrl,
    });
    expect(saveUrl).toHaveBeenCalledTimes(2);
    expect(result.rejected).toEqual({ work: 'http://bad' });
    expect(result.failures).toEqual(['Work (Calendar URL must be a public HTTPS URL)']);
  });
  it('ignores a URL typed for a calendar that was since removed', async () => {
    const { promise, calls } = run({ calendars: [home], urls: { work: 'https://calendar.example.org/work' } });
    await promise;
    expect(calls).toEqual(['list']);
  });
  it('names an unnamed calendar by its position in a failure', async () => {
    const result = await saveCalendarChanges({
      calendars: [work, home], listChanged: false, urls: { home: 'https://x.example.org/' }, saveList: vi.fn(),
      saveUrl: async () => { throw new Error('refused'); },
    });
    expect(result.failures).toEqual(['#2 (refused)']);
  });
});
