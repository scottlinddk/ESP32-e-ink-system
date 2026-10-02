import type { DisplaySchedule, UserPreferences } from '../types';

export class SlideshowConflictError extends Error {
  constructor() { super('Saved layouts were added or removed. Reload saved settings before editing the slideshow again.'); }
}

export function savedDeviceSchedule(preferences?: UserPreferences): DisplaySchedule {
  return preferences?.display_schedule ?? {
    enabled: false, timezone: preferences?.display_timezone ?? 'Europe/Copenhagen', pages: [],
    quiet_hours: { enabled: false, start: '22:00', end: '07:00' },
  };
}

/** Keep freshly saved layout contents/names, changing only slideshow controls. */
export function deviceSlideshowChanges(latest: UserPreferences, draft: DisplaySchedule, originalIds: string[]): Partial<UserPreferences> {
  const current = savedDeviceSchedule(latest);
  const sameIds = (pages: DisplaySchedule['pages']) => pages.length === originalIds.length
    && new Set(pages.map((page) => page.id)).size === originalIds.length && pages.every((page) => originalIds.includes(page.id));
  if (!sameIds(current.pages) || !sameIds(draft.pages)) throw new SlideshowConflictError();
  if (draft.enabled && !draft.pages.length) throw new Error('Save at least one layout before enabling the slideshow.');
  if (draft.pages.some((page) => !Number.isInteger(page.duration_seconds) || page.duration_seconds < 60 || page.duration_seconds > 86400)) {
    throw new Error('Each layout duration must be 60–86400 whole seconds.');
  }
  const timezone = draft.timezone.trim();
  if (timezone.length > 64 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(timezone)) throw new Error('Choose a valid IANA time zone.');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw new Error('Choose a valid IANA time zone.'); }
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(draft.quiet_hours.start) || !time.test(draft.quiet_hours.end)
    || draft.quiet_hours.enabled && draft.quiet_hours.start === draft.quiet_hours.end) throw new Error('Quiet hours need valid, different start and end times.');
  return { display_schedule: {
    enabled: draft.enabled, timezone, quiet_hours: { ...draft.quiet_hours },
    pages: draft.pages.map((page) => ({ ...current.pages.find((saved) => saved.id === page.id)!, duration_seconds: page.duration_seconds })),
  } };
}
