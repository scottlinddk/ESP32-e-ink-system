import * as ical from 'node-ical';
import { createHash } from 'crypto';
import { CacheEntry } from '../types/index';
import { IcsCalendarData, IcsCalendarEvent } from '../types/index';

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const FETCH_TIMEOUT_MS = 10_000;

const cache = new Map<string, CacheEntry<IcsCalendarData>>();

function isCacheValid<T>(entry: CacheEntry<T>): boolean {
  return Date.now() < entry.expiresAt;
}

function extractSummary(raw: ical.ParameterValue): string {
  if (typeof raw === 'string') return raw;
  return raw.val ?? '(No title)';
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export async function fetchIcsCalendarData(
  url: string,
  opts: { label?: string; maxEvents?: number; daysAhead?: number } = {}
): Promise<IcsCalendarData> {
  const { label = 'Calendar', maxEvents = 3, daysAhead = 7 } = opts;

  // Use a hash of the URL as cache key to avoid logging private iCloud URLs
  const cacheKey = createHash('sha256').update(url).digest('hex').slice(0, 16);
  const cached = cache.get(cacheKey);
  if (cached && isCacheValid(cached)) {
    return cached.data;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let icsText: string;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`ICS fetch failed: ${res.status} ${res.statusText}`);
    icsText = await res.text();
  } finally {
    clearTimeout(timeout);
  }

  const cal = await ical.async.parseICS(icsText);

  const now = new Date();
  const cutoff = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const events: IcsCalendarEvent[] = [];

  for (const key of Object.keys(cal)) {
    const component = cal[key];
    if (!component || component.type !== 'VEVENT') continue;
    const event = component as ical.VEvent;

    if (event.rrule) {
      const instances = ical.expandRecurringEvent(event, { from: now, to: cutoff });
      for (const inst of instances) {
        events.push({
          summary: extractSummary(inst.summary).slice(0, 40),
          timeLabel: inst.isFullDay ? 'All day' : formatTime(inst.start),
          isToday: isSameDay(inst.start, today),
        });
      }
    } else {
      const start = event.start as Date;
      if (!start || start > cutoff) continue;
      const end = (event.end ?? start) as Date;
      if (end < now) continue;

      events.push({
        summary: extractSummary(event.summary).slice(0, 40),
        timeLabel: event.datetype === 'date' ? 'All day' : formatTime(start),
        isToday: isSameDay(start, today),
      });
    }
  }

  // Sort: today first, then chronological; all-day events before timed events within the same day
  events.sort((a, b) => {
    if (a.isToday !== b.isToday) return a.isToday ? -1 : 1;
    if (a.timeLabel === 'All day' && b.timeLabel !== 'All day') return -1;
    if (a.timeLabel !== 'All day' && b.timeLabel === 'All day') return 1;
    return a.timeLabel.localeCompare(b.timeLabel);
  });

  const result: IcsCalendarData = {
    label,
    today: formatDate(now),
    events: events.slice(0, maxEvents),
  };

  cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

export function clearIcsCache(): void {
  cache.clear();
}
