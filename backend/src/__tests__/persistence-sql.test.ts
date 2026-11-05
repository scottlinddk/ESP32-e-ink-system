import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No database needed: every statement the repositories send is captured and inspected.
 * User-controlled values must travel as bound parameters, never inside the SQL text.
 */
const sent = vi.hoisted(() => ({ calls: [] as Array<{ text: string; values: unknown[] }> }));
vi.mock('../db/pool', async (importOriginal) => {
  const record = async (text: string, values: unknown[] = []) => {
    sent.calls.push({ text, values });
    return { rows: [{}], rowCount: 1 };
  };
  return { ...(await importOriginal<typeof import('../db/pool')>()), query: record, withTransaction: async (work: (tx: unknown) => unknown) => work({ query: record }) };
});

import * as accounts from '../db/repositories/accounts';
import * as devices from '../db/repositories/devices';
import * as delivery from '../db/repositories/deviceDelivery';
import * as displays from '../db/repositories/deviceDisplays';
import * as tokens from '../db/repositories/integrationTokens';
import * as sharing from '../db/repositories/sharing';

const EVIL = `x'; DROP TABLE users; --`;
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const HASH = 'a'.repeat(64);

beforeEach(() => { sent.calls = []; });

describe('SQL parameterization', () => {
  it('sends hostile values as bound parameters, never inside the statement text', async () => {
    await accounts.findUserByEmail(EVIL);
    await accounts.upsertUserRow(EVIL, EVIL);
    await accounts.upsertApiKeyRow(UUID_A, EVIL, EVIL);
    await accounts.deleteApiKeyRow(UUID_A, EVIL);
    await accounts.upsertPreferenceRow(UUID_A, { weather_location: EVIL, custom_text: EVIL });
    await devices.insertDevice(UUID_A, EVIL, EVIL, EVIL);
    await devices.renameDevice(UUID_A, UUID_B, EVIL);
    await devices.findFirmwareByVersion(UUID_A, EVIL);
    await devices.insertFirmware(UUID_A, EVIL, EVIL, EVIL, EVIL, true);
    await devices.insertApiUsage(UUID_A, EVIL);
    await tokens.writeWebhookPayload(UUID_A, EVIL, { rows: [{ label: EVIL }], observed_at: EVIL, received_at: EVIL });
    await tokens.writeAiUsageProviders(UUID_A, EVIL, { claude: EVIL }, EVIL);
    await tokens.findWebhookOwnerByHash(EVIL);
    await delivery.findOwnerByDeviceToken(UUID_A, EVIL);
    await delivery.updateTelemetry(UUID_A, UUID_B, EVIL, { firmware_version: EVIL, last_applied_hash: EVIL });
    await displays.insertDeviceDisplay(UUID_A, UUID_B, 1, { display_timezone: EVIL, layout: { name: EVIL } });
    await sharing.selectUserIdByEmail(EVIL);
    await sharing.insertItem(UUID_A, UUID_B, 'layout', EVIL, { name: EVIL });
    expect(sent.calls.length).toBeGreaterThan(15);
    for (const { text, values } of sent.calls) {
      expect(text, text).not.toContain(EVIL);
      expect(text, text).not.toMatch(/DROP TABLE/i);
      // Every placeholder in the text has a value.
      const placeholders = [...text.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
      if (placeholders.length) expect(values.length).toBeGreaterThanOrEqual(Math.max(...placeholders));
    }
    expect(sent.calls.some(({ values }) => values.includes(EVIL))).toBe(true);
  });

  it('builds dynamic column lists only from allow-listed names, and refuses anything else before querying', async () => {
    await expect(accounts.upsertPreferenceRow(UUID_A, { [`weather_location" = 'x', "user_id`]: '1' } as never)).rejects.toThrow(/Unknown preference column/);
    await expect(accounts.upsertPreferenceRow(UUID_A, { user_id: UUID_B } as never)).rejects.toThrow(/Unknown preference column/);
    await expect(accounts.upsertPreferenceRow(UUID_A, { id: UUID_B } as never)).rejects.toThrow(/Unknown preference column/);
    expect(sent.calls).toEqual([]);

    await accounts.upsertPreferenceRow(UUID_A, { show_news: false, layout: null, news_feeds: [{ id: 'a' }] as never, custom_image: undefined });
    const { text, values } = sent.calls[0];
    expect(text).toContain('"show_news"');
    expect(text).not.toContain('custom_image');
    // jsonb arrays are serialised; SQL NULL stays NULL.
    expect(values).toEqual([UUID_A, false, null, '[{"id":"a"}]']);

    sent.calls = [];
    await delivery.updateTelemetry(UUID_A, UUID_B, HASH, { firmware_version: 'v1', rssi: undefined, bogus: 'x' } as never);
    expect(sent.calls[0].text).toMatch(/SET firmware_version = \$4, last_seen_at = now\(\)/);
    expect(sent.calls[0].text).not.toContain('bogus');
    sent.calls = [];
    await displays.insertDeviceDisplay(UUID_A, UUID_B, 1, { display_timezone: 'UTC', owner_id: UUID_A, "evil\" = 1 --": 'x' });
    expect(sent.calls[0].text).not.toContain('evil');
    expect(sent.calls[0].text.match(/"owner_id"/g)).toHaveLength(1);
  });

  it('puts the caller’s id in the WHERE clause of every user-data statement', async () => {
    await devices.listDeviceRows(UUID_A);
    await devices.renameDevice(UUID_A, UUID_B, 'n');
    await devices.removeDevice(UUID_A, UUID_B);
    await accounts.writeDefaultDeviceId(UUID_B, UUID_A);
    await accounts.listApiKeyRows(UUID_B);
    await delivery.isDeviceOwnedBy(UUID_B, UUID_A);
    await delivery.upsertDeliveryToken(UUID_B, UUID_A, HASH, true);
    await sharing.selectSharesOfDevice(UUID_A, UUID_B);
    for (const { text } of sent.calls) expect(text, text).toMatch(/user_id = \$\d|owner_id = \$\d|d\.user_id = \$\d/);
  });

  it('does not reach the database for ids that are not UUIDs', async () => {
    expect(await devices.listDeviceRows('1 OR 1=1')).toEqual([]);
    expect(await devices.findFirmwareById(UUID_A, "' OR '1'='1")).toBeNull();
    expect(await delivery.findDelivery('not-a-uuid')).toBeNull();
    expect(await delivery.upsertDeliveryToken('x', 'y', HASH, true)).toBe(false);
    expect(await accounts.writeDefaultDeviceId(UUID_A, 'nope')).toBe(false);
    expect(await sharing.selectConnectionBetween('a', 'b')).toBeNull();
    expect(await sharing.selectDeviceOwner('nope')).toBeNull();
    await expect(devices.renameDevice('nope', UUID_A, 'n')).rejects.toMatchObject({ statusCode: 404 });
    expect(sent.calls).toEqual([]);
  });
});

describe('static guard on SQL text', () => {
  /** Every ${...} inside a repository template literal, as written. */
  const interpolations = new Map<string, Set<string>>();
  const dir = join(__dirname, '..', 'db', 'repositories');
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
    const source = readFileSync(join(dir, file), 'utf8');
    interpolations.set(file, new Set([...source.matchAll(/\$\{([^}]+)\}/g)].map((match) => match[1].trim())));
  }

  // Each of these expands to a fixed fragment: a literal, a placeholder number, or an identifier that was
  // checked against an allow-list first (see the test above). The pattern stops at the first "}", so
  // nested template literals appear truncated. Anything new must be reviewed and added here on purpose.
  const SAFE = new Set([
    'AI_FIELDS', 'refreshColumns', 'refreshValues', 'refreshReset', 'pendingOnly', "lock ? 'FOR UPDATE' : ''",
    'index + 1', 'index + 4', 'index + 6', 'column',
    'columns.map((column) => `"${column', 'names.map((name) => `"${name',
    "placeholders.join(', ')", "updates.join(', ')",
    "[...assignments, 'last_seen_at = now()'].join(', ')",
    "[...assignments, 'owner_id = $4', 'revision = $5', 'updated_at = now()'].join(', ')",
    "unknown.join(', ')", // an error message, not SQL
  ]);

  it('only interpolates fixed fragments and allow-listed identifiers', () => {
    for (const [file, found] of interpolations) {
      for (const expression of found) expect(SAFE.has(expression), `${file}: \${${expression}} is not a reviewed SQL fragment`).toBe(true);
    }
  });

  it('keeps SQL out of routes, middleware and services', () => {
    const roots = ['routes', 'middleware', 'services', 'aiUsage'];
    for (const root of roots) {
      for (const file of readdirSync(join(__dirname, '..', root)).filter((name) => name.endsWith('.ts'))) {
        const source = readFileSync(join(__dirname, '..', root, file), 'utf8');
        expect(source, `${root}/${file}`).not.toMatch(/\b(SELECT|INSERT INTO|UPDATE \w+ SET|DELETE FROM)\b/);
        expect(source, `${root}/${file}`).not.toMatch(/from 'pg'|supabase/i);
      }
    }
  });
});
