import type { EventInstance, VEvent } from 'node-ical';
import type { CalendarData, CalendarEvent } from '../types';

// Self-contained so the same function runs in a worker from both TS tests and
// compiled CommonJS deployments. No calendar input is ever evaluated as code.
export function runCalendarWorker(): void {
  const { parentPort, workerData } = require('node:worker_threads') as typeof import('node:worker_threads');
  const ical = require(workerData.icalPath) as typeof import('node-ical');
  const windowsZones = require(require('node:path').join(require('node:path').dirname(workerData.icalPath), 'windowsZones.json')) as Record<string, { iana: string[] }>;
  const { text, timezone, days, limit, now } = workerData as {
    text: string; timezone: string; days: number; limit: number; now: number;
  };
  try {
    const lines = text.replace(/^\uFEFF/, '').replace(/\r?\n[ \t]/g, '').trim().split(/\r?\n/);
    if (lines.length > 20_000 || lines[0] !== 'BEGIN:VCALENDAR' || lines[lines.length - 1] !== 'END:VCALENDAR') throw new Error();
    const stack: string[] = [];
    let eventCount = 0;
    let calendarCount = 0;
    let version = false;
    let eventFields = new Set<string>();
    const normalized = lines.map((line) => {
      if (!line || !line.includes(':')) throw new Error();
      if (line.startsWith('BEGIN:')) {
        const component = line.slice(6);
        if (component === 'VCALENDAR' && ++calendarCount > 1) throw new Error();
        if (stack.length >= 20 || component === 'VCALENDAR' && stack.length) throw new Error();
        stack.push(component);
        if (component === 'VEVENT') { eventFields = new Set(); if (++eventCount > 500) throw new Error(); }
      } else if (line.startsWith('END:')) {
        const component = line.slice(4);
        if (stack.pop() !== component) throw new Error();
        if (component === 'VEVENT' && (!eventFields.has('UID') || !eventFields.has('DTSTART') && !eventFields.has('RECURRENCE-ID'))) throw new Error();
      }
      if (line === 'VERSION:2.0' && stack.length === 1) version = true;
      if (stack[stack.length - 1] !== 'VEVENT') return line;
      const colon = line.indexOf(':');
      let property = line.slice(0, colon);
      const name = property.split(';')[0];
      const value = line.slice(colon + 1);
      eventFields.add(name);
      // These recurrence extensions are not supported by the agenda engine.
      // Reject instead of silently displaying an incorrect schedule.
      if (name === 'RDATE' || name === 'EXRULE' || /;RANGE=/i.test(property)) throw new Error();
      if (name === 'RRULE' && !/(?:^|;)FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;|$)/.test(value)) throw new Error();
      if (!['DTSTART', 'DTEND', 'EXDATE', 'RECURRENCE-ID'].includes(name)) return line;
      const tz = /;TZID=(?:"([^"]+)"|([^;]+))/.exec(property);
      if (tz) {
        const name = tz[1] ?? tz[2];
        // Reuse node-ical's known Outlook mappings, never its host-zone fallback for Custom zones.
        const zone = windowsZones[name]?.iana?.[0] ?? name;
        new Intl.DateTimeFormat('en', { timeZone: zone });
        property = property.replace(tz[0], `;TZID=${zone}`);
      }
      for (const date of value.split(',')) {
        const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(date);
        if (!match) throw new Error();
        const [, y, m, d, h, min, sec] = match;
        const parsed = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
        if (parsed.getUTCFullYear() !== Number(y) || parsed.getUTCMonth() !== Number(m) - 1 || parsed.getUTCDate() !== Number(d)
            || Number(h ?? 0) > 23 || Number(min ?? 0) > 59 || Number(sec ?? 0) > 59) throw new Error();
      }
      // Interpret floating wall-clock times in the user's chosen timezone,
      // independent of the server process timezone. DATE values stay dates.
      if (!tz && /T\d{6}(?:,|$)/.test(value)) return `${property};TZID=${timezone}:${value}`;
      return `${property}:${value}`;
    });
    if (stack.length || !version) throw new Error();
    const calendar = ical.sync.parseICS(normalized.join('\r\n'));
    if (calendar.vcalendar?.method === 'CANCEL') {
      parentPort!.postMessage({ result: { timezone, events: [] } });
      return;
    }
    const start = new Date(now);
    const finish = new Date(now + days * 86_400_000);
    const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const selectedDate = (date: Date) => {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
      return ['year', 'month', 'day'].map((part) => parts.find((p) => p.type === part)!.value).join('-');
    };
    const today = selectedDate(start);
    const lastDay = selectedDate(finish);
    // A margin includes all-day events on the current local calendar day.
    const range = { from: new Date(now - 2 * 86_400_000), to: new Date(finish.getTime() + 2 * 86_400_000), expandOngoing: true };
    const events: Array<CalendarEvent & { sort: string }> = [];
    let expanded = 0;
    const add = (instance: EventInstance) => {
      if (++expanded > 5000) throw new Error();
      if (instance.event.status === 'CANCELLED') return;
      if (!Number.isFinite(instance.start.getTime()) || !Number.isFinite(instance.end.getTime()) || instance.end < instance.start) throw new Error();
      const allDay = instance.isFullDay;
      const begin = allDay ? dateKey(instance.start) : instance.start.toISOString();
      const end = allDay ? dateKey(instance.end) : instance.end.toISOString();
      if (allDay ? end <= today || begin > lastDay : instance.start > finish || (instance.end > instance.start ? instance.end <= start : instance.start < start)) return;
      const day = allDay ? begin : selectedDate(instance.start);
      const summary = typeof instance.summary === 'string' ? instance.summary : instance.summary?.val;
      const title = String(summary || 'Untitled event').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 256);
      const dateLabel = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: allDay ? 'UTC' : timezone }).format(allDay ? new Date(`${begin}T12:00:00Z`) : instance.start);
      const timeLabel = allDay ? 'All day' : new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: timezone }).format(instance.start);
      events.push({ title, start: begin, end, allDay, dateLabel, timeLabel, sort: `${day} ${allDay ? '00:00' : timeLabel}` });
    };
    for (const component of Object.values(calendar)) {
      if (component?.type !== 'VEVENT') continue;
      const event = component as VEvent;
      if (event.status === 'CANCELLED' || event.method === 'CANCEL') continue;
      if (!event.start || !Number.isFinite(event.start.getTime())) throw new Error();
      // Expand the master without overrides, then handle each override directly.
      // This also finds occurrences moved into the window from a distant date.
      for (const instance of ical.expandRecurringEvent({ ...event, recurrences: undefined }, range)) {
        const key = instance.isFullDay ? dateKey(instance.start) : instance.start.toISOString();
        if (!event.recurrences?.[key]) add(instance);
      }
      for (const override of new Set(Object.values(event.recurrences ?? {}))) {
        if (override.status === 'CANCELLED') continue;
        const detached = { ...override, rrule: undefined } as VEvent;
        // A moved occurrence without DTEND inherits the master's duration.
        if (!detached.end && event.end) detached.end = new Date(detached.start.getTime() + event.end.getTime() - event.start.getTime());
        for (const instance of ical.expandRecurringEvent(detached, range)) add(instance);
      }
    }
    events.sort((a, b) => a.sort.localeCompare(b.sort) || a.start.localeCompare(b.start));
    const result: CalendarData = { timezone, events: events.slice(0, limit).map(({ sort: _sort, ...event }) => event) };
    parentPort!.postMessage({ result });
  } catch {
    // Parser exceptions can include feed content. Never pass them to logs/API.
    parentPort!.postMessage({ error: 'Calendar feed is invalid or exceeds supported limits' });
  }
}
