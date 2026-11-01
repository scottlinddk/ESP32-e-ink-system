// @ts-check
/** @typedef {import('node-ical').EventInstance} EventInstance */
/** @typedef {import('node-ical').VEvent} VEvent */
/** @typedef {import('../types').CalendarData} CalendarData */
/** @typedef {import('../types').CalendarEvent} CalendarEvent */

// A real worker module keeps its dependencies and any build-generated helpers in
// the same scope. Serializing a transformed function with toString() loses them.
// No calendar input is ever evaluated as code.
function runCalendarWorker() {
  /**
   * Rejects the feed with a fixed reason. Only these codes ever leave the worker: parser
   * messages can hold private feed text, so they are never passed on.
   * @param {string} code @returns {never}
   */
  const reject = (code) => { throw Object.assign(new Error(code), { reason: code }); };
  const { parentPort, workerData } = require('node:worker_threads');
  const ical = require('node-ical');
  const path = require('node:path');
  /** @type {Record<string, { iana: string[] }>} */
  const windowsZones = require(path.join(path.dirname(require.resolve('node-ical/package.json')), 'windowsZones.json'));
  /** @type {import('../utils/calendarOptions').CalendarOptions & { text: string; now: number }} */
  const { text, timezone, days, limit, now, range, maxEvents } = workerData;
  try {
    const lines = text.replace(/^\uFEFF/, '').replace(/\r?\n[ \t]/g, '').trim().split(/\r?\n/);
    if (lines.length > 20_000) reject('too_many_lines');
    if (lines[0] !== 'BEGIN:VCALENDAR' || lines[lines.length - 1] !== 'END:VCALENDAR') reject('not_an_ics_feed');
    /** @type {string[]} */
    const stack = [];
    let eventCount = 0;
    let calendarCount = 0;
    let version = false;
    /** @type {Set<string>} */
    let eventFields = new Set();
    // One broken event (a garbled UNTIL, an end before its start, an unsupported rule) must not
    // blank the whole calendar: long-lived feeds such as Google's often hold one. Such an event is
    // left out and counted by reason. Structural problems with the feed itself stay fatal.
    /** @type {Record<string, number>} */
    const skipped = {};
    /** @type {string | undefined} */
    let firstSkip;
    /** @param {string} code */
    const recordSkip = (code) => { skipped[code] = (skipped[code] ?? 0) + 1; firstSkip ??= code; };
    /** @param {unknown} error */
    const reasonOf = (error) => error && typeof error === 'object' && 'reason' in error && typeof error.reason === 'string' ? error.reason : 'parse_error';
    /** Lines outside any VEVENT (calendar properties, VTIMEZONE), and each kept VEVENT by UID. */
    /** @type {string[]} */
    const header = [];
    /** @type {Map<string, string[][]>} */
    const eventsByUid = new Map();
    /** @type {string[]} */
    const normalized = [];
    /** @type {string[]} */
    let current = [];
    /** @type {string | undefined} */
    let currentSkip;
    let uid = '';
    let keptEvents = 0;
    /** @param {string} line @returns {string} */
    const normalizeEventLine = (line) => {
      const colon = line.indexOf(':');
      let property = line.slice(0, colon);
      const name = property.split(';')[0];
      const value = line.slice(colon + 1);
      eventFields.add(name);
      if (name === 'UID') uid = value;
      // These recurrence extensions are not supported by the agenda engine.
      // Leave the event out instead of silently displaying an incorrect schedule.
      if (name === 'RDATE' || name === 'EXRULE' || /;RANGE=/i.test(property)) reject('unsupported_recurrence');
      if (name === 'RRULE' && !/(?:^|;)FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;|$)/.test(value)) reject('unsupported_recurrence');
      if (!['DTSTART', 'DTEND', 'EXDATE', 'RECURRENCE-ID'].includes(name)) return line;
      const tz = /;TZID=(?:"([^"]+)"|([^;]+))/.exec(property);
      if (tz) {
        const name = tz[1] ?? tz[2];
        // Reuse node-ical's known Outlook mappings, never its host-zone fallback for Custom zones.
        const zone = windowsZones[name]?.iana?.[0] ?? name;
        try { new Intl.DateTimeFormat('en', { timeZone: zone }); } catch { reject('unknown_timezone'); }
        property = property.replace(tz[0], `;TZID=${zone}`);
      }
      for (const date of value.split(',')) {
        const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(date);
        if (!match) reject('invalid_date');
        const [, y, m, d, h, min, sec] = match;
        const parsed = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
        if (parsed.getUTCFullYear() !== Number(y) || parsed.getUTCMonth() !== Number(m) - 1 || parsed.getUTCDate() !== Number(d)
            || Number(h ?? 0) > 23 || Number(min ?? 0) > 59 || Number(sec ?? 0) > 59) reject('invalid_date');
      }
      // Interpret floating wall-clock times in the user's chosen timezone,
      // independent of the server process timezone. DATE values stay dates.
      if (!tz && /T\d{6}(?:,|$)/.test(value)) return `${property};TZID=${timezone}:${value}`;
      return `${property}:${value}`;
    };
    for (const line of lines) {
      if (!line || !line.includes(':')) reject('malformed_line');
      const inEvent = stack.includes('VEVENT');
      if (line.startsWith('BEGIN:')) {
        const component = line.slice(6);
        if (component === 'VCALENDAR' && ++calendarCount > 1) reject('nested_calendar');
        if (stack.length >= 20 || component === 'VCALENDAR' && stack.length) reject('nested_calendar');
        stack.push(component);
        if (component === 'VEVENT') {
          if (inEvent) reject('nested_calendar');
          eventFields = new Set(); current = []; currentSkip = undefined; uid = '';
          if (++eventCount > 500) reject('too_many_events');
        }
      } else if (line.startsWith('END:')) {
        const component = line.slice(4);
        if (stack.pop() !== component) reject('unbalanced_components');
        if (component === 'VEVENT') {
          current.push(line);
          if (!currentSkip && (!eventFields.has('UID') || !eventFields.has('DTSTART') && !eventFields.has('RECURRENCE-ID'))) currentSkip = 'event_missing_uid_or_start';
          if (currentSkip) recordSkip(currentSkip);
          else {
            keptEvents++;
            normalized.push(...current);
            eventsByUid.set(uid, [...(eventsByUid.get(uid) ?? []), current]);
          }
          continue;
        }
      }
      if (line === 'VERSION:2.0' && stack.length === 1) version = true;
      if (!stack.includes('VEVENT')) { normalized.push(line); header.push(line); continue; }
      if (currentSkip) continue;
      try {
        current.push(stack[stack.length - 1] === 'VEVENT' ? normalizeEventLine(line) : line);
      } catch (error) {
        currentSkip = reasonOf(error);
      }
    }
    if (stack.length || !version) reject('missing_version_or_unclosed');
    // Every event was unusable: report why, rather than showing an empty calendar.
    if (eventCount && !keptEvents) reject(firstSkip ?? 'parse_error');
    /** @param {string[]} body */
    const parseLines = (body) => ical.sync.parseICS(body.join('\r\n'));
    /** @type {Record<string, any>} */
    let calendar;
    try {
      calendar = parseLines(normalized);
    } catch {
      // node-ical rejects a whole feed for one bad recurrence rule. Parse each UID (a master with
      // its overrides) on its own, with the shared calendar header, and leave out the ones that fail.
      calendar = parseLines(header);
      const end = header[header.length - 1];
      const head = header.slice(0, -1);
      let parsedAny = false;
      for (const group of eventsByUid.values()) {
        try {
          Object.assign(calendar, parseLines([...head, ...group.flat(), end]));
          parsedAny = true;
        } catch {
          recordSkip('parse_error');
        }
      }
      if (!parsedAny) reject(firstSkip ?? 'parse_error');
    }
    const start = new Date(now);
    const finish = new Date(now + days * 86_400_000);
    // Local calendar day and minute of an instant in the chosen timezone.
    /** @param {Date} date */
    const zoned = (date) => {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
      /** @param {string} type */
      const part = (type) => /** @type {Intl.DateTimeFormatPart} */ (parts.find((p) => p.type === type)).value;
      return { day: `${part('year')}-${part('month')}-${part('day')}`, minute: Number(part('hour')) * 60 + Number(part('minute')) };
    };
    /** @param {string} day @param {number} by */
    const shiftDay = (day, by) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + by)).toISOString().slice(0, 10);
    const local = zoned(start);
    /** @type {CalendarData} */
    const empty = { timezone, today: local.day, nowMinute: local.minute, days, limit, events: [] };
    if (calendar.vcalendar?.method === 'CANCEL') {
      parentPort?.postMessage({ result: empty });
      return;
    }
    /** @param {Date} date */
    const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    /** @param {Date} date */
    const selectedDate = (date) => {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
      return ['year', 'month', 'day'].map((part) => /** @type {Intl.DateTimeFormatPart} */ (parts.find((p) => p.type === part)).value).join('-');
    };
    const today = selectedDate(start);
    const lastDay = selectedDate(finish);
    // A margin includes all-day events on the current local calendar day.
    // With a day range the window is whole local days, otherwise the next `days` from now.
    const expansion = range
      ? { from: new Date(Date.parse(`${range.from}T00:00:00Z`) - 2 * 86_400_000), to: new Date(Date.parse(`${range.to}T00:00:00Z`) + 3 * 86_400_000), expandOngoing: true }
      : { from: new Date(now - 2 * 86_400_000), to: new Date(finish.getTime() + 2 * 86_400_000), expandOngoing: true };
    /** @type {Array<CalendarEvent & { sort: string }>} */
    const events = [];
    let expanded = 0;
    /** @type {Array<CalendarEvent & { sort: string }>} */
    let pending = events;
    /** @param {EventInstance} instance */
    const add = (instance) => {
      if (++expanded > 5000) reject('too_many_occurrences');
      if (instance.event.status === 'CANCELLED') return;
      if (!Number.isFinite(instance.start.getTime()) || !Number.isFinite(instance.end.getTime()) || instance.end < instance.start) reject('invalid_date');
      const allDay = instance.isFullDay;
      const begin = allDay ? dateKey(instance.start) : instance.start.toISOString();
      const end = allDay ? dateKey(instance.end) : instance.end.toISOString();
      const day = allDay ? begin : selectedDate(instance.start);
      let endDay = day;
      /** @type {number | null} */
      let startMinute = null;
      /** @type {number | null} */
      let endMinute = null;
      if (allDay) {
        endDay = end > begin ? shiftDay(end, -1) : begin;
      } else {
        const first = zoned(instance.start);
        const last = zoned(instance.end);
        startMinute = first.minute;
        // The end is exclusive: an event that stops at midnight belongs to the day before.
        const midnight = instance.end > instance.start && last.minute === 0;
        endDay = midnight ? shiftDay(last.day, -1) : last.day;
        endMinute = midnight ? 1440 : last.minute;
        if (endDay < day) { endDay = day; endMinute = startMinute; }
      }
      if (range ? endDay < range.from || day > range.to
        : allDay ? end <= today || begin > lastDay : instance.start > finish || (instance.end > instance.start ? instance.end <= start : instance.start < start)) return;
      const summary = typeof instance.summary === 'string' ? instance.summary : instance.summary?.val;
      const title = String(summary || 'Untitled event').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 256);
      const raw = instance.event.description;
      const notes = typeof raw === 'string' ? raw : raw?.val;
      const description = typeof notes === 'string' ? notes.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : '';
      const dateLabel = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: allDay ? 'UTC' : timezone }).format(allDay ? new Date(`${begin}T12:00:00Z`) : instance.start);
      const timeLabel = allDay ? 'All day' : new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: timezone }).format(instance.start);
      pending.push({ title, start: begin, end, allDay, dateLabel, timeLabel, day, endDay, startMinute, endMinute, ...(description ? { description } : {}), sort: `${day} ${allDay ? '00:00' : timeLabel}` });
    };
    let expandedEvents = 0;
    for (const component of Object.values(calendar)) {
      if (component?.type !== 'VEVENT') continue;
      const event = /** @type {VEvent} */ (component);
      if (event.status === 'CANCELLED' || event.method === 'CANCEL') continue;
      // An event's occurrences are kept only when the whole event expands cleanly.
      pending = [];
      try {
        if (!event.start || !Number.isFinite(event.start.getTime())) reject('invalid_date');
        // Expand the master without overrides, then handle each override directly.
        // This also finds occurrences moved into the window from a distant date.
        for (const instance of ical.expandRecurringEvent({ ...event, recurrences: undefined }, expansion)) {
          const key = instance.isFullDay ? dateKey(instance.start) : instance.start.toISOString();
          if (!event.recurrences?.[key]) add(instance);
        }
        for (const override of new Set(Object.values(event.recurrences ?? {}))) {
          if (override.status === 'CANCELLED') continue;
          const detached = /** @type {VEvent} */ ({ ...override, rrule: undefined });
          // A moved occurrence without DTEND inherits the master's duration.
          if (!detached.end && event.end) detached.end = new Date(detached.start.getTime() + event.end.getTime() - event.start.getTime());
          for (const instance of ical.expandRecurringEvent(detached, expansion)) add(instance);
        }
      } catch (error) {
        // The occurrence budget covers the whole feed, so exceeding it stays fatal.
        if (reasonOf(error) === 'too_many_occurrences') throw error;
        recordSkip(reasonOf(error));
        continue;
      }
      expandedEvents++;
      events.push(...pending);
    }
    if (!expandedEvents && firstSkip) reject(firstSkip);
    events.sort((a, b) => a.sort.localeCompare(b.sort) || a.start.localeCompare(b.start));
    /** @type {CalendarData} */
    const result = { ...empty, events: events.slice(0, maxEvents ?? limit).map(({ sort: _sort, ...event }) => event) };
    parentPort?.postMessage({ result, skipped });
  } catch (error) {
    // Parser exceptions can include feed content. Only a reason set by `reject` is passed on.
    const reason = error && typeof error === 'object' && 'reason' in error && typeof error.reason === 'string' ? error.reason : 'parse_error';
    parentPort?.postMessage({ error: 'Calendar feed is invalid or exceeds supported limits', reason });
  }
}

runCalendarWorker();
