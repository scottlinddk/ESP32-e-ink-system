import { describe, expect, it } from 'vitest';
import { layoutForDisplayData, resolveDisplaySchedule } from '../services/displaySchedule';
import { activeTimedLayout, nextTimedBoundary, zonedTimeToUtc } from '../services/timedLayouts';
import { DEFAULT_PREFS } from '../services/displayData';
import { parseDisplaySchedule, ScheduleValidationError } from '../utils/scheduleValidation';
import { parseDeviceDisplayUpdates } from '../services/deviceDisplays';
import { buildAcceptUpdates } from '../utils/sharedItems';
import type { DisplayLayout, DisplaySchedule, TimedLayout, UserPreferences } from '../types';

const layoutOf = (widget: string): DisplayLayout => ({ version: 1, cols: 10, rows: 6, widgets: [{ i: widget, x: 0, y: 0, w: 10, h: 6 }] });
const pages = [
  { id: 'home', name: 'Home', duration_seconds: 60, layout: layoutOf('energy') },
  { id: 'away', name: 'Away', duration_seconds: 60, layout: layoutOf('news') },
  { id: 'morning', name: 'Morning', duration_seconds: 60, layout: layoutOf('weather') },
  { id: 'agenda', name: 'Agenda', duration_seconds: 60, layout: layoutOf('calendar') },
];
const rule = (id: string, layout_id: string, start: string, duration_seconds: number): TimedLayout => ({ id, layout_id, start, duration_seconds });
const schedule = (timed_layouts: TimedLayout[], override: Partial<DisplaySchedule> = {}): DisplaySchedule => ({
  enabled: false, timezone: 'UTC', pages, quiet_hours: { enabled: false, start: '22:00', end: '07:00' }, timed_layouts, ...override,
});
const base = layoutOf('clock');
const prefsFor = (display_schedule: DisplaySchedule): UserPreferences => ({ ...DEFAULT_PREFS, layout: base, refresh_interval_minutes: 30, display_schedule });
const at = (iso: string) => new Date(iso);

