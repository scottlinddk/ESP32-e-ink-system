import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise the installed Supabase client and its HTTP contract, without a live
// database. A standalone gateway must behave like the /rest/v1 Supabase API.
const serviceKey = 'test-only-service-role-jwt';
const fetchMock = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
  new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
);

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('SUPABASE_URL', 'https://database.example.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', serviceKey);
  vi.stubEnv('ENCRYPTION_KEY', '01'.repeat(32));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function request() {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [input, init] = fetchMock.mock.calls[0];
  return { url: new URL(String(input)), init, headers: new Headers(init?.headers) };
}

describe('standalone PostgREST gateway client', () => {
  it('uses /rest/v1, service authentication and singular responses for a user lookup', async () => {
    const user = { id: 'user-id', email: 'owner@example.test', display_name: 'Owner' };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }));
    const { getUserByEmail } = await import('../services/database');

    await expect(getUserByEmail(user.email)).resolves.toEqual(user);

    const { url, init, headers } = request();
    expect(url.origin).toBe('https://database.example.test');
    expect(url.pathname).toBe('/rest/v1/users');
    expect(url.searchParams.get('email')).toBe('eq.owner@example.test');
    expect(url.searchParams.get('select')).toBe('*');
    expect(init?.method).toBe('GET');
    expect(headers.get('Authorization')).toBe(`Bearer ${serviceKey}`);
    expect(headers.get('apikey')).toBe(serviceKey);
    expect(headers.get('Accept')).toBe('application/vnd.pgrst.object+json');
  });

  it('retains composite conflict targets and encrypted provider keys during an upsert', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'key-id', user_id: 'user-id', provider: 'weather' }), { status: 201 }));
    const { upsertApiKey } = await import('../services/database');
    const { decrypt } = await import('../utils/crypto');

    await expect(upsertApiKey('user-id', 'weather', 'provider-secret')).resolves.toMatchObject({
      user_id: 'user-id', provider: 'weather', api_key: 'provider-secret',
    });

    const { url, init, headers } = request();
    expect(url.pathname).toBe('/rest/v1/api_keys');
    expect(url.searchParams.get('on_conflict')).toBe('user_id,provider');
    expect(init?.method).toBe('POST');
    expect(headers.get('Prefer')).toContain('resolution=merge-duplicates');
    expect(headers.get('Prefer')).toContain('return=representation');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ user_id: 'user-id', provider: 'weather' });
    expect(body.api_key).not.toBe('provider-secret');
    expect(decrypt(body.api_key)).toBe('provider-secret');
  });

  it('preserves the no-row response contract without swallowing authentication errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'PGRST116', message: 'No rows' }), { status: 406 }));
    const { getUserByEmail } = await import('../services/database');
    await expect(getUserByEmail('missing@example.test')).resolves.toBeNull();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'PGRST301', message: 'Invalid JWT' }), { status: 401 }));
    await expect(getUserByEmail('owner@example.test')).rejects.toMatchObject({ code: 'PGRST301' });
  });

  it('requires a service role key even when an anonymous key is present', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anonymous-test-key');
    const { getSupabaseClient } = await import('../services/database');
    expect(getSupabaseClient).toThrow('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
