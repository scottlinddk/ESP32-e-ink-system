import { describe, expect, it } from 'vitest';
import { layoutForDisplayData, resolveDisplaySchedule } from '../services/displaySchedule';
import { parseDisplaySchedule } from '../utils/scheduleValidation';
import { DEFAULT_PREFS } from '../services/displayData';
import type { DisplaySchedule, UserPreferences } from '../types';

const schedule: DisplaySchedule = {
  enabled: true, timezone: 'UTC',
  pages: [
    { id: 'first', name: 'First', duration_seconds: 60, layout: { version: 1, cols: 10, rows: 6, widgets: [{ i: 'energy', x: 0, y: 0, w: 10, h: 6 }] } },
    { id: 'second', name: 'Second', duration_seconds: 120, layout: { version: 1, cols: 10, rows: 6, widgets: [{ i: 'weather', x: 0, y: 0, w: 10, h: 6 }] } },
  ], quiet_hours: { enabled: false, start: '22:00', end: '07:00' },
};
const prefs: UserPreferences = { ...DEFAULT_PREFS, display_schedule: schedule };
function resolve(at: string, override: Partial<DisplaySchedule> = {}) {
  return resolveDisplaySchedule({ ...prefs, display_schedule: { ...schedule, ...override } }, new Date(at));
}

describe('deterministic page rotation', () => {
  it.each([[0, 'first', 60000], [59999, 'first', 1], [60000, 'second', 120000], [179999, 'second', 1], [180000, 'first', 60000]])(
    'selects page and delay at epoch offset %d', (offset, page, delay) => {
      const result = resolveDisplaySchedule(prefs, new Date(offset));
      expect(result.schedule?.pageId).toBe(page);
      expect(result.nextRefresh).toBe(delay);
      expect(result.layout).toEqual(schedule.pages.find((item) => item.id === page)!.layout);
    });

  it('respects order and clamps awake refresh delay to source cadence', () => {
    const result = resolveDisplaySchedule({ ...prefs, refresh_interval_minutes: 1,
      display_schedule: { ...schedule, pages: [...schedule.pages].reverse() } }, new Date(0));
    expect(result.schedule?.pageId).toBe('second');
    expect(result.nextRefresh).toBe(60000);
    expect(result.schedule?.nextTransitionAt).toBe('1970-01-01T00:02:00.000Z');
  });

  it.each([null, undefined, { ...schedule, enabled: false }, { ...schedule, pages: [] }])('keeps the base layout for inactive or invalid saved schedules', (display_schedule) => {
    expect(resolveDisplaySchedule({ ...prefs, display_schedule }, new Date(0))).toEqual({ layout: prefs.layout, nextRefresh: 1800000 });
  });

  it('retains the selected page across a clock boundary during data fetching', () => {
    const selected = resolveDisplaySchedule(prefs, new Date(59999));
    expect(layoutForDisplayData(prefs, { nextRefresh: 1, schedule: selected.schedule })).toEqual(schedule.pages[0].layout);
    expect(resolveDisplaySchedule(prefs, new Date(60001)).layout).toEqual(schedule.pages[1].layout);
  });
});

