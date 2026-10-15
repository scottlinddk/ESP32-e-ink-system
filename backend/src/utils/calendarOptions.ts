import { daysBetween, isCalendarDay } from './calendarDays';

export const MAX_CALENDAR_EVENTS = 300;
const MAX_RANGE_DAYS = 120;

export interface CalendarOptions {
  timezone: string; days: number; limit: number;
  /**
   * Whole local days to return, inclusive, instead of the upcoming `days` from now. Events that
   * ended earlier today are kept, so day and month views can show the whole day.
   */
  range?: { from: string; to: string };
  /** How many events to return, up to MAX_CALENDAR_EVENTS. Defaults to `limit`. */
  maxEvents?: number;
}

export function validateCalendarOptions(options: CalendarOptions): void {
  if (typeof options.timezone !== 'string' || options.timezone.length > 100 || !/^[A-Za-z_][A-Za-z0-9_+\/-]*$/.test(options.timezone)) throw new Error('Invalid calendar timezone');
  try { new Intl.DateTimeFormat('en', { timeZone: options.timezone }); } catch { throw new Error('Invalid calendar timezone'); }
  if (!Number.isInteger(options.days) || options.days < 1 || options.days > 30) throw new Error('Calendar days must be between 1 and 30');
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 10) throw new Error('Calendar event limit must be between 1 and 10');
  const { range, maxEvents } = options;
  if (range !== undefined && (!isCalendarDay(range?.from) || !isCalendarDay(range?.to) || range.from > range.to
    || daysBetween(range.from, range.to) >= MAX_RANGE_DAYS)) throw new Error('Calendar range is invalid');
  if (maxEvents !== undefined && (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > MAX_CALENDAR_EVENTS)) {
    throw new Error(`Calendar event count must be between 1 and ${MAX_CALENDAR_EVENTS}`);
  }
}
