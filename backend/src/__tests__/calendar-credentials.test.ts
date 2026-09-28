import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import router from '../routes/preferences';
import { decrypt, isEncrypted } from '../utils/crypto';

const db = vi.hoisted(() => ({ row: null as null | { user_id: string; provider: string; api_key: string }, fail: false, prefs: {} }));
vi.mock('../middleware/auth', () => ({ requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.headers.authorization !== 'Bearer test-session') { res.status(401).json({ error: 'Unauthorized' }); return; }
  req.clerkUserId = 'clerk-owner'; next();
} }));
vi.mock('../routes/preferences-helpers', () => ({ getOrCreateUserFromClerk: vi.fn().mockResolvedValue('owner') }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (table: string) => ({
  upsert: (row: { user_id: string; provider: string; api_key: string }) => {
    if (db.fail) throw new Error('private https://example.org/secret-token');
    if (table === 'api_keys') db.row = row; else db.prefs = row;
    return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
  },
  select: () => ({ eq: async (_key: string, owner: string) => ({ data: db.row?.user_id === owner ? [db.row] : [], error: null }) }),
  delete: () => ({ eq: (_key: string, owner: string) => ({ eq: async (_key2: string, provider: string) => {
    if (db.row?.user_id === owner && db.row.provider === provider) db.row = null;
    return { error: null };
  } }) }),
}) }) }));

describe('private calendar configuration', () => {
  let server: Server;
  let base: string;
  const secret = 'https://calendar.example.org/private/secret-token?access=private-access';
  beforeAll(async () => {
    vi.stubEnv('SUPABASE_URL', 'https://db.example.org'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only'); vi.stubEnv('ENCRYPTION_KEY', 'ab'.repeat(32));
    const app = express(); app.use(express.json()); app.use('/preferences', router);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/preferences`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); vi.unstubAllEnvs(); });
  beforeEach(() => { db.row = null; db.fail = false; db.prefs = {}; });
  const call = (path: string, method = 'GET', body?: unknown) => fetch(`${base}${path}`, { method, headers: { Authorization: 'Bearer test-session', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

  it('encrypts the URL, scopes storage to the owner, returns only status, and removes it', async () => {
    const saved = await call('/calendar-credentials', 'POST', { url: secret, user_id: 'attacker' });
    expect(saved.status).toBe(200); expect(await saved.json()).toEqual({ configured: true });
    expect(db.row?.user_id).toBe('owner'); expect(isEncrypted(db.row!.api_key)).toBe(true);
    expect(db.row?.api_key).not.toContain(secret); expect(decrypt(db.row!.api_key)).toBe(secret);
    expect(await (await call('/calendar-credentials')).json()).toEqual({ configured: true });
    expect(await (await call('/api-keys')).json()).toEqual({ api_keys: [] });
    expect(await (await call('/calendar-credentials', 'DELETE')).json()).toEqual({ configured: false });
    expect(db.row).toBeNull();
  });
  it('requires authentication and never fetches or stores unauthorized input', async () => {
    const response = await fetch(`${base}/calendar-credentials`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: secret }) });
    expect(response.status).toBe(401); expect(db.row).toBeNull();
  });
  it('redacts database failures', async () => {
    db.fail = true;
    const response = await call('/calendar-credentials', 'POST', { url: secret });
    expect(response.status).toBe(500); expect(await response.text()).not.toContain('secret-token');
  });
  it.each(['http://calendar.example.org/x', 'https://127.0.0.1/private', 'https://user:password@example.org/x', null])('rejects unsafe calendar URLs without echoing them', async (url) => {
    const response = await call('/calendar-credentials', 'POST', { url });
    expect(response.status).toBe(400); expect(db.row).toBeNull();
  });
  it('persists validated agenda options but ignores URL fields in preferences', async () => {
    const response = await call('', 'POST', { show_calendar: true, calendar_timezone: 'America/New_York', calendar_days: 14, calendar_item_limit: 8, calendar_url: secret });
    expect(response.status).toBe(200);
    expect(db.prefs).toMatchObject({ user_id: 'owner', show_calendar: true, calendar_timezone: 'America/New_York', calendar_days: 14, calendar_item_limit: 8 });
    expect(JSON.stringify(db.prefs)).not.toContain(secret);
  });
  it.each([{ show_calendar: 'yes' }, { calendar_timezone: 'Invalid/Zone' }, { calendar_timezone: null }, { calendar_days: 0 }, { calendar_days: 31 }, { calendar_item_limit: 11 }, { calendar_item_limit: 1.5 }])('rejects invalid agenda options %j', async (options) => {
    expect((await call('', 'POST', options)).status).toBe(400); expect(db.prefs).toEqual({});
  });
});