describe('local quiet hours', () => {
  const quiet = { enabled: true, start: '22:00', end: '07:00' };
  it('enters and leaves overnight quiet hours at exact boundaries', () => {
    expect(resolve('2026-09-28T21:59:59Z', { quiet_hours: quiet })).toMatchObject({ nextRefresh: 1000, schedule: { quiet: false, nextTransitionAt: '2026-09-28T22:00:00.000Z' } });
    expect(resolve('2026-09-28T22:00:00Z', { quiet_hours: quiet })).toMatchObject({ nextRefresh: 9 * 3600000, schedule: { quiet: true, nextTransitionAt: '2026-09-29T07:00:00.000Z' } });
    expect(resolve('2026-09-29T06:59:59Z', { quiet_hours: quiet })).toMatchObject({ nextRefresh: 1000, schedule: { quiet: true } });
    expect(resolve('2026-09-29T07:00:00Z', { quiet_hours: quiet }).schedule?.quiet).toBe(false);
  });
  it('freezes the page for the entire quiet window', () => {
    const pages = schedule.pages.map((page, index) => ({ ...page, duration_seconds: index === 0 ? 70 : 120 }));
    const start = resolve('2026-09-28T22:00:00Z', { pages, quiet_hours: quiet });
    const later = resolve('2026-09-29T02:53:12Z', { pages, quiet_hours: quiet });
    expect(later.schedule?.pageId).toBe(start.schedule?.pageId);
    expect(later.layout).toEqual(start.layout);
  });
  it('supports daytime windows and fractional-hour time zones', () => {
    expect(resolve('2026-09-28T10:00:00Z', { quiet_hours: { enabled: true, start: '09:00', end: '17:00' } })).toMatchObject({ schedule: { quiet: true, nextTransitionAt: '2026-09-28T17:00:00.000Z' } });
    expect(resolve('2026-09-28T16:30:00Z', { timezone: 'Asia/Kolkata', quiet_hours: quiet })).toMatchObject({ nextRefresh: 9 * 3600000, schedule: { quiet: true, nextTransitionAt: '2026-09-29T01:30:00.000Z' } });
  });
  it('uses elapsed time across spring DST', () => {
    expect(resolve('2026-03-28T21:00:00Z', { timezone: 'Europe/Copenhagen', quiet_hours: quiet })).toMatchObject({ nextRefresh: 8 * 3600000, schedule: { quiet: true, nextTransitionAt: '2026-03-29T05:00:00.000Z' } });
  });
  it('uses elapsed time across autumn DST', () => {
    expect(resolve('2026-10-24T20:00:00Z', { timezone: 'Europe/Copenhagen', quiet_hours: quiet })).toMatchObject({ nextRefresh: 10 * 3600000, schedule: { quiet: true, nextTransitionAt: '2026-10-25T06:00:00.000Z' } });
  });
  it('starts at the first valid minute when spring skips the configured start', () => {
    const override = { timezone: 'Europe/Copenhagen', quiet_hours: { enabled: true, start: '02:30', end: '04:00' } };
    expect(resolve('2026-03-29T00:59:59Z', override)).toMatchObject({ nextRefresh: 1000, schedule: { quiet: false, nextTransitionAt: '2026-03-29T01:00:00.000Z' } });
    expect(resolve('2026-03-29T01:10:00Z', override)).toMatchObject({ schedule: { quiet: true, nextTransitionAt: '2026-03-29T02:00:00.000Z' } });
  });
  it('holds the page through both occurrences of the repeated hour', () => {
    const first = resolve('2026-10-25T00:30:00Z', { timezone: 'Europe/Copenhagen', quiet_hours: quiet });
    const second = resolve('2026-10-25T01:30:00Z', { timezone: 'Europe/Copenhagen', quiet_hours: quiet });
    expect(first.schedule?.quiet).toBe(true);
    expect(second.schedule?.quiet).toBe(true);
    expect(first.schedule?.pageId).toBe(second.schedule?.pageId);
    expect(first.schedule?.nextTransitionAt).toBe(second.schedule?.nextTransitionAt);
  });
});

describe('schedule validation', () => {
  it('supports empty disabled schedules and rejects empty enabled schedules', () => {
    expect(parseDisplaySchedule({ ...schedule, enabled: false, pages: [] }).pages).toEqual([]);
    expect(() => parseDisplaySchedule({ ...schedule, pages: [] })).toThrow();
  });
  it.each([
    { ...schedule, timezone: '+02:00' }, { ...schedule, enabled: 'true' },
    { ...schedule, pages: [{ ...schedule.pages[0], name: '' }] },
    { ...schedule, pages: [{ ...schedule.pages[0], duration_seconds: 86401 }] },
    { ...schedule, pages: [{ ...schedule.pages[0], duration_seconds: 60.5 }] },
    { ...schedule, quiet_hours: { enabled: true, start: '22:00', end: '22:00' } },
  ])('rejects invalid schedule %j', (input) => { expect(() => parseDisplaySchedule(input)).toThrow(); });
});
