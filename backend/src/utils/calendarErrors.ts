export type CalendarErrorCode = 'not_configured' | 'unavailable' | 'timeout';
/** `reason` is a fixed code naming what went wrong (see services/calendar.ts), drawn on the widget. Never feed text. */
export interface CalendarProblem { code: CalendarErrorCode; message: string; reason?: string }

const REASON = /^[A-Za-z0-9_]{1,40}$/;

const MESSAGES: Record<CalendarErrorCode, string> = {
  not_configured: 'Save a calendar URL for this calendar.',
  unavailable: 'Calendar unavailable: check the feed URL and supported format.',
  timeout: 'The calendar did not respond in time. Try again.',
};

export function calendarProblem(code: CalendarErrorCode): CalendarProblem { return { code, message: MESSAGES[code] }; }

/** A fixed, safe problem for any failure. Feed URLs and parser messages can hold private text and are never passed on. */
export function calendarProblemFrom(error: unknown): CalendarProblem {
  const raw = (error as { reason?: unknown } | null)?.reason;
  const reason = typeof raw === 'string' && REASON.test(raw) ? raw : undefined;
  const timedOut = reason === 'timeout' || error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
  return { ...calendarProblem(timedOut ? 'timeout' : 'unavailable'), ...(reason ? { reason } : {}) };
}
