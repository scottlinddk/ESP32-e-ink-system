import { User, UserPreferences, ApiKey, Device, FirmwareVersion } from '../types/index';
import { encrypt, decrypt, isEncrypted } from '../utils/crypto';
import { logger } from '../lib/logger';
import {
  deleteApiKeyRow, findPreferences, findUserByEmail, findUserById, listApiKeyRows, readDefaultDeviceId,
  upsertApiKeyRow, upsertPreferenceRow, upsertUserRow, writeDefaultDeviceId,
} from '../db/repositories/accounts';
import {
  findActiveFirmware, findFirmwareById, findFirmwareByVersion, insertApiUsage, insertDevice, insertFirmware,
  listDeviceRows, listFirmwareRows, removeDevice, renameDevice,
} from '../db/repositories/devices';

/**
 * Persistence facade used by the routes. SQL lives in db/repositories; this module
 * keeps what is not SQL: encryption of provider keys and merging device telemetry.
 * Every function that touches user data takes the user's id and filters on it.
 */

export async function getUserByEmail(email: string): Promise<User | null> {
  return findUserByEmail(email);
}

export async function getUserById(id: string): Promise<User | null> {
  return findUserById(id);
}

export async function upsertUser(email: string, displayName?: string): Promise<User> {
  return upsertUserRow(email, displayName ?? null);
}

export async function getPreferences(userId: string): Promise<UserPreferences | null> {
  return findPreferences(userId);
}

export async function upsertPreferences(
  userId: string,
  prefs: Partial<UserPreferences>
): Promise<UserPreferences> {
  return upsertPreferenceRow(userId, prefs);
}

export async function getApiKeys(userId: string): Promise<ApiKey[]> {
  const rows = await listApiKeyRows(userId);
  return rows.map((row) => {
    if (isEncrypted(row.api_key)) {
      return { ...row, api_key: decrypt(row.api_key) } as ApiKey;
    }
    // Legacy plaintext row — return as-is until migrated
    logger.warn({ rowId: row.id, provider: row.provider }, 'api_keys row is not encrypted — run the migration script');
    return row as ApiKey;
  });
}

export async function upsertApiKey(
  userId: string,
  provider: string,
  apiKey: string
): Promise<ApiKey> {
  const row = await upsertApiKeyRow(userId, provider, encrypt(apiKey));
  // Return with decrypted key so callers work with the plaintext value
  return { ...row, api_key: apiKey } as ApiKey;
}

export async function deleteApiKey(userId: string, provider: string): Promise<void> {
  await deleteApiKeyRow(userId, provider);
}

export async function getDevices(userId: string): Promise<Device[]> {
  const rows = await listDeviceRows(userId);
  return rows.map((row) => {
    const { delivery_owner_id, delivery_last_seen_at, delivery_firmware_version, ...device } = row;
    // Reassignment must not carry a previous owner's delivery reports across.
    const reportOwned = delivery_owner_id === userId;
    const legacySeen = device.last_seen_at ? Date.parse(device.last_seen_at) : NaN;
    const reportSeen = reportOwned && delivery_last_seen_at ? Date.parse(delivery_last_seen_at) : NaN;
    const hasLegacyReport = Number.isFinite(legacySeen);
    const useDelivery = Number.isFinite(reportSeen) && (!hasLegacyReport || reportSeen >= legacySeen);
    return {
      ...device,
      last_seen_at: useDelivery ? delivery_last_seen_at : hasLegacyReport ? device.last_seen_at : null,
      // Old registrations defaulted to 1.0.0 before any device had connected.
      // Keep real legacy reports, but never present that default as telemetry.
      firmware_version: useDelivery ? delivery_firmware_version : hasLegacyReport ? device.firmware_version : null,
    } as Device;
  });
}

export async function createDevice(
  userId: string,
  deviceId: string,
  deviceName: string,
  bleName: string | null
): Promise<Device> {
  return insertDevice(userId, deviceId, deviceName, bleName);
}

/** Renames a device the user owns; any other id is a 404. */
export async function updateDeviceName(
  id: string,
  userId: string,
  deviceName: string
): Promise<Device> {
  return renameDevice(id, userId, deviceName);
}

/** The user's default dashboard device, or null when unset. Ownership is checked by the caller. */
export async function getDefaultDeviceId(userId: string): Promise<string | null> {
  return readDefaultDeviceId(userId);
}

/** Sets or clears the default dashboard device. Returns false when the device is not the user's. */
export async function setDefaultDeviceId(userId: string, deviceId: string | null): Promise<boolean> {
  return writeDefaultDeviceId(userId, deviceId);
}

export async function deleteDevice(id: string, userId: string): Promise<void> {
  await removeDevice(id, userId);
}

export async function getLatestFirmwareVersion(userId: string): Promise<FirmwareVersion | null> {
  return findActiveFirmware(userId);
}

export async function getFirmwareVersions(userId: string): Promise<FirmwareVersion[]> {
  return listFirmwareRows(userId);
}

export async function getFirmwareVersionByUserAndVersion(
  userId: string,
  version: string
): Promise<FirmwareVersion | null> {
  return findFirmwareByVersion(userId, version);
}

export async function getFirmwareVersionById(
  userId: string,
  id: string
): Promise<FirmwareVersion | null> {
  return findFirmwareById(userId, id);
}

export async function createFirmwareVersion(
  userId: string,
  version: string,
  downloadPath: string,
  checksum: string | null,
  releaseNotes: string | null,
  active = true
): Promise<FirmwareVersion> {
  return insertFirmware(userId, version, downloadPath, checksum, releaseNotes, active);
}

/** Fire-and-forget: a logging failure must never break the request. */
export function logApiUsage(userId: string, endpoint: string): void {
  insertApiUsage(userId, endpoint).catch((error: unknown) => {
    logger.error({ message: error instanceof Error ? error.message : 'unknown' }, 'Failed to log API usage');
  });
}
