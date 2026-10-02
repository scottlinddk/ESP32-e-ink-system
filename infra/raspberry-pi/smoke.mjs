#!/usr/bin/env node
// Run from a checkout with `npm ci`; never print response rows or credentials.
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
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
function checkFields(actual, expected, label) {
  for (const [field, value] of Object.entries(expected)) {
    // PostgREST represents UTC timestamps with +00:00; JavaScript emits Z.
    const equal = field.endsWith('_at') && typeof value === 'string'
      ? Date.parse(actual[field]) === Date.parse(value) : isDeepStrictEqual(actual[field], value);
    if (!equal) throw new Error(`${label}: ${field} did not round trip`);
  }
}
const primaryKeys = {
  users: 'id', user_preferences: 'id', api_keys: 'id', devices: 'id',
  firmware_versions: 'id', api_usage: 'id', custom_webhooks: 'user_id',
  device_delivery: 'device_id', device_displays: 'device_id', orders: 'id',
};

let fixtureId;
let fixtureDeviceId;
let transferOwnerId;
try {
  for (const [table, primaryKey] of Object.entries(primaryKeys)) {
    for (const headers of [{}, { apikey: key }, { Authorization: 'Bearer invalid' }]) {
      const response = await fetchWithTimeout(`${url.origin}/rest/v1/${table}?select=${primaryKey}&limit=1`, { headers });
      if (![401, 403].includes(response.status)) throw new Error(`Unauthenticated/invalid ${table} request was not denied: ${response.status}`);
    }
    check(await db.from(table).select(primaryKey, { head: true, count: 'exact' }), `Read ${table}`);
  }
  // Empty .single() must retain the error contract used in database.ts.
  const missing = await db.from('users').select('id').eq('id', randomUUID()).single();
  if (missing.error?.code !== 'PGRST116') throw new Error('Missing-row response is incompatible');
  console.log('PASS: service-token access, denied anonymous/invalid access, all ten table primary keys, missing-row contract.');

  if (args.includes('--write-test')) {
    fixtureId = randomUUID();
    const email = `migration-smoke-${fixtureId}@example.invalid`;
    const user = check(await db.from('users').upsert({ id: fixtureId, email, display_name: 'Migration smoke' }, { onConflict: 'email' }).select().single(), 'User upsert');
    if (user.id !== fixtureId) throw new Error('Unexpected user identity');
    const layout = { migration_smoke: true, unicode: 'æøå', nested: [1, null, false] };
    const prefs = check(await db.from('user_preferences').upsert({ user_id: fixtureId, layout }, { onConflict: 'user_id' }).select().single(), 'Preferences JSONB');
    if (JSON.stringify(prefs.layout.nested) !== JSON.stringify(layout.nested) || prefs.layout.unicode !== layout.unicode) throw new Error('JSONB did not round trip');
    const newPreferences = {
      display_profile: { width: 320, height: 240, rotation: 90, colorMode: 'bw' },
      news_source: 'rss', news_feed_url: 'https://example.invalid/feed.xml?source=smoke&lang=da', news_item_limit: 7,
      show_custom_text: true, custom_text: 'Migration smoke: æøå\nSecond line',
      show_custom_image: true, custom_image: { width: 8, height: 2, pixels: '/wA=', fit: 'contain' },
      show_calendar: true, calendar_timezone: 'Europe/Copenhagen', calendar_days: 14, calendar_item_limit: 8,
      display_schedule: {
        enabled: true, timezone: 'Europe/Copenhagen',
        pages: [{ id: 'smoke', name: 'Øjeblik', duration_seconds: 120, layout: { version: 1, cols: 10, rows: 6, widgets: [{ i: 'custom-text', x: 0, y: 0, w: 10, h: 6 }] } }],
        quiet_hours: { enabled: true, start: '22:30', end: '07:15' },
      },
      show_custom_webhook: true, custom_webhook_ttl_minutes: 90,
    };
    checkFields(check(await db.from('user_preferences').update(newPreferences).eq('user_id', fixtureId).select().single(), 'New preferences'), newPreferences, 'New preferences');
    check(await db.from('api_keys').upsert({ user_id: fixtureId, provider: 'migration-smoke', api_key: 'fixture-not-a-secret' }, { onConflict: 'user_id,provider' }).select().single(), 'Composite upsert');
    check(await db.from('api_keys').upsert({ user_id: fixtureId, provider: 'migration-smoke', api_key: 'fixture-updated' }, { onConflict: 'user_id,provider' }).select().single(), 'Composite conflict update');
    const device = check(await db.from('devices').insert({ user_id: fixtureId, device_id: fixtureId, device_name: 'Smoke', ble_name: 'OD-smoke' }).select().single(), 'Device without license key');
    fixtureDeviceId = device.id;
    check(await db.from('devices').update({ device_name: 'Smoke updated' }).eq('id', device.id).eq('user_id', fixtureId).select().single(), 'Scoped device update');
    const fixtureHash = createHash('sha256').update(fixtureId).digest('hex');
    const rotatedHash = createHash('sha256').update(`${fixtureId}-rotated`).digest('hex');
    const timestamp = new Date().toISOString();
    const webhook = { user_id: fixtureId, token_hash: fixtureHash, token_created_at: timestamp, rows: [{ label: 'Køkken', value: '21.5', unit: '°C' }], observed_at: timestamp, received_at: timestamp };
    check(await db.from('custom_webhooks').upsert(webhook, { onConflict: 'user_id' }).select().single(), 'Webhook upsert');
    const webhookUpdate = { token_hash: rotatedHash, rows: [{ label: 'Køkken', value: '22.0', unit: '°C' }] };
    checkFields(check(await db.from('custom_webhooks').upsert({ ...webhook, ...webhookUpdate }, { onConflict: 'user_id' }).select().single(), 'Webhook conflict update'), webhookUpdate, 'Webhook conflict update');
    checkFields(check(await db.from('custom_webhooks').update({ token_hash: null }).eq('user_id', fixtureId).select().single(), 'Webhook revoke'), { token_hash: null }, 'Webhook revoke');
    check(await db.from('custom_webhooks').delete().eq('user_id', fixtureId).select().single(), 'Webhook delete');
    check(await db.from('custom_webhooks').insert(webhook), 'Webhook cascade fixture');
    const delivery = {
      device_id: fixtureDeviceId, owner_id: fixtureId, token_hash: fixtureHash, rotated_at: timestamp,
      last_seen_at: timestamp, firmware_version: 'smoke-telemetry', battery_percent: 72.5, rssi: -65, last_applied_hash: fixtureHash,
    };
    check(await db.from('device_delivery').upsert(delivery, { onConflict: 'device_id' }).select().single(), 'Delivery upsert');
    const deliveryUpdate = { token_hash: rotatedHash, battery_percent: 71.25, rssi: -70, last_applied_hash: rotatedHash };
    checkFields(check(await db.from('device_delivery').upsert({ ...delivery, ...deliveryUpdate }, { onConflict: 'device_id' }).select().single(), 'Delivery conflict update'), deliveryUpdate, 'Delivery conflict update');
    const refreshRequest = { refresh_request_id: randomUUID(), refresh_requested_at: timestamp, refresh_applied_at: null };
    checkFields(check(await db.from('device_delivery').update(refreshRequest).eq('device_id', fixtureDeviceId).eq('owner_id', fixtureId).select().single(), 'Queue screen refresh'), refreshRequest, 'Queue screen refresh');
    const staleAck = check(await db.from('device_delivery').update({ refresh_applied_at: timestamp }).eq('device_id', fixtureDeviceId).eq('owner_id', fixtureId).eq('refresh_request_id', randomUUID()).select(), 'Stale refresh ACK');
    if (staleAck.length !== 0) throw new Error('Stale refresh ACK matched a newer request');
    checkFields(check(await db.from('device_delivery').update({ refresh_applied_at: timestamp }).eq('device_id', fixtureDeviceId).eq('owner_id', fixtureId).eq('refresh_request_id', refreshRequest.refresh_request_id).select().single(), 'Refresh ACK'), { ...refreshRequest, refresh_applied_at: timestamp }, 'Refresh ACK');
    checkFields(check(await db.from('device_delivery').update({ token_hash: null, revoked_at: timestamp }).eq('device_id', fixtureDeviceId).eq('owner_id', fixtureId).select().single(), 'Delivery revoke'), { token_hash: null }, 'Delivery revoke');
    const invalidBattery = await db.from('device_delivery').update({ battery_percent: 101 }).eq('device_id', fixtureDeviceId);
    if (invalidBattery.error?.code !== '23514') throw new Error('Delivery battery constraint is missing');
    check(await db.from('device_delivery').delete().eq('device_id', fixtureDeviceId).eq('owner_id', fixtureId).select().single(), 'Delivery delete');
    check(await db.from('device_delivery').insert(delivery), 'Delivery cascade fixture');
    const presentation = {
      device_id: fixtureDeviceId, owner_id: fixtureId,
      layout: { version: 1, cols: 10, rows: 6, widgets: [{ i: 'custom-text', x: 0, y: 0, w: 10, h: 6 }] },
      display_schedule: newPreferences.display_schedule, active_layout_id: 'smoke',
      display_profile: newPreferences.display_profile, display_timezone: 'Europe/Copenhagen', refresh_interval_minutes: 15,
      revision: 1,
    };
    checkFields(check(await db.from('device_displays').upsert(presentation, { onConflict: 'device_id' }).select().single(), 'Device presentation'), presentation, 'Device presentation');
    checkFields(check(await db.from('device_displays').update({ revision: 2 }).eq('device_id', fixtureDeviceId).eq('owner_id', fixtureId).eq('revision', 1).select().single(), 'Presentation revision'), { revision: 2 }, 'Presentation revision');
    for (const invalid of [{ layout: [] }, { display_schedule: [] }, { display_profile: [] }, { active_layout_id: 'bad/id' }, { display_timezone: '' }, { refresh_interval_minutes: 0 }, { revision: 0 }]) {
      const rejected = await db.from('device_displays').update(invalid).eq('device_id', fixtureDeviceId);
      if (rejected.error?.code !== '23514') throw new Error('Device presentation constraint is missing');
    }
    check(await db.from('devices').update({ device_name: 'Preserve presentation' }).eq('id', fixtureDeviceId), 'Device rename');
    checkFields(check(await db.from('device_displays').select('revision').eq('device_id', fixtureDeviceId).single(), 'Presentation after rename'), { revision: 2 }, 'Presentation after rename');
    transferOwnerId = randomUUID();
    check(await db.from('users').insert({ id: transferOwnerId, email: `migration-smoke-${transferOwnerId}@example.invalid` }), 'Transfer owner fixture');
    check(await db.from('devices').update({ user_id: transferOwnerId }).eq('id', fixtureDeviceId), 'Device transfer');
    if (check(await db.from('device_displays').select('device_id').eq('device_id', fixtureDeviceId).maybeSingle(), 'Transferred presentation') !== null) throw new Error('Device transfer retained previous owner presentation');
    const staleOwnerWrite = await db.from('device_displays').insert(presentation);
    if (staleOwnerWrite.error?.code !== '23503') throw new Error('Device presentation accepted a previous owner write');
    check(await db.from('devices').update({ user_id: fixtureId }).eq('id', fixtureDeviceId), 'Return device ownership');
    if (check(await db.from('device_displays').select('device_id').eq('device_id', fixtureDeviceId).maybeSingle(), 'Returned presentation') !== null) throw new Error('Returning ownership revived old presentation');
    check(await db.from('device_displays').insert(presentation), 'Presentation cascade fixture');
    check(await db.from('firmware_versions').insert({ user_id: fixtureId, version: 'smoke', download_path: 'https://example.invalid/smoke.bin' }), 'Firmware');
    check(await db.from('firmware_versions').select('id').eq('user_id', fixtureId).eq('active', true).order('created_at', { ascending: false }).limit(1).single(), 'Latest firmware');
    check(await db.from('api_usage').insert({ user_id: fixtureId, endpoint: 'migration-smoke' }), 'Usage');
    check(await db.from('orders').insert({ user_id: fixtureId, status: 'migration-smoke' }), 'Orders');
    console.log('PASS: SDK upserts, preferences, device presentation ownership reset, tokens and telemetry, CRUD, constraints and nullable device license.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Smoke test failed');
  process.exitCode = 1;
} finally {
  if (transferOwnerId) {
    const cleanup = await db.from('users').delete().eq('id', transferOwnerId);
    if (cleanup.error) {
      console.error(`Transfer fixture cleanup failed; delete ONLY users.id=${transferOwnerId} on the Pi after investigation.`);
      process.exitCode = 1;
    }
  }
  if (fixtureId) {
    const result = await db.from('users').delete().eq('id', fixtureId);
    if (result.error) {
      console.error(`Fixture cleanup failed; delete ONLY users.id=${fixtureId} on the Pi after investigation.`);
      process.exitCode = 1;
    } else {
      try {
        for (const [table, primaryKey] of Object.entries(primaryKeys)) {
          const filter = table === 'users' ? 'id' : ['device_delivery', 'device_displays'].includes(table) ? 'owner_id' : 'user_id';
          const remaining = check(await db.from(table).select(primaryKey).eq(filter, fixtureId).limit(1), `Cleanup ${table}`);
          if (remaining.length) throw new Error(`Dependent fixture remains in ${table}`);
        }
        console.log('PASS: fixture deleted and cascades verified across all ten tables.');
      } catch (error) {
        console.error(error instanceof Error ? error.message : 'Cascade verification failed');
        process.exitCode = 1;
      }
    }
  }
}
