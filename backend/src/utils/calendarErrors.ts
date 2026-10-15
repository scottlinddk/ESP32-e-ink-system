export type CalendarErrorCode = 'not_configured' | 'unavailable' | 'timeout';
export interface CalendarProblem { code: CalendarErrorCode; message: string }

const MESSAGES: Record<CalendarErrorCode, string> = {
  not_configured: 'Save a calendar URL for this calendar.',
  unavailable: 'Calendar unavailable: check the feed URL and supported format.',
  timeout: 'The calendar did not respond in time. Try again.',
};
export const CALENDAR_ERROR_LABELS: Record<CalendarErrorCode, string> = {
  not_configured: 'Add calendar URL', unavailable: 'Unavailable', timeout: 'Timed out',
};

export function calendarProblem(code: CalendarErrorCode): CalendarProblem { return { code, message: MESSAGES[code] }; }

/** A fixed, safe problem for any failure. Feed URLs and parser messages can hold private text and are never passed on. */
export function calendarProblemFrom(error: unknown): CalendarProblem {
  return calendarProblem(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout' : 'unavailable');
}
