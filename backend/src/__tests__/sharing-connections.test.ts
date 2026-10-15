import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestConnection, shareDevice } from '../services/sharing';

const db = vi.hoisted(() => ({ userId: null as string | null, connection: null as unknown, inserts: [] as unknown[], updates: [] as unknown[], upserts: [] as unknown[], from: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: db.from }) }));

function chain(table: string) {
  const query: Record<string, unknown> = {
    select: () => query, eq: () => query, limit: () => query, or: async () => ({ data: db.connection ? [db.connection] : [], error: null }),
    ilike: () => query,
    maybeSingle: async () => ({ data: table === 'users' ? (db.userId ? { id: db.userId } : null) : table === 'devices' ? { user_id: 'me' } : null, error: null }),
    insert: async (row: unknown) => { db.inserts.push([table, row]); return { error: null }; },
    upsert: async (row: unknown) => { db.upserts.push([table, row]); return { error: null }; },
    update: (row: unknown) => { db.updates.push([table, row]); return query; },
    then: (resolve: (value: unknown) => void) => resolve({ error: null }),
  };
  return query;
}

describe('requesting a connection', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://db.example.org');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
    db.userId = null; db.connection = null; db.inserts = []; db.updates = []; db.upserts = []; db.from.mockImplementation(chain);
  });

  it('rejects malformed addresses', async () => {
    await expect(requestConnection('me', 'not-an-email')).rejects.toMatchObject({ statusCode: 400 });
    await expect(requestConnection('me', 42)).rejects.toMatchObject({ statusCode: 400 });
  });
  it('does not reveal whether an address has an account', async () => {
    await expect(requestConnection('me', 'nobody@example.org')).resolves.toBeUndefined();
    expect(db.inserts).toEqual([]);
    db.userId = 'them';
    await expect(requestConnection('me', 'someone@example.org')).resolves.toBeUndefined();
    expect(db.inserts).toEqual([['user_connections', { requester_id: 'me', addressee_id: 'them' }]]);
  });
  it('refuses to connect a user to themselves', async () => {
    db.userId = 'me';
    await expect(requestConnection('me', 'me@example.org')).rejects.toMatchObject({ statusCode: 400 });
  });
  it('treats asking someone who already asked you as accepting', async () => {
    db.userId = 'them';
    db.connection = { id: 'c1', requester_id: 'them', addressee_id: 'me', status: 'pending' };
    await requestConnection('me', 'them@example.org');
    expect(db.inserts).toEqual([]);
    expect(db.updates[0]).toEqual(['user_connections', expect.objectContaining({ status: 'accepted' })]);
  });
});

describe('sharing a device', () => {
  beforeEach(() => { db.connection = null; db.upserts = []; db.from.mockImplementation(chain); });
  it('needs an accepted connection first', async () => {
    await expect(shareDevice('me', '0b3c5c8e-1111-4a4a-9b9b-000000000001', '0b3c5c8e-1111-4a4a-9b9b-000000000002', 'viewer')).rejects.toMatchObject({ statusCode: 403 });
    expect(db.upserts).toEqual([]);
  });
  it('accepts only the two roles', async () => {
    await expect(shareDevice('me', 'd', 'c', 'admin')).rejects.toMatchObject({ statusCode: 400 });
  });
});
