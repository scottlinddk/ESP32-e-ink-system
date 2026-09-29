import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { Request, Response, NextFunction } from 'express';
import app from '../app';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('../middleware/rateLimit', () => ({
  createRateLimiter: vi.fn(() => vi.fn((_req: Request, _res: Response, next: NextFunction) => next())),
}));

describe('/api path prefix', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it.each(['/health', '/api/health', '/api/health?probe=1'])('serves %s', async (path) => {
    const response = await fetch(`${baseUrl}${path}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });

  it('still requires authentication behind the prefix', async () => {
    const response = await fetch(`${baseUrl}/api/preferences`);
    expect(response.status).toBe(401);
  });

  it('reports unknown routes without the prefix', async () => {
    const response = await fetch(`${baseUrl}/api/nope`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Route not found: GET /nope' });
  });

  it('does not strip look-alike paths such as /api-docs', async () => {
    const response = await fetch(`${baseUrl}/api-docs/`);
    expect(response.status).toBe(200);
  });
});
