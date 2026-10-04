import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getSupabaseClient } from './database';
import { createError } from '../middleware/errorHandler';

interface DeliveryRow {
  device_id: string;
  owner_id: string;
  token_hash: string | null;
  rotated_at: string;
  revoked_at: string | null;
  last_seen_at: string | null;
  firmware_version: string | null;
  battery_percent: number | null;
  rssi: number | null;
  last_applied_hash: string | null;
  refresh_request_id?: string | null;
  refresh_requested_at?: string | null;
  refresh_applied_at?: string | null;
  instant_updates?: boolean;
}
export interface DeliveryStatus {
  configured: boolean;
  rotatedAt: string | null;
  lastSeenAt: string | null;
  firmwareVersion: string | null;
  batteryPercent: number | null;
  rssi: number | null;
  lastAppliedHash: string | null;
  refreshRequestId: string | null;
  refreshRequestedAt: string | null;
  refreshAppliedAt: string | null;
  /** The device stays online and checks for requests every few seconds. */
  instantUpdates: boolean;
}
export interface RefreshState {
  /** A pending, unacknowledged manual request for this credential. */
  requestId: string | null;
  instantUpdates: boolean;
}
export interface Heartbeat {
  firmware_version: string;
  battery_percent?: number;
  rssi?: number;
  // Omitted means unchanged (legacy clients); null explicitly clears an unknown panel state.
  last_applied_hash?: string | null;
  refresh_request_id?: string;
}
export class DeviceNotFound extends Error { readonly statusCode = 404; }
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const emptyRefresh = { refresh_request_id: null, refresh_requested_at: null, refresh_applied_at: null };
const missingRefreshColumns = (error: { code?: string; message?: string } | null) =>
  (error?.code === '42703' || error?.code === 'PGRST204') && /refresh_(request_id|requested_at|applied_at)/.test(error.message ?? '');
const missingInstantColumn = (error: { code?: string; message?: string } | null) =>
  (error?.code === '42703' || error?.code === 'PGRST204') && /instant_updates/.test(error.message ?? '');

export async function assertDeviceOwner(owner: string, deviceId: string): Promise<void> {
  const { data, error } = await getSupabaseClient().from('devices').select('id').eq('id', deviceId).eq('user_id', owner).maybeSingle();
  if (error) throw new Error('Unable to check device ownership');
  if (!data) throw new DeviceNotFound('Device not found');
}

export async function getDeliveryStatus(owner: string, deviceId: string): Promise<DeliveryStatus> {
  await assertDeviceOwner(owner, deviceId);
  const { data, error } = await getSupabaseClient().from('device_delivery').select('*').eq('device_id', deviceId).maybeSingle();
  if (error) throw new Error('Unable to load device delivery status');
  // Credentials/reports issued to an earlier owner never follow a reassignment.
  const row = data?.owner_id === owner ? data as DeliveryRow : null;
  return deliveryStatus(row);
}

function deliveryStatus(row: DeliveryRow | null): DeliveryStatus {
  return {
    configured: Boolean(row?.token_hash && !row.revoked_at), rotatedAt: row?.rotated_at ?? null,
    lastSeenAt: row?.last_seen_at ?? null, firmwareVersion: row?.firmware_version ?? null,
    batteryPercent: row?.battery_percent ?? null, rssi: row?.rssi ?? null, lastAppliedHash: row?.last_applied_hash ?? null,
    refreshRequestId: row?.refresh_request_id ?? null, refreshRequestedAt: row?.refresh_requested_at ?? null,
    refreshAppliedAt: row?.refresh_applied_at ?? null, instantUpdates: row?.instant_updates === true,
  };
}

