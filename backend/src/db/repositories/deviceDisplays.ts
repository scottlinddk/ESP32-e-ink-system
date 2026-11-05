/** Per-device presentation settings (table device_displays), saved with optimistic concurrency. */
import { isUuid } from '../errors';
import { query, type Queryable } from '../pool';

const pool: Queryable = { query };

export interface DeviceDisplayRow {
  device_id: string;
  owner_id: string;
  layout: unknown;
  display_schedule: unknown;
  active_layout_id: string | null;
  display_profile: unknown;
  display_timezone: string;
  display_language?: string;
  refresh_interval_minutes: number;
  revision: number;
  updated_at: string;
}

/** Names are interpolated into SQL, so only these may ever be used. */
const WRITABLE_COLUMNS = new Set([
  'layout', 'display_schedule', 'active_layout_id', 'display_profile', 'display_timezone',
  'display_language', 'refresh_interval_minutes',
]);
const JSON_COLUMNS = new Set(['layout', 'display_schedule', 'display_profile']);

export async function findDeviceDisplay(deviceId: string, db: Queryable = pool): Promise<DeviceDisplayRow | null> {
  if (!isUuid(deviceId)) return null;
  const { rows } = await db.query<DeviceDisplayRow>('SELECT * FROM device_displays WHERE device_id = $1', [deviceId]);
  return rows[0] ?? null;
}

function bind(values: Record<string, unknown>) {
  const entries = Object.entries(values).filter(([key, value]) => value !== undefined && WRITABLE_COLUMNS.has(key));
  return {
    columns: entries.map(([key]) => key),
    params: entries.map(([key, value]) => (JSON_COLUMNS.has(key) && value !== null ? JSON.stringify(value) : value)),
  };
}

/**
 * Updates the row only if it still has the revision the caller read and the owner
 * it was read with. Returns null when another writer got there first.
 */
export async function updateDeviceDisplay(
  deviceId: string, expectedOwner: string, expectedRevision: number, newOwner: string, nextRevision: number,
  values: Record<string, unknown>, db: Queryable = pool,
): Promise<DeviceDisplayRow | null> {
  const { columns, params } = bind(values);
  const assignments = columns.map((column, index) => `"${column}" = $${index + 6}`);
  const { rows } = await db.query<DeviceDisplayRow>(
    `UPDATE device_displays
        SET ${[...assignments, 'owner_id = $4', 'revision = $5', 'updated_at = now()'].join(', ')}
      WHERE device_id = $1 AND owner_id = $2 AND revision = $3
      RETURNING *`,
    [deviceId, expectedOwner, expectedRevision, newOwner, nextRevision, ...params],
  );
  return rows[0] ?? null;
}

/**
 * Inserts the first row for a device. The composite foreign key (device_id, owner_id)
 * -> devices(id, user_id) makes the database reject an owner that does not own the device
 * (23503), and a concurrent first save fails on the primary key (23505).
 */
export async function insertDeviceDisplay(
  deviceId: string, owner: string, revision: number, values: Record<string, unknown>, db: Queryable = pool,
): Promise<DeviceDisplayRow> {
  const { columns, params } = bind(values);
  const names = ['device_id', 'owner_id', 'revision', ...columns, 'updated_at'];
  const placeholders = [...['device_id', 'owner_id', 'revision', ...columns].map((_, index) => `$${index + 1}`), 'now()'];
  const { rows } = await db.query<DeviceDisplayRow>(
    `INSERT INTO device_displays (${names.map((name) => `"${name}"`).join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    [deviceId, owner, revision, ...params],
  );
  return rows[0];
}
