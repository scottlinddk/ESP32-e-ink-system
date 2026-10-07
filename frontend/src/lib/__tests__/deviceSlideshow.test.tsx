import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceSlideshowChanges, savedDeviceSchedule, slideshowPreviewPages, SlideshowConflictError, stepPreviewPage } from '../deviceSlideshow';
import { DeviceSlideshowCard } from '../../components/dashboard/DeviceSlideshowCard';
import { DEFAULT_LAYOUT, type DisplaySchedule, type UserPreferences } from '../../types';

const prefs = (): UserPreferences => ({
  layout: DEFAULT_LAYOUT, display_timezone: 'Europe/Copenhagen', active_layout_id: 'office',
  display_schedule: { enabled: false, timezone: 'America/New_York', quiet_hours: { enabled: true, start: '22:00', end: '07:00' },
    pages: [{ id: 'kitchen', name: 'Kitchen layout', duration_seconds: 60, layout: DEFAULT_LAYOUT },
      { id: 'office', name: 'Office layout', duration_seconds: 120, layout: { ...DEFAULT_LAYOUT, widgets: [] } }] },
}) as UserPreferences;
const session = vi.hoisted(() => ({ data: undefined as UserPreferences | undefined, lang: 'en', pending: false, error: false }));
const hooks = vi.hoisted(() => ({ preferences: vi.fn(), save: vi.fn() }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ getToken: async () => 'auth' }) }));
vi.mock('../../hooks/usePreferences', () => ({
  usePreferences: (id: string) => { hooks.preferences(id); return { data: session.data, isPending: session.pending, isError: session.error, refetch: vi.fn() }; },
  useSavePreferences: (id: string) => { hooks.save(id); return { isPending: false, mutateAsync: vi.fn() }; },
}));
vi.mock('../appContext', () => ({ useApp: () => ({ lang: session.lang }) }));
beforeEach(() => { vi.clearAllMocks(); session.data = prefs(); session.lang = 'en'; session.pending = false; session.error = false; });

describe('device slideshow save', () => {
  it('merges draft order/durations with the latest layout contents and renamed pages', () => {
    const initial = prefs();
    const draft: DisplaySchedule = { ...initial.display_schedule!, enabled: true, timezone: ' Europe/Copenhagen ',
      pages: [...initial.display_schedule!.pages].reverse().map((page) => ({ ...page, duration_seconds: 900 })) };
    const latest = prefs();
    latest.display_schedule!.pages[0] = { ...latest.display_schedule!.pages[0], name: 'New kitchen name', layout: { ...DEFAULT_LAYOUT, widgets: [] } };
    const patch = deviceSlideshowChanges(latest, draft, ['kitchen', 'office']);
    expect(patch.display_schedule).toMatchObject({ enabled: true, timezone: 'Europe/Copenhagen', quiet_hours: initial.display_schedule!.quiet_hours });
    expect(patch.display_schedule?.pages.map((page) => page.id)).toEqual(['office', 'kitchen']);
    expect(patch.display_schedule?.pages[1]).toEqual({ ...latest.display_schedule!.pages[0], duration_seconds: 900 });
    expect(initial.display_schedule!.pages[0].name).toBe('Kitchen layout');
  });
  it('switches back to a single layout without submitting stale selection, layout or source settings', () => {
    const latest = prefs(); latest.active_layout_id = 'kitchen';
    const patch = deviceSlideshowChanges(latest, { ...latest.display_schedule!, enabled: false }, ['kitchen', 'office']);
    expect(Object.keys(patch)).toEqual(['display_schedule']);
    expect(patch.display_schedule).toEqual(latest.display_schedule);
    expect({ ...latest, ...patch }.active_layout_id).toBe('kitchen');
  });
  it.each(['added', 'removed', 'replaced'] as const)('rejects %s library membership rather than overwriting fresh layouts', (change) => {
    const initial = prefs(); const latest = prefs();
    if (change === 'added') latest.display_schedule!.pages.push({ ...latest.display_schedule!.pages[0], id: 'new' });
    if (change === 'removed') latest.display_schedule!.pages.pop();
    if (change === 'replaced') latest.display_schedule!.pages[1].id = 'new';
    expect(() => deviceSlideshowChanges(latest, initial.display_schedule!, ['kitchen', 'office'])).toThrow(SlideshowConflictError);
  });
  it('rejects duplicate draft IDs and supports exactly one saved page', () => {
    const initial = prefs();
    const duplicate = { ...initial.display_schedule!, pages: [initial.display_schedule!.pages[0], initial.display_schedule!.pages[0]] };
    expect(() => deviceSlideshowChanges(initial, duplicate, ['kitchen', 'office'])).toThrow(SlideshowConflictError);
    initial.display_schedule!.pages.pop();
    expect(deviceSlideshowChanges(initial, { ...initial.display_schedule!, enabled: true }, ['kitchen']).display_schedule?.enabled).toBe(true);
  });
  it('cannot enable an empty slideshow but can retain an empty fixed mode', () => {
    const initial = { ...prefs(), display_schedule: null };
    const draft = savedDeviceSchedule(initial);
    expect(() => deviceSlideshowChanges(initial, { ...draft, enabled: true }, [])).toThrow('at least one');
    expect(deviceSlideshowChanges(initial, draft, []).display_schedule).toEqual(draft);
  });
  it.each([0, 59, 86401, 60.5, NaN])('rejects invalid duration %s', (duration_seconds) => {
    const initial = prefs(); const draft = structuredClone(initial.display_schedule!); draft.pages[0].duration_seconds = duration_seconds;
    expect(() => deviceSlideshowChanges(initial, draft, ['kitchen', 'office'])).toThrow('60–86400');
  });
  it('keeps quiet-hour and display time zones independent, supports overnight windows, and rejects invalid settings', () => {
    const initial = prefs(); const draft = initial.display_schedule!;
    expect(deviceSlideshowChanges(initial, draft, ['kitchen', 'office']).display_schedule?.timezone).toBe('America/New_York');
    expect(() => deviceSlideshowChanges(initial, { ...draft, timezone: 'No/Such_Zone' }, ['kitchen', 'office'])).toThrow('IANA');
    expect(() => deviceSlideshowChanges(initial, { ...draft, quiet_hours: { enabled: true, start: '23:00', end: '23:00' } }, ['kitchen', 'office'])).toThrow('different');
  });
});

