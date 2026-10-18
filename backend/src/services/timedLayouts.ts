import type { TimedLayout } from '../types';

const DAY = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
    });
    formatters.set(timeZone, found);
  }
  return found;
}

function localParts(timeZone: string, timestamp: number): Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number> {
  const parts = formatter(timeZone).formatToParts(timestamp);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)!.value);
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute'), second: part('second') };
}

/** Milliseconds the zone's wall clock is ahead of UTC at this instant. */
function offsetAt(timeZone: string, timestamp: number): number {
  const local = localParts(timeZone, timestamp);
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - Math.floor(timestamp / 1000) * 1000;
}

/**
 * The UTC instant of a local wall-clock time. A repeated time (clocks go back) resolves to its
 * first occurrence; a skipped time (clocks go forward) resolves to the same offset past the gap.
 */
export function zonedTimeToUtc(timeZone: string, year: number, month: number, day: number, hour: number, minute: number): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const candidates = [guess - offsetAt(timeZone, guess - DAY), guess - offsetAt(timeZone, guess + DAY)];
  const valid = candidates.filter((candidate) => offsetAt(timeZone, candidate) === guess - candidate);
  return valid.length ? Math.min(...valid) : Math.max(...candidates);
}

interface Occurrence { rule: TimedLayout; start: number; end: number }

/** Windows starting on the local day before, of and after `timestamp`: enough to find the active and next ones. */
function occurrences(rules: TimedLayout[], timeZone: string, timestamp: number): Occurrence[] {
  const today = localParts(timeZone, timestamp);
  const found: Occurrence[] = [];
  for (const rule of rules) {
    const hour = Number(rule.start.slice(0, 2));
    const minute = Number(rule.start.slice(3));
    for (let shift = -1; shift <= 2; shift++) {
      const start = zonedTimeToUtc(timeZone, today.year, today.month, today.day + shift, hour, minute);
      found.push({ rule, start, end: start + rule.duration_seconds * 1000 });
    }
  }
  return found;
}

/** The rule showing at `timestamp`. Overlaps go to the one that started last, then to the one listed first. */
export function activeTimedLayout(rules: TimedLayout[], timeZone: string, timestamp: number): TimedLayout | null {
  let best: Occurrence | null = null;
  for (const entry of occurrences(rules, timeZone, timestamp)) {
    if (entry.start <= timestamp && timestamp < entry.end && (!best || entry.start > best.start)) best = entry;
  }
  return best?.rule ?? null;
}

/** The next instant after `timestamp` at which any rule starts or ends, or Infinity without rules. */
export function nextTimedBoundary(rules: TimedLayout[], timeZone: string, timestamp: number): number {
  let next = Infinity;
  for (const entry of occurrences(rules, timeZone, timestamp)) {
    for (const boundary of [entry.start, entry.end]) if (boundary > timestamp && boundary < next) next = boundary;
  }
  return next;
}
