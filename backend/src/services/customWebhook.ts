import crypto from 'crypto';
import { withSignal } from '../db/pool';
import {
  clearWebhookToken, findWebhookOwnerByHash, findWebhookRow, replaceWebhookToken, writeWebhookPayload,
} from '../db/repositories/integrationTokens';
import { withCause } from '../db/errors';
import type { CustomWebhookData, SensorRow, UserPreferences } from '../types';

export interface WebhookRecord {
  user_id: string;
  token_hash: string | null;
  token_created_at: string | null;
  rows: SensorRow[];
  observed_at: string | null;
  received_at: string | null;
}
export interface WebhookPayload { rows: SensorRow[]; observed_at: string; received_at: string; }
export const DEFAULT_WEBHOOK_TTL_MINUTES = 60;

export function hashWebhookToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function parseWebhookBearer(header?: string): string | null {
  return /^Bearer ewh_[a-f0-9]{64}$/.test(header ?? '') ? header!.slice(7) : null;
}

function textField(value: unknown, name: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${name} must be text`);
  const text = value.normalize('NFC').trim();
  if (text.length > maximum || (!allowEmpty && text.length === 0) || /[\u0000-\u001f\u007f]/u.test(text) ||
      Array.from(text).some((character) => { const code = character.codePointAt(0)!; return code >= 0xd800 && code <= 0xdfff; })) {
    throw new Error(`${name} must be a single line of ${allowEmpty ? '0' : '1'}–${maximum} valid text characters`);
  }
  return text;
}

export function parseWebhookPayload(value: unknown, now = new Date()): WebhookPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Payload must be an object');
  const payload = value as Record<string, unknown>;
  if (Object.keys(payload).some((key) => !['rows', 'observed_at'].includes(key))) throw new Error('Payload only accepts rows and observed_at');
  if (!Array.isArray(payload.rows) || payload.rows.length < 1 || payload.rows.length > 12) throw new Error('rows must contain 1–12 sensor rows');
  const labels = new Set<string>();
  const rows = payload.rows.map((value, index): SensorRow => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Row ${index + 1} must be an object`);
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some((key) => !['label', 'value', 'unit'].includes(key))) throw new Error('Rows only accept label, value and unit');
    const label = textField(row.label, 'label', 40);
    if (labels.has(label.toLowerCase())) throw new Error('Sensor labels must be unique');
    labels.add(label.toLowerCase());
    return { label, value: textField(row.value, 'value', 80), ...(row.unit === undefined ? {} : { unit: textField(row.unit, 'unit', 16, true) }) };
  });
  let observedAt = now.toISOString();
  if (payload.observed_at !== undefined) {
    const value = payload.observed_at;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
      throw new Error('observed_at must be a UTC timestamp such as 2026-09-28T12:00:00Z');
    }
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > now.getTime() ||
        new Date(timestamp).toISOString().slice(0, 19) !== value.slice(0, 19)) {
      throw new Error('observed_at must be a valid timestamp from 1970 through the present');
    }
    observedAt = new Date(timestamp).toISOString();
  }
  return { rows, observed_at: observedAt, received_at: now.toISOString() };
}

export function parseWebhookPreferences(body: Record<string, unknown>): Partial<UserPreferences> {
  const updates: Partial<UserPreferences> = {};
  if (body.show_custom_webhook !== undefined) {
    if (typeof body.show_custom_webhook !== 'boolean') throw new Error('show_custom_webhook must be a boolean');
    updates.show_custom_webhook = body.show_custom_webhook;
  }
  if (body.custom_webhook_ttl_minutes !== undefined) {
    const ttl = body.custom_webhook_ttl_minutes;
    if (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl < 1 || ttl > 1440) throw new Error('custom_webhook_ttl_minutes must be an integer between 1 and 1440');
    updates.custom_webhook_ttl_minutes = ttl;
  }
  return updates;
}

export async function getWebhookRecord(userId: string, signal?: AbortSignal): Promise<WebhookRecord | null> {
  try { return (await withSignal(findWebhookRow(userId), signal)) as WebhookRecord | null; }
  catch (cause) {
    throw withCause('Could not load custom webhook data', cause);
  }
}

export async function issueWebhookToken(userId: string): Promise<string> {
  const token = `ewh_${crypto.randomBytes(32).toString('hex')}`;
  try { await replaceWebhookToken(userId, hashWebhookToken(token)); }
  catch (cause) { throw withCause('Could not create an integration token', cause); }
  return token;
}

export async function revokeWebhookToken(userId: string): Promise<void> {
  try { await clearWebhookToken(userId); }
  catch (cause) { throw withCause('Could not revoke the integration token', cause); }
}

export async function findWebhookOwner(tokenHash: string): Promise<string | null> {
  try { return await findWebhookOwnerByHash(tokenHash); }
  catch (cause) { throw withCause('Could not authenticate the integration token', cause); }
}

export async function saveWebhookPayload(userId: string, tokenHash: string, payload: WebhookPayload): Promise<boolean> {
  // The write is filtered on the current token hash: revocation/rotation between
  // lookup and update must not allow an old request to publish another payload.
  try { return await writeWebhookPayload(userId, tokenHash, payload); }
  catch (cause) { throw withCause('Could not store custom webhook data', cause); }
}

export function webhookDisplayData(record: WebhookRecord | null, ttlMinutes: number, now = new Date()): CustomWebhookData {
  const unavailable: CustomWebhookData = { state: 'unavailable', rows: [], receivedAt: null, observedAt: null, expiresAt: null };
  if (!record?.token_hash || !record.received_at || !record.observed_at || !record.rows?.length) return unavailable;
  const observed = Date.parse(record.observed_at);
  if (!Number.isFinite(observed)) return unavailable;
  let validated: WebhookPayload;
  // PostgreSQL serializes TIMESTAMPTZ with +00:00; normalize stored timestamps
  // before applying the strict public input contract.
  try { validated = parseWebhookPayload({ rows: record.rows, observed_at: new Date(observed).toISOString() }, now); } catch { return unavailable; }
  const received = Date.parse(record.received_at);
  if (!Number.isFinite(received) || received > now.getTime()) return unavailable;
  const ttl = Number.isInteger(ttlMinutes) && ttlMinutes >= 1 && ttlMinutes <= 1440 ? ttlMinutes : DEFAULT_WEBHOOK_TTL_MINUTES;
  const expires = Math.min(Date.parse(validated.observed_at), received) + ttl * 60000;
  return {
    state: now.getTime() >= expires ? 'stale' : 'fresh', rows: validated.rows,
    receivedAt: new Date(received).toISOString(), observedAt: validated.observed_at, expiresAt: new Date(expires).toISOString(),
  };
}

export async function fetchWebhookData(userId: string, ttlMinutes: number, signal?: AbortSignal): Promise<CustomWebhookData> {
  return webhookDisplayData(await getWebhookRecord(userId, signal), ttlMinutes);
}
