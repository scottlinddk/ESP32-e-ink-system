import { createHash } from 'node:crypto';
import { fetchPublicFeed, FeedStatusError, validatePublicHttpsUrl } from '../utils/publicFeedFetch';

const FRESH_MS = 15 * 60_000;
const STALE_MS = 24 * 60 * 60_000;
const MAX_ENTRIES = 16; // Each feed is bounded to 1 MiB by fetchPublicFeed.

interface Entry {
  text?: string;
  fetchedAt?: number;
  retryAt?: number;
  pending?: Promise<string>;
}

/** Bounded, process-local cache. Private URLs are hashed, never logged or persisted. */
export class CalendarFeedCache {
  private readonly entries = new Map<string, Entry>();

  async get(value: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const url = validatePublicHttpsUrl(value).href;
    const key = createHash('sha256').update(url).digest('hex');
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= MAX_ENTRIES) {
        // Do not evict active downloads: another caller must still join them.
        const victim = [...this.entries].find(([, item]) => !item.pending);
        if (!victim) throw new Error('Calendar download capacity reached');
        this.entries.delete(victim[0]);
      }
      entry = {};
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    const now = Date.now();
    if (entry.text !== undefined && now - entry.fetchedAt! < FRESH_MS) return entry.text;
    if (entry.retryAt && now < entry.retryAt) return this.staleOrThrow(entry);
    if (!entry.pending) {
      // Caller cancellation stops only its wait. The shared download has its own
      // eight-second deadline and can populate the cache for the other callers.
      entry.pending = this.refresh(url, entry).finally(() => { entry!.pending = undefined; });
    }
    return waitFor(entry.pending, signal);
  }

  private staleOrThrow(entry: Entry): string {
    if (entry.text !== undefined && Date.now() - entry.fetchedAt! < STALE_MS) return entry.text;
    entry.text = undefined;
    throw new FeedStatusError(429, Math.max(0, (entry.retryAt ?? Date.now()) - Date.now()));
  }

  private async refresh(url: string, entry: Entry): Promise<string> {
    try {
      const { text } = await fetchPublicFeed(url);
      entry.text = text;
      entry.fetchedAt = Date.now();
      entry.retryAt = undefined;
      return text;
    } catch (error) {
      if (error instanceof FeedStatusError && error.status === 429) {
        // No rapid retry loops, even if the provider sends Retry-After: 0.
        entry.retryAt = Date.now() + Math.max(60_000, error.retryAfterMs ?? FRESH_MS);
        return this.staleOrThrow(entry);
      }
      // Never mask revoked access (401/403/404) or malformed downloads with old data.
      entry.text = undefined;
      entry.fetchedAt = undefined;
      entry.retryAt = undefined;
      throw error;
    }
  }
}

function waitFor<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

const cache = new CalendarFeedCache();
export const fetchCalendarFeed = (url: string, signal?: AbortSignal): Promise<string> => cache.get(url, signal);
