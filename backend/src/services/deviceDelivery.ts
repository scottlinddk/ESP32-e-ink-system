import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createError } from '../middleware/errorHandler';
import { DeviceNotFound, isMissingColumn, withCause } from '../db/errors';
import { withTransaction } from '../db/pool';
import {
  acknowledgeRefresh, findActiveDelivery, findDelivery, findOwnedDelivery, findOwnerByDeviceToken, isDeviceOwnedBy,
  revokeDelivery, setInstantUpdatesFlag, setRefreshRequest, updateTelemetry, upsertDeliveryToken, type DeliveryRow,
} from '../db/repositories/deviceDelivery';

export { DeviceNotFound };
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
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const missingRefreshColumns = (error: unknown) => isMissingColumn(error, /refresh_(request_id|requested_at|applied_at)/);
const missingInstantColumn = (error: unknown) => isMissingColumn(error, /instant_updates/);

export async function assertDeviceOwner(owner: string, deviceId: string): Promise<void> {
  let owned: boolean;
  try { owned = await isDeviceOwnedBy(owner, deviceId); }
  catch (cause) { throw withCause('Unable to check device ownership', cause); }
  if (!owned) throw new DeviceNotFound('Device not found');
}

export async function getDeliveryStatus(owner: string, deviceId: string): Promise<DeliveryStatus> {
  await assertDeviceOwner(owner, deviceId);
  let data: DeliveryRow | null;
  try { data = await findDelivery(deviceId); }
  catch (cause) { throw withCause('Unable to load device delivery status', cause); }
  // Credentials/reports issued to an earlier owner never follow a reassignment.
  const row = data?.owner_id === owner ? data : null;
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
  let written: boolean;
  try {
    try { written = await upsertDeliveryToken(owner, deviceId, tokenHash(token), true); }
    // Migration 019 may lag an application rollout; preserve old token management.
    catch (error) {
      if (!missingRefreshColumns(error)) throw error;
      written = await upsertDeliveryToken(owner, deviceId, tokenHash(token), false);
    }
  } catch (cause) { throw withCause('Unable to create device token', cause); }
  // The device was reassigned between the check and the write: nothing was issued.
  if (!written) throw new DeviceNotFound('Device not found');
  return token;
}

export async function revokeDeviceToken(owner: string, deviceId: string): Promise<void> {
  await assertDeviceOwner(owner, deviceId);
  try {
    try { await revokeDelivery(owner, deviceId, true); }
    catch (error) {
      if (!missingRefreshColumns(error)) throw error;
      await revokeDelivery(owner, deviceId, false);
    }
  } catch (cause) { throw withCause('Unable to revoke device token', cause); }
}

/** One durable request per device; a new click supersedes an older request. */
export async function requestDeviceRefresh(owner: string, deviceId: string): Promise<DeliveryStatus> {
  await assertDeviceOwner(owner, deviceId);
  let current: DeliveryRow | null;
  try { current = await findOwnedDelivery(owner, deviceId); }
  catch (cause) { throw withCause('Unable to load device delivery status', cause); }
  if (!current?.token_hash || current.revoked_at) throw createError('Configure automatic updates with an active device token before requesting a refresh.', 409);
  let updated: DeliveryRow | null;
  try { updated = await setRefreshRequest(owner, deviceId, randomUUID(), current.token_hash); }
  catch (error) {
    if (missingRefreshColumns(error)) throw createError('Apply database migration 019 before requesting a device refresh.', 503);
    throw new Error('Unable to request device refresh');
  }
  if (!updated) throw createError('Device credentials changed. Reload the device and try again.', 409);
  return deliveryStatus(updated);
}

/** Owner opt-in; the device learns the mode from its next feed response. */
export async function setInstantUpdates(owner: string, deviceId: string, enabled: boolean): Promise<DeliveryStatus> {
  await assertDeviceOwner(owner, deviceId);
  let updated: DeliveryRow | null;
  try { updated = await setInstantUpdatesFlag(owner, deviceId, enabled); }
  catch (error) {
    if (missingInstantColumn(error)) throw createError('Apply database migration 020 before enabling instant updates.', 503);
    throw new Error('Unable to change instant updates');
  }
  if (!updated) throw createError('Configure automatic updates with an active device token before enabling instant updates.', 409);
  return deliveryStatus(updated);
}

/**
 * Snapshot before fetching data; do not attach a newer request to an older frame.
 * Selecting every column keeps installations without migration 019/020 working:
 * absent columns read as no pending request and instant updates off.
 */
export async function getRefreshState(owner: string, deviceId: string, credentialHash: string): Promise<RefreshState> {
  let row: DeliveryRow | null;
  try { row = await findActiveDelivery(owner, deviceId, credentialHash); }
  catch (cause) { throw withCause('Unable to load pending device refresh', cause); }
  return {
    requestId: row?.refresh_request_id && !row.refresh_applied_at ? row.refresh_request_id : null,
    instantUpdates: row?.instant_updates === true,
  };
}

/** Returns the owner a valid, unrevoked device token was issued to, or null. */
export async function authenticateDevice(deviceId: string, authorization?: string): Promise<string | null> {
  const match = /^Bearer (einkd_[A-Za-z0-9_-]{43})$/.exec(authorization ?? '');
  if (!match) return null;
  try { return await findOwnerByDeviceToken(deviceId, tokenHash(match[1])); }
  catch (cause) { throw withCause('Unable to authenticate device', cause); }
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
  if (!refresh_request_id) {
    try { await updateTelemetry(owner, deviceId, credentialHash, telemetry); }
    catch (cause) { throw withCause('Unable to record heartbeat', cause); }
    return;
  }
  // Telemetry and the acknowledgement describe the same event: both or neither.
  try {
    await withTransaction(async (tx) => {
      await updateTelemetry(owner, deviceId, credentialHash, telemetry, tx);
      await acknowledgeRefresh(owner, deviceId, credentialHash, refresh_request_id, tx);
    });
  } catch (cause) { throw withCause('Unable to acknowledge device refresh', cause); }
}