/** Only the creation response contains the plaintext token. Never store/log it. */
export async function rotateDeviceToken(owner: string, deviceId: string): Promise<string> {
  await assertDeviceOwner(owner, deviceId);
  const token = `einkd_${randomBytes(32).toString('base64url')}`;
  const values = {
    device_id: deviceId, owner_id: owner, token_hash: tokenHash(token), rotated_at: new Date().toISOString(), revoked_at: null,
    last_seen_at: null, firmware_version: null, battery_percent: null, rssi: null, last_applied_hash: null,
  };
  const db = getSupabaseClient();
  let result = await db.from('device_delivery').upsert({ ...values, ...emptyRefresh }, { onConflict: 'device_id' });
  // Migration 019 may lag an application rollout; preserve old token management.
  if (missingRefreshColumns(result.error)) result = await db.from('device_delivery').upsert(values, { onConflict: 'device_id' });
  if (result.error) throw new Error('Unable to create device token');
  return token;
}

export async function revokeDeviceToken(owner: string, deviceId: string): Promise<void> {
  await assertDeviceOwner(owner, deviceId);
  const db = getSupabaseClient();
  const values = { token_hash: null, revoked_at: new Date().toISOString() };
  let result = await db.from('device_delivery').update({ ...values, ...emptyRefresh }).eq('device_id', deviceId).eq('owner_id', owner);
  if (missingRefreshColumns(result.error)) result = await db.from('device_delivery').update(values).eq('device_id', deviceId).eq('owner_id', owner);
  if (result.error) throw new Error('Unable to revoke device token');
}

/** One durable request per device; a new click supersedes an older request. */
export async function requestDeviceRefresh(owner: string, deviceId: string): Promise<DeliveryStatus> {
  await assertDeviceOwner(owner, deviceId);
  const db = getSupabaseClient();
  const current = await db.from('device_delivery').select('*').eq('device_id', deviceId).eq('owner_id', owner).maybeSingle();
  if (current.error) throw new Error('Unable to load device delivery status');
  if (!current.data?.token_hash || current.data.revoked_at) throw createError('Configure automatic updates with an active device token before requesting a refresh.', 409);
  const result = await db.from('device_delivery').update({ refresh_request_id: randomUUID(), refresh_requested_at: new Date().toISOString(), refresh_applied_at: null })
    .eq('device_id', deviceId).eq('owner_id', owner).eq('token_hash', current.data.token_hash).is('revoked_at', null).select('*').maybeSingle();
  if (missingRefreshColumns(result.error)) throw createError('Apply database migration 019 before requesting a device refresh.', 503);
  if (result.error) throw new Error('Unable to request device refresh');
  if (!result.data) throw createError('Device credentials changed. Reload the device and try again.', 409);
  return deliveryStatus(result.data as DeliveryRow);
}

/** Owner opt-in; the device learns the mode from its next feed response. */
export async function setInstantUpdates(owner: string, deviceId: string, enabled: boolean): Promise<DeliveryStatus> {
  await assertDeviceOwner(owner, deviceId);
  const result = await getSupabaseClient().from('device_delivery').update({ instant_updates: enabled })
    .eq('device_id', deviceId).eq('owner_id', owner).not('token_hash', 'is', null).is('revoked_at', null).select('*').maybeSingle();
  if (missingInstantColumn(result.error)) throw createError('Apply database migration 020 before enabling instant updates.', 503);
  if (result.error) throw new Error('Unable to change instant updates');
  if (!result.data) throw createError('Configure automatic updates with an active device token before enabling instant updates.', 409);
  return deliveryStatus(result.data as DeliveryRow);
}

/**
 * Snapshot before fetching data; do not attach a newer request to an older frame.
 * Selecting every column keeps installations without migration 019/020 working:
 * absent columns read as no pending request and instant updates off.
 */
