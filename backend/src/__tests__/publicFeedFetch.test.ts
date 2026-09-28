import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { lookup } from 'node:dns/promises';
import { request, RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { fetchPublicFeed, isPublicAddress, MAX_FEED_BYTES, validatePublicHttpsUrl } from '../utils/publicFeedFetch';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('node:https', () => ({ request: vi.fn() }));

type Reply = { status?: number; headers?: Record<string, string>; chunks?: Buffer[]; hang?: boolean; interrupted?: boolean };
let replies: Reply[];

beforeEach(() => {
  vi.clearAllMocks();
  replies = [];
  vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
  vi.mocked(request).mockImplementation(((url: URL, options: RequestOptions, callback: (res: IncomingMessage) => void) => {
    const reply = replies.shift() ?? {};
    const req = new EventEmitter() as ClientRequest;
    req.destroy = vi.fn(() => req);
    req.end = vi.fn(() => {
      queueMicrotask(() => {
        const res = new EventEmitter() as IncomingMessage;
        res.statusCode = reply.status ?? 200;
        res.headers = reply.headers ?? {};
        let destroyed = false;
        res.destroy = vi.fn(() => { destroyed = true; return res; });
        callback(res);
        if (!destroyed && !reply.hang) {
          for (const chunk of reply.chunks ?? [Buffer.from('<rss/>')]) if (!destroyed) res.emit('data', chunk);
          if (reply.interrupted) res.emit('aborted');
          else if (!destroyed) res.emit('end');
        }
      });
      return req;
    }) as ClientRequest['end'];
    options.signal?.addEventListener('abort', () => req.emit('error', options.signal?.reason), { once: true });
    return req;
  }) as typeof request);
});
afterEach(() => { vi.useRealTimers(); });

describe('public feed fetching', () => {
  it.each(['127.0.0.1', '0.0.0.0', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '192.0.2.1', '198.18.0.1', '224.0.0.1', '255.255.255.255', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '64:ff9b::a00:1', '2001:db8::1', '2002:7f00:1::', '3fff::1'])('rejects non-public IP %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(['http://example.org/feed', 'https://user:pass@example.org/feed', 'https://example.org:8443/feed', 'https://localhost/feed', 'https://router.local/feed', 'https://127.1/feed', 'https://0x7f000001/feed', 'https://2130706433/feed', 'https://[::ffff:127.0.0.1]/feed', 'https://example.org/feed#fragment'])('rejects unsafe URL %s before network access', async (url) => {
    await expect(fetchPublicFeed(url)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('allows public IPv4/IPv6 and pins the socket lookup while preserving HTTPS hostname verification', async () => {
    expect(isPublicAddress('93.184.216.34')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    expect(validatePublicHttpsUrl('https://example.org/feed').hostname).toBe('example.org');
    expect(await fetchPublicFeed('https://example.org/feed')).toEqual({ text: '<rss/>', url: 'https://example.org/feed' });
    const [url, options] = vi.mocked(request).mock.calls[0] as unknown as [URL, RequestOptions];
    expect(url.hostname).toBe('example.org');
    expect(options.agent).toBe(false);
    const callback = vi.fn();
    options.lookup!('example.org', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    const callbackAll = vi.fn();
    options.lookup!('example.org', { all: true }, callbackAll);
    expect(callbackAll).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('rejects mixed public/private DNS answers and never opens a socket', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }] as never);
    await expect(fetchPublicFeed('https://example.org/feed')).rejects.toThrow('public addresses');
    expect(request).not.toHaveBeenCalled();
  });

  it('revalidates redirect DNS answers, including a rebinding on the same hostname', async () => {
    replies.push({ status: 302, headers: { location: '/next' } });
    vi.mocked(lookup).mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as never)
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as never);
    await expect(fetchPublicFeed('https://example.org/feed')).rejects.toThrow('public addresses');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(['http://example.org/next', 'https://169.254.169.254/metadata', 'https://user:pass@example.org/next'])('blocks unsafe redirect %s', async (location) => {
    replies.push({ status: 302, headers: { location } });
    await expect(fetchPublicFeed('https://example.org/feed')).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('follows bounded public redirects and returns the final URL', async () => {
    replies.push({ status: 301, headers: { location: '/new-feed' } });
    expect((await fetchPublicFeed('https://example.org/feed')).url).toBe('https://example.org/new-feed');
    expect(lookup).toHaveBeenCalledTimes(2);
    replies = Array.from({ length: 4 }, () => ({ status: 302, headers: { location: '/loop' } }));
    await expect(fetchPublicFeed('https://example.org/feed')).rejects.toThrow('Too many');
  });

  it.each([
    { headers: { 'content-length': String(MAX_FEED_BYTES + 1) } },
    { chunks: [Buffer.alloc(MAX_FEED_BYTES), Buffer.from('x')] },
  ])('bounds declared and streamed response sizes', async (reply) => {
    replies.push(reply);
    await expect(fetchPublicFeed('https://example.org/feed')).rejects.toThrow('1 MiB');
  });

  it.each([{ status: 404 }, { headers: { 'content-encoding': 'gzip' } }, { interrupted: true }, { chunks: [Buffer.from([0xff])] }])('rejects HTTP failures, compressed, interrupted and invalid UTF-8 responses', async (reply) => {
    replies.push(reply);
    await expect(fetchPublicFeed('https://example.org/feed')).rejects.toThrow();
  });

  it('applies a total deadline to DNS resolution and slow responses', async () => {
    vi.useFakeTimers();
    vi.mocked(lookup).mockReturnValueOnce(new Promise(() => {}));
    const pendingDns = expect(fetchPublicFeed('https://example.org/feed')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(8000);
    await pendingDns;
    expect(request).not.toHaveBeenCalled();
    replies.push({ hang: true });
    const pendingBody = expect(fetchPublicFeed('https://example.org/feed')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(8000);
    await pendingBody;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors caller cancellation before fetching and during a pending response', async () => {
    const early = new AbortController(); early.abort();
    await expect(fetchPublicFeed('https://example.org/feed', early.signal)).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
    const controller = new AbortController();
    replies.push({ hang: true });
    const pending = expect(fetchPublicFeed('https://example.org/feed', controller.signal)).rejects.toThrow('cancelled');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    controller.abort();
    await pending;
  });
});
