import type { CalendarWidgetSetting } from '../types';

// Mirrors backend/src/utils/calendarWidgets.ts. Each additional calendar is placed in a
// layout as its own `calendar:<id>` widget. Its private ICS URL is never part of the
// settings: it is saved on its own and stored encrypted.
export const MAX_CALENDAR_WIDGETS = 8;
export const CALENDAR_NAME_MAX = 40;
const CALENDAR_WIDGET_PREFIX = 'calendar:';
const CALENDAR_ID = /^[a-z0-9]{1,16}$/;

export function calendarWidgetId(id: string): string { return `${CALENDAR_WIDGET_PREFIX}${id}`; }

export function calendarIdFromWidget(widgetId: string): string | null {
  if (!widgetId.startsWith(CALENDAR_WIDGET_PREFIX)) return null;
  const id = widgetId.slice(CALENDAR_WIDGET_PREFIX.length);
  return CALENDAR_ID.test(id) ? id : null;
}

/** A short random ID that is not already used by another calendar. */
export function createCalendarId(existing: readonly CalendarWidgetSetting[]): string {
  const used = new Set(existing.map((calendar) => calendar.id));
  for (;;) {
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    if (!used.has(id)) return id;
  }
}

export function emptyCalendar(existing: readonly CalendarWidgetSetting[], timezone = 'Europe/Copenhagen'): CalendarWidgetSetting {
  return { id: createCalendarId(existing), name: '', timezone, days: 7, item_limit: 5 };
}

/** The name, or a numbered fallback, so every calendar can be told apart in the layout editor. */
export function calendarLabel(calendar: CalendarWidgetSetting, index: number): string {
  return calendar.name.trim() || `#${index + 1}`;
}

/** Trimmed calendars ready to save. */
export function calendarWidgetsForSave(calendars: readonly CalendarWidgetSetting[]): CalendarWidgetSetting[] {
  return calendars.map((calendar) => ({ ...calendar, name: calendar.name.trim(), timezone: calendar.timezone.trim() }));
}

export interface CalendarSaveResult {
  /** URLs the server refused, by calendar ID, so they stay in their inputs to be corrected. */
  rejected: Record<string, string>;
  /** A line for each refused URL: the calendar and why. */
  failures: string[];
}

/**
 * Saves the calendar list, then the URLs typed for it. The list goes first: the server only
 * stores a URL for a calendar it already has. A failed list save throws and no URL is sent;
 * a refused URL never stops the others.
 */
export async function saveCalendarChanges(input: {
  calendars: readonly CalendarWidgetSetting[];
  /** False when only URLs were typed, so the list is left alone. */
  listChanged: boolean;
  urls: Readonly<Record<string, string>>;
  saveList: (calendars: CalendarWidgetSetting[]) => Promise<unknown>;
  saveUrl: (id: string, url: string) => Promise<unknown>;
}): Promise<CalendarSaveResult> {
  const calendars = calendarWidgetsForSave(input.calendars);
  if (input.listChanged) await input.saveList(calendars);
  const result: CalendarSaveResult = { rejected: {}, failures: [] };
  for (const [index, calendar] of calendars.entries()) {
    const url = input.urls[calendar.id]?.trim();
    if (!url) continue;
    try { await input.saveUrl(calendar.id, url); }
    catch (error) {
      result.rejected[calendar.id] = url;
      result.failures.push(`${calendarLabel(calendar, index)} (${error instanceof Error ? error.message : 'error'})`);
    }
  }
  return result;
}
