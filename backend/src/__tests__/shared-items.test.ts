import { describe, expect, it } from 'vitest';
import { buildAcceptUpdates, parsePayload, portableLayout, portableWidget, summarize, SharedItemError } from '../utils/sharedItems';
import { DEFAULT_PREFS } from '../services/displayData';
import type { DisplayLayout, UserPreferences } from '../types';

const layout = (widgets: DisplayLayout['widgets'], cols = 10, rows = 6): DisplayLayout => ({ version: 1, cols, rows, widgets });
const prefs = (extra: Partial<UserPreferences> = {}): UserPreferences => ({ ...DEFAULT_PREFS, layout: null, display_schedule: null, ...extra });

describe('portableLayout', () => {
  it('keeps built-in widgets and reports account-specific ones it leaves behind', () => {
    const source = layout([{ i: 'weather', x: 0, y: 0, w: 4, h: 2 }, { i: 'news:abc123', x: 4, y: 0, w: 4, h: 2 }]);
    const { layout: portable, dropped } = portableLayout(source);
    expect(portable.widgets.map((widget) => widget.i)).toEqual(['weather']);
    expect(dropped).toBe(1);
  });
});

describe('portableWidget', () => {
  it('refuses widgets that depend on the sender’s own sources', () => {
    expect(() => portableWidget(layout([{ i: 'news:abc123', x: 0, y: 0, w: 2, h: 2 }]), 'news:abc123')).toThrow(SharedItemError);
  });
  it('is not found when the widget is not in the layout', () => {
    expect(() => portableWidget(layout([]), 'weather')).toThrow(/not in the selected layout/);
  });
});

describe('parsePayload', () => {
  it('rejects damaged or tampered payloads', () => {
    expect(() => parsePayload('layout', null)).toThrow(SharedItemError);
    expect(() => parsePayload('layout', { layout: { version: 1, cols: 3, rows: 3, widgets: [] } })).toThrow();
    expect(() => parsePayload('widget', { layout_cols: 10, layout_rows: 6, widget: { i: 'weather', x: 9, y: 0, w: 5, h: 1 } })).toThrow();
  });
});

describe('accepting a layout', () => {
  const payload = { layout: layout([{ i: 'weather', x: 0, y: 0, w: 5, h: 3 }]) };
  it('adds a new saved layout without touching existing ones', () => {
    const current = prefs();
    const updates = buildAcceptUpdates('layout', payload, current, { name: 'Kitchen' });
    expect(updates.display_schedule?.pages).toHaveLength(1);
    expect(updates.display_schedule?.pages[0]).toMatchObject({ name: 'Kitchen', duration_seconds: 300 });
    expect(updates.display_schedule?.enabled).toBe(false);
  });
  it('stops at the 12 layout limit', () => {
    const pages = Array.from({ length: 12 }, (_, n) => ({ id: `p${n}`, name: `P${n}`, duration_seconds: 60, layout: layout([]) }));
    const current = prefs({ display_schedule: { enabled: true, timezone: 'Europe/Copenhagen', pages, quiet_hours: { enabled: false, start: '22:00', end: '06:00' } } });
    expect(() => buildAcceptUpdates('layout', payload, current)).toThrow(/at most 12/);
  });
});

describe('accepting a widget', () => {
  const payload = { layout_cols: 10, layout_rows: 6, widget: { i: 'weather', x: 0, y: 0, w: 3, h: 2 } };
  it('uses the first free spot and leaves the recipient’s widgets in place', () => {
    const current = prefs({ layout: layout([{ i: 'energy', x: 0, y: 0, w: 5, h: 6 }]) });
    const updates = buildAcceptUpdates('widget', payload, current);
    expect(updates.layout?.widgets.find((widget) => widget.i === 'weather')).toMatchObject({ x: 5, y: 0, w: 3, h: 2 });
    expect(updates.layout?.widgets.find((widget) => widget.i === 'energy')).toMatchObject({ x: 0, y: 0 });
  });
  it('scales to a finer recipient grid', () => {
    const current = prefs({ layout: layout([], 20, 12) });
    expect(buildAcceptUpdates('widget', payload, current).layout?.widgets[0]).toMatchObject({ w: 6, h: 4 });
  });
  it('explains a duplicate, a full layout and a missing layout', () => {
    expect(() => buildAcceptUpdates('widget', payload, prefs({ layout: layout([{ i: 'weather', x: 0, y: 0, w: 1, h: 1 }]) }))).toThrow(/already has/);
    expect(() => buildAcceptUpdates('widget', payload, prefs({ layout: layout([{ i: 'energy', x: 0, y: 0, w: 10, h: 6 }]) }))).toThrow(/no free space/);
    expect(() => buildAcceptUpdates('widget', payload, prefs())).toThrow(/no base layout/);
  });
  it('can target a saved layout', () => {
    const page = { id: 'main', name: 'Main', duration_seconds: 60, layout: layout([]) };
    const current = prefs({ display_schedule: { enabled: false, timezone: 'Europe/Copenhagen', pages: [page], quiet_hours: { enabled: false, start: '22:00', end: '06:00' } } });
    expect(buildAcceptUpdates('widget', payload, current, { page_id: 'main' }).display_schedule?.pages[0].layout.widgets).toHaveLength(1);
    expect(() => buildAcceptUpdates('widget', payload, current, { page_id: 'missing' })).toThrow(/not found/);
  });
});

describe('accepting a dashboard', () => {
  const payload = { layout: layout([{ i: 'weather', x: 0, y: 0, w: 5, h: 3 }]), enabled: true, pages: [{ name: 'Day', duration_seconds: 120, layout: layout([]) }] };
  it('replaces layouts but keeps the recipient’s time zone, quiet hours and panel', () => {
    const current = prefs({
      display_profile: { width: 400, height: 300, rotation: 0, colorMode: 'bw' },
      display_schedule: { enabled: false, timezone: 'Europe/London', pages: [], quiet_hours: { enabled: true, start: '23:00', end: '05:00' } },
      active_layout_id: 'old',
    });
    const updates = buildAcceptUpdates('dashboard', payload, current);
    expect(updates.display_schedule).toMatchObject({ enabled: true, timezone: 'Europe/London', quiet_hours: { enabled: true, start: '23:00', end: '05:00' } });
    expect(updates.display_schedule?.pages[0]).toMatchObject({ name: 'Day', duration_seconds: 120 });
    expect(updates.active_layout_id).toBeNull();
    expect(updates).not.toHaveProperty('display_profile');
    expect(updates).not.toHaveProperty('display_timezone');
  });
  it('summarizes what it contains', () => {
    expect(summarize('dashboard', parsePayload('dashboard', payload))).toEqual({ widgets: ['weather'], pages: 1 });
  });
});
