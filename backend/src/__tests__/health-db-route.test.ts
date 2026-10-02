import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { Request, Response, NextFunction } from 'express';
import app from '../app';
import { checkDatabase } from '../services/databaseHealth';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('../middleware/rateLimit', () => ({
  createRateLimiter: vi.fn(() => vi.fn((_req: Request, _res: Response, next: NextFunction) => next())),
}));
vi.mock('../services/databaseHealth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/databaseHealth')>()),
  checkDatabase: vi.fn(),
}));

describe('GET /health/db', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  beforeEach(() => { vi.mocked(checkDatabase).mockReset(); });

  it('returns 200 when the database is reachable', async () => {
    vi.mocked(checkDatabase).mockResolvedValue({ ok: true });
    const response = await fetch(`${baseUrl}/api/health/db`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it.each(['token_rejected', 'gateway_challenge', 'gateway_error', 'unreachable', 'not_configured', 'error'] as const)(
    'returns 503 with only the coarse reason %s',
    async (reason) => {
      vi.mocked(checkDatabase).mockResolvedValue({ ok: false, reason });
      const response = await fetch(`${baseUrl}/health/db`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: 'error', reason });
    }
  );

  it('does not break the plain liveness endpoint', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });
});
