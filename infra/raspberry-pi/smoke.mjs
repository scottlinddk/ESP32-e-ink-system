#!/usr/bin/env node
// Run from a checkout with `npm ci`; never print response rows or credentials.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('EINK_SMOKE_URL=https://eink-db.example.com EINK_SMOKE_SERVICE_KEY=<private JWT> node infra/raspberry-pi/smoke.mjs [--write-test]');
  console.log('Default: read-only authentication/table probes. --write-test creates and deletes a unique fixture on the NEW database only.');
  process.exit(0);
}
if (args.some(arg => arg !== '--write-test')) throw new Error('Unknown argument');
const url = new URL(process.env.EINK_SMOKE_URL || 'http://invalid.invalid');
const key = process.env.EINK_SMOKE_SERVICE_KEY;
if (!key || url.hostname === 'invalid.invalid') throw new Error('Set EINK_SMOKE_URL and EINK_SMOKE_SERVICE_KEY');
if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use a bare origin without credentials or path');
if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
  throw new Error('HTTPS is required except for local loopback');
}
// This tool is deliberately limited to our generated target token, not a cloud key.
const claims = JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url').toString());
if (claims.role !== 'service_role' || claims.iss !== 'esp32-eink') throw new Error('Use the generated Pi service token');
const fetchWithTimeout = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) });
const db = createClient(url.origin, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: fetchWithTimeout },
});
function check(result, label) {
  if (result.error) throw new Error(`${label} failed (${result.error.code || result.status || 'unknown'})`);
  return result.data;
}

let fixtureId;
try {
  for (const headers of [{}, { apikey: key }, { Authorization: 'Bearer invalid' }]) {
    const response = await fetchWithTimeout(`${url.origin}/rest/v1/users?select=id&limit=1`, { headers });
    if (![401, 403].includes(response.status)) throw new Error(`Unauthenticated/invalid request was not denied: ${response.status}`);
  }
  for (const table of ['users', 'user_preferences', 'api_keys', 'devices', 'firmware_versions', 'api_usage', 'orders']) {
    check(await db.from(table).select('id', { head: true, count: 'exact' }), `Read ${table}`);
  }
  // Empty .single() must retain the error contract used in database.ts.
  const missing = await db.from('users').select('id').eq('id', randomUUID()).single();
  if (missing.error?.code !== 'PGRST116') throw new Error('Missing-row response is incompatible');
  console.log('PASS: service-token access, denied anonymous/invalid access, all seven tables, missing-row contract.');

  if (args.includes('--write-test')) {
    fixtureId = randomUUID();
    const email = `migration-smoke-${fixtureId}@example.invalid`;
    const user = check(await db.from('users').upsert({ id: fixtureId, email, display_name: 'Migration smoke' }, { onConflict: 'email' }).select().single(), 'User upsert');
    if (user.id !== fixtureId) throw new Error('Unexpected user identity');
    const layout = { migration_smoke: true, unicode: 'æøå', nested: [1, null, false] };
    const prefs = check(await db.from('user_preferences').upsert({ user_id: fixtureId, layout }, { onConflict: 'user_id' }).select().single(), 'Preferences JSONB');
    if (JSON.stringify(prefs.layout.nested) !== JSON.stringify(layout.nested) || prefs.layout.unicode !== layout.unicode) throw new Error('JSONB did not round trip');
    check(await db.from('api_keys').upsert({ user_id: fixtureId, provider: 'migration-smoke', api_key: 'fixture-not-a-secret' }, { onConflict: 'user_id,provider' }).select().single(), 'Composite upsert');
    check(await db.from('api_keys').upsert({ user_id: fixtureId, provider: 'migration-smoke', api_key: 'fixture-updated' }, { onConflict: 'user_id,provider' }).select().single(), 'Composite conflict update');
    const device = check(await db.from('devices').insert({ user_id: fixtureId, device_id: fixtureId, device_name: 'Smoke', ble_name: 'OD-smoke' }).select().single(), 'Device without license key');
    check(await db.from('devices').update({ device_name: 'Smoke updated' }).eq('id', device.id).eq('user_id', fixtureId).select().single(), 'Scoped device update');
    check(await db.from('firmware_versions').insert({ user_id: fixtureId, version: 'smoke', download_path: 'https://example.invalid/smoke.bin' }), 'Firmware');
    check(await db.from('firmware_versions').select('id').eq('user_id', fixtureId).eq('active', true).order('created_at', { ascending: false }).limit(1).single(), 'Latest firmware');
    check(await db.from('api_usage').insert({ user_id: fixtureId, endpoint: 'migration-smoke' }), 'Usage');
    check(await db.from('orders').insert({ user_id: fixtureId, status: 'migration-smoke' }), 'Orders');
    console.log('PASS: SDK upserts, JSONB, inserts, filters, update, ordering and nullable device license.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Smoke test failed');
  process.exitCode = 1;
} finally {
  if (fixtureId) {
    const result = await db.from('users').delete().eq('id', fixtureId);
    if (result.error) {
      console.error(`Fixture cleanup failed; delete ONLY users.id=${fixtureId} on the Pi after investigation.`);
      process.exitCode = 1;
    } else {
      console.log('PASS: fixture deleted (dependent rows cascade).');
    }
  }
}
