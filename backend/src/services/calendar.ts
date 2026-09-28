import { Worker } from 'node:worker_threads';
import { fetchPublicFeed, MAX_FEED_BYTES } from '../utils/publicFeedFetch';
import { runCalendarWorker } from './calendarWorker';
import type { CalendarData } from '../types';

export interface CalendarOptions { timezone: string; days: number; limit: number }

export function validateCalendarOptions(options: CalendarOptions): void {
  if (typeof options.timezone !== 'string' || options.timezone.length > 100 || !/^[A-Za-z_][A-Za-z0-9_+\/-]*$/.test(options.timezone)) throw new Error('Invalid calendar timezone');
  try { new Intl.DateTimeFormat('en', { timeZone: options.timezone }); } catch { throw new Error('Invalid calendar timezone'); }
  if (!Number.isInteger(options.days) || options.days < 1 || options.days > 30) throw new Error('Calendar days must be between 1 and 30');
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 10) throw new Error('Calendar event limit must be between 1 and 10');
}

/** Bound both parser memory and CPU; an HTTP deadline alone cannot stop RRULE expansion. */
export async function parseCalendar(text: string, options: CalendarOptions, now = new Date(), signal?: AbortSignal): Promise<CalendarData> {
  validateCalendarOptions(options);
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_FEED_BYTES || !Number.isFinite(now.getTime())) throw new Error('Invalid calendar feed');
  if (signal?.aborted) throw new Error('Calendar request cancelled');
  return new Promise((resolve, reject) => {
    const worker = new Worker(`(${runCalendarWorker.toString()})()`, {
      eval: true, workerData: { text, ...options, now: now.getTime(), icalPath: require.resolve('node-ical') },
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
    worker.once('message', (message: { error?: string; result?: CalendarData }) => finish(message.error ? new Error(message.error) : undefined, message.result));
    worker.once('error', () => finish(new Error('Calendar parsing failed')));
    worker.once('exit', (code) => { if (code !== 0) finish(new Error('Calendar parsing failed')); });
  });
}

export async function fetchCalendar(url: string, options: CalendarOptions, signal?: AbortSignal): Promise<CalendarData> {
  try {
    const { text } = await fetchPublicFeed(url, signal);
    return await parseCalendar(text, options, new Date(), signal);
  } catch {
    // URLs may contain private tokens, including in DNS/client error messages.
    throw new Error('Calendar unavailable: check the feed URL and supported format');
  }
}
