import type { NewsFeed } from '../types';

// Mirrors backend/src/utils/newsFeeds.ts. Each additional feed is placed in a
// layout as its own `news:<id>` widget.
export const MAX_NEWS_FEEDS = 20;
export const NEWS_FEED_NAME_MAX = 40;
const NEWS_FEED_WIDGET_PREFIX = 'news:';
const FEED_ID = /^[a-z0-9]{1,16}$/;

export function newsFeedWidgetId(feedId: string): string { return `${NEWS_FEED_WIDGET_PREFIX}${feedId}`; }

export function newsFeedIdFromWidget(widgetId: string): string | null {
  if (!widgetId.startsWith(NEWS_FEED_WIDGET_PREFIX)) return null;
  const id = widgetId.slice(NEWS_FEED_WIDGET_PREFIX.length);
  return FEED_ID.test(id) ? id : null;
}

/** A short random ID that is not already used by another feed. */
export function createNewsFeedId(existing: readonly NewsFeed[]): string {
  const used = new Set(existing.map((feed) => feed.id));
  for (;;) {
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    if (!used.has(id)) return id;
  }
}

export function emptyNewsFeed(existing: readonly NewsFeed[]): NewsFeed {
  return { id: createNewsFeedId(existing), name: '', feed_url: '', item_limit: 3 };
}

/** The name, or the feed's host name when no name is set. */
export function newsFeedLabel(feed: NewsFeed): string {
  if (feed.name.trim()) return feed.name.trim();
  try { return new URL(feed.feed_url).hostname.replace(/^www\./, ''); } catch { return feed.id; }
}

/** Trimmed feeds ready to save. */
export function newsFeedsForSave(feeds: readonly NewsFeed[]): NewsFeed[] {
  return feeds.map((feed) => ({ ...feed, name: feed.name.trim(), feed_url: feed.feed_url.trim() }));
}