export async function getRefreshState(owner: string, deviceId: string, credentialHash: string): Promise<RefreshState> {
  const { data, error } = await getSupabaseClient().from('device_delivery')
    .select('*').eq('device_id', deviceId).eq('owner_id', owner)
    .eq('token_hash', credentialHash).is('revoked_at', null).maybeSingle();
  if (error) throw new Error('Unable to load pending device refresh');
  const row = data as DeliveryRow | null;
  return {
    requestId: row?.refresh_request_id && !row.refresh_applied_at ? row.refresh_request_id : null,
    instantUpdates: row?.instant_updates === true,
  };
}

export async function authenticateDevice(deviceId: string, authorization?: string): Promise<string | null> {
  const match = /^Bearer (einkd_[A-Za-z0-9_-]{43})$/.exec(authorization ?? '');
  if (!match) return null;
  const db = getSupabaseClient();
  const { data, error } = await db.from('device_delivery').select('device_id, owner_id').eq('device_id', deviceId).eq('token_hash', tokenHash(match[1])).is('revoked_at', null).maybeSingle();
  if (error) throw new Error('Unable to authenticate device');
  if (!data) return null;
  const device = await db.from('devices').select('user_id').eq('id', deviceId).maybeSingle();
  if (device.error) throw new Error('Unable to authenticate device');
  return device.data?.user_id === data.owner_id ? data.owner_id as string : null;
}

export function validateHeartbeat(body: unknown): Heartbeat {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid heartbeat');
  const row = body as Record<string, unknown>;
  if (Object.keys(row).some((key) => !['firmware_version', 'battery_percent', 'rssi', 'last_applied_hash', 'refresh_request_id'].includes(key))) throw new Error('Unknown heartbeat field');
  if (typeof row.firmware_version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+/-]{0,63}$/.test(row.firmware_version)) throw new Error('Invalid firmware version');
  if (row.battery_percent !== undefined && (typeof row.battery_percent !== 'number' || !Number.isFinite(row.battery_percent) || row.battery_percent < 0 || row.battery_percent > 100)) throw new Error('Battery must be between 0 and 100 percent');
  if (row.rssi !== undefined && (typeof row.rssi !== 'number' || !Number.isInteger(row.rssi) || row.rssi < -150 || row.rssi > 0)) throw new Error('RSSI must be an integer between -150 and 0');
  if (row.last_applied_hash !== undefined && row.last_applied_hash !== null && (typeof row.last_applied_hash !== 'string' || !/^[0-9a-f]{64}$/.test(row.last_applied_hash))) throw new Error('Invalid applied image hash');
  if (row.refresh_request_id !== undefined) {
    if (typeof row.refresh_request_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.refresh_request_id)
      || typeof row.last_applied_hash !== 'string') throw new Error('A refresh acknowledgement requires a valid request UUID and applied image hash');
    return { ...row, refresh_request_id: row.refresh_request_id.toLowerCase() } as unknown as Heartbeat;
  }
  return row as unknown as Heartbeat;
}

/** A fetch never counts as a heartbeat or as successful application to a panel. */
export async function recordHeartbeat(owner: string, deviceId: string, credentialHash: string, heartbeat: Heartbeat): Promise<void> {
  // Preserve explicit nulls so a failed refresh can invalidate an earlier ACK.
  // Fields omitted by older clients retain their previously reported values.
  const { refresh_request_id, ...telemetry } = heartbeat;
  const db = getSupabaseClient();
  const now = new Date().toISOString();
  const { error } = await db.from('device_delivery').update({ ...telemetry, last_seen_at: now })
    .eq('device_id', deviceId).eq('owner_id', owner).eq('token_hash', credentialHash).is('revoked_at', null);
  if (error) throw new Error('Unable to record heartbeat');
  if (refresh_request_id) {
    const acknowledged = await db.from('device_delivery').update({ refresh_applied_at: now })
      .eq('device_id', deviceId).eq('owner_id', owner).eq('token_hash', credentialHash).is('revoked_at', null)
      .eq('refresh_request_id', refresh_request_id).is('refresh_applied_at', null);
    if (acknowledged.error) throw new Error('Unable to acknowledge device refresh');
  }
}
