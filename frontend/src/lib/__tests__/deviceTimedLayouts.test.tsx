import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceLayoutChange } from '../deviceLayouts';
import { deviceSlideshowChanges } from '../deviceSlideshow';
import { newTimedLayout, savedTimedLayouts, splitDuration, timedLayoutChanges, TimedLayoutConflictError, toSeconds } from '../deviceTimedLayouts';
import { readPreviewMetadata } from '../previewMetadata';
import { DeviceTimedLayoutsCard } from '../../components/dashboard/DeviceTimedLayoutsCard';
import { DEFAULT_LAYOUT, type TimedLayout, type UserPreferences } from '../../types';

const rule = (id: string, layout_id: string, start = '07:00', duration_seconds = 900): TimedLayout => ({ id, layout_id, start, duration_seconds });
const prefs = (timed: TimedLayout[] = [rule('wake', 'kitchen')]): UserPreferences => ({
  layout: DEFAULT_LAYOUT, display_timezone: 'Europe/Copenhagen', active_layout_id: 'office',
  display_schedule: { enabled: false, timezone: 'Europe/Copenhagen', quiet_hours: { enabled: false, start: '22:00', end: '07:00' }, timed_layouts: timed,
    pages: [{ id: 'kitchen', name: 'Kitchen layout', duration_seconds: 60, layout: DEFAULT_LAYOUT },
      { id: 'office', name: 'Office layout', duration_seconds: 120, layout: DEFAULT_LAYOUT }] },
}) as UserPreferences;

