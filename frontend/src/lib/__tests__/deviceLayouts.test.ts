import { describe, expect, it } from 'vitest';
import { deviceDashboardPath, deviceLayoutChange, deviceLayoutPath } from '../deviceLayouts';
import { DEFAULT_LAYOUT, type UserPreferences } from '../../types';

const empty = { version: 1, cols: 10, rows: 6, widgets: [] } as const;
const settings = (): UserPreferences => ({
  layout: DEFAULT_LAYOUT, active_layout_id: 'one', display_timezone: 'Europe/Copenhagen',
  display_schedule: { enabled: true, timezone: 'UTC', quiet_hours: { enabled: true, start: '22:00', end: '07:00' },
    pages: [{ id: 'one', name: 'Kitchen', duration_seconds: 60, layout: { ...empty, widgets: [] } },
      { id: 'two', name: 'Office', duration_seconds: 120, layout: DEFAULT_LAYOUT }] },
}) as UserPreferences;

describe('device saved layouts', () => {
  it('copies the selected layout and retains an inherited rotation until a fixed layout is explicitly chosen', () => {
    const original = settings();
    const patch = deviceLayoutChange(original, { type: 'add', id: 'three', name: ' New copy ' });
    expect(patch.display_schedule?.enabled).toBe(true);
    expect(patch.display_schedule?.pages[2]).toEqual({ id: 'three', name: 'New copy', duration_seconds: 900, layout: empty });
    expect(patch.display_schedule?.pages[2].layout).not.toBe(original.display_schedule?.pages[0].layout);
    expect(original.display_schedule?.pages).toHaveLength(2);
    expect(patch).not.toHaveProperty('active_layout_id');
  });
  it('switches to a saved layout without changing other pages or quiet hours', () => {
    const original = settings();
    expect(deviceLayoutChange(original, { type: 'select', id: 'two' })).toEqual({ active_layout_id: 'two', display_schedule: { ...original.display_schedule, enabled: false } });
    expect(deviceLayoutChange(original, { type: 'default' })).toEqual({ active_layout_id: null, display_schedule: { ...original.display_schedule, enabled: false } });
  });
  it('renames only the requested page and keeps current page ordering and timing', () => {
    const original = settings();
    const patch = deviceLayoutChange(original, { type: 'rename', id: 'one', name: ' Dining room ' });
    expect(patch.display_schedule?.pages[0]).toEqual({ ...original.display_schedule?.pages[0], name: 'Dining room' });
    expect(patch.display_schedule?.pages[1]).toEqual(original.display_schedule?.pages[1]);
    expect(patch.display_schedule?.enabled).toBe(true);
  });
  it('atomically replaces a removed selected layout and returns to the base after removing the final page', () => {
    let prefs = settings();
    prefs = { ...prefs, ...deviceLayoutChange(prefs, { type: 'remove', id: 'one' }) };
    expect(prefs.active_layout_id).toBe('two');
    const last = deviceLayoutChange(prefs, { type: 'remove', id: 'two' });
    expect(last).toMatchObject({ active_layout_id: null, display_schedule: { enabled: false, pages: [] } });
    expect(last).not.toHaveProperty('layout');
  });
  it('rejects removed IDs, empty names and an oversized library without mutating settings', () => {
    const prefs = settings();
    expect(() => deviceLayoutChange(prefs, { type: 'select', id: 'gone' })).toThrow('no longer exists');
    expect(() => deviceLayoutChange(prefs, { type: 'rename', id: 'one', name: ' ' })).toThrow('1–80');
    prefs.display_schedule!.pages = Array.from({ length: 12 }, (_, i) => ({ ...prefs.display_schedule!.pages[0], id: String(i) }));
    expect(() => deviceLayoutChange(prefs, { type: 'add', id: 'new', name: 'New' })).toThrow('12');
  });
  it('starts a library from existing base preferences without enabling rotation or changing content', () => {
    const prefs = { layout: DEFAULT_LAYOUT, display_timezone: 'America/New_York', custom_text: 'shared' } as UserPreferences;
    const patch = deviceLayoutChange(prefs, { type: 'add', id: 'one', name: 'First' });
    expect(patch).toMatchObject({ display_schedule: { enabled: false, timezone: 'America/New_York', pages: [{ layout: DEFAULT_LAYOUT }] } });
    expect(patch).not.toHaveProperty('custom_text');
  });
  it('retains device context in editor and dashboard routes', () => {
    expect(deviceLayoutPath('device-a', 'page-b')).toBe('/layout?device=device-a&page=page-b');
    expect(deviceDashboardPath('device-a')).toBe('/dashboard?device=device-a');
    expect(deviceLayoutPath(undefined, 'legacy')).toBe('/layout?page=legacy');
    expect(deviceLayoutPath()).toBe('/layout');
  });
});
