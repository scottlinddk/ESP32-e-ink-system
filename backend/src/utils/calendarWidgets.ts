import type { CalendarWidgetSetting } from '../types';
import { validateCalendarOptions } from './calendarOptions';

// Additional calendars. Each one is placed in a layout as its own `calendar:<id>` widget next
// to the original `calendar` widget. The private ICS URL is never stored here: it is the
// encrypted api_keys row `calendar:<id>` (see routes/calendar.ts). The cap bounds the feed
// downloads and parser runs of one display refresh.
export const MAX_CALENDAR_WIDGETS = 8;
export const CALENDAR_WIDGET_PREFIX = 'calendar:';
export const CALENDAR_NAME_MAX = 40;
const CALENDAR_ID = /^[a-z0-9]{1,16}$/;
const KEYS = ['id', 'name', 'timezone', 'days', 'item_limit'];

export class CalendarWidgetValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'CalendarWidgetValidationError'; }
}

export function calendarWidgetId(id: string): string { return `${CALENDAR_WIDGET_PREFIX}${id}`; }

/** The api_keys provider that holds the calendar's ICS URL. Identical to its layout widget ID. */
export function calendarProvider(id: string): string { return calendarWidgetId(id); }

/** The calendar ID referenced by a `calendar:<id>` widget or provider, or null for any other. */
export function calendarIdFromWidget(widgetId: string): string | null {
  if (!widgetId.startsWith(CALENDAR_WIDGET_PREFIX)) return null;
  const id = widgetId.slice(CALENDAR_WIDGET_PREFIX.length);
  return CALENDAR_ID.test(id) ? id : null;
}

export function isCalendarId(value: unknown): value is string {
  return typeof value === 'string' && CALENDAR_ID.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Strictly validate an untrusted calendar list before saving it. */
export function parseCalendarWidgets(value: unknown): CalendarWidgetSetting[] {
  if (!Array.isArray(value) || value.length > MAX_CALENDAR_WIDGETS) {
    throw new CalendarWidgetValidationError(`Calendars must be a list of at most ${MAX_CALENDAR_WIDGETS}.`);
  }
  const ids = new Set<string>();
  return value.map((input) => {
    if (!record(input) || Object.keys(input).some((key) => !KEYS.includes(key))) {
      throw new CalendarWidgetValidationError('Each calendar may only contain id, name, timezone, days and item_limit.');
    }
    const { id, name, timezone, days, item_limit: limit } = input;
    if (typeof id !== 'string' || !CALENDAR_ID.test(id) || ids.has(id)) {
      throw new CalendarWidgetValidationError('Each calendar needs a unique ID of 1–16 lowercase letters or digits.');
    }
    if (typeof name !== 'string' || name.trim().length > CALENDAR_NAME_MAX) {
      throw new CalendarWidgetValidationError(`Calendar names must be at most ${CALENDAR_NAME_MAX} characters.`);
    }
    try { validateCalendarOptions({ timezone: timezone as string, days: days as number, limit: limit as number }); }
    catch (error) { throw new CalendarWidgetValidationError(error instanceof Error ? error.message : 'Invalid calendar settings.'); }
    ids.add(id);
    return { id, name: name.trim(), timezone: timezone as string, days: days as number, item_limit: limit as number };
  });
}

/** Stored rows were validated on save; tolerate legacy or hand-edited data when rendering. */
export function storedCalendarWidgets(value: unknown): CalendarWidgetSetting[] {
  try { return value === undefined || value === null ? [] : parseCalendarWidgets(value); }
  catch { return []; }
}
