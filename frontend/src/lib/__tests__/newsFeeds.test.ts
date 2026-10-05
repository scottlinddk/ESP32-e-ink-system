import { describe, expect, it } from 'vitest';
import { createNewsFeedId, emptyNewsFeed, newsFeedIdFromWidget, newsFeedLabel, newsFeedWidgetId } from '../newsFeeds';

describe('additional news feed helpers', () => {
  it('maps feeds to their own layout widget IDs and back', () => {
    expect(newsFeedWidgetId('dr')).toBe('news:dr');
    expect(newsFeedIdFromWidget('news:dr')).toBe('dr');
    expect(newsFeedIdFromWidget('news')).toBeNull();
    expect(newsFeedIdFromWidget('news:Bad')).toBeNull();
  });
  it('creates IDs the backend accepts and never reuses one', () => {
    const existing = [emptyNewsFeed([])];
    const id = createNewsFeedId(existing);
    expect(id).toMatch(/^[a-z0-9]{1,16}$/);
    expect(id).not.toBe(existing[0].id);
    expect(newsFeedIdFromWidget(newsFeedWidgetId(id))).toBe(id);
  });
  it('labels a feed by name, then host name', () => {
    expect(newsFeedLabel({ id: 'a', name: ' DR ', feed_url: 'https://www.dr.dk/rss', item_limit: 3 })).toBe('DR');
    expect(newsFeedLabel({ id: 'a', name: '', feed_url: 'https://www.dr.dk/rss', item_limit: 3 })).toBe('dr.dk');
    expect(newsFeedLabel({ id: 'a', name: '', feed_url: 'not a url', item_limit: 3 })).toBe('a');
  });
});
