/**
 * Integration tests against a real PostgreSQL server. The API connects as the least-privilege
 * application role from backend/src/db/roles/app-role.sql, to a database built from the real
 * migrations, so these tests cover the SQL, the privileges and the transaction behaviour.
 *
 *   TEST_DATABASE_URL=postgresql://postgres:...@localhost:5432/postgres npm test -w backend
 *
 * The server must be disposable: each test file creates and drops its own database.
 * Without TEST_DATABASE_URL these tests are skipped locally; CI sets REQUIRE_TEST_DATABASE=1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createIsolatedDatabase, TEST_DATABASE_REQUIRED, TEST_DATABASE_URL, type IsolatedDatabase } from './helpers/testDatabase';
import { closePool, getPool, query, resetPoolForTests, withTransaction } from '../db/pool';
import { classifyDatabaseError, DeviceNotFound } from '../db/errors';
import {
  createDevice, deleteApiKey, deleteDevice, getApiKeys, getDefaultDeviceId, getDevices, getPreferences, getUserByEmail,
  setDefaultDeviceId, updateDeviceName, upsertApiKey, upsertPreferences, upsertUser,
} from '../services/database';
import {
  authenticateDevice, getDeliveryStatus, getRefreshState, recordHeartbeat, requestDeviceRefresh, revokeDeviceToken,
  rotateDeviceToken, setInstantUpdates, tokenHash,
} from '../services/deviceDelivery';
import { getDeviceDisplay, saveDeviceDisplay } from '../services/deviceDisplays';
import { insertDeviceDisplay, updateDeviceDisplay } from '../db/repositories/deviceDisplays';
import {
  acceptConnection, acceptItem, dismissItem, listConnections, listDeviceShares, listDevicesSharedWithMe, listItems,
  removeConnection, requestConnection, resolveDeviceAccess, revokeDeviceShare, sendItem, shareDevice,
} from '../services/sharing';
import { fetchWebhookData, findWebhookOwner, hashWebhookToken, issueWebhookToken, revokeWebhookToken, saveWebhookPayload } from '../services/customWebhook';
import { findAiUsageOwner, getAiUsageRecord, hashAiUsageToken, issueAiUsageToken, saveAiUsagePush } from '../aiUsage/store';
import { parseAiUsagePush } from '../aiUsage/snapshot';
import { encrypt, isEncrypted } from '../utils/crypto';
import type { DisplayLayout } from '../types';

if (TEST_DATABASE_REQUIRED && !TEST_DATABASE_URL) {
  describe('database integration', () => {
    it('requires TEST_DATABASE_URL (REQUIRE_TEST_DATABASE=1)', () => { throw new Error('TEST_DATABASE_URL is not set'); });
  });
}

const layout = (widget: string): DisplayLayout => ({ version: 1, cols: 10, rows: 6, widgets: [{ i: widget, x: 0, y: 0, w: 10, h: 6 }] });
const rejects = async (promise: Promise<unknown>) => { try { await promise; } catch (error) { return error as Error & { code?: string; statusCode?: number }; } throw new Error('expected a rejection'); };

describe.skipIf(!TEST_DATABASE_URL)('PostgreSQL persistence (real database, application role)', () => {
  let db: IsolatedDatabase;
  let alice: string; let bob: string; let carol: string;
  let aliceDevice: string; let bobDevice: string;

  const newUser = async (name: string) => (await upsertUser(`${name}@example.test`, name)).id;
  const newDevice = async (owner: string, hardware: string) => (await createDevice(owner, hardware, `Device ${hardware}`, null)).id;
  /** Make two users accepted connections, as the API would: request, then accept. */
  async function connect(a: string, b: string) {
    await requestConnection(a, `${(await db.admin<{ email: string }>('SELECT email FROM users WHERE id = $1', [b]))[0].email}`);
    const [{ id }] = await db.admin<{ id: string }>('SELECT id FROM user_connections WHERE requester_id = $1 AND addressee_id = $2', [a, b]);
    await acceptConnection(b, id);
    return id;
  }

  beforeAll(async () => {
    db = await createIsolatedDatabase();
    process.env.DATABASE_URL = db.appUrl;
    process.env.DATABASE_SSL = 'disable';
    process.env.DATABASE_POOL_MAX = '4';
    process.env.DATABASE_APPLICATION_NAME = `esp32-eink-test-${db.name}`;
    process.env.ENCRYPTION_KEY = '01'.repeat(32);
    resetPoolForTests();
    alice = await newUser('alice'); bob = await newUser('bob'); carol = await newUser('carol');
    aliceDevice = await newDevice(alice, 'OD-ALICE'); bobDevice = await newDevice(bob, 'OD-BOB');
  });
  afterAll(async () => {
    await closePool();
    await db?.drop();
  });

  // ------------------------------------------------------------------ role

  describe('the application role', () => {
    it('is a plain login role that cannot bypass row level security or change the schema', async () => {
      const [role] = await db.admin<{ rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolbypassrls: boolean; rolcanlogin: boolean }>(
        `SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'eink_app'`);
      expect(role).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false, rolcanlogin: true });
      for (const statement of ['DROP TABLE users', 'ALTER TABLE users ADD COLUMN x int', 'TRUNCATE devices', 'CREATE TABLE public.x (a int)', 'CREATE ROLE other']) {
        expect((await rejects(query(statement))).code, statement).toBe('42501');
      }
    });

    it('can use only the tables and verbs the API needs', async () => {
      for (const statement of ['SELECT * FROM orders', 'DELETE FROM users', 'DELETE FROM user_preferences', 'DELETE FROM device_delivery',
        'SELECT * FROM api_usage', 'UPDATE firmware_versions SET active = false']) {
        expect((await rejects(query(statement))).code, statement).toBe('42501');
      }
      await expect(query('SELECT count(*) FROM devices')).resolves.toBeTruthy();
    });
  });

  // -------------------------------------------------------------- accounts

  describe('users, preferences and provider keys', () => {
    it('upserts a user by email and keeps the id; display_name follows the last call, as before', async () => {
      const first = await upsertUser('dana@example.test', 'Dana');
      const again = await upsertUser('dana@example.test');
      expect(again.id).toBe(first.id);
      expect(again.display_name).toBeNull();
      expect(first.created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
      expect(await getUserByEmail('dana@example.test')).toMatchObject({ id: first.id });
      expect(await getUserByEmail('DANA@example.test')).toBeNull();
    });

    it('stores arrays and objects as jsonb (not PostgreSQL arrays), merges only the keys given, and keeps NULL as NULL', async () => {
      const feeds = [{ id: 'a', name: 'A', url: 'https://example.test/feed' }];
      const saved = await upsertPreferences(alice, { layout: layout('energy'), news_feeds: feeds as never, monta_fields: ['charger_status'], weather_location: '1,2', custom_image: null });
      expect(saved).toMatchObject({ layout: layout('energy'), news_feeds: feeds, monta_fields: ['charger_status'], weather_location: '1,2', custom_image: null });
      const merged = await upsertPreferences(alice, { show_news: false });
      expect(merged).toMatchObject({ show_news: false, weather_location: '1,2', news_feeds: feeds, id: (saved as unknown as { id: string }).id });
      expect(await db.admin(`SELECT jsonb_typeof(news_feeds) AS t, jsonb_typeof(layout) AS l, custom_image IS NULL AS n FROM user_preferences WHERE user_id = $1`, [alice]))
        .toEqual([{ t: 'array', l: 'object', n: true }]);
      expect(await getPreferences(alice)).toMatchObject({ show_news: false });
      expect(await getPreferences(carol)).toBeNull();
    });

    it('treats hostile values as data and refuses unknown or hostile column names before running any SQL', async () => {
      const evil = `'; DROP TABLE users; --`;
      await upsertPreferences(bob, { weather_location: evil });
      expect((await getPreferences(bob))?.weather_location).toBe(evil);
      expect(await db.admin('SELECT count(*)::int AS n FROM users')).toEqual([{ n: expect.any(Number) }]);
      const error = await rejects(upsertPreferences(bob, { [`weather_location" = 'x', "user_id`]: 'y' } as never));
      expect(error.message).toMatch(/Unknown preference column/);
      await rejects(upsertPreferences(bob, { user_id: carol } as never));
      expect((await getPreferences(carol))).toBeNull();
    });

    it('rejects values the table constraints forbid, as PostgREST did', async () => {
      expect((await rejects(upsertPreferences(bob, { news_item_limit: 99 }))).code).toBe('23514');
    });

    it('encrypts provider keys with the unchanged ENCRYPTION_KEY, reads existing ciphertext, and scopes by owner', async () => {
      const stored = await upsertApiKey(alice, 'openweathermap', 'owm-secret');
      expect(stored.api_key).toBe('owm-secret');
      const [raw] = await db.admin<{ api_key: string }>('SELECT api_key FROM api_keys WHERE user_id = $1 AND provider = $2', [alice, 'openweathermap']);
      expect(isEncrypted(raw.api_key)).toBe(true);
      expect(raw.api_key).not.toContain('owm-secret');
      // A row written by the previous deployment (same key, same format) decrypts too.
      await db.admin('INSERT INTO api_keys (user_id, provider, api_key) VALUES ($1, $2, $3)', [alice, 'legacy-format', encrypt('from-before-the-move')]);
      const keys = await getApiKeys(alice);
      expect(Object.fromEntries(keys.map((key) => [key.provider, key.api_key]))).toEqual({ openweathermap: 'owm-secret', 'legacy-format': 'from-before-the-move' });
      expect(await getApiKeys(bob)).toEqual([]);
      // Re-saving replaces the value in place (one row per user and provider).
      await upsertApiKey(alice, 'openweathermap', 'rotated');
      expect((await getApiKeys(alice)).filter((key) => key.provider === 'openweathermap')).toHaveLength(1);
      // Deleting is scoped to the owner.
      await deleteApiKey(bob, 'openweathermap');
      expect(await getApiKeys(alice)).toHaveLength(2);
      await deleteApiKey(alice, 'openweathermap');
      expect((await getApiKeys(alice)).map((key) => key.provider)).toEqual(['legacy-format']);
    });
  });

  // --------------------------------------------------------------- devices

  describe('devices', () => {
    it('lists only the caller’s devices, oldest first, with timestamps as ISO strings', async () => {
      const second = await newDevice(alice, 'OD-ALICE-2');
      const devices = await getDevices(alice);
      expect(devices.map((device) => device.id)).toEqual([aliceDevice, second]);
      expect(devices.every((device) => device.user_id === alice)).toBe(true);
      expect(devices[0]).toMatchObject({ firmware_version: null, last_seen_at: null, ble_name: null });
      expect(await getDevices(carol)).toEqual([]);
    });

    it('rejects a duplicate hardware id with a unique violation', async () => {
      expect((await rejects(createDevice(bob, 'OD-ALICE', 'dup', null))).code).toBe('23505');
    });

    it('renames and deletes only the owner’s device; anyone else gets "not found" or nothing happens', async () => {
      await expect(updateDeviceName(aliceDevice, bob, 'hijacked')).rejects.toBeInstanceOf(DeviceNotFound);
      await expect(updateDeviceName('not-a-uuid', alice, 'x')).rejects.toBeInstanceOf(DeviceNotFound);
      expect((await updateDeviceName(aliceDevice, alice, 'Kitchen')).device_name).toBe('Kitchen');
      await deleteDevice(aliceDevice, bob);
      await deleteDevice('not-a-uuid', alice);
      expect((await getDevices(alice)).some((device) => device.id === aliceDevice && device.device_name === 'Kitchen')).toBe(true);
      const temporary = await newDevice(carol, 'OD-TEMP');
      await deleteDevice(temporary, carol);
      expect(await getDevices(carol)).toEqual([]);
    });

    it('stores a default device only if the user owns it, in one statement', async () => {
      expect(await setDefaultDeviceId(bob, aliceDevice)).toBe(false);
      expect(await getDefaultDeviceId(bob)).toBeNull();
      expect(await setDefaultDeviceId(bob, bobDevice)).toBe(true);
      expect(await getDefaultDeviceId(bob)).toBe(bobDevice);
      expect(await setDefaultDeviceId(bob, 'not-a-uuid')).toBe(false);
      expect(await getDefaultDeviceId(bob)).toBe(bobDevice);
      expect(await setDefaultDeviceId(bob, null)).toBe(true);
      expect(await getDefaultDeviceId(bob)).toBeNull();
    });
  });

  // ---------------------------------------------------------- device tokens

  describe('device tokens and delivery', () => {
    it('issues tokens only for the owner, stores only a hash, and authenticates by device and hash', async () => {
      await expect(rotateDeviceToken(bob, aliceDevice)).rejects.toBeInstanceOf(DeviceNotFound);
      expect(await db.admin('SELECT 1 FROM device_delivery WHERE device_id = $1', [aliceDevice])).toEqual([]);

      const token = await rotateDeviceToken(alice, aliceDevice);
      expect(token).toMatch(/^einkd_[\w-]{43}$/);
      const [row] = await db.admin<{ token_hash: string; owner_id: string }>('SELECT token_hash, owner_id FROM device_delivery WHERE device_id = $1', [aliceDevice]);
      expect(row).toEqual({ token_hash: tokenHash(token), owner_id: alice });
      expect(JSON.stringify(await db.admin('SELECT * FROM device_delivery'))).not.toContain(token);

      expect(await authenticateDevice(aliceDevice, `Bearer ${token}`)).toBe(alice);
      expect(await authenticateDevice(bobDevice, `Bearer ${token}`)).toBeNull();
      expect(await authenticateDevice(aliceDevice, `Bearer ${token.slice(0, -1)}A`)).toBeNull();
      expect(await authenticateDevice(aliceDevice, 'Bearer einkd_short')).toBeNull();
      expect(await authenticateDevice(aliceDevice, undefined)).toBeNull();
      expect(await authenticateDevice('not-a-uuid', `Bearer ${token}`)).toBeNull();
    });

    it('rotation and revocation take effect at once, and a transferred device stops accepting its old token', async () => {
      const first = await rotateDeviceToken(alice, aliceDevice);
      const second = await rotateDeviceToken(alice, aliceDevice);
      expect(await authenticateDevice(aliceDevice, `Bearer ${first}`)).toBeNull();
      expect(await authenticateDevice(aliceDevice, `Bearer ${second}`)).toBe(alice);

      await expect(revokeDeviceToken(bob, aliceDevice)).rejects.toBeInstanceOf(DeviceNotFound);
      expect(await authenticateDevice(aliceDevice, `Bearer ${second}`)).toBe(alice);
      await revokeDeviceToken(alice, aliceDevice);
      expect(await authenticateDevice(aliceDevice, `Bearer ${second}`)).toBeNull();
      expect((await getDeliveryStatus(alice, aliceDevice)).configured).toBe(false);

      const third = await rotateDeviceToken(alice, aliceDevice);
      expect(await authenticateDevice(aliceDevice, `Bearer ${third}`)).toBe(alice);
      // An administrative transfer (the credential row still names the previous owner).
      await db.admin('UPDATE devices SET user_id = $1 WHERE id = $2', [carol, aliceDevice]);
      expect(await authenticateDevice(aliceDevice, `Bearer ${third}`)).toBeNull();
      await expect(getDeliveryStatus(alice, aliceDevice)).rejects.toBeInstanceOf(DeviceNotFound);
      expect((await getDeliveryStatus(carol, aliceDevice)).configured).toBe(false);
      await db.admin('UPDATE devices SET user_id = $1 WHERE id = $2', [alice, aliceDevice]);
    });

    it('records heartbeats for the current credential only, keeping omitted fields and clearing explicit nulls', async () => {
      const token = await rotateDeviceToken(alice, aliceDevice);
      const hash = tokenHash(token);
      const applied = 'ab'.repeat(32);
      await recordHeartbeat(alice, aliceDevice, hash, { firmware_version: 'v1', battery_percent: 55, rssi: -60, last_applied_hash: applied });
      await recordHeartbeat(alice, aliceDevice, hash, { firmware_version: 'v2' });
      expect(await getDeliveryStatus(alice, aliceDevice)).toMatchObject({ firmwareVersion: 'v2', batteryPercent: 55, rssi: -60, lastAppliedHash: applied, lastSeenAt: expect.any(String) });
      await recordHeartbeat(alice, aliceDevice, hash, { firmware_version: 'v2', last_applied_hash: null });
      expect((await getDeliveryStatus(alice, aliceDevice)).lastAppliedHash).toBeNull();

      await recordHeartbeat(alice, aliceDevice, tokenHash('einkd_stale'), { firmware_version: 'stale' });
      await recordHeartbeat(bob, aliceDevice, hash, { firmware_version: 'wrong-owner' });
      expect((await getDeliveryStatus(alice, aliceDevice)).firmwareVersion).toBe('v2');
    });

    it('runs the refresh protocol: request, pending state, one acknowledgement, and no stale writers', async () => {
      const token = await rotateDeviceToken(alice, aliceDevice);
      const hash = tokenHash(token);
      await expect(requestDeviceRefresh(bob, aliceDevice)).rejects.toBeInstanceOf(DeviceNotFound);
      const requested = await requestDeviceRefresh(alice, aliceDevice);
      expect(requested.refreshRequestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(await getRefreshState(alice, aliceDevice, hash)).toEqual({ requestId: requested.refreshRequestId, instantUpdates: false });
      expect(await getRefreshState(alice, aliceDevice, tokenHash('other'))).toEqual({ requestId: null, instantUpdates: false });

      const applied = 'cd'.repeat(32);
      await recordHeartbeat(alice, aliceDevice, tokenHash('einkd_stale'), { firmware_version: 'x', last_applied_hash: applied, refresh_request_id: requested.refreshRequestId! });
      expect((await getRefreshState(alice, aliceDevice, hash)).requestId).toBe(requested.refreshRequestId);
      await recordHeartbeat(alice, aliceDevice, hash, { firmware_version: 'v3', last_applied_hash: applied, refresh_request_id: requested.refreshRequestId! });
      expect(await getRefreshState(alice, aliceDevice, hash)).toEqual({ requestId: null, instantUpdates: false });
      expect(await getDeliveryStatus(alice, aliceDevice)).toMatchObject({ firmwareVersion: 'v3', refreshAppliedAt: expect.any(String) });

      await revokeDeviceToken(alice, aliceDevice);
      expect((await rejects(requestDeviceRefresh(alice, aliceDevice))).statusCode).toBe(409);
    });

    it('lets only the owner of an active credential enable instant updates, and keeps the choice across rotation', async () => {
      await revokeDeviceToken(alice, aliceDevice);
      expect((await rejects(setInstantUpdates(alice, aliceDevice, true))).statusCode).toBe(409);
      await rotateDeviceToken(alice, aliceDevice);
      await expect(setInstantUpdates(bob, aliceDevice, true)).rejects.toBeInstanceOf(DeviceNotFound);
      expect((await setInstantUpdates(alice, aliceDevice, true)).instantUpdates).toBe(true);
      await rotateDeviceToken(alice, aliceDevice);
      expect((await getDeliveryStatus(alice, aliceDevice)).instantUpdates).toBe(true);
    });

    it('rolls back the telemetry when its acknowledgement cannot be stored', async () => {
      const token = await rotateDeviceToken(alice, aliceDevice);
      const hash = tokenHash(token);
      const request = (await requestDeviceRefresh(alice, aliceDevice)).refreshRequestId!;
      await db.admin(`CREATE FUNCTION public.refuse_ack() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.refresh_applied_at IS NOT NULL AND OLD.refresh_applied_at IS NULL THEN RAISE EXCEPTION 'ack refused'; END IF; RETURN NEW; END $$`);
      await db.admin('CREATE TRIGGER refuse_ack BEFORE UPDATE ON device_delivery FOR EACH ROW EXECUTE FUNCTION public.refuse_ack()');
      try {
        await expect(recordHeartbeat(alice, aliceDevice, hash, { firmware_version: 'must-not-persist', last_applied_hash: 'ef'.repeat(32), refresh_request_id: request })).rejects.toThrow();
        const status = await getDeliveryStatus(alice, aliceDevice);
        expect(status.firmwareVersion).not.toBe('must-not-persist');
        expect(status.refreshAppliedAt).toBeNull();
      } finally {
        await db.admin('DROP TRIGGER refuse_ack ON device_delivery');
        await db.admin('DROP FUNCTION public.refuse_ack()');
      }
      await recordHeartbeat(alice, aliceDevice, hash, { firmware_version: 'persisted', last_applied_hash: 'ef'.repeat(32), refresh_request_id: request });
      expect(await getDeliveryStatus(alice, aliceDevice)).toMatchObject({ firmwareVersion: 'persisted', refreshAppliedAt: expect.any(String) });
    });

    it('shows a device’s telemetry in the device list only to its current owner', async () => {
      const token = await rotateDeviceToken(alice, aliceDevice);
      await recordHeartbeat(alice, aliceDevice, tokenHash(token), { firmware_version: 'fw-9' });
      expect((await getDevices(alice)).find((device) => device.id === aliceDevice)).toMatchObject({ firmware_version: 'fw-9', last_seen_at: expect.any(String) });
      expect(JSON.stringify(await getDevices(alice))).not.toContain(tokenHash(token));
    });
  });

  // ------------------------------------------------------ device presentation

  describe('device presentation settings', () => {
    it('saves with compare-and-swap: the first save inserts, later saves bump the revision, a stale writer conflicts', async () => {
      await upsertPreferences(bob, { layout: layout('energy') });
      const inherited = await getDeviceDisplay(bob, bobDevice);
      expect(inherited.inherited).toBe(true);
      const first = await saveDeviceDisplay(bob, bobDevice, { display_timezone: 'UTC' });
      expect(first).toMatchObject({ inherited: false, preferences: { display_timezone: 'UTC', layout: layout('energy') } });
      const second = await saveDeviceDisplay(bob, bobDevice, { refresh_interval_minutes: 5 });
      expect(second.preferences).toMatchObject({ display_timezone: 'UTC', refresh_interval_minutes: 5 });
      expect(await db.admin('SELECT revision FROM device_displays WHERE device_id = $1', [bobDevice])).toEqual([{ revision: 2 }]);

      // Two writers that both read revision 2 and write against it: exactly one wins.
      const stale = (timezone: string) => updateDeviceDisplay(bobDevice, bob, 2, bob, 3, { display_timezone: timezone });
      const results = await Promise.all([stale('Europe/Copenhagen'), stale('America/New_York')]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await db.admin('SELECT revision FROM device_displays WHERE device_id = $1', [bobDevice])).toEqual([{ revision: 3 }]);
      // The service reports a lost race as a conflict, never as a silent overwrite.
      expect((await saveDeviceDisplay(bob, bobDevice, { refresh_interval_minutes: 10 })).preferences.refresh_interval_minutes).toBe(10);
      expect(await db.admin('SELECT revision FROM device_displays WHERE device_id = $1', [bobDevice])).toEqual([{ revision: 4 }]);
    });

    it('lets one concurrent first save win; the other hits the primary key and is not an upsert over it', async () => {
      const device = await newDevice(carol, 'OD-CAROL');
      const attempts = await Promise.allSettled([
        insertDeviceDisplay(device, carol, 1, { display_timezone: 'UTC' }),
        insertDeviceDisplay(device, carol, 1, { display_timezone: 'Europe/Copenhagen' }),
      ]);
      expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
      expect((attempts.find((attempt) => attempt.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: '23505' });
    });

    it('cannot write another owner’s device: the foreign key rejects it as "not found"', async () => {
      await expect(saveDeviceDisplay(alice, bobDevice, { display_timezone: 'UTC' })).rejects.toBeInstanceOf(DeviceNotFound);
      expect(await db.admin('SELECT 1 FROM device_displays WHERE owner_id = $1 AND device_id = $2', [alice, bobDevice])).toEqual([]);
    });

    it('drops a device’s settings when it is transferred, so the new owner inherits nothing', async () => {
      await db.admin('UPDATE devices SET user_id = $1 WHERE id = $2', [carol, bobDevice]);
      expect(await db.admin('SELECT 1 FROM device_displays WHERE device_id = $1', [bobDevice])).toEqual([]);
      await db.admin('UPDATE devices SET user_id = $1 WHERE id = $2', [bob, bobDevice]);
    });
  });

  // --------------------------------------------------- connections & sharing

  describe('connections, device shares and shared items', () => {
    let seq = 0;
    /** A fresh trio per test, so tests cannot influence each other. */
    async function trio() {
      seq += 1;
      const [owner, friend, stranger] = await Promise.all(['owner', 'friend', 'stranger'].map((name) => newUser(`${name}${seq}`)));
      const device = await newDevice(owner, `OD-SHARE-${seq}`);
      const friendDevice = await newDevice(friend, `OD-FRIEND-${seq}`);
      return { owner, friend, stranger, device, friendDevice };
    }
    const emailOf = async (id: string) => (await db.admin<{ email: string }>('SELECT email FROM users WHERE id = $1', [id]))[0].email;
    const shareRows = (device: string) => db.admin('SELECT collaborator_id, role FROM device_shares WHERE device_id = $1', [device]);

    it('lets people connect without revealing which addresses have accounts', async () => {
      const { owner, friend } = await trio();
      await requestConnection(owner, 'nobody-here@example.test');
      expect(await db.admin('SELECT 1 FROM user_connections WHERE requester_id = $1', [owner])).toEqual([]);
      await expect(requestConnection(owner, (await emailOf(owner)))).rejects.toMatchObject({ statusCode: 400 });

      const friendEmail = (await emailOf(friend)).toUpperCase();
      await requestConnection(owner, friendEmail);
      await requestConnection(owner, friendEmail);
      expect(await db.admin('SELECT status FROM user_connections WHERE requester_id = $1 AND addressee_id = $2', [owner, friend])).toEqual([{ status: 'pending' }]);
      expect((await listConnections(owner))[0]).toMatchObject({ status: 'outgoing', user: { id: friend } });
      expect((await listConnections(friend))[0]).toMatchObject({ status: 'incoming', user: { id: owner } });

      const [{ id }] = await db.admin<{ id: string }>('SELECT id FROM user_connections WHERE requester_id = $1', [owner]);
      await expect(acceptConnection(owner, id)).rejects.toMatchObject({ statusCode: 404 }); // only the addressee may accept
      await requestConnection(friend, await emailOf(owner)); // asking back is accepting
      expect((await listConnections(owner))[0]).toMatchObject({ status: 'connected' });
      expect(await db.admin('SELECT count(*)::int AS n FROM user_connections WHERE id = $1', [id])).toEqual([{ n: 1 }]);
    });

    it('resolves device access for owner, collaborators and strangers, and only for the granting owner', async () => {
      const { owner, friend, stranger, device } = await trio();
      await connect(owner, friend);
      await shareDevice(owner, device, friend, 'viewer');

      expect(await resolveDeviceAccess(owner, device, 'owner')).toEqual({ ownerId: owner, role: 'owner' });
      expect(await resolveDeviceAccess(friend, device, 'viewer')).toEqual({ ownerId: owner, role: 'viewer' });
      await expect(resolveDeviceAccess(friend, device, 'editor')).rejects.toMatchObject({ statusCode: 403 });
      await expect(resolveDeviceAccess(friend, device, 'owner')).rejects.toMatchObject({ statusCode: 403 });
      await expect(resolveDeviceAccess(stranger, device)).rejects.toBeInstanceOf(DeviceNotFound);
      await expect(resolveDeviceAccess(owner, '00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(DeviceNotFound);
      await expect(resolveDeviceAccess(owner, 'not-a-uuid')).rejects.toBeInstanceOf(DeviceNotFound);

      await shareDevice(owner, device, friend, 'editor');
      expect((await resolveDeviceAccess(friend, device, 'editor')).role).toBe('editor');
      expect(await shareRows(device)).toHaveLength(1);

      // A share granted by an earlier owner never counts for the new one, even if the row survived.
      await db.admin('ALTER TABLE device_shares DISABLE TRIGGER ALL');
      await db.admin('ALTER TABLE devices DISABLE TRIGGER ALL');
      await db.admin('UPDATE devices SET user_id = $1 WHERE id = $2', [stranger, device]);
      await db.admin('ALTER TABLE devices ENABLE TRIGGER ALL');
      await db.admin('ALTER TABLE device_shares ENABLE TRIGGER ALL');
      await expect(resolveDeviceAccess(friend, device)).rejects.toBeInstanceOf(DeviceNotFound);
    });

    it('removes shares when a device changes owner', async () => {
      const { owner, friend, stranger, device } = await trio();
      await connect(owner, friend);
      await shareDevice(owner, device, friend, 'editor');
      await db.admin('UPDATE devices SET user_id = $1 WHERE id = $2', [stranger, device]);
      expect(await shareRows(device)).toEqual([]);
      await expect(resolveDeviceAccess(friend, device)).rejects.toBeInstanceOf(DeviceNotFound);
    });

    it('lets only the owner share, and only with an accepted connection and a real role', async () => {
      const { owner, friend, stranger, device } = await trio();
      await expect(shareDevice(owner, device, friend, 'viewer')).rejects.toMatchObject({ statusCode: 403 });
      await connect(owner, friend);
      await expect(shareDevice(owner, device, friend, 'admin')).rejects.toMatchObject({ statusCode: 400 });
      await expect(shareDevice(owner, device, owner, 'viewer')).rejects.toMatchObject({ statusCode: 400 });
      await expect(shareDevice(owner, device, stranger, 'viewer')).rejects.toMatchObject({ statusCode: 403 });
      await expect(shareDevice(stranger, device, friend, 'viewer')).rejects.toBeInstanceOf(DeviceNotFound);
      await shareDevice(owner, device, friend, 'viewer');
      await expect(shareDevice(friend, device, stranger, 'viewer')).rejects.toMatchObject({ statusCode: 403 });
      expect(await shareRows(device)).toEqual([{ collaborator_id: friend, role: 'viewer' }]);
    });

    it('shows collaborators only what they need, and lets either side end a share', async () => {
      const { owner, friend, stranger, device } = await trio();
      await connect(owner, friend);
      await shareDevice(owner, device, friend, 'viewer');
      expect(await listDeviceShares(owner, device)).toMatchObject([{ role: 'viewer', collaborator: { id: friend } }]);
      await expect(listDeviceShares(friend, device)).rejects.toMatchObject({ statusCode: 403 });
      await expect(listDeviceShares(stranger, device)).rejects.toBeInstanceOf(DeviceNotFound);

      const shared = await listDevicesSharedWithMe(friend);
      expect(shared).toHaveLength(1);
      expect(Object.keys(shared[0]).sort()).toEqual(['device_name', 'id', 'owner', 'role']);
      expect(JSON.stringify(shared)).not.toMatch(/license_key|"device_id"|ble_name/);
      expect(await listDevicesSharedWithMe(stranger)).toEqual([]);

      await expect(revokeDeviceShare(stranger, device, friend)).rejects.toBeInstanceOf(DeviceNotFound);
      await expect(revokeDeviceShare(friend, device, owner)).rejects.toMatchObject({ statusCode: 403 });
      await revokeDeviceShare(friend, device, friend); // leave
      expect(await shareRows(device)).toEqual([]);
      await expect(revokeDeviceShare(owner, device, friend)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('ends every share and unanswered item between two people when they disconnect, in one transaction', async () => {
      const { owner, friend, stranger, device, friendDevice } = await trio();
      const connection = await connect(owner, friend);
      await connect(owner, stranger);
      await shareDevice(owner, device, friend, 'editor');
      await shareDevice(friend, friendDevice, owner, 'viewer');
      await db.admin(`INSERT INTO shared_items (sender_id, recipient_id, kind, name, payload) VALUES ($1, $2, 'layout', 'p', '{}'), ($2, $1, 'layout', 'q', '{}'), ($1, $3, 'layout', 'keep', '{}')`, [owner, friend, stranger]);
      await db.admin(`INSERT INTO shared_items (sender_id, recipient_id, kind, name, payload, status) VALUES ($1, $2, 'layout', 'old', '{}', 'accepted')`, [owner, friend]);
      await db.admin('INSERT INTO device_shares (device_id, owner_id, collaborator_id, role) VALUES ($1, $2, $3, $4)', [device, owner, stranger, 'viewer']);

      await expect(removeConnection(stranger, connection)).rejects.toMatchObject({ statusCode: 404 });
      await removeConnection(friend, connection);

      expect(await db.admin('SELECT 1 FROM user_connections WHERE id = $1', [connection])).toEqual([]);
      expect(await shareRows(device)).toEqual([{ collaborator_id: stranger, role: 'viewer' }]);
      expect(await shareRows(friendDevice)).toEqual([]);
      expect((await db.admin<{ name: string }>('SELECT name FROM shared_items WHERE sender_id = $1 OR recipient_id = $1 ORDER BY name', [owner])).map((row) => row.name)).toEqual(['keep', 'old']);
    });

    it('rolls a disconnect back completely if any step fails', async () => {
      const { owner, friend, device } = await trio();
      const connection = await connect(owner, friend);
      await shareDevice(owner, device, friend, 'viewer');
      await db.admin(`CREATE FUNCTION public.refuse_item_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'refused'; END $$`);
      await db.admin(`INSERT INTO shared_items (sender_id, recipient_id, kind, name, payload) VALUES ($1, $2, 'layout', 'stuck', '{}')`, [owner, friend]);
      await db.admin('CREATE TRIGGER refuse_item_delete BEFORE DELETE ON shared_items FOR EACH ROW EXECUTE FUNCTION public.refuse_item_delete()');
      try {
        await expect(removeConnection(owner, connection)).rejects.toThrow();
        expect(await db.admin('SELECT 1 FROM user_connections WHERE id = $1', [connection])).toHaveLength(1);
        expect(await shareRows(device)).toHaveLength(1);
      } finally {
        await db.admin('DROP TRIGGER refuse_item_delete ON shared_items');
        await db.admin('DROP FUNCTION public.refuse_item_delete()');
      }
    });

    it('makes a disconnect wait for a share that is being written, so no share outlives its connection', async () => {
      const { owner, friend, device } = await trio();
      const connection = await connect(owner, friend);
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let removed = false;
      const sharing = withTransaction(async (tx) => {
        const { lockAcceptedConnection, upsertShare } = await import('../db/repositories/sharing');
        expect(await lockAcceptedConnection(owner, friend, tx)).toBe(true);
        await upsertShare(device, owner, friend, 'viewer', tx);
        await held; // the share is written but not committed yet
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const removal = removeConnection(owner, connection).then(() => { removed = true; });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(removed).toBe(false); // blocked on the connection row the sharer holds
      release();
      await sharing; await removal;
      expect(removed).toBe(true);
      expect(await shareRows(device)).toEqual([]); // the disconnect saw the committed share and removed it
    });

    it('never leaves a share behind when sharing and disconnecting race', async () => {
      for (let round = 0; round < 15; round++) {
        const { owner, friend, device } = await trio();
        const connection = await connect(owner, friend);
        await Promise.allSettled([shareDevice(owner, device, friend, 'viewer'), removeConnection(friend, connection)]);
        expect(await db.admin('SELECT 1 FROM user_connections WHERE id = $1', [connection])).toEqual([]);
        expect(await shareRows(device), `round ${round}`).toEqual([]);
      }
    });

    describe('shared layouts', () => {
      async function prepare() {
        const people = await trio();
        await connect(people.owner, people.friend);
        await upsertPreferences(people.owner, { layout: layout('energy') });
        return people;
      }
      const send = (sender: string, recipient: string, device: string) =>
        sendItem(sender, { recipient_id: recipient, source: { kind: 'layout', device_id: device }, name: 'Nice layout' });

      it('copies a layout to a connection, who applies it to a device they may edit', async () => {
        const { owner, friend, friendDevice } = await prepare();
        const { item } = await send(owner, friend, (await getDevices(owner))[0].id);
        expect(item).toMatchObject({ kind: 'layout', name: 'Nice layout', status: 'pending', from: { id: owner }, to: { id: friend } });
        expect((await listItems(friend, 'inbox')).map((entry) => entry.id)).toEqual([item.id]);
        expect((await listItems(owner, 'sent')).map((entry) => entry.id)).toEqual([item.id]);
        expect(await listItems(owner, 'inbox')).toEqual([]);

        await acceptItem(friend, item.id, { device_id: friendDevice });
        expect((await getDeviceDisplay(friend, friendDevice)).preferences.display_schedule?.pages.map((page) => page.name)).toEqual(['Nice layout']);
        expect(await listItems(friend, 'inbox')).toEqual([]);
        await expect(acceptItem(friend, item.id, { device_id: friendDevice })).rejects.toMatchObject({ statusCode: 404 });
      });

      it('refuses to send to someone who is not connected, to oneself, or over the pending cap', async () => {
        const { owner, friend, stranger, device } = await prepare();
        await expect(send(owner, stranger, device)).rejects.toMatchObject({ statusCode: 403 });
        await expect(send(owner, owner, device)).rejects.toMatchObject({ statusCode: 400 });
        for (let i = 0; i < 20; i++) {
          await db.admin(`INSERT INTO shared_items (sender_id, recipient_id, kind, name, payload) VALUES ($1, $2, 'layout', $3, '{}')`, [owner, friend, `n${i}`]);
        }
        await expect(send(owner, friend, device)).rejects.toMatchObject({ statusCode: 429 });
      });

      it('lets only an editor of the target device accept, and only the recipient answer', async () => {
        const { owner, friend, stranger, device, friendDevice } = await prepare();
        const { item } = await send(owner, friend, device);
        await expect(acceptItem(stranger, item.id, { device_id: friendDevice })).rejects.toMatchObject({ statusCode: 404 });
        await expect(acceptItem(owner, item.id, { device_id: device })).rejects.toMatchObject({ statusCode: 404 }); // the sender cannot accept their own
        await expect(acceptItem(friend, item.id, { device_id: device })).rejects.toBeInstanceOf(DeviceNotFound); // not their device
        await shareDevice(owner, device, friend, 'viewer');
        await expect(acceptItem(friend, item.id, { device_id: device })).rejects.toMatchObject({ statusCode: 403 }); // view-only
        expect(await db.admin('SELECT status FROM shared_items WHERE id = $1', [item.id])).toEqual([{ status: 'pending' }]);
        expect(await db.admin('SELECT 1 FROM device_displays WHERE device_id = $1', [device])).toEqual([]);
      });

      it('applies an accepted item at most once, even when answered twice at the same moment', async () => {
        const { owner, friend, friendDevice, device } = await prepare();
        const { item } = await send(owner, friend, device);
        const results = await Promise.allSettled([acceptItem(friend, item.id, { device_id: friendDevice }), acceptItem(friend, item.id, { device_id: friendDevice })]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ statusCode: 404 });
        expect(await db.admin('SELECT revision FROM device_displays WHERE device_id = $1', [friendDevice])).toEqual([{ revision: 1 }]);
      });

      it('applies the change and marks the item answered together, or neither', async () => {
        const { owner, friend, friendDevice, device } = await prepare();
        const { item } = await send(owner, friend, device);
        await db.admin(`CREATE FUNCTION public.refuse_accept() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.status = 'accepted' THEN RAISE EXCEPTION 'refused'; END IF; RETURN NEW; END $$`);
        await db.admin('CREATE TRIGGER refuse_accept BEFORE UPDATE ON shared_items FOR EACH ROW EXECUTE FUNCTION public.refuse_accept()');
        try {
          await expect(acceptItem(friend, item.id, { device_id: friendDevice })).rejects.toThrow();
          expect(await db.admin('SELECT status FROM shared_items WHERE id = $1', [item.id])).toEqual([{ status: 'pending' }]);
          expect(await db.admin('SELECT 1 FROM device_displays WHERE device_id = $1', [friendDevice])).toEqual([]);
        } finally {
          await db.admin('DROP TRIGGER refuse_accept ON shared_items');
          await db.admin('DROP FUNCTION public.refuse_accept()');
        }
        await acceptItem(friend, item.id, { device_id: friendDevice });
        expect(await db.admin('SELECT 1 FROM device_displays WHERE device_id = $1', [friendDevice])).toHaveLength(1);
      });

      it('lets the recipient decline and the sender withdraw, nobody else', async () => {
        const { owner, friend, stranger, device } = await prepare();
        const first = (await send(owner, friend, device)).item;
        const second = (await send(owner, friend, device)).item;
        await expect(dismissItem(stranger, first.id)).rejects.toMatchObject({ statusCode: 404 });
        await dismissItem(friend, first.id);
        await dismissItem(owner, second.id);
        expect(await db.admin('SELECT status FROM shared_items WHERE id = $1', [first.id])).toEqual([{ status: 'declined' }]);
        expect(await db.admin('SELECT 1 FROM shared_items WHERE id = $1', [second.id])).toEqual([]);
      });
    });
  });

  // ----------------------------------------------------- integration tokens

  describe('push-integration tokens', () => {
    it('publishes webhook rows as a jsonb array, only for the current token, and reads them back', async () => {
      const token = await issueWebhookToken(alice);
      const hash = hashWebhookToken(token);
      expect(await findWebhookOwner(hash)).toBe(alice);
      expect(await findWebhookOwner(hashWebhookToken('ewh_other'))).toBeNull();
      const payload = { rows: [{ label: 'Kitchen', value: '21.5', unit: '°C' }], observed_at: '2026-11-05T09:00:00.000Z', received_at: '2026-11-05T09:00:01.000Z' };
      expect(await saveWebhookPayload(alice, hash, payload)).toBe(true);
      expect(await saveWebhookPayload(alice, hashWebhookToken('ewh_stale'), { ...payload, rows: [{ label: 'x', value: '1' }] })).toBe(false);
      expect(await saveWebhookPayload(bob, hash, payload)).toBe(false);
      expect(await db.admin('SELECT jsonb_typeof(rows) AS t FROM custom_webhooks WHERE user_id = $1', [alice])).toEqual([{ t: 'array' }]);
      expect(await fetchWebhookData(alice, 60)).toMatchObject({ rows: payload.rows, observedAt: payload.observed_at, receivedAt: payload.received_at });
      expect(JSON.stringify(await db.admin('SELECT * FROM custom_webhooks'))).not.toContain(token);

      await revokeWebhookToken(alice);
      expect(await findWebhookOwner(hash)).toBeNull();
      expect(await saveWebhookPayload(alice, hash, payload)).toBe(false);
      expect((await fetchWebhookData(alice, 60)).rows).toEqual([]);
    });

    it('stores AI usage under the current token only and drops the old snapshot when the token is replaced', async () => {
      const token = await issueAiUsageToken(alice);
      const hash = hashAiUsageToken(token);
      const record = (await findAiUsageOwner(hash))!;
      expect(record.user_id).toBe(alice);
      const now = new Date('2026-11-05T10:00:00Z');
      const push = parseAiUsagePush({ machine: 'laptop', providers: { claude: { usage: { day: '2026-11-05', models: [{ model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 5, cache_write_tokens: 0, cache_read_tokens: 0 }] } } } }, now);
      expect(await saveAiUsagePush(record, hash, push, now)).toBeTruthy();
      expect(await saveAiUsagePush(record, hashAiUsageToken('eau_stale'), push, now)).toBeNull();
      expect((await getAiUsageRecord(alice))?.received_at).toBe(now.toISOString());
      const replacement = await issueAiUsageToken(alice);
      expect(await findAiUsageOwner(hash)).toBeNull();
      expect(await findAiUsageOwner(hashAiUsageToken(replacement))).toMatchObject({ received_at: null, providers: {} });
    });
  });

  // ------------------------------------------------------------- the pool

  describe('connection pool behaviour', () => {
    const rowsIn = async (table: string) => (await db.admin<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`))[0].n;

    it('commits a transaction on success and rolls it back, with its connection, on failure', async () => {
      const before = await rowsIn('api_usage');
      await withTransaction(async (tx) => { await tx.query(`INSERT INTO api_usage (user_id, endpoint) VALUES ($1, 'ok')`, [alice]); });
      await expect(withTransaction(async (tx) => {
        await tx.query(`INSERT INTO api_usage (user_id, endpoint) VALUES ($1, 'discarded')`, [alice]);
        throw new Error('boom');
      })).rejects.toThrow('boom');
      await expect(withTransaction(async (tx) => {
        await tx.query(`INSERT INTO api_usage (user_id, endpoint) VALUES ($1, 'also discarded')`, [alice]);
        await tx.query('SELECT * FROM does_not_exist');
      })).rejects.toMatchObject({ code: '42P01' });
      expect(await rowsIn('api_usage')).toBe(before + 1);
      expect(await db.admin(`SELECT endpoint FROM api_usage WHERE endpoint IN ('discarded', 'also discarded')`)).toEqual([]);
    });

    it('returns every connection to the pool, so repeated failures cannot exhaust it', async () => {
      await closePool(); resetPoolForTests();
      process.env.DATABASE_POOL_MAX = '2';
      try {
        for (let i = 0; i < 25; i++) {
          await rejects(withTransaction(async (tx) => { await tx.query('SELECT 1'); throw new Error('fail'); }));
          await rejects(query('SELECT * FROM does_not_exist'));
        }
        const answers = await Promise.all(Array.from({ length: 30 }, (_, i) => query<{ n: number }>('SELECT $1::int AS n', [i])));
        expect(answers.map((answer) => answer.rows[0].n)).toEqual(Array.from({ length: 30 }, (_, i) => i));
        const pool = getPool();
        expect(pool.totalCount).toBeLessThanOrEqual(2);
        expect(pool.waitingCount).toBe(0);
        expect(pool.idleCount).toBe(pool.totalCount);
      } finally {
        await closePool(); resetPoolForTests();
        process.env.DATABASE_POOL_MAX = '4';
      }
    });

    it('cancels a statement that runs too long and stays usable', async () => {
      await closePool(); resetPoolForTests();
      process.env.DATABASE_STATEMENT_TIMEOUT_MS = '500';
      try {
        const error = await rejects(query('SELECT pg_sleep(3)'));
        expect(error.code).toBe('57014');
        expect(classifyDatabaseError(error)).toBe('timeout');
        await expect(query('SELECT 1 AS ok')).resolves.toMatchObject({ rows: [{ ok: 1 }] });
      } finally {
        await closePool(); resetPoolForTests();
        delete process.env.DATABASE_STATEMENT_TIMEOUT_MS;
      }
    });

    it('fails safely, without echoing credentials, when the password is wrong', async () => {
      await closePool(); resetPoolForTests();
      const saved = process.env.DATABASE_URL;
      const wrong = new URL(saved!); wrong.password = 'definitely-not-the-password';
      process.env.DATABASE_URL = wrong.toString();
      try {
        const error = await rejects(query('SELECT 1'));
        expect(error.code).toBe('28P01');
        expect(classifyDatabaseError(error)).toBe('authentication_failed');
        expect(JSON.stringify([error.message, error.stack])).not.toMatch(/definitely-not-the-password|test-only-app-role-password/);
      } finally {
        await closePool(); resetPoolForTests();
        process.env.DATABASE_URL = saved;
      }
    });

    it('verifies TLS by default: a server without a trusted certificate is refused', async () => {
      await closePool(); resetPoolForTests();
      process.env.DATABASE_SSL = 'verify-full';
      try {
        const error = await rejects(query('SELECT 1'));
        expect(classifyDatabaseError(error)).toBe('tls_error');
      } finally {
        await closePool(); resetPoolForTests();
        process.env.DATABASE_SSL = 'disable';
      }
    });

    it('closes every connection on shutdown', async () => {
      await closePool(); resetPoolForTests();
      await Promise.all([query('SELECT 1'), query('SELECT 2'), query('SELECT 3')]);
      const application = process.env.DATABASE_APPLICATION_NAME!;
      const open = () => db.admin<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1`, [application]);
      expect((await open())[0].n).toBeGreaterThan(0);
      await closePool();
      expect((await open())[0].n).toBe(0);
      await closePool(); // idempotent
    });
  });
});
