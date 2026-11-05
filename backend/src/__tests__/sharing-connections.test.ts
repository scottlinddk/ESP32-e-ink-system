import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestConnection, shareDevice } from '../services/sharing';

const db = vi.hoisted(() => ({
  userId: null as string | null, connection: null as unknown, connected: false,
  inserts: [] as unknown[], accepts: [] as unknown[], shares: [] as unknown[],
}));
// Double for the persistence layer. SQL behaviour is covered by database-integration.test.ts.
vi.mock('../db/pool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db/pool')>()),
  withTransaction: async (work: (tx: unknown) => Promise<unknown>) => work({}),
}));
vi.mock('../db/repositories/sharing', () => ({
  selectUserIdByEmail: async () => db.userId,
  selectConnectionBetween: async () => db.connection ?? (db.connected ? { id: 'c', status: 'accepted' } : null),
  insertConnection: async (requester: string, addressee: string) => { db.inserts.push([requester, addressee]); },
  acceptPendingConnection: async (me: string, id: string) => { db.accepts.push([me, id]); return true; },
  lockAcceptedConnection: async () => db.connected,
  selectDeviceOwner: async () => 'me',
  selectShareRole: async () => null,
  upsertShare: async (...args: unknown[]) => { db.shares.push(args); },
}));

describe('requesting a connection', () => {
  beforeEach(() => {
    db.userId = null; db.connection = null; db.connected = false; db.inserts = []; db.accepts = []; db.shares = [];
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
    expect(db.inserts).toEqual([['me', 'them']]);
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
    expect(db.accepts).toEqual([['me', 'c1']]);
  });
});

describe('sharing a device', () => {
  beforeEach(() => { db.connection = null; db.connected = false; db.shares = []; });
  it('needs an accepted connection first', async () => {
    await expect(shareDevice('me', '0b3c5c8e-1111-4a4a-9b9b-000000000001', '0b3c5c8e-1111-4a4a-9b9b-000000000002', 'viewer')).rejects.toMatchObject({ statusCode: 403 });
    expect(db.shares).toEqual([]);
  });
  it('writes the share only while the connection still holds at write time', async () => {
    db.connection = { id: 'c', status: 'accepted' }; db.connected = false; // disconnected between the check and the write
    await expect(shareDevice('me', '0b3c5c8e-1111-4a4a-9b9b-000000000001', '0b3c5c8e-1111-4a4a-9b9b-000000000002', 'viewer')).rejects.toMatchObject({ statusCode: 403 });
    expect(db.shares).toEqual([]);
    db.connected = true;
    await shareDevice('me', '0b3c5c8e-1111-4a4a-9b9b-000000000001', '0b3c5c8e-1111-4a4a-9b9b-000000000002', 'editor');
    expect(db.shares).toHaveLength(1);
  });
  it('accepts only the two roles', async () => {
    await expect(shareDevice('me', 'd', 'c', 'admin')).rejects.toMatchObject({ statusCode: 400 });
  });
});