const session = vi.hoisted(() => ({ data: undefined as UserPreferences | undefined, lang: 'en' }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ getToken: async () => 'auth' }) }));
vi.mock('../../hooks/usePreferences', () => ({
  usePreferences: () => ({ data: session.data, isPending: false, isError: false, refetch: vi.fn() }),
  useSavePreferences: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock('../appContext', () => ({ useApp: () => ({ lang: session.lang }) }));
beforeEach(() => { session.data = prefs(); session.lang = 'en'; });

describe('duration units', () => {
  it.each([[10, 10, 'seconds'], [90, 90, 'seconds'], [60, 1, 'minutes'], [1800, 30, 'minutes'], [3600, 1, 'hours'], [7200, 2, 'hours'], [5400, 90, 'minutes']])(
    'shows %d seconds as %d %s', (seconds, amount, unit) => {
      expect(splitDuration(seconds)).toEqual({ amount, unit });
      expect(toSeconds(amount, unit as 'seconds')).toBe(seconds);
    });
  it('rounds fractional amounts to whole seconds', () => {
    expect(toSeconds(1.5, 'minutes')).toBe(90);
    expect(toSeconds(0.1, 'seconds')).toBe(0);
  });
});

describe('saving timed layouts', () => {
  it('replaces only the timed layouts and keeps pages, slideshow and quiet hours as saved', () => {
    const latest = prefs();
    const next = [rule('wake', 'office', '06:30', 45), newTimedLayout('kitchen', 'dinner')];
    const { display_schedule } = timedLayoutChanges(latest, next);
    expect(display_schedule?.timed_layouts).toEqual(next);
    expect({ ...display_schedule, timed_layouts: undefined }).toEqual({ ...latest.display_schedule, timed_layouts: undefined });
  });
  it('leaves no key behind once every rule is removed', () => {
    expect('timed_layouts' in timedLayoutChanges(prefs(), []).display_schedule!).toBe(false);
  });
  it('works for a device that has never saved a schedule', () => {
    expect(() => timedLayoutChanges({ ...prefs(), display_schedule: null }, [rule('a', 'kitchen')])).toThrow(TimedLayoutConflictError);
    expect(timedLayoutChanges({ ...prefs(), display_schedule: null }, []).display_schedule?.pages).toEqual([]);
  });
  it('refuses a rule whose layout was removed in the meantime', () => {
    expect(() => timedLayoutChanges(prefs(), [rule('wake', 'deleted')])).toThrow(TimedLayoutConflictError);
  });
  it.each([[9], [86400], [10.5], [NaN]])('rejects a duration of %s seconds', (seconds) => {
    expect(() => timedLayoutChanges(prefs(), [rule('wake', 'kitchen', '07:00', seconds)])).toThrow('10 seconds');
  });
  it.each(['', '7:00', '24:00', '07:60'])('rejects the start time "%s"', (start) => {
    expect(() => timedLayoutChanges(prefs(), [rule('wake', 'kitchen', start)])).toThrow('start time');
  });
  it('accepts the shortest and longest durations', () => {
    expect(timedLayoutChanges(prefs(), [rule('a', 'kitchen', '00:00', 10), rule('b', 'kitchen', '23:59', 86399)]).display_schedule?.timed_layouts).toHaveLength(2);
  });
  it('rejects duplicate ids and more than 24 rules', () => {
    expect(() => timedLayoutChanges(prefs(), [rule('a', 'kitchen'), rule('a', 'office')])).toThrow('unique');
    expect(() => timedLayoutChanges(prefs(), Array.from({ length: 25 }, (_, index) => rule(`r${index}`, 'kitchen')))).toThrow('At most 24');
  });
});

describe('other editors keep timed layouts consistent', () => {
  it('saving the slideshow does not drop the timed layouts', () => {
    const latest = prefs();
    const draft = { ...latest.display_schedule!, enabled: true };
    expect(deviceSlideshowChanges(latest, draft, ['kitchen', 'office']).display_schedule?.timed_layouts).toEqual([rule('wake', 'kitchen')]);
  });
  it('removing a layout removes the timed layouts that showed it, and only those', () => {
    const latest = prefs([rule('a', 'kitchen'), rule('b', 'office')]);
    expect(deviceLayoutChange(latest, { type: 'remove', id: 'kitchen' }).display_schedule?.timed_layouts).toEqual([rule('b', 'office')]);
    expect(savedTimedLayouts({ ...latest, display_schedule: { ...latest.display_schedule!, timed_layouts: undefined } })).toEqual([]);
  });
  it('removing the only shown layout leaves a schedule the server still accepts', () => {
    const next = deviceLayoutChange(prefs(), { type: 'remove', id: 'kitchen' }).display_schedule!;
    expect(next.timed_layouts ?? []).toEqual([]);
  });
});

describe('preview metadata for a timed layout', () => {
  const headers = (mode: string, extra: Record<string, string> = {}) => new Headers({
    'X-Preview-Device-ID': 'd1', 'X-Preview-Layout-ID': 'kitchen', 'X-Preview-Layout-Name': 'Kitchen', 'X-Preview-Mode': mode,
    'X-Preview-Quiet': 'false', 'X-Preview-Rendered-At': '2026-05-01T07:00:00.000Z', 'X-Preview-Next-Transition': '2026-05-01T07:15:00.000Z',
    'X-Display-Width': '250', 'X-Display-Height': '122', 'X-Display-Rotation': '0', 'X-Display-Row-Bytes': '32', 'X-Display-Encoding': 'mono-msb-white1', ...extra,
  });
  it('accepts the timed mode with its next transition', () => {
    expect(readPreviewMetadata(headers('timed'), 'd1').mode).toBe('timed');
  });
  it('still requires a next transition for scheduled modes', () => {
    const missing = headers('timed'); missing.delete('X-Preview-Next-Transition');
    expect(() => readPreviewMetadata(missing, 'd1')).toThrow('Invalid preview metadata');
  });
});

describe('timed layouts card', () => {
  const render = () => renderToStaticMarkup(<DeviceTimedLayoutsCard deviceId="device-kitchen" />);
  it('lists each saved rule with its layout, start time and duration', () => {
    const html = render();
    expect(html).toContain('Timed layouts');
    expect(html).toContain('value="07:00"');
    expect(html).toContain('value="15"');
    expect(html).toContain('<option value="minutes" selected="">minutes</option>');
    expect(html).toContain('<option value="kitchen" selected="">Kitchen layout</option>');
    expect(html).toContain('Europe/Copenhagen');
  });
  it('shows a short rule in seconds', () => {
    session.data = prefs([rule('wake', 'kitchen', '07:00', 45)]);
    expect(render()).toContain('<option value="seconds" selected="">seconds</option>');
  });
  it('explains the empty state and cannot add a rule before a layout exists', () => {
    session.data = { ...prefs([]), display_schedule: { ...prefs().display_schedule!, pages: [], timed_layouts: undefined } };
    const html = render();
    expect(html).toContain('Create at least one layout');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Add timed layout/);
  });
  it('is available in Danish', () => {
    session.lang = 'da';
    const html = render();
    expect(html).toContain('Tidsstyrede layouts');
    expect(html).toContain('sekunder');
    expect(html).toContain('Gem tidsstyrede layouts');
  });
  it('keeps saving disabled until something changes', () => {
    expect(render()).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });
});
