import type { TimedLayout, UserPreferences } from '../types';
import { savedDeviceSchedule } from './deviceSlideshow';

export const MAX_TIMED_LAYOUTS = 24;
export const MIN_TIMED_SECONDS = 10;
export const MAX_TIMED_SECONDS = 86399;

export type DurationUnit = 'seconds' | 'minutes' | 'hours';
export const DURATION_UNITS: DurationUnit[] = ['seconds', 'minutes', 'hours'];
const UNIT_SECONDS: Record<DurationUnit, number> = { seconds: 1, minutes: 60, hours: 3600 };

export class TimedLayoutConflictError extends Error {
  constructor() { super('A saved layout was removed. Reload saved settings before editing timed layouts again.'); }
}

/** Show a duration in the largest unit that represents it exactly, so 90 s stays 90 seconds, not 1.5 minutes. */
export function splitDuration(seconds: number): { amount: number; unit: DurationUnit } {
  const unit = [...DURATION_UNITS].reverse().find((candidate) => seconds >= UNIT_SECONDS[candidate] && seconds % UNIT_SECONDS[candidate] === 0) ?? 'seconds';
  return { amount: seconds / UNIT_SECONDS[unit], unit };
}

export const toSeconds = (amount: number, unit: DurationUnit) => Math.round(amount * UNIT_SECONDS[unit]);

export const savedTimedLayouts = (preferences?: UserPreferences): TimedLayout[] => preferences?.display_schedule?.timed_layouts ?? [];

/** A new rule starts at 07:00 for fifteen minutes on the first saved layout. */
export function newTimedLayout(layoutId: string, id: string): TimedLayout {
  return { id, layout_id: layoutId, start: '07:00', duration_seconds: 900 };
}

/** Replace only the timed layouts on the latest saved schedule, leaving layouts, slideshow and quiet hours as saved. */
export function timedLayoutChanges(latest: UserPreferences, draft: TimedLayout[]): Partial<UserPreferences> {
  const current = savedDeviceSchedule(latest);
  if (draft.length > MAX_TIMED_LAYOUTS) throw new Error(`At most ${MAX_TIMED_LAYOUTS} timed layouts fit on a device.`);
  if (new Set(draft.map((rule) => rule.id)).size !== draft.length) throw new Error('Each timed layout needs a unique ID.');
  if (draft.some((rule) => !current.pages.some((page) => page.id === rule.layout_id))) throw new TimedLayoutConflictError();
  if (draft.some((rule) => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(rule.start))) throw new Error('Choose a start time for every timed layout.');
  if (draft.some((rule) => !Number.isInteger(rule.duration_seconds) || rule.duration_seconds < MIN_TIMED_SECONDS || rule.duration_seconds > MAX_TIMED_SECONDS)) {
    throw new Error('Each timed layout must last from 10 seconds to 23 hours 59 minutes.');
  }
  const { timed_layouts: _replaced, ...rest } = current;
  return { display_schedule: { ...rest, ...(draft.length ? { timed_layouts: draft.map((rule) => ({ ...rule })) } : {}) } };
}
