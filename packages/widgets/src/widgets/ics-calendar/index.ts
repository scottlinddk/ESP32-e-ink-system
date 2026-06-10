import { z } from 'zod';
import * as ical from 'node-ical';
import type { Widget, PixelRegion, TypographyScale, RenderedWidget, WidgetResult } from '@esp32-eink/types';
import type { IcsCalendarConfig, IcsCalendarData, IcsCalendarEvent } from './types';

export const configSchema = z.object({
  url: z.string().url(),
  label: z.string().optional(),
  maxEvents: z.number().int().min(1).max(10).optional(),
  daysAhead: z.number().int().min(1).max(90).optional(),
});

function extractSummary(raw: ical.ParameterValue): string {
  if (typeof raw === 'string') return raw;
  return raw.val ?? '(No title)';
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

async function fetchEvents(
  url: string,
  daysAhead: number,
  maxEvents: number
): Promise<IcsCalendarEvent[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  let icsText: string;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`ICS fetch failed: ${res.status}`);
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
      // Expand recurring events within the window
      const instances = ical.expandRecurringEvent(event, { from: now, to: cutoff });
      for (const inst of instances) {
        const allDay = inst.isFullDay;
        events.push({
          summary: extractSummary(inst.summary).slice(0, 40),
          timeLabel: allDay ? 'All day' : formatTime(inst.start),
          isToday: isSameDay(inst.start, today),
        });
      }
    } else {
      const start = event.start as Date;
      if (!start || start > cutoff) continue;
      const end = (event.end ?? start) as Date;
      if (end < now) continue;

      const allDay = event.datetype === 'date';
      events.push({
        summary: extractSummary(event.summary).slice(0, 40),
        timeLabel: allDay ? 'All day' : formatTime(start),
        isToday: isSameDay(start, today),
      });
    }
  }

  events.sort((a, b) => {
    const todayDiff = (b.isToday ? 1 : 0) - (a.isToday ? 1 : 0);
    return todayDiff !== 0 ? todayDiff : (a.timeLabel === 'All day' ? -1 : 1);
  });

  return events.slice(0, maxEvents);
}

export const icsCalendarWidget: Widget<IcsCalendarConfig, IcsCalendarData> = {
  meta: {
    id: 'ics-calendar',
    name: 'ICS Calendar',
    description: 'Upcoming events from any .ics calendar feed (iCloud, Google, Outlook).',
    category: 'general',
  },

  configSchema,

  async fetch(
    config: IcsCalendarConfig,
    _region: PixelRegion
  ): Promise<WidgetResult<IcsCalendarData>> {
    try {
      const daysAhead = config.daysAhead ?? 7;
      const maxEvents = config.maxEvents ?? 3;
      const label = config.label ?? 'Calendar';
      const events = await fetchEvents(config.url, daysAhead, maxEvents);

      return {
        ok: true,
        data: {
          label,
          today: formatDate(new Date()),
          events,
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  render(data: IcsCalendarData, region: PixelRegion, typography: TypographyScale): RenderedWidget {
    const elements: RenderedWidget['elements'] = [];
    let y = 2;

    elements.push({ kind: 'text', text: `${data.label}  ${data.today}`, x: 2, y, fontSize: typography.sm });
    y += typography.sm + 3;
    elements.push({ kind: 'hline', x: 0, y, width: region.widthPx });
    y += 3;

    if (data.events.length === 0) {
      elements.push({ kind: 'text', text: 'No upcoming events', x: 2, y, fontSize: typography.sm });
    } else {
      for (const ev of data.events) {
        if (y + typography.sm > region.heightPx - 2) break;
        const label = `${ev.timeLabel}  ${ev.summary}`;
        elements.push({ kind: 'text', text: label, x: 2, y, fontSize: typography.sm });
        y += typography.sm + 2;
      }
    }

    return { region, elements };
  },
};
