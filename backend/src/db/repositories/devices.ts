/** Devices, firmware versions and API usage rows. Every device query carries the owner's id. */
import type { Device, FirmwareVersion } from '../../types/index';
import { DeviceNotFound, isUuid } from '../errors';
import { query, type Queryable } from '../pool';

const pool: Queryable = { query };

/** A device row plus the telemetry its delivery record reported. Credential hashes are never selected. */
export interface DeviceWithDelivery extends Device {
  delivery_owner_id: string | null;
  delivery_last_seen_at: string | null;
  delivery_firmware_version: string | null;
}

export async function listDeviceRows(userId: string, db: Queryable = pool): Promise<DeviceWithDelivery[]> {
  if (!isUuid(userId)) return [];
  const { rows } = await db.query<DeviceWithDelivery>(
    `SELECT d.*,
            dd.owner_id        AS delivery_owner_id,
            dd.last_seen_at    AS delivery_last_seen_at,
            dd.firmware_version AS delivery_firmware_version
       FROM devices d
       LEFT JOIN device_delivery dd ON dd.device_id = d.id
      WHERE d.user_id = $1
      ORDER BY d.created_at ASC, d.id ASC`,
    [userId],
  );
  return rows;
}

export async function insertDevice(userId: string, hardwareId: string, name: string, bleName: string | null, db: Queryable = pool): Promise<Device> {
  const { rows } = await db.query<Device>(
    `INSERT INTO devices (user_id, device_id, device_name, ble_name, firmware_version)
     VALUES ($1, $2, $3, $4, NULL)
     RETURNING *`,
    [userId, hardwareId, name, bleName],
  );
  return rows[0];
}

/** Renames a device the user owns. Someone else's device and a missing one are both "not found". */
export async function renameDevice(id: string, userId: string, name: string, db: Queryable = pool): Promise<Device> {
  if (!isUuid(id) || !isUuid(userId)) throw new DeviceNotFound('Device not found');
  const { rows } = await db.query<Device>(
    'UPDATE devices SET device_name = $3 WHERE id = $1 AND user_id = $2 RETURNING *',
    [id, userId, name],
  );
  if (!rows[0]) throw new DeviceNotFound('Device not found');
  return rows[0];
}

/** Deleting a device that is absent or not yours is a no-op, as before. */
export async function removeDevice(id: string, userId: string, db: Queryable = pool): Promise<void> {
  if (!isUuid(id) || !isUuid(userId)) return;
  await db.query('DELETE FROM devices WHERE id = $1 AND user_id = $2', [id, userId]);
}

// ------------------------------------------------------------- firmware

export async function findActiveFirmware(userId: string, db: Queryable = pool): Promise<FirmwareVersion | null> {
  if (!isUuid(userId)) return null;
  const { rows } = await db.query<FirmwareVersion>(
    'SELECT * FROM firmware_versions WHERE user_id = $1 AND active = true ORDER BY created_at DESC LIMIT 1',
    [userId],
  );
  return rows[0] ?? null;
}

export async function listFirmwareRows(userId: string, db: Queryable = pool): Promise<FirmwareVersion[]> {
  if (!isUuid(userId)) return [];
  const { rows } = await db.query<FirmwareVersion>(
    'SELECT * FROM firmware_versions WHERE user_id = $1 ORDER BY created_at DESC',
    [userId],
  );
  return rows;
}

export async function findFirmwareByVersion(userId: string, version: string, db: Queryable = pool): Promise<FirmwareVersion | null> {
  if (!isUuid(userId)) return null;
  const { rows } = await db.query<FirmwareVersion>(
    'SELECT * FROM firmware_versions WHERE user_id = $1 AND version = $2 ORDER BY created_at DESC LIMIT 1',
    [userId, version],
  );
  return rows[0] ?? null;
}

export async function findFirmwareById(userId: string, id: string, db: Queryable = pool): Promise<FirmwareVersion | null> {
  if (!isUuid(userId) || !isUuid(id)) return null;
  const { rows } = await db.query<FirmwareVersion>(
    'SELECT * FROM firmware_versions WHERE user_id = $1 AND id = $2 LIMIT 1',
    [userId, id],
  );
  return rows[0] ?? null;
}

export async function insertFirmware(
  userId: string, version: string, downloadPath: string, checksum: string | null, releaseNotes: string | null, active: boolean,
  db: Queryable = pool,
): Promise<FirmwareVersion> {
  const { rows } = await db.query<FirmwareVersion>(
    `INSERT INTO firmware_versions (user_id, version, download_path, checksum, release_notes, active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [userId, version, downloadPath, checksum, releaseNotes, active],
  );
  return rows[0];
}

// ------------------------------------------------------------ api usage

export async function insertApiUsage(userId: string, endpoint: string, db: Queryable = pool): Promise<void> {
  await db.query('INSERT INTO api_usage (user_id, endpoint, called_at) VALUES ($1, $2, now())', [userId, endpoint]);
}
