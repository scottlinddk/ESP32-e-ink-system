/** Selectable device refresh intervals: every 5 minutes from 5 to 60. */
export const REFRESH_INTERVAL_STEP_MINUTES = 5;
export const REFRESH_INTERVAL_MAX_MINUTES = 60;
export const DEFAULT_REFRESH_INTERVAL_MINUTES = 30;

export const REFRESH_INTERVAL_OPTIONS: readonly number[] = Array.from(
  { length: REFRESH_INTERVAL_MAX_MINUTES / REFRESH_INTERVAL_STEP_MINUTES },
  (_, index) => (index + 1) * REFRESH_INTERVAL_STEP_MINUTES,
);

export function isSelectableRefreshInterval(minutes: number): boolean {
  return REFRESH_INTERVAL_OPTIONS.includes(minutes);
}

/**
 * The API still accepts 1–1440 minutes (templates and older saves), so keep a
 * saved off-grid value visible instead of silently showing a different one.
 */
export function refreshIntervalChoices(saved: number | undefined): number[] {
  const options = [...REFRESH_INTERVAL_OPTIONS];
  if (saved !== undefined && Number.isInteger(saved) && saved > 0 && !isSelectableRefreshInterval(saved)) {
    options.push(saved);
    options.sort((a, b) => a - b);
  }
  return options;
}

export function formatRefreshInterval(minutes: number, da: boolean): string {
  if (minutes === 60) return da ? '1 time' : '1 hour';
  if (minutes > 60 && minutes % 60 === 0) return da ? `${minutes / 60} timer` : `${minutes / 60} hours`;
  return `${minutes} min`;
}
