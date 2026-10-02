import { createHash, randomBytes } from 'node:crypto';
import { getSupabaseClient } from './database';

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
}
export interface DeliveryStatus {
  configured: boolean;
  rotatedAt: string | null;
  lastSeenAt: string | null;
  firmwareVersion: string | null;
  batteryPercent: number | null;
  rssi: number | null;
  lastAppliedHash: string | null;
}
export interface Heartbeat {
  firmware_version: string;
  battery_percent?: number;
  rssi?: number;
  // Omitted means unchanged (legacy clients); null explicitly clears an unknown panel state.
  last_applied_hash?: string | null;
}
export class DeviceNotFound extends Error { readonly statusCode = 404; }
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

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
  return {
    configured: Boolean(row?.token_hash && !row.revoked_at), rotatedAt: row?.rotated_at ?? null,
    lastSeenAt: row?.last_seen_at ?? null, firmwareVersion: row?.firmware_version ?? null,
    batteryPercent: row?.battery_percent ?? null, rssi: row?.rssi ?? null, lastAppliedHash: row?.last_applied_hash ?? null,
  };
}

/** Only the creation response contains the plaintext token. Never store/log it. */
export async function rotateDeviceToken(owner: string, deviceId: string): Promise<string> {
  await assertDeviceOwner(owner, deviceId);
  const token = `einkd_${randomBytes(32).toString('base64url')}`;
  const { error } = await getSupabaseClient().from('device_delivery').upsert({
    device_id: deviceId, owner_id: owner, token_hash: tokenHash(token), rotated_at: new Date().toISOString(), revoked_at: null,
    last_seen_at: null, firmware_version: null, battery_percent: null, rssi: null, last_applied_hash: null,
  }, { onConflict: 'device_id' });
  if (error) throw new Error('Unable to create device token');
  return token;
}

export async function revokeDeviceToken(owner: string, deviceId: string): Promise<void> {
  await assertDeviceOwner(owner, deviceId);
  const { error } = await getSupabaseClient().from('device_delivery').update({ token_hash: null, revoked_at: new Date().toISOString() }).eq('device_id', deviceId);
  if (error) throw new Error('Unable to revoke device token');
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
  if (Object.keys(row).some((key) => !['firmware_version', 'battery_percent', 'rssi', 'last_applied_hash'].includes(key))) throw new Error('Unknown heartbeat field');
  if (typeof row.firmware_version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+/-]{0,63}$/.test(row.firmware_version)) throw new Error('Invalid firmware version');
  if (row.battery_percent !== undefined && (typeof row.battery_percent !== 'number' || !Number.isFinite(row.battery_percent) || row.battery_percent < 0 || row.battery_percent > 100)) throw new Error('Battery must be between 0 and 100 percent');
  if (row.rssi !== undefined && (typeof row.rssi !== 'number' || !Number.isInteger(row.rssi) || row.rssi < -150 || row.rssi > 0)) throw new Error('RSSI must be an integer between -150 and 0');
  if (row.last_applied_hash !== undefined && row.last_applied_hash !== null && (typeof row.last_applied_hash !== 'string' || !/^[0-9a-f]{64}$/.test(row.last_applied_hash))) throw new Error('Invalid applied image hash');
  return row as unknown as Heartbeat;
}

/** A fetch never counts as a heartbeat or as successful application to a panel. */
export async function recordHeartbeat(deviceId: string, heartbeat: Heartbeat): Promise<void> {
  // Preserve explicit nulls so a failed refresh can invalidate an earlier ACK.
  // Fields omitted by older clients retain their previously reported values.
  const { error } = await getSupabaseClient().from('device_delivery').update({ ...heartbeat, last_seen_at: new Date().toISOString() }).eq('device_id', deviceId);
  if (error) throw new Error('Unable to record heartbeat');
}
