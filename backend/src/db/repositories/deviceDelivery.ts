/**
 * Device tokens, refresh requests and telemetry (table device_delivery).
 *
 * Every statement is scoped by both the device id and its owner, and credential
 * lookups additionally by token hash, so a stale or foreign id matches nothing.
 */
import { isUuid } from '../errors';
import { query, type Queryable } from '../pool';

const pool: Queryable = { query };

export interface DeliveryRow {
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

export interface TelemetryUpdate {
  firmware_version?: string;
  battery_percent?: number;
  rssi?: number;
  last_applied_hash?: string | null;
}
/** Names are interpolated into SQL, so only these may ever be used. */
const TELEMETRY_COLUMNS = ['firmware_version', 'battery_percent', 'rssi', 'last_applied_hash'] as const;

export async function isDeviceOwnedBy(owner: string, deviceId: string, db: Queryable = pool): Promise<boolean> {
  if (!isUuid(owner) || !isUuid(deviceId)) return false;
  const { rowCount } = await db.query('SELECT 1 FROM devices WHERE id = $1 AND user_id = $2', [deviceId, owner]);
  return (rowCount ?? 0) > 0;
}

export async function findDelivery(deviceId: string, db: Queryable = pool): Promise<DeliveryRow | null> {
  if (!isUuid(deviceId)) return null;
  const { rows } = await db.query<DeliveryRow>('SELECT * FROM device_delivery WHERE device_id = $1', [deviceId]);
  return rows[0] ?? null;
}

export async function findOwnedDelivery(owner: string, deviceId: string, db: Queryable = pool): Promise<DeliveryRow | null> {
  if (!isUuid(owner) || !isUuid(deviceId)) return null;
  const { rows } = await db.query<DeliveryRow>('SELECT * FROM device_delivery WHERE device_id = $1 AND owner_id = $2', [deviceId, owner]);
  return rows[0] ?? null;
}

/**
 * Creates or replaces the device's credential and clears its telemetry. The row is
 * written only if `owner` owns the device in this very statement; returns false otherwise.
 * `instant_updates` is left as it was. Without the refresh columns (migration 019 missing)
 * pass `includeRefresh: false`.
 */
export async function upsertDeliveryToken(owner: string, deviceId: string, hash: string, includeRefresh: boolean, db: Queryable = pool): Promise<boolean> {
  if (!isUuid(owner) || !isUuid(deviceId)) return false;
  const refreshColumns = includeRefresh ? ', refresh_request_id, refresh_requested_at, refresh_applied_at' : '';
  const refreshValues = includeRefresh ? ', NULL, NULL, NULL' : '';
  const refreshReset = includeRefresh
    ? ', refresh_request_id = NULL, refresh_requested_at = NULL, refresh_applied_at = NULL'
    : '';
  const { rowCount } = await db.query(
    `INSERT INTO device_delivery
       (device_id, owner_id, token_hash, rotated_at, revoked_at, last_seen_at, firmware_version,
        battery_percent, rssi, last_applied_hash${refreshColumns})
     SELECT d.id, d.user_id, $3::text, now(), NULL, NULL, NULL, NULL, NULL, NULL${refreshValues}
       FROM devices d
      WHERE d.id = $1 AND d.user_id = $2
     ON CONFLICT (device_id) DO UPDATE SET
       owner_id = EXCLUDED.owner_id, token_hash = EXCLUDED.token_hash, rotated_at = EXCLUDED.rotated_at,
       revoked_at = NULL, last_seen_at = NULL, firmware_version = NULL, battery_percent = NULL,
       rssi = NULL, last_applied_hash = NULL${refreshReset}`,
    [deviceId, owner, hash],
  );
  return (rowCount ?? 0) > 0;
}

export async function revokeDelivery(owner: string, deviceId: string, includeRefresh: boolean, db: Queryable = pool): Promise<void> {
  if (!isUuid(owner) || !isUuid(deviceId)) return;
  const refreshReset = includeRefresh
    ? ', refresh_request_id = NULL, refresh_requested_at = NULL, refresh_applied_at = NULL'
    : '';
  await db.query(
    `UPDATE device_delivery SET token_hash = NULL, revoked_at = now()${refreshReset}
      WHERE device_id = $1 AND owner_id = $2`,
    [deviceId, owner],
  );
}

/**
 * Compare-and-swap on the credential the caller just read: a token rotated or revoked
 * in between makes this match nothing (null). Needs migration 019.
 */
export async function setRefreshRequest(owner: string, deviceId: string, requestId: string, expectedTokenHash: string, db: Queryable = pool): Promise<DeliveryRow | null> {
  const { rows } = await db.query<DeliveryRow>(
    `UPDATE device_delivery
        SET refresh_request_id = $3::uuid, refresh_requested_at = now(), refresh_applied_at = NULL
      WHERE device_id = $1 AND owner_id = $2 AND token_hash = $4 AND revoked_at IS NULL
      RETURNING *`,
    [deviceId, owner, requestId, expectedTokenHash],
  );
  return rows[0] ?? null;
}

/** Needs migration 020. Only an active credential can opt in. */
export async function setInstantUpdatesFlag(owner: string, deviceId: string, enabled: boolean, db: Queryable = pool): Promise<DeliveryRow | null> {
  if (!isUuid(owner) || !isUuid(deviceId)) return null;
  const { rows } = await db.query<DeliveryRow>(
    `UPDATE device_delivery SET instant_updates = $3
      WHERE device_id = $1 AND owner_id = $2 AND token_hash IS NOT NULL AND revoked_at IS NULL
      RETURNING *`,
    [deviceId, owner, enabled],
  );
  return rows[0] ?? null;
}

/** SELECT * so installations without migrations 019/020 still read: absent columns are simply undefined. */
export async function findActiveDelivery(owner: string, deviceId: string, credentialHash: string, db: Queryable = pool): Promise<DeliveryRow | null> {
  if (!isUuid(owner) || !isUuid(deviceId)) return null;
  const { rows } = await db.query<DeliveryRow>(
    `SELECT * FROM device_delivery
      WHERE device_id = $1 AND owner_id = $2 AND token_hash = $3 AND revoked_at IS NULL`,
    [deviceId, owner, credentialHash],
  );
  return rows[0] ?? null;
}

/**
 * The device-token check: the credential must match, not be revoked, and the device must
 * still belong to the owner it was issued to. Returns that owner's id, or null.
 */
export async function findOwnerByDeviceToken(deviceId: string, credentialHash: string, db: Queryable = pool): Promise<string | null> {
  if (!isUuid(deviceId)) return null;
  const { rows } = await db.query<{ owner_id: string }>(
    `SELECT dd.owner_id
       FROM device_delivery dd
       JOIN devices d ON d.id = dd.device_id AND d.user_id = dd.owner_id
      WHERE dd.device_id = $1 AND dd.token_hash = $2 AND dd.revoked_at IS NULL`,
    [deviceId, credentialHash],
  );
  return rows[0]?.owner_id ?? null;
}

/** Only the fields present are written (null clears). Returns whether an active credential matched. */
export async function updateTelemetry(owner: string, deviceId: string, credentialHash: string, telemetry: TelemetryUpdate, db: Queryable = pool): Promise<boolean> {
  const present = TELEMETRY_COLUMNS.filter((column) => telemetry[column] !== undefined);
  const assignments = present.map((column, index) => `${column} = $${index + 4}`);
  const { rowCount } = await db.query(
    `UPDATE device_delivery SET ${[...assignments, 'last_seen_at = now()'].join(', ')}
      WHERE device_id = $1 AND owner_id = $2 AND token_hash = $3 AND revoked_at IS NULL`,
    [deviceId, owner, credentialHash, ...present.map((column) => telemetry[column])],
  );
  return (rowCount ?? 0) > 0;
}

/** Marks the pending request as applied, once. Needs migration 019. */
export async function acknowledgeRefresh(owner: string, deviceId: string, credentialHash: string, requestId: string, db: Queryable = pool): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE device_delivery SET refresh_applied_at = now()
      WHERE device_id = $1 AND owner_id = $2 AND token_hash = $3 AND revoked_at IS NULL
        AND refresh_request_id = $4::uuid AND refresh_applied_at IS NULL`,
    [deviceId, owner, credentialHash, requestId],
  );
  return (rowCount ?? 0) > 0;
}

export async function findReportedBatteryPercent(owner: string, deviceId: string, db: Queryable = pool): Promise<number | null> {
  if (!isUuid(owner) || !isUuid(deviceId)) return null;
  const { rows } = await db.query<{ battery_percent: number | null }>(
    'SELECT battery_percent FROM device_delivery WHERE device_id = $1 AND owner_id = $2',
    [deviceId, owner],
  );
  return rows[0]?.battery_percent ?? null;
}
