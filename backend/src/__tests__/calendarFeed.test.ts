import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarFeedCache } from '../services/calendarFeed';
import { fetchPublicFeed, FeedStatusError } from '../utils/publicFeedFetch';

vi.mock('../utils/publicFeedFetch', async (original) => ({ ...await original<typeof import('../utils/publicFeedFetch')>(), fetchPublicFeed: vi.fn() }));
const url = 'https://calendar.example.org/private-token/basic.ics';
const feed = { text: 'BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR', url };
let cache: CalendarFeedCache;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
  vi.mocked(fetchPublicFeed).mockReset().mockResolvedValue(feed);
  cache = new CalendarFeedCache();
});
afterEach(() => { vi.useRealTimers(); });

describe('calendar download caching', () => {
  it('reuses downloads for 15 minutes, then refreshes; a changed URL has its own cache', async () => {
    expect(await cache.get(url)).toBe(feed.text);
    await cache.get(url);
    expect(fetchPublicFeed).toHaveBeenCalledTimes(1);
    await cache.get(url.replace('private-token', 'new-token'));
    expect(fetchPublicFeed).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(15 * 60_000);
    vi.mocked(fetchPublicFeed).mockResolvedValue({ ...feed, text: 'updated' });
    expect(await cache.get(url)).toBe('updated');
    expect(fetchPublicFeed).toHaveBeenCalledTimes(3);
  });
  it('joins concurrent downloads and cancellation of one waiter does not cancel another', async () => {
    let complete!: (value: typeof feed) => void;
    vi.mocked(fetchPublicFeed).mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    const controller = new AbortController();
    const first = cache.get(url, controller.signal);
    const second = cache.get(url);
    const cancelled = expect(first).rejects.toThrow('cancelled');
    controller.abort(new Error('cancelled'));
    await cancelled;
    complete(feed);
    expect(await second).toBe(feed.text);
    expect(await cache.get(url)).toBe(feed.text);
    expect(fetchPublicFeed).toHaveBeenCalledTimes(1);
  });
  it('does not fetch for an already cancelled caller', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(cache.get(url, controller.signal)).rejects.toThrow();
    expect(fetchPublicFeed).not.toHaveBeenCalled();
  });
  it('backs off a cold 429 without retries, then recovers', async () => {
    vi.mocked(fetchPublicFeed).mockRejectedValueOnce(new FeedStatusError(429, 120_000));
    await expect(cache.get(url)).rejects.toMatchObject({ status: 429 });
    vi.advanceTimersByTime(119_999);
    await expect(cache.get(url)).rejects.toMatchObject({ status: 429 });
    expect(fetchPublicFeed).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(await cache.get(url)).toBe(feed.text);
    expect(fetchPublicFeed).toHaveBeenCalledTimes(2);
  });
  it('uses a 15 minute fallback without Retry-After and a one minute minimum', async () => {
    vi.mocked(fetchPublicFeed).mockRejectedValueOnce(new FeedStatusError(429));
    await expect(cache.get(url)).rejects.toMatchObject({ status: 429 });
    vi.advanceTimersByTime(14 * 60_000);
    await expect(cache.get(url)).rejects.toMatchObject({ status: 429 });
    expect(fetchPublicFeed).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    vi.mocked(fetchPublicFeed).mockRejectedValueOnce(new FeedStatusError(429, 0));
    await expect(cache.get(url)).rejects.toMatchObject({ status: 429 });
    await expect(cache.get(url)).rejects.toMatchObject({ status: 429 });
    expect(fetchPublicFeed).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60_000);
    await cache.get(url);
    expect(fetchPublicFeed).toHaveBeenCalledTimes(3);
  });
  it('serves the last download on 429, but never past 24 hours, even during a longer backoff', async () => {
    await cache.get(url);
    vi.advanceTimersByTime(15 * 60_000);
    vi.mocked(fetchPublicFeed).mockRejectedValueOnce(new FeedStatusError(429, 48 * 60 * 60_000));
    expect(await cache.get(url)).toBe(feed.text);
    expect(await cache.get(url)).toBe(feed.text);
    vi.advanceTimersByTime(24 * 60 * 60_000);
    await expect(cache.get(url)).rejects.toMatchObject({ status: 429 });
    expect(fetchPublicFeed).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 404, 500])('does not serve stale data after HTTP %s', async (status) => {
    await cache.get(url);
    vi.advanceTimersByTime(15 * 60_000);
    vi.mocked(fetchPublicFeed).mockRejectedValueOnce(new FeedStatusError(status));
    await expect(cache.get(url)).rejects.toMatchObject({ status });
    vi.mocked(fetchPublicFeed).mockRejectedValueOnce(new FeedStatusError(429));
    await expect(cache.get(url)).rejects.toMatchObject({ status: 429 });
  });
  it('bounds retained feeds and evicts the least recently used entry', async () => {
    for (let i = 0; i < 16; i++) await cache.get(`${url}?id=${i}`);
    await cache.get(`${url}?id=0`);
    await cache.get(`${url}?id=16`);
    await cache.get(`${url}?id=0`);
    expect(fetchPublicFeed).toHaveBeenCalledTimes(17);
    await cache.get(`${url}?id=1`);
    expect(fetchPublicFeed).toHaveBeenCalledTimes(18);
  });
});
