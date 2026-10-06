import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDefaultDeviceId } from '../services/database';

// Records each query chain so ownership filtering is asserted, not assumed.
const db = vi.hoisted(() => ({ owned: true, calls: [] as Array<[string, ...unknown[]]>, from: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: db.from }) }));

function chain(table: string) {
  const query = {
    select: (...args: unknown[]) => { db.calls.push([`${table}.select`, ...args]); return query; },
    update: (...args: unknown[]) => { db.calls.push([`${table}.update`, ...args]); return query; },
    eq: (...args: unknown[]) => { db.calls.push([`${table}.eq`, ...args]); return query; },
    maybeSingle: async () => ({ data: db.owned ? { id: 'device' } : null, error: null }),
    then: (resolve: (value: unknown) => void) => resolve({ error: null }),
  };
  return query;
}

describe('default device storage', () => {
  beforeAll(() => {
    vi.stubEnv('SUPABASE_URL', 'https://db.example.org');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
  });
  afterAll(() => { vi.unstubAllEnvs(); });
  beforeEach(() => { db.owned = true; db.calls = []; db.from.mockImplementation(chain); });

  it('checks ownership before storing the default', async () => {
    expect(await setDefaultDeviceId('owner', 'device')).toBe(true);
    expect(db.calls).toEqual([
      ['devices.select', 'id'], ['devices.eq', 'id', 'device'], ['devices.eq', 'user_id', 'owner'],
      ['users.update', { default_device_id: 'device' }], ['users.eq', 'id', 'owner'],
    ]);
  });

  it('never stores another user’s device', async () => {
    db.owned = false;
    expect(await setDefaultDeviceId('owner', 'device')).toBe(false);
    expect(db.calls.some(([call]) => call === 'users.update')).toBe(false);
  });

  it('clears the default without a device lookup', async () => {
    expect(await setDefaultDeviceId('owner', null)).toBe(true);
    expect(db.calls).toEqual([['users.update', { default_device_id: null }], ['users.eq', 'id', 'owner']]);
  });
});
