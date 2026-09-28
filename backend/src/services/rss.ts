import { SaxesParser, SaxesTagNS } from 'saxes';
import { Parser as HtmlParser } from 'htmlparser2';
import { fetchPublicFeed, MAX_FEED_BYTES } from '../utils/publicFeedFetch';
import type { NewsItem } from '../types';

const ATOM = 'http://www.w3.org/2005/Atom';
const XML = 'http://www.w3.org/XML/1998/namespace';

function attribute(tag: SaxesTagNS, name: string, uri = ''): string | undefined {
  return Object.values(tag.attributes).find((a) => a.local === name && a.uri === uri)?.value;
}

function plainHtml(value: string): string {
  let result = '';
  let hidden = 0;
  const parser = new HtmlParser({
    onopentag(name) { if (name === 'script' || name === 'style') hidden++; if (['br', 'p', 'div', 'li'].includes(name)) result += ' '; },
    onclosetag(name) { if (name === 'script' || name === 'style') hidden = Math.max(0, hidden - 1); },
    ontext(text) { if (!hidden) result += text; },
  }, { decodeEntities: true });
  parser.end(value);
  return result;
}

function articleUrl(value: string, base: string): string {
  if (!value.trim()) return '';
  try {
    const url = new URL(value.trim(), base);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

/** XML parsing is delegated to saxes (including namespace and entity handling). */
export function parseNewsFeed(xml: string, baseUrl: string, limit = 3): NewsItem[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('Feed item limit must be between 1 and 10');
  if (Buffer.byteLength(xml, 'utf8') > MAX_FEED_BYTES) throw new Error('Feed exceeds the 1 MiB limit');
  const items: NewsItem[] = [];
  const stack: { local: string; uri: string; base: string }[] = [];
  let format: 'rss' | 'atom' | undefined;
  let entry: { depth: number; title: string; url: string } | undefined;
  let capture: { depth: number; kind: 'title' | 'link'; text: string; base: string; html: boolean } | undefined;
  let elements = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => { throw new Error('Feed document types and custom entities are not supported'); });
  parser.on('error', () => { throw new Error('Feed contains malformed XML'); });
  parser.on('opentag', (tag) => {
    if (++elements > 20_000 || stack.length >= 32) throw new Error('Feed XML is too complex');
    const parentBase = stack[stack.length - 1]?.base ?? baseUrl;
    const declaredBase = attribute(tag, 'base', XML);
    let base = parentBase;
    if (declaredBase) { try { base = new URL(declaredBase, parentBase).href; } catch { /* ignore invalid xml:base */ } }
    stack.push({ local: tag.local, uri: tag.uri, base });
    if (stack.length === 1) {
      if (tag.local === 'rss' && tag.uri === '') format = 'rss';
      else if (tag.local === 'feed' && tag.uri === ATOM) format = 'atom';
      else throw new Error('Expected an RSS 2.0 or Atom 1.0 feed');
    }
    const core = tag.uri === (format === 'atom' ? ATOM : '');
    if (core && (format === 'rss' && stack.length === 3 && stack[1].local === 'channel' && tag.local === 'item'
        || format === 'atom' && stack.length === 2 && tag.local === 'entry')) {
      entry = { depth: stack.length, title: '', url: '' };
    } else if (entry && core && stack.length === entry.depth + 1) {
      if (tag.local === 'title' && !entry.title) {
        capture = { depth: stack.length, kind: 'title', text: '', base, html: format === 'rss' || attribute(tag, 'type') === 'html' };
      } else if (tag.local === 'link') {
        if (format === 'rss') capture = { depth: stack.length, kind: 'link', text: '', base, html: false };
        else if (!entry.url && (!attribute(tag, 'rel') || attribute(tag, 'rel') === 'alternate')) {
          entry.url = articleUrl(attribute(tag, 'href') ?? '', base);
        }
      }
    }
  });
  const append = (text: string) => { if (capture) capture.text += text; };
  parser.on('text', append);
  parser.on('cdata', append);
  parser.on('closetag', () => {
    if (capture && capture.depth === stack.length && entry) {
      if (capture.kind === 'title') {
        const title = capture.html ? plainHtml(capture.text) : capture.text;
        entry.title = title.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 512);
      } else entry.url = articleUrl(capture.text, capture.base);
      capture = undefined;
    }
    if (entry && entry.depth === stack.length) {
      if (entry.title && items.length < limit && !items.some((item) => item.title === entry!.title && item.url === entry!.url)) {
        items.push({ title: entry.title, url: entry.url });
      }
      entry = undefined;
    }
    stack.pop();
  });
  parser.write(xml).close();
  return items;
}

export async function fetchRssNews(url: string, limit = 3, signal?: AbortSignal): Promise<NewsItem[]> {
  const feed = await fetchPublicFeed(url, signal);
  signal?.throwIfAborted();
  return parseNewsFeed(feed.text, feed.url, limit);
}
