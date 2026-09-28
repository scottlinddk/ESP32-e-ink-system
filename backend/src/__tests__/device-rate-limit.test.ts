import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { createRateLimiter } from '../middleware/rateLimit';

const limits = vi.hoisted(() => ({ keys: [] as string[] }));
vi.mock('@upstash/redis', () => ({ Redis: class {} }));
vi.mock('@upstash/ratelimit', () => ({ Ratelimit: class {
  static slidingWindow() { return {}; }
  async limit(key: string) { limits.keys.push(key); return { success: true, limit: 120, remaining: 119, reset: Date.now() + 60000 }; }
} }));
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn() } }));
afterEach(() => { vi.unstubAllEnvs(); limits.keys = []; });

describe('device rate-limit identity', () => {
  it('gives four devices on one gateway separate budgets', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.org'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-only');
    const limiter = createRateLimiter(120, '1 m', 'Limited', 'device-test', (request) => request.params.id);
    const response = { setHeader: vi.fn() } as unknown as Response;
    for (const id of ['one', 'two', 'three', 'four']) {
      for (let count = 0; count < 30; count++) await limiter({ params: { id }, headers: { 'x-forwarded-for': '203.0.113.5' } } as unknown as Request, response, () => {});
    }
    expect(new Set(limits.keys)).toEqual(new Set(['one', 'two', 'three', 'four']));
    expect(limits.keys.filter((key) => key === 'one')).toHaveLength(30);
  });
  it('keeps ordinary/invalid-auth limits scoped to IP by default', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.org'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-only');
    const limiter = createRateLimiter(30, '1 m', 'Limited', 'invalid-device');
    await limiter({ headers: { 'x-forwarded-for': '203.0.113.5' } } as unknown as Request, { setHeader: vi.fn() } as unknown as Response, () => {});
    expect(limits.keys).toEqual(['203.0.113.5']);
  });
});
