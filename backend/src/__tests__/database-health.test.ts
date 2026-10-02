import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  checkDatabase,
  classifyDatabaseError,
  resetDatabaseHealthCache,
} from '../services/databaseHealth';
import { getSupabaseClient } from '../services/database';
import { errorHandler } from '../middleware/errorHandler';

vi.mock('../services/database', () => ({ getSupabaseClient: vi.fn() }));

const CHALLENGE = '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title>';
const GATEWAY_404 = '<html><head><title>404 Not Found</title></head><body>nginx</body></html>';

function clientReturning(result: { error: unknown } | Error) {
  const abortSignal = vi.fn(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
  );
  const limit = vi.fn(() => ({ abortSignal }));
  const select = vi.fn(() => ({ limit }));
  vi.mocked(getSupabaseClient).mockReturnValue({ from: vi.fn(() => ({ select })) } as never);
}

describe('classifyDatabaseError', () => {
  it.each([
    [{ code: 'PGRST301', message: 'JWT cryptographic operation failed' }, 'token_rejected'],
    [{ code: 'PGRST301', message: 'No suitable key or wrong key type' }, 'token_rejected'],
    [{ code: 'PGRST303', message: 'JWT expired' }, 'token_rejected'],
    [{ message: CHALLENGE }, 'gateway_challenge'],
    [{ message: '<html><script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script></html>' }, 'gateway_challenge'],
    [{ message: GATEWAY_404 }, 'gateway_error'],
    [{ message: '<!DOCTYPE html><title>502 Bad Gateway</title>' }, 'gateway_error'],
    [{ message: 'TypeError: fetch failed' }, 'unreachable'],
    [new Error('connect ECONNREFUSED 127.0.0.1:3080'), 'unreachable'],
  ])('classifies %j', (error, expected) => {
    expect(classifyDatabaseError(error)).toBe(expected);
  });

  it.each([
    [{ code: '23505', message: 'duplicate key value violates unique constraint' }],
    [{ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }],
    [new Error('Preferences must be an object')],
    ['a string'],
    [null],
    [undefined],
  ])('leaves ordinary errors alone: %j', (error) => {
    expect(classifyDatabaseError(error)).toBeNull();
  });
});

describe('checkDatabase', () => {
  beforeEach(() => {
    resetDatabaseHealthCache();
    vi.mocked(getSupabaseClient).mockReset();
  });

  it('reports ok when the read succeeds', async () => {
    clientReturning({ error: null });
    expect(await checkDatabase()).toEqual({ ok: true });
  });

  it('reports a rejected token', async () => {
    clientReturning({ error: { code: 'PGRST301', message: 'JWT cryptographic operation failed' } });
    expect(await checkDatabase()).toEqual({ ok: false, reason: 'token_rejected' });
  });

  it('reports a bot-protection challenge', async () => {
    clientReturning({ error: { message: CHALLENGE } });
    expect(await checkDatabase()).toEqual({ ok: false, reason: 'gateway_challenge' });
  });

  it('distinguishes an HTML proxy error from a bot-protection challenge', async () => {
    clientReturning({ error: { message: GATEWAY_404 } });
    expect(await checkDatabase()).toEqual({ ok: false, reason: 'gateway_error' });
  });

  it('reports an unreachable gateway when the request throws', async () => {
    clientReturning(new TypeError('fetch failed'));
    expect(await checkDatabase()).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('reports missing configuration', async () => {
    vi.mocked(getSupabaseClient).mockImplementation(() => {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    });
    expect(await checkDatabase()).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('falls back to a generic reason for other errors', async () => {
    clientReturning({ error: { code: '42P01', message: 'relation "users" does not exist' } });
    expect(await checkDatabase()).toEqual({ ok: false, reason: 'error' });
  });

  it('caches the result briefly so the endpoint cannot hammer the database', async () => {
    clientReturning({ error: null });
    const start = 1_000_000;
    await checkDatabase(start);
    await checkDatabase(start + 10_000);
    expect(getSupabaseClient).toHaveBeenCalledTimes(1);
    await checkDatabase(start + 31_000);
    expect(getSupabaseClient).toHaveBeenCalledTimes(2);
  });
});

describe('errorHandler', () => {
  function run(err: unknown, header?: string) {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const req = { get: vi.fn(() => header) };
    errorHandler(err as never, req as unknown as Request, res as unknown as Response, vi.fn() as never);
    return res;
  }

  it('does not leak the upstream challenge page to the client', () => {
    const res = run({ message: CHALLENGE }, 'iad1::abc');
    expect(res.status).toHaveBeenCalledWith(503);
    const body = JSON.stringify(res.json.mock.calls[0][0]);
    expect(body).not.toMatch(/doctype|just a moment/i);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Database is temporarily unavailable',
      requestId: 'iad1::abc',
    });
  });

  it('answers a rejected token with 503 and a generic message', () => {
    const res = run({ code: 'PGRST301', message: 'JWT cryptographic operation failed' });
    expect(res.status).toHaveBeenCalledWith(503);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toMatch(/jwt/i);
  });

  it('hides messages of unexpected errors', () => {
    const res = run(new Error('secret internal detail'));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0]).toMatchObject({ error: 'Internal server error' });
  });

  it('keeps the message of errors raised on purpose', () => {
    const err = Object.assign(new Error('Preferences must be an object'), { statusCode: 400 });
    const res = run(err);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ error: 'Preferences must be an object' });
  });
});
