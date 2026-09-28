import { describe, expect, it, vi } from 'vitest';
import { parseNewsFeed, fetchRssNews } from '../services/rss';
import { fetchPublicFeed, MAX_FEED_BYTES } from '../utils/publicFeedFetch';

vi.mock('../utils/publicFeedFetch', async (original) => ({
  ...await original<typeof import('../utils/publicFeedFetch')>(), fetchPublicFeed: vi.fn(),
}));

const rss = (items: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed title</title>${items}</channel></rss>`;
const base = 'https://news.example.org/feed.xml';

describe('RSS 2.0 and Atom 1.0', () => {
  it('decodes XML entities, CDATA and HTML titles without treating metadata as stories', () => {
    expect(parseNewsFeed(rss(`<item><title><![CDATA[<b>Danmark</b> &amp; Europa&nbsp;<script>hidden</script>]]></title><link>/one?a=1&amp;b=2</link></item>
      <item><title>Electricity &lt; 0 &amp; wind</title><link>https://news.example.org/two</link></item>`), base)).toEqual([
      { title: 'Danmark & Europa', url: 'https://news.example.org/one?a=1&b=2' },
      { title: 'Electricity < 0 & wind', url: 'https://news.example.org/two' },
    ]);
  });

  it('handles prefixed Atom, alternate links, nested XHTML and inherited xml:base', () => {
    const xml = `<a:feed xmlns:a="http://www.w3.org/2005/Atom" xml:base="https://example.org/articles/">
      <a:title>Not an entry</a:title><a:entry xml:base="today/">
        <a:title type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">Wind <b>power</b></div></a:title>
        <a:link rel="self" href="metadata"/><a:link rel="alternate" href="story"/>
      </a:entry><a:entry><a:title type="html">&lt;b&gt;Grid&lt;/b&gt; &amp;amp; prices</a:title><a:link href="prices"/></a:entry>
      <a:entry><a:title type="text">Use &lt;b&gt; literally</a:title></a:entry>
    </a:feed>`;
    expect(parseNewsFeed(xml, base)).toEqual([
      { title: 'Wind power', url: 'https://example.org/articles/today/story' },
      { title: 'Grid & prices', url: 'https://example.org/articles/prices' },
      { title: 'Use <b> literally', url: '' },
    ]);
  });

  it('keeps headline-only stories, drops unsafe links, empty titles and duplicate entries, and applies the limit', () => {
    const item = '<item><title>One</title><link>javascript:alert(1)</link></item>';
    expect(parseNewsFeed(rss(`<item><link>/no-title</link></item>${item}${item}<item><title>Two</title></item><item><title>Three</title></item>`), base, 2)).toEqual([
      { title: 'One', url: '' }, { title: 'Two', url: '' },
    ]);
    expect(parseNewsFeed(rss(''), base)).toEqual([]);
  });

  it.each([
    '<rss><channel><item></channel></rss>', '<html><body>not a feed</body></html>',
    '<rss><channel><item><title>&unknown;</title></item></channel></rss>',
    '<!DOCTYPE rss [<!ENTITY secret SYSTEM "file:///etc/passwd">]><rss><channel/></rss>',
    '<!DOCTYPE rss SYSTEM "https://example.org/entities"><rss><channel/></rss>',
  ])('rejects malformed or unsafe XML: %s', (xml) => {
    expect(() => parseNewsFeed(xml, base)).toThrow();
  });

  it('enforces complexity, body-size and item-count bounds', () => {
    expect(() => parseNewsFeed(rss('<x>'.repeat(40) + '</x>'.repeat(40)), base)).toThrow('complex');
    expect(() => parseNewsFeed(rss(' '.repeat(MAX_FEED_BYTES)), base)).toThrow('1 MiB');
    expect(() => parseNewsFeed(rss(''), base, 11)).toThrow('limit');
    expect(() => parseNewsFeed(rss('<x/>'.repeat(20_001)), base)).toThrow('complex');
  });

  it('uses the final response URL for relative story links and propagates cancellation', async () => {
    vi.mocked(fetchPublicFeed).mockResolvedValue({ text: rss('<item><title>News</title><link>story</link></item>'), url: 'https://other.example.org/feeds/latest' });
    const controller = new AbortController();
    expect(await fetchRssNews(base, 1, controller.signal)).toEqual([{ title: 'News', url: 'https://other.example.org/feeds/story' }]);
    expect(fetchPublicFeed).toHaveBeenLastCalledWith(base, controller.signal);
    controller.abort();
    await expect(fetchRssNews(base, 1, controller.signal)).rejects.toThrow();
  });
});
