// Calendar helpers in the display time zone. Usage "today" follows the display's local
// day; billed cost follows the providers' UTC billing month.

function zonedParts(instant: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute'), second: part('second') };
}

/** The local calendar date, YYYY-MM-DD. */
export function localDay(now: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(now, timeZone);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Offset of the zone from UTC at `instant`, in milliseconds. */
function offsetAt(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant the current local day began. */
export function startOfLocalDay(now: Date, timeZone: string): Date {
  const { year, month, day } = zonedParts(now, timeZone);
  const midnightAsUtc = Date.UTC(year, month - 1, day);
  // Two passes settle the offset when midnight is near a DST change.
  let guess = midnightAsUtc - offsetAt(new Date(midnightAsUtc), timeZone);
  guess = midnightAsUtc - offsetAt(new Date(guess), timeZone);
  return new Date(guess);
}

export function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
