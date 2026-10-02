import { DEFAULT_LAYOUT, type DisplaySchedule, type UserPreferences } from '../types';

export type LayoutAction = { type: 'add'; id: string; name: string } | { type: 'rename'; id: string; name: string }
  | { type: 'remove'; id: string } | { type: 'select'; id: string } | { type: 'default' };

/** Apply one library action to the latest saved device settings, preserving unrelated pages. */
export function deviceLayoutChange(preferences: UserPreferences, action: LayoutAction): Partial<UserPreferences> {
  const schedule: DisplaySchedule = preferences.display_schedule ?? {
    enabled: false, timezone: preferences.display_timezone ?? 'Europe/Copenhagen', pages: [],
    quiet_hours: { enabled: false, start: '22:00', end: '07:00' },
  };
  if (action.type === 'default') return { active_layout_id: null, display_schedule: { ...schedule, enabled: false } };
  const existing = schedule.pages.find((page) => page.id === action.id);
  if (action.type !== 'add' && !existing) throw new Error('This layout no longer exists. Reload the saved layouts.');
  if (action.type === 'select') return { active_layout_id: action.id, display_schedule: { ...schedule, enabled: false } };
  if (action.type === 'remove') {
    const pages = schedule.pages.filter((page) => page.id !== action.id);
    return { display_schedule: { ...schedule, pages, enabled: schedule.enabled && pages.length > 0 },
      ...(preferences.active_layout_id === action.id ? { active_layout_id: pages[0]?.id ?? null } : {}) };
  }
  const name = action.name.trim();
  if (!name || name.length > 80) throw new Error('Layout names must contain 1–80 characters.');
  if (action.type === 'rename') return { display_schedule: { ...schedule, pages: schedule.pages.map((page) => page.id === action.id ? { ...page, name } : page) } };
  if (schedule.pages.length >= 12 || existing) throw new Error('A device supports up to 12 saved layouts with unique IDs.');
  const current = schedule.pages.find((page) => page.id === preferences.active_layout_id)?.layout ?? preferences.layout ?? DEFAULT_LAYOUT;
  return { display_schedule: { ...schedule, pages: [...schedule.pages, { id: action.id, name, duration_seconds: 900, layout: structuredClone(current) }] } };
}

export const deviceDashboardPath = (deviceId?: string) => deviceId ? `/dashboard?device=${encodeURIComponent(deviceId)}` : '/dashboard';
export function deviceLayoutPath(deviceId?: string, pageId?: string) {
  const query = new URLSearchParams();
  if (deviceId) query.set('device', deviceId);
  if (pageId) query.set('page', pageId);
  return `/layout${query.size ? `?${query}` : ''}`;
}
