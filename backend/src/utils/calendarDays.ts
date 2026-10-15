// Calendar day arithmetic on YYYY-MM-DD strings. Days are plain dates in the calendar's own
// time zone, so everything here runs in UTC and never depends on the server's zone.
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DAY.exec(value);
  if (!match) return false;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return parsed.getUTCFullYear() === Number(match[1]) && parsed.getUTCMonth() === Number(match[2]) - 1 && parsed.getUTCDate() === Number(match[3]);
}

/** The calendar day of an instant in an IANA time zone. */
export function localDay(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)!.value).join('-');
}

export function dayToUtc(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date);
}

export function utcToDay(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function shiftDay(day: string, days: number): string { return utcToDay(dayToUtc(day) + days * DAY_MS); }

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function daysBetween(a: string, b: string): number { return Math.round((dayToUtc(b) - dayToUtc(a)) / DAY_MS); }

/** 0 for Monday to 6 for Sunday: weeks start on Monday. */
export function weekdayIndex(day: string): number { return (new Date(dayToUtc(day)).getUTCDay() + 6) % 7; }

export interface MonthGrid {
  /** Monday on or before the 1st of the month. */
  start: string;
  /** Sunday on or after the last day of the month. */
  end: string;
  first: string;
  last: string;
  weeks: number;
}

/** The Monday-first grid of whole weeks that holds the month of `day`. */
export function monthGrid(day: string): MonthGrid {
  const first = `${day.slice(0, 7)}-01`;
  const [year, month] = day.split('-').map(Number);
  const last = utcToDay(Date.UTC(year, month, 0));
  const start = shiftDay(first, -weekdayIndex(first));
  const end = shiftDay(last, 6 - weekdayIndex(last));
  return { start, end, first, last, weeks: (daysBetween(start, end) + 1) / 7 };
}

/**
 * The days to fetch so every view has its data: the month grid for the month view, and the
 * configured horizon for the list, day and days views.
 */
export function calendarFetchRange(today: string, days: number): { from: string; to: string } {
  const grid = monthGrid(today);
  const horizon = shiftDay(today, Math.max(days, 7) - 1);
  return { from: grid.start < today ? grid.start : today, to: grid.end > horizon ? grid.end : horizon };
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

export const weekdayName = (day: string): string => WEEKDAYS[weekdayIndex(day)];
export const monthShort = (day: string): string => MONTHS[Number(day.slice(5, 7)) - 1];
export const monthName = (day: string): string => MONTH_NAMES[Number(day.slice(5, 7)) - 1];
export const dayOfMonth = (day: string): number => Number(day.slice(8, 10));