describe('zonedTimeToUtc', () => {
  it('converts an ordinary local time using the zone offset', () => {
    expect(new Date(zonedTimeToUtc('Europe/Copenhagen', 2026, 7, 1, 7, 0)).toISOString()).toBe('2026-07-01T05:00:00.000Z');
    expect(new Date(zonedTimeToUtc('Europe/Copenhagen', 2026, 1, 1, 7, 0)).toISOString()).toBe('2026-01-01T06:00:00.000Z');
  });
  it('moves a skipped spring-forward time past the gap', () => {
    expect(new Date(zonedTimeToUtc('Europe/Copenhagen', 2026, 3, 29, 2, 30)).toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });
  it('uses the first occurrence of a repeated autumn time', () => {
    expect(new Date(zonedTimeToUtc('Europe/Copenhagen', 2026, 10, 25, 2, 30)).toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });
  it('normalises day overflow into the next month', () => {
    expect(new Date(zonedTimeToUtc('UTC', 2026, 1, 32, 6, 0)).toISOString()).toBe('2026-02-01T06:00:00.000Z');
  });
});

describe('active timed layout', () => {
  const rules = [rule('r1', 'morning', '07:00', 30 * 60)];
  it.each([
    ['2026-05-01T06:59:59Z', false], ['2026-05-01T07:00:00Z', true], ['2026-05-01T07:29:59Z', true], ['2026-05-01T07:30:00Z', false],
  ])('at %s active=%s', (iso, active) => {
    expect(activeTimedLayout(rules, 'UTC', at(iso).getTime())?.id ?? null).toBe(active ? 'r1' : null);
  });

  it('honours a duration of seconds', () => {
    const short = [rule('r1', 'morning', '07:00', 10)];
    expect(activeTimedLayout(short, 'UTC', at('2026-05-01T07:00:09Z').getTime())).not.toBeNull();
    expect(activeTimedLayout(short, 'UTC', at('2026-05-01T07:00:10Z').getTime())).toBeNull();
  });

  it('keeps a window that crosses midnight open on both sides', () => {
    const night = [rule('r1', 'away', '23:30', 3600)];
    expect(activeTimedLayout(night, 'UTC', at('2026-05-01T23:45:00Z').getTime())).not.toBeNull();
    expect(activeTimedLayout(night, 'UTC', at('2026-05-02T00:15:00Z').getTime())).not.toBeNull();
    expect(activeTimedLayout(night, 'UTC', at('2026-05-02T00:30:00Z').getTime())).toBeNull();
  });

  it('follows the local clock of the schedule time zone through daylight saving', () => {
    const local = [rule('r1', 'morning', '07:00', 600)];
    expect(activeTimedLayout(local, 'Europe/Copenhagen', at('2026-07-01T05:00:00Z').getTime())).not.toBeNull();
    expect(activeTimedLayout(local, 'Europe/Copenhagen', at('2026-07-01T06:00:00Z').getTime())).toBeNull();
    expect(activeTimedLayout(local, 'Europe/Copenhagen', at('2026-01-01T06:00:00Z').getTime())).not.toBeNull();
    // The first morning after clocks go forward: 07:00 CEST is 05:00Z, not 06:00Z.
    expect(activeTimedLayout(local, 'Europe/Copenhagen', at('2026-03-30T05:00:00Z').getTime())).not.toBeNull();
  });

  it('prefers the rule that started last when windows overlap', () => {
    const overlap = [rule('long', 'away', '07:00', 3600), rule('late', 'agenda', '07:30', 600)];
    expect(activeTimedLayout(overlap, 'UTC', at('2026-05-01T07:10:00Z').getTime())?.id).toBe('long');
    expect(activeTimedLayout(overlap, 'UTC', at('2026-05-01T07:35:00Z').getTime())?.id).toBe('late');
    expect(activeTimedLayout(overlap, 'UTC', at('2026-05-01T07:45:00Z').getTime())?.id).toBe('long');
  });

  it('reports the next start or end, or Infinity without rules', () => {
    expect(new Date(nextTimedBoundary(rules, 'UTC', at('2026-05-01T06:00:00Z').getTime())).toISOString()).toBe('2026-05-01T07:00:00.000Z');
    expect(new Date(nextTimedBoundary(rules, 'UTC', at('2026-05-01T07:10:00Z').getTime())).toISOString()).toBe('2026-05-01T07:30:00.000Z');
    expect(new Date(nextTimedBoundary(rules, 'UTC', at('2026-05-01T08:00:00Z').getTime())).toISOString()).toBe('2026-05-02T07:00:00.000Z');
    expect(nextTimedBoundary([], 'UTC', 0)).toBe(Infinity);
  });
});

describe('resolving a timed layout', () => {
  it('shows it in single-layout mode and returns to the saved layout afterwards', () => {
    const prefs = prefsFor(schedule([rule('r1', 'morning', '07:00', 120)]));
    const during = resolveDisplaySchedule(prefs, at('2026-05-01T07:00:30Z'));
    expect(during.layout).toEqual(pages[2].layout);
    expect(during.schedule).toEqual({ pageId: 'morning', pageName: 'Morning', quiet: false, nextTransitionAt: '2026-05-01T07:02:00.000Z', timed: true });
    expect(during.nextRefresh).toBe(90_000);
    const after = resolveDisplaySchedule(prefs, at('2026-05-01T07:02:00Z'));
    expect(after.layout).toBe(base);
    expect(after.schedule).toBeUndefined();
  });

  it('wakes the device for the next window even while nothing is timed yet', () => {
    const prefs = prefsFor(schedule([rule('r1', 'morning', '07:00', 120)]));
    // Thirty minutes of source refresh would sleep through 07:00 from 06:50, so the delay is cut short.
    expect(resolveDisplaySchedule(prefs, at('2026-05-01T06:50:00Z')).nextRefresh).toBe(10 * 60_000);
    expect(resolveDisplaySchedule(prefs, at('2026-05-01T03:00:00Z')).nextRefresh).toBe(30 * 60_000);
  });

  it('leaves single-layout mode untouched without rules', () => {
    expect(resolveDisplaySchedule(prefsFor(schedule([])), at('2026-05-01T07:00:00Z'))).toEqual({ layout: base, nextRefresh: 30 * 60_000 });
  });

  it('overrides the slideshow and resumes its UTC cycle afterwards', () => {
    const rules = [rule('r1', 'agenda', '00:10', 120)];
    const slideshow = (timed: TimedLayout[]) => prefsFor(schedule(timed, { enabled: true, pages: [pages[0], pages[1], pages[3]] }));
    const during = resolveDisplaySchedule(slideshow(rules), at('2026-05-01T00:10:30Z'));
    expect(during.layout).toEqual(pages[3].layout);
    expect(during.schedule).toMatchObject({ pageId: 'agenda', timed: true, nextTransitionAt: '2026-05-01T00:12:00.000Z' });
    // Rotation was paused, not shifted: afterwards it shows what it would have shown without the rule.
    const resumed = resolveDisplaySchedule(slideshow(rules), at('2026-05-01T00:12:00Z'));
    const untouched = resolveDisplaySchedule(slideshow([]), at('2026-05-01T00:12:00Z'));
    expect(resumed.schedule?.timed).toBeUndefined();
    expect(resumed).toEqual(untouched);
  });

  it('overrules quiet hours: a window wakes the display, and quiet hours return afterwards', () => {
    const quiet = { enabled: true, start: '22:00', end: '07:00' };
    const slideshow = (timed: TimedLayout[]) => prefsFor(schedule(timed, { enabled: true, pages: [pages[0], pages[1], pages[3]], quiet_hours: quiet }));
    const rules = [rule('r1', 'agenda', '03:00', 3600)];
    // Before the window the display sleeps, but is told to wake when the window opens.
    const before = resolveDisplaySchedule(slideshow(rules), at('2026-05-01T02:30:00Z'));
    expect(before.schedule?.quiet).toBe(true);
    expect(before.schedule?.nextTransitionAt).toBe('2026-05-01T03:00:00.000Z');
    expect(before.nextRefresh).toBe(30 * 60_000);
    // During it the timed layout is shown and the display is not quiet.
    const during = resolveDisplaySchedule(slideshow(rules), at('2026-05-01T03:30:00Z'));
    expect(during.schedule).toMatchObject({ pageId: 'agenda', quiet: false, timed: true, nextTransitionAt: '2026-05-01T04:00:00.000Z' });
    expect(during.layout).toEqual(pages[3].layout);
    // Afterwards it is quiet again and sleeps until quiet hours end.
    const after = resolveDisplaySchedule(slideshow(rules), at('2026-05-01T04:00:00Z'));
    expect(after.schedule).toMatchObject({ quiet: true, nextTransitionAt: '2026-05-01T07:00:00.000Z' });
  });

  it('keeps a window that opens before quiet hours end showing until its own end', () => {
    const quiet = { enabled: true, start: '22:00', end: '07:00' };
    const prefs = prefsFor(schedule([rule('r1', 'agenda', '06:30', 3600)], { enabled: true, pages: [pages[0], pages[1], pages[3]], quiet_hours: quiet }));
    expect(resolveDisplaySchedule(prefs, at('2026-05-01T06:45:00Z')).schedule).toMatchObject({ pageId: 'agenda', quiet: false, timed: true });
    expect(resolveDisplaySchedule(prefs, at('2026-05-01T07:00:00Z')).schedule).toMatchObject({ pageId: 'agenda', quiet: false, timed: true, nextTransitionAt: '2026-05-01T07:30:00.000Z' });
  });

  it('ignores quiet hours for a single layout', () => {
    const prefs = prefsFor(schedule([rule('r1', 'morning', '03:00', 3600)], { quiet_hours: { enabled: true, start: '22:00', end: '07:00' } }));
    expect(resolveDisplaySchedule(prefs, at('2026-05-01T03:10:00Z')).schedule).toMatchObject({ pageId: 'morning', quiet: false, timed: true });
  });

  it('falls back to the saved layout when a rule points at a removed layout', () => {
    const broken = { ...schedule([rule('r1', 'gone', '07:00', 600)]) };
    expect(resolveDisplaySchedule(prefsFor(broken), at('2026-05-01T07:01:00Z'))).toEqual({ layout: base, nextRefresh: 30 * 60_000 });
  });

  it('pairs the frame with the page chosen when the request began', () => {
    const prefs = prefsFor(schedule([rule('r1', 'morning', '07:00', 600)]));
    const data = { nextRefresh: 1, schedule: resolveDisplaySchedule(prefs, at('2026-05-01T07:00:01Z')).schedule };
    expect(layoutForDisplayData(prefs, data)).toEqual(pages[2].layout);
  });
});

describe('timed layout validation', () => {
  const parse = (timed: unknown) => parseDisplaySchedule({ ...schedule([]), timed_layouts: timed });
  const valid = { id: 'r1', layout_id: 'morning', start: '07:00', duration_seconds: 90 };

  it('keeps a valid rule and omits the key when there are none', () => {
    expect(parse([valid]).timed_layouts).toEqual([valid]);
    expect('timed_layouts' in parse([])).toBe(false);
    const { timed_layouts: _, ...legacy } = schedule([]);
    expect('timed_layouts' in parseDisplaySchedule(legacy)).toBe(false);
  });

  it.each([
    ['an unknown layout', { ...valid, layout_id: 'gone' }],
    ['a start without leading zero', { ...valid, start: '7:00' }],
    ['an hour past 23', { ...valid, start: '24:00' }],
    ['less than ten seconds', { ...valid, duration_seconds: 9 }],
    ['a full day', { ...valid, duration_seconds: 86400 }],
    ['a fractional duration', { ...valid, duration_seconds: 10.5 }],
    ['an unsupported field', { ...valid, days: [1] }],
    ['an unsafe id', { ...valid, id: 'a b' }],
  ])('rejects %s', (_, entry) => {
    expect(() => parse([entry])).toThrow(ScheduleValidationError);
  });

  it('accepts the shortest and longest durations', () => {
    expect(parse([{ ...valid, duration_seconds: 10 }])).toBeTruthy();
    expect(parse([{ ...valid, duration_seconds: 86399 }])).toBeTruthy();
  });

  it('rejects duplicate ids and more than 24 rules', () => {
    expect(() => parse([valid, valid])).toThrow(ScheduleValidationError);
    expect(() => parse(Array.from({ length: 25 }, (_, index) => ({ ...valid, id: `r${index}` })))).toThrow(ScheduleValidationError);
    expect(parse(Array.from({ length: 24 }, (_, index) => ({ ...valid, id: `r${index}` }))).timed_layouts).toHaveLength(24);
  });
});

describe('timed layouts through the device settings and sharing paths', () => {
  it('survive a device settings save, and an invalid rule is a 400 rather than a stored schedule', () => {
    const timed = [rule('r1', 'morning', '07:00', 90)];
    expect(parseDeviceDisplayUpdates({ display_schedule: schedule(timed) }).display_schedule?.timed_layouts).toEqual(timed);
    expect(() => parseDeviceDisplayUpdates({ display_schedule: schedule([rule('r1', 'gone', '07:00', 90)]) })).toThrow(/saved layouts/);
  });

  it('are dropped when a shared dashboard replaces every layout ID, but the rest of the schedule is kept', () => {
    const current = { ...prefsFor(schedule([rule('r1', 'morning', '07:00', 90)], { timezone: 'Europe/London' })), display_schedule: schedule([rule('r1', 'morning', '07:00', 90)], { timezone: 'Europe/London' }) };
    const payload = { enabled: true, pages: [{ name: 'Day', duration_seconds: 120, layout: layoutOf('weather') }] };
    const updates = buildAcceptUpdates('dashboard', payload, current);
    expect(updates.display_schedule).not.toHaveProperty('timed_layouts');
    expect(updates.display_schedule).toMatchObject({ timezone: 'Europe/London', enabled: true });
    // What the recipient is left with must still be a schedule the server accepts.
    expect(() => parseDisplaySchedule(updates.display_schedule)).not.toThrow();
  });
});
