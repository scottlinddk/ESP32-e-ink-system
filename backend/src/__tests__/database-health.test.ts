import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { checkDatabase, classifyDatabaseError, resetDatabaseHealthCache } from '../services/databaseHealth';
import { DatabaseConfigError } from '../db/config';
import { pingDatabase } from '../db/pool';
import { errorHandler } from '../middleware/errorHandler';

vi.mock('../db/pool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db/pool')>()),
  pingDatabase: vi.fn(),
}));

const pgError = (code: string, message: string) => Object.assign(new Error(message), { code });

describe('classifyDatabaseError', () => {
  it.each([
    [pgError('28P01', 'password authentication failed for user "eink_app"'), 'authentication_failed'],
    [pgError('28000', 'no pg_hba.conf entry for host'), 'authentication_failed'],
    [pgError('ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.5:5432'), 'unreachable'],
    [pgError('ENOTFOUND', 'getaddrinfo ENOTFOUND postgres'), 'unreachable'],
    [pgError('EAI_AGAIN', 'getaddrinfo EAI_AGAIN postgres'), 'unreachable'],
    [pgError('57P01', 'terminating connection due to administrator command'), 'unreachable'],
    [pgError('57P03', 'the database system is starting up'), 'unreachable'],
    [pgError('08006', 'connection failure'), 'unreachable'],
    [new Error('Connection terminated unexpectedly'), 'unreachable'],
    [new Error('Cannot use a pool after calling end on the pool'), 'unreachable'],
    [pgError('53300', 'sorry, too many clients already'), 'too_many_connections'],
    [pgError('57014', 'canceling statement due to statement timeout'), 'timeout'],
    [pgError('ETIMEDOUT', 'connect ETIMEDOUT 10.0.0.5:5432'), 'timeout'],
    [new Error('timeout exceeded when trying to connect'), 'timeout'],
    [pgError('DEPTH_ZERO_SELF_SIGNED_CERT', 'self-signed certificate'), 'tls_error'],
    [pgError('SELF_SIGNED_CERT_IN_CHAIN', 'self-signed certificate in certificate chain'), 'tls_error'],
    [pgError('UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'unable to verify the first certificate'), 'tls_error'],
    [pgError('ERR_TLS_CERT_ALTNAME_INVALID', "Hostname/IP does not match certificate's altnames"), 'tls_error'],
    [new Error('The server does not support SSL connections'), 'tls_error'],
    [new DatabaseConfigError('DATABASE_URL environment variable is required.'), 'not_configured'],
  ])('classifies %s', (error, expected) => {
    expect(classifyDatabaseError(error)).toBe(expected);
  });

  it.each([
    [pgError('23505', 'duplicate key value violates unique constraint')],
    [pgError('23503', 'foreign key violation')],
    [pgError('42P01', 'relation "users" does not exist')],
    [pgError('42703', 'column does not exist')],
    [pgError('22P02', 'invalid input syntax for type uuid')],
    [new Error('Preferences must be an object')],
    [new Error('unable to verify the first certificate of an unrelated upstream')],
    ['a string'], [null], [undefined],
  ])('leaves ordinary errors alone: %s', (error) => {
    expect(classifyDatabaseError(error)).toBeNull();
  });
});

describe('checkDatabase', () => {
  beforeEach(() => { resetDatabaseHealthCache(); vi.mocked(pingDatabase).mockReset(); });

  it('reports ok when a statement succeeds', async () => {
    vi.mocked(pingDatabase).mockResolvedValue();
    expect(await checkDatabase()).toEqual({ ok: true });
  });

  it.each([
    [pgError('28P01', 'password authentication failed'), 'authentication_failed'],
    [pgError('ECONNREFUSED', 'connect ECONNREFUSED'), 'unreachable'],
    [pgError('DEPTH_ZERO_SELF_SIGNED_CERT', 'self-signed certificate'), 'tls_error'],
    [new DatabaseConfigError('DATABASE_URL has no host.'), 'not_configured'],
    [pgError('42P01', 'relation does not exist'), 'error'],
  ])('maps %s to the coarse reason %s', async (error, reason) => {
    vi.mocked(pingDatabase).mockRejectedValue(error);
    expect(await checkDatabase()).toEqual({ ok: false, reason });
  });

  it('caches the result briefly so the endpoint cannot hammer the database', async () => {
    vi.mocked(pingDatabase).mockResolvedValue();
    const start = 1_000_000;
    await checkDatabase(start);
    await checkDatabase(start + 10_000);
    expect(pingDatabase).toHaveBeenCalledTimes(1);
    await checkDatabase(start + 31_000);
    expect(pingDatabase).toHaveBeenCalledTimes(2);
  });
});

describe('errorHandler', () => {
  function run(err: unknown, header?: string) {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const req = { get: vi.fn(() => header) };
    errorHandler(err as never, req as unknown as Request, res as unknown as Response, vi.fn() as never);
    return res;
  }

  it('answers a database outage with 503 and nothing from the server', () => {
    const res = run(pgError('ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'), 'req-1');
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'Database is temporarily unavailable', requestId: 'req-1' });
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toMatch(/10\.0\.0\.5|hunter2/);
  });

  it('answers a rejected role with 503 and a generic message', () => {
    const res = run(pgError('28P01', 'password authentication failed for user "eink_app"'));
    expect(res.status).toHaveBeenCalledWith(503);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toMatch(/eink_app|password/i);
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
