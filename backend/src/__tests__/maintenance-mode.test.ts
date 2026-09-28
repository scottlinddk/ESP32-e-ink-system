import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { createRateLimiter } from '../middleware/rateLimit';
import app from '../app';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('../middleware/rateLimit', () => ({
  createRateLimiter: vi.fn(() => vi.fn((_req: Request, _res: Response, next: NextFunction) => next())),
}));

describe('database migration maintenance mode', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    vi.stubEnv('DATABASE_MAINTENANCE_MODE', 'true');
    vi.mocked(createClient).mockClear();
    for (const result of vi.mocked(createRateLimiter).mock.results) vi.mocked(result.value).mockClear();
  });

  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it.each([
    ['GET', '/auth/user'], // A read can upsert the Clerk user.
    ['POST', '/auth/login'],
    ['POST', '/devices'],
    ['PUT', '/preferences'],
    ['DELETE', '/devices/test-id'],
    ['GET', '/image'], // Device reads can update last-seen and usage.
    ['GET', '/device-feed/test-id/frame'], // Device delivery can record activity.
    ['POST', '/device-feed/test-id/heartbeat'],
    ['POST', '/devices/test-id/delivery/token'],
    ['DELETE', '/devices/test-id/delivery/token'],
    ['POST', '/custom-webhook/ingest'], // External producers must freeze too.
    ['POST', '/custom-webhook/token'],
    ['DELETE', '/custom-webhook/token'],
    ['GET', '/firmware/manifest.json'],
  ])('freezes %s %s before rate limiting or database access', async (method, path) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: 'Bearer test-token', Origin: 'https://esp32.scottlind.dk' },
    });
    expect(response.status).toBe(503);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://esp32.scottlind.dk');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(response.headers.get('Retry-After')).toBe('300');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('maintenance') });
    expect(createClient).not.toHaveBeenCalled();
    for (const result of vi.mocked(createRateLimiter).mock.results) expect(result.value).not.toHaveBeenCalled();
  });

  it('allows browser preflight so the frontend can read the maintenance response', async () => {
    const response = await fetch(`${baseUrl}/devices`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://esp32.scottlind.dk',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://esp32.scottlind.dk');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    expect(createClient).not.toHaveBeenCalled();
    for (const result of vi.mocked(createRateLimiter).mock.results) expect(result.value).not.toHaveBeenCalled();
  });

  it('keeps database-independent health available while frozen', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
    expect(createClient).not.toHaveBeenCalled();
    for (const result of vi.mocked(createRateLimiter).mock.results) expect(result.value).not.toHaveBeenCalled();
  });

  it('resumes normal routing when maintenance is disabled', async () => {
    vi.stubEnv('DATABASE_MAINTENANCE_MODE', 'false');
    const response = await fetch(`${baseUrl}/checkout`, { method: 'POST' });
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: 'Checkout not yet implemented' });
    expect(createClient).not.toHaveBeenCalled();
  });
});
