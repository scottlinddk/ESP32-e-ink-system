import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupFunction } from 'node:net';
import { request } from 'node:https';
import ipaddr from 'ipaddr.js';

export const MAX_FEED_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  if (parsed.range() !== 'unicast') return false;
  if (parsed.kind() === 'ipv6') {
    // Only global unicast; exclude transition, documentation and protocol ranges.
    const v6 = parsed as ipaddr.IPv6;
    return v6.match(ipaddr.parse('2000::') as ipaddr.IPv6, 3)
      && !v6.match(ipaddr.parse('2001::') as ipaddr.IPv6, 23)
      && !v6.match(ipaddr.parse('2002::') as ipaddr.IPv6, 16)
      && !v6.match(ipaddr.parse('3fff::') as ipaddr.IPv6, 20);
  }
  // Benchmark networks are not globally reachable (older ipaddr releases call
  // this range unicast), and may be routed to internal testing infrastructure.
  return !(parsed as ipaddr.IPv4).match(ipaddr.parse('198.18.0.0') as ipaddr.IPv4, 15);
}

/** Syntactic checks at save time. DNS is checked again on every actual request. */
export function validatePublicHttpsUrl(value: string): URL {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Feed URL must be a public HTTPS URL (maximum 2048 characters)');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Feed URL must be a valid HTTPS URL'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
      || url.hash || !host.includes('.') && !host.includes(':')
      || /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)\.?$/.test(host)
      || ipaddr.isValid(host) && !isPublicAddress(host)) {
    throw new Error('Feed URL must use public HTTPS on port 443 without credentials or a fragment');
  }
  return url;
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

interface Download { body?: Buffer; redirect?: string }

async function download(url: URL, signal: AbortSignal): Promise<Download> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  // Check every answer, then pin one to the actual socket. A second DNS lookup
  // by the HTTP client would permit DNS rebinding between validation and use.
  const addresses = await abortable(dnsLookup(host, { all: true, verbatim: true }), signal);
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('Feed hostname must resolve only to public addresses');
  }
  const selected = addresses[0];
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, [selected]);
    else callback(null, selected.address, selected.family);
  };
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'GET', agent: false, lookup: pinnedLookup, signal,
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/calendar, */*;q=0.1', 'Accept-Encoding': 'identity', 'User-Agent': 'ESP32-e-ink-system/1.0' },
    }, (res) => {
      const fail = (error: Error) => { reject(error); res.destroy(); req.destroy(); };
      res.on('error', () => fail(new Error('Feed response was interrupted')));
      res.on('aborted', () => fail(new Error('Feed response was interrupted')));
      if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
        if (!res.headers.location) { fail(new Error('Feed redirect has no destination')); return; }
        resolve({ redirect: res.headers.location });
        res.destroy();
        return;
      }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        fail(new Error(`Feed request failed (${res.statusCode ?? 'unknown'})`)); return;
      }
      if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {
        fail(new Error('Compressed feed responses are not supported')); return;
      }
      if (Number(res.headers['content-length']) > MAX_FEED_BYTES) {
        fail(new Error('Feed exceeds the 1 MiB limit')); return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_FEED_BYTES) { fail(new Error('Feed exceeds the 1 MiB limit')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ body: Buffer.concat(chunks) }));
    });
    // Do not leak URLs (which can contain private feed tokens) into error logs.
    req.on('error', () => reject(signal.aborted ? signal.reason : new Error('Unable to retrieve feed')));
    req.end();
  });
}

/** Public HTTPS only, pinned DNS, bounded bytes, redirects and total wall time. */
export async function fetchPublicFeed(value: string, signal?: AbortSignal): Promise<{ text: string; url: string }> {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error('Feed request cancelled'));
  signal?.throwIfAborted();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Feed request timed out')), 8000);
  try {
    let url = validatePublicHttpsUrl(value);
    for (let redirects = 0; ; redirects++) {
      const result = await download(url, controller.signal);
      controller.signal.throwIfAborted();
      if (result.redirect) {
        if (redirects >= MAX_REDIRECTS) throw new Error('Too many feed redirects');
        url = validatePublicHttpsUrl(new URL(result.redirect, url).href);
      } else {
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(result.body), url: url.href };
      }
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
