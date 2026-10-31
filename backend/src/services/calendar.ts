import { Worker } from 'node:worker_threads';
import { fetchPublicFeed, FeedStatusError, MAX_FEED_BYTES } from '../utils/publicFeedFetch';
import type { CalendarData } from '../types';
import { validateCalendarOptions, type CalendarOptions } from '../utils/calendarOptions';

/**
 * A calendar that could not be loaded. `reason` is a short fixed code (`too_many_events`, `http_404`,
 * `ENOTFOUND`, ...) that is safe to log: it never holds the feed URL or any feed text.
 */
export class CalendarUnavailableError extends Error {
  constructor(readonly reason: string) {
    super('Calendar unavailable: check the feed URL and supported format');
    this.name = 'CalendarUnavailableError';
  }
}

/** Fixed messages written by this code base; anything else (DNS, TLS, parser text) may name the host or the feed. */
const SAFE_MESSAGE = /^(?:Feed |Too many feed|Unable to retrieve feed|Compressed feed|Authenticated feed|Calendar (?:parsing|request)|Invalid calendar)/;

function reasonOf(error: unknown): string {
  if (error instanceof FeedStatusError) return `http_${error.status ?? 'unknown'}`;
  if (!(error instanceof Error)) return 'unknown';
  const { reason, code } = error as Error & { reason?: unknown; code?: unknown };
  if (typeof reason === 'string') return reason;
  if (typeof code === 'string' && /^[A-Z_]+$/.test(code)) return code;
  if (error instanceof TypeError && /utf-?8/i.test(error.message)) return 'not_utf8';
  return SAFE_MESSAGE.test(error.message) ? error.message : 'unknown';
}

export { validateCalendarOptions, MAX_CALENDAR_EVENTS, type CalendarOptions } from '../utils/calendarOptions';

/** Bound both parser memory and CPU; an HTTP deadline alone cannot stop RRULE expansion. */
export async function parseCalendar(text: string, options: CalendarOptions, now = new Date(), signal?: AbortSignal): Promise<CalendarData> {
  validateCalendarOptions(options);
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_FEED_BYTES || !Number.isFinite(now.getTime())) throw new Error('Invalid calendar feed');
  if (signal?.aborted) throw new Error('Calendar request cancelled');
  return new Promise((resolve, reject) => {
    const worker = new Worker(require.resolve('./calendarWorker.cjs'), {
      workerData: { text, ...options, now: now.getTime() },
      resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 }, stdout: true, stderr: true,
    });
    // Suppress dependency diagnostics: a malformed feed may contain private text.
    worker.stdout?.resume(); worker.stderr?.resume();
    let settled = false;
    const finish = (error?: Error, result?: CalendarData) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(new Error('Calendar request cancelled'));
    const timer = setTimeout(() => finish(new Error('Calendar parsing timed out')), 2000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', (message: { error?: string; reason?: string; result?: CalendarData }) =>
      finish(message.error ? Object.assign(new Error(message.error), { reason: message.reason }) : undefined, message.result));
    worker.once('error', () => finish(new Error('Calendar parsing failed')));
    worker.once('exit', (code) => { if (code !== 0) finish(new Error('Calendar parsing failed')); });
  });
}

export async function fetchCalendar(url: string, options: CalendarOptions, signal?: AbortSignal): Promise<CalendarData> {
  try {
    const { text } = await fetchPublicFeed(url, signal);
    return await parseCalendar(text, options, new Date(), signal);
  } catch (error) {
    // URLs may contain private tokens, including in DNS/client error messages, so only a fixed reason code is kept.
    throw new CalendarUnavailableError(reasonOf(error));
  }
}
