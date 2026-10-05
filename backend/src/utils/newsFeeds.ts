import type { NewsFeed } from '../types';
import { validatePublicHttpsUrl } from './publicFeedFetch';

// Additional RSS/Atom feeds. Each one is placed as its own `news:<id>` layout
// widget next to the original `news` widget. The cap keeps a single display
// refresh bounded; the 10 × 6 grid limits how many fit on screen anyway.
export const MAX_NEWS_FEEDS = 20;
export const NEWS_FEED_WIDGET_PREFIX = 'news:';
const FEED_ID = /^[a-z0-9]{1,16}$/;
const MAX_NAME_LENGTH = 40;

export class NewsFeedValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'NewsFeedValidationError'; }
}

export function newsFeedWidgetId(feedId: string): string { return `${NEWS_FEED_WIDGET_PREFIX}${feedId}`; }

/** The feed ID referenced by a `news:<id>` widget, or null for any other widget. */
export function newsFeedIdFromWidget(widgetId: string): string | null {
  if (!widgetId.startsWith(NEWS_FEED_WIDGET_PREFIX)) return null;
  const id = widgetId.slice(NEWS_FEED_WIDGET_PREFIX.length);
  return FEED_ID.test(id) ? id : null;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Strictly validate an untrusted feed list before saving it. */
export function parseNewsFeeds(value: unknown): NewsFeed[] {
  if (!Array.isArray(value) || value.length > MAX_NEWS_FEEDS) {
    throw new NewsFeedValidationError(`News feeds must be a list of at most ${MAX_NEWS_FEEDS} feeds.`);
  }
  const ids = new Set<string>();
  return value.map((input) => {
    if (!record(input) || Object.keys(input).some((key) => !['id', 'name', 'feed_url', 'item_limit'].includes(key))) {
      throw new NewsFeedValidationError('Each news feed must contain only id, name, feed_url and item_limit.');
    }
    const { id, name, feed_url: feedUrl, item_limit: itemLimit } = input;
    if (typeof id !== 'string' || !FEED_ID.test(id) || ids.has(id)) {
      throw new NewsFeedValidationError('Each news feed needs a unique ID of 1–16 lowercase letters or digits.');
    }
    if (typeof name !== 'string' || name.trim().length > MAX_NAME_LENGTH) {
      throw new NewsFeedValidationError(`News feed names must be at most ${MAX_NAME_LENGTH} characters.`);
    }
    if (typeof itemLimit !== 'number' || !Number.isInteger(itemLimit) || itemLimit < 1 || itemLimit > 10) {
      throw new NewsFeedValidationError('News feed headline limit must be 1–10.');
    }
    if (typeof feedUrl !== 'string' || !feedUrl) throw new NewsFeedValidationError('Each news feed needs a feed URL.');
    try { validatePublicHttpsUrl(feedUrl); }
    catch (error) { throw new NewsFeedValidationError((error as Error).message); }
    ids.add(id);
    return { id, name: name.trim(), feed_url: feedUrl, item_limit: itemLimit };
  });
}

/** Stored rows were validated on save; tolerate legacy or hand-edited data when rendering. */
export function storedNewsFeeds(value: unknown): NewsFeed[] {
  try { return value === undefined || value === null ? [] : parseNewsFeeds(value); }
  catch { return []; }
}
