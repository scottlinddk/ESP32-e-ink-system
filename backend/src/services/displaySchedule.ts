import type { DisplayData, DisplayLayout, DisplaySchedule, UserPreferences } from '../types';
import { parseDisplaySchedule } from '../utils/scheduleValidation';
import { activeTimedLayout, nextTimedBoundary } from './timedLayouts';

export interface ResolvedDisplaySchedule {
  layout: DisplayLayout | null;
  nextRefresh: number;
  schedule?: NonNullable<DisplayData['schedule']>;
}
const MINUTE = 60_000;

function quietChecker(schedule: DisplaySchedule): (timestamp: number) => boolean {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: schedule.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const start = minutes(schedule.quiet_hours.start);
  const end = minutes(schedule.quiet_hours.end);
  return (timestamp) => {
    const parts = formatter.formatToParts(timestamp);
    const hour = Number(parts.find((part) => part.type === 'hour')!.value);
    const minute = Number(parts.find((part) => part.type === 'minute')!.value);
    const current = hour * 60 + minute;
    return start < end ? current >= start && current < end : current >= start || current < end;
  };
}

/** Find actual UTC transitions, including skipped/repeated local minutes at DST changes. */
function quietBoundary(timestamp: number, direction: 1 | -1, isQuiet: (timestamp: number) => boolean, quiet: boolean): number {
  let candidate = direction === 1 ? Math.floor(timestamp / MINUTE) * MINUTE + MINUTE : Math.floor(timestamp / MINUTE) * MINUTE - 1;
  // Daily quiet windows transition within 72 hours even across date-line changes.
  for (let count = 0; count < 3 * 24 * 60; count++, candidate += direction * MINUTE) {
    if (isQuiet(candidate) !== quiet) return direction === 1 ? candidate : Math.floor(candidate / MINUTE) * MINUTE + MINUTE;
  }
  throw new Error('Could not resolve quiet-hour boundary');
}

/**
 * UTC-anchored rotation is deterministic across processes and daylight-saving changes. A timed layout
 * overrides it, a single layout and quiet hours while its window is open; rotation then resumes where the cycle is.
 */
export function resolveDisplaySchedule(prefs: Pick<UserPreferences, 'display_schedule' | 'layout' | 'refresh_interval_minutes'>, now = new Date()): ResolvedDisplaySchedule {
  const fallback = { layout: prefs.layout ?? null, nextRefresh: prefs.refresh_interval_minutes * MINUTE };
  if (!prefs.display_schedule) return fallback;
  let schedule: DisplaySchedule;
  try { schedule = parseDisplaySchedule(prefs.display_schedule); } catch { return fallback; }
  const timed = schedule.timed_layouts ?? [];
  const rotating = schedule.enabled && schedule.pages.length > 0;
  if (!rotating && timed.length === 0) return fallback;
  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp)) throw new Error('Invalid schedule time');
  let quiet = false;
  let pageTime = timestamp;
  let quietChange = Infinity;
  // Quiet hours belong to the slideshow; they never silence a single layout.
  if (rotating && schedule.quiet_hours.enabled) {
    const isQuiet = quietChecker(schedule);
    quiet = isQuiet(timestamp);
    quietChange = quietBoundary(timestamp, 1, isQuiet, quiet);
    if (quiet) pageTime = quietBoundary(timestamp, -1, isQuiet, true);
  }
  const timedChange = nextTimedBoundary(timed, schedule.timezone, timestamp);
  // A timed layout overrules everything, quiet hours included: its window wakes the display.
  const activeRule = activeTimedLayout(timed, schedule.timezone, timestamp);
  if (activeRule) quiet = false;
  let selected: DisplaySchedule['pages'][number] | undefined;
  let pageChange = Infinity;
  if (activeRule) {
    selected = schedule.pages.find((page) => page.id === activeRule.layout_id);
  } else if (rotating) {
    const cycle = schedule.pages.reduce((total, page) => total + page.duration_seconds * 1000, 0);
    let offset = ((pageTime % cycle) + cycle) % cycle;
    selected = schedule.pages[0];
    for (const page of schedule.pages) {
      selected = page;
      if (offset < page.duration_seconds * 1000) break;
      offset -= page.duration_seconds * 1000;
    }
    pageChange = timestamp + selected.duration_seconds * 1000 - offset;
  }
  const nextTransition = quiet ? Math.min(quietChange, timedChange) : Math.min(pageChange, quietChange, timedChange);
  const nextRefresh = Math.max(1, quiet ? nextTransition - timestamp : Math.min(fallback.nextRefresh, nextTransition - timestamp));
  // A single layout between timed windows reports no schedule, so it keeps drawing the saved layout.
  if (!selected) return { layout: fallback.layout, nextRefresh };
  return {
    layout: selected.layout,
    nextRefresh,
    schedule: { pageId: selected.id, pageName: selected.name, quiet, nextTransitionAt: new Date(nextTransition).toISOString(), ...(activeRule ? { timed: true } : {}) },
  };
}

/** Select the exact page chosen when this data request started, even across a boundary. */
export function layoutForDisplayData(prefs: UserPreferences, data: DisplayData): DisplayLayout | null {
  return prefs.display_schedule?.pages.find((page) => page.id === data.schedule?.pageId)?.layout ?? prefs.layout ?? null;
}
