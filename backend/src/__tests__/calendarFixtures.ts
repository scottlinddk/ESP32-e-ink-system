import type { CalendarData, CalendarEvent } from '../types';

/** Thursday 15 October 2026, 06:25 in the calendar's time zone. */
export const TODAY = '2026-10-15';
export const NOW_MINUTE = 6 * 60 + 25;

const pad = (value: number) => String(value).padStart(2, '0');
export const hhmm = (minute: number) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

/** A timed event on one day, `from` and `to` in minutes after midnight. */
export function timedEvent(title: string, from: number, to: number, day = TODAY): CalendarEvent {
  return {
    title, start: `${day}T${hhmm(from)}:00`, end: `${day}T${hhmm(to)}:00`, allDay: false,
    dateLabel: '15 Oct', timeLabel: hhmm(from), day, endDay: day, startMinute: from, endMinute: to,
  };
}

/** An all-day event; `endDay` is the last day it covers. */
export function allDayEvent(title: string, day = TODAY, endDay = day): CalendarEvent {
  return {
    title, start: day, end: day, allDay: true, dateLabel: '15 Oct', timeLabel: 'All day',
    day, endDay, startMinute: null, endMinute: null,
  };
}

export function calendarData(events: CalendarEvent[] = [], overrides: Partial<CalendarData> = {}): CalendarData {
  return { timezone: 'Europe/Copenhagen', today: TODAY, nowMinute: NOW_MINUTE, days: 7, limit: 5, events, ...overrides };
}
