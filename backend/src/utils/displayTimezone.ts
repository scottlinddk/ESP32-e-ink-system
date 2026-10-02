export const DEFAULT_DISPLAY_TIMEZONE = 'Europe/Copenhagen';

export function parseDisplayTimezone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(value)) {
    throw new Error('Choose a valid IANA display time zone, for example Europe/Copenhagen.');
  }
  try { new Intl.DateTimeFormat('en', { timeZone: value }); }
  catch { throw new Error('Choose a valid IANA display time zone, for example Europe/Copenhagen.'); }
  return value;
}