describe('device slideshow controls', () => {
  const render = () => renderToStaticMarkup(<MemoryRouter><DeviceSlideshowCard deviceId="device-kitchen" /></MemoryRouter>);
  it('shows saved fixed mode, every page and its scoped editor link without another library form', () => {
    const html = render();
    expect(hooks.preferences).toHaveBeenCalledWith('device-kitchen');
    expect(hooks.save).toHaveBeenCalledWith('device-kitchen');
    expect(html).toContain('Saved mode:'); expect(html).toContain('Single layout · Office layout');
    expect(html).toContain('1. Kitchen layout'); expect(html).toContain('2. Office layout');
    expect(html).toContain('value="60"'); expect(html).toContain('value="120"');
    expect(html).toContain('/layout?device=device-kitchen&amp;page=office');
    expect(html).not.toContain('New layout name'); expect(html).not.toContain('Save name');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });
  it('shows a saved slideshow mode without pretending to know the physical current page', () => {
    session.data!.display_schedule!.enabled = true;
    const html = render();
    expect(html).toContain('<strong>Saved mode: </strong>Slideshow');
    expect(html).toContain('All saved layouts take part');
    expect(html).toContain('a sleeping device cannot be woken here');
    expect(html).not.toContain('Currently displayed');
  });
  it.each(['pending', 'error', 'missing'])('gates changes during %s settings and offers reload', (state) => {
    session.pending = state === 'pending'; session.error = state === 'error';
    if (state !== 'error') session.data = undefined;
    const html = render();
    expect(html).toMatch(/<fieldset disabled=""/);
    expect(html).toContain('Reload saved settings');
  });
  it('disables slideshow until a layout exists', () => {
    session.data!.display_schedule = null;
    const html = render();
    expect(html).toContain('<option value="slideshow" disabled="">');
    expect(html).toContain('Create at least one layout in Saved layouts');
  });
  it('localizes the new controls and saved mode in Danish', () => {
    session.lang = 'da';
    const html = render();
    expect(html).toContain('Visningstilstand og slideshow'); expect(html).toContain('Gemt tilstand:');
    expect(html).toContain('Fast layout · Office layout'); expect(html).toContain('Rækkefølge og varighed');
    expect(html).toContain('Genindlæs gemte indstillinger');
  });
});

describe('slideshow preview pages', () => {
  it('lists pages only for an enabled slideshow with more than one page', () => {
    const preferences = prefs();
    expect(slideshowPreviewPages(preferences)).toEqual([]);
    preferences.display_schedule!.enabled = true;
    expect(slideshowPreviewPages(preferences)).toEqual([{ id: 'kitchen', name: 'Kitchen layout' }, { id: 'office', name: 'Office layout' }]);
    preferences.display_schedule!.pages.pop();
    expect(slideshowPreviewPages(preferences)).toEqual([]);
    expect(slideshowPreviewPages(undefined)).toEqual([]);
  });

  it('steps in order, wraps at both ends and starts from the scheduled page', () => {
    const pages = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
    expect(stepPreviewPage(pages, 'a', 1)).toBe('b');
    expect(stepPreviewPage(pages, 'c', 1)).toBe('a');
    expect(stepPreviewPage(pages, 'a', -1)).toBe('c');
    expect(stepPreviewPage(pages, 'b', -1)).toBe('a');
    expect(stepPreviewPage(pages, null, 1)).toBe('a');
    expect(stepPreviewPage(pages, 'removed', -1)).toBe('c');
    expect(stepPreviewPage([], 'a', 1)).toBeUndefined();
  });
});
