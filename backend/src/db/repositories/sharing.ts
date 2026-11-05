/**
 * Connections, device shares and shared items. SQL only: who may do what is decided
 * in services/sharing.ts, which calls these functions with the verified caller id.
 */
import type { SharedItemKind } from '../../utils/sharedItems';
import { isUuid } from '../errors';
import { query, type Queryable } from '../pool';

const pool: Queryable = { query };

export interface UserRow { id: string; email: string; display_name: string | null }
export interface ConnectionRow { id: string; requester_id: string; addressee_id: string; status: 'pending' | 'accepted'; created_at: string }
export interface ShareRow { device_id: string; owner_id: string; collaborator_id: string; role: 'viewer' | 'editor'; created_at: string }
export interface ItemRow {
  id: string; sender_id: string; recipient_id: string; kind: SharedItemKind; name: string;
  payload: unknown; status: string; created_at: string;
}

// ---------------------------------------------------------------- users

export async function selectPublicUsers(ids: string[], db: Queryable = pool): Promise<UserRow[]> {
  const valid = [...new Set(ids)].filter(isUuid);
  if (valid.length === 0) return [];
  const { rows } = await db.query<UserRow>('SELECT id, email, display_name FROM users WHERE id = ANY($1::uuid[])', [valid]);
  return rows;
}

/** Case-insensitive exact match. The address is bound, so no pattern characters are involved. */
export async function selectUserIdByEmail(email: string, db: Queryable = pool): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM users WHERE lower(email) = lower($1) ORDER BY created_at LIMIT 1',
    [email],
  );
  return rows[0]?.id ?? null;
}

// ---------------------------------------------------------- connections

export async function selectConnectionBetween(a: string, b: string, db: Queryable = pool): Promise<ConnectionRow | null> {
  if (!isUuid(a) || !isUuid(b)) return null;
  const { rows } = await db.query<ConnectionRow>(
    `SELECT * FROM user_connections
      WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)
      LIMIT 1`,
    [a, b],
  );
  return rows[0] ?? null;
}

/**
 * Proves the two users are connected and keeps that true until the transaction ends:
 * ending a connection deletes the row first, so it waits for this lock, and a share
 * written under the lock is then removed by that same ending. Call inside a transaction.
 */
export async function lockAcceptedConnection(a: string, b: string, db: Queryable): Promise<boolean> {
  if (!isUuid(a) || !isUuid(b)) return false;
  const { rowCount } = await db.query(
    `SELECT 1 FROM user_connections
      WHERE status = 'accepted'
        AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
        FOR SHARE`,
    [a, b],
  );
  return (rowCount ?? 0) > 0;
}

export async function selectConnectionsOf(me: string, db: Queryable = pool): Promise<ConnectionRow[]> {
  const { rows } = await db.query<ConnectionRow>(
    'SELECT * FROM user_connections WHERE requester_id = $1 OR addressee_id = $1 ORDER BY created_at DESC',
    [me],
  );
  return rows;
}

/** A concurrent request from the other side hits the unique pair index and is ignored. */
export async function insertConnection(requester: string, addressee: string, db: Queryable = pool): Promise<void> {
  await db.query(
    'INSERT INTO user_connections (requester_id, addressee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [requester, addressee],
  );
}

/** Accepts a pending request addressed to `me`. Returns false if there is none. */
export async function acceptPendingConnection(me: string, id: string, db: Queryable = pool): Promise<boolean> {
  if (!isUuid(id)) return false;
  const { rowCount } = await db.query(
    `UPDATE user_connections SET status = 'accepted', responded_at = now()
      WHERE id = $1 AND addressee_id = $2 AND status = 'pending'`,
    [id, me],
  );
  return (rowCount ?? 0) > 0;
}

export async function selectConnectionOfMember(id: string, me: string, db: Queryable = pool): Promise<ConnectionRow | null> {
  if (!isUuid(id)) return null;
  const { rows } = await db.query<ConnectionRow>(
    'SELECT * FROM user_connections WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2)',
    [id, me],
  );
  return rows[0] ?? null;
}

export async function deleteConnectionRow(id: string, db: Queryable = pool): Promise<void> {
  await db.query('DELETE FROM user_connections WHERE id = $1', [id]);
}

export async function deleteSharesBetween(a: string, b: string, db: Queryable = pool): Promise<void> {
  await db.query(
    `DELETE FROM device_shares
      WHERE (owner_id = $1 AND collaborator_id = $2) OR (owner_id = $2 AND collaborator_id = $1)`,
    [a, b],
  );
}

export async function deletePendingItemsBetween(a: string, b: string, db: Queryable = pool): Promise<void> {
  await db.query(
    `DELETE FROM shared_items
      WHERE status = 'pending'
        AND ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))`,
    [a, b],
  );
}

// -------------------------------------------------------- device shares

export async function selectDeviceOwner(deviceId: string, db: Queryable = pool): Promise<string | null> {
  if (!isUuid(deviceId)) return null;
  const { rows } = await db.query<{ user_id: string }>('SELECT user_id FROM devices WHERE id = $1', [deviceId]);
  return rows[0]?.user_id ?? null;
}

/** The collaborator's role, only if the share was granted by the device's current owner. */
export async function selectShareRole(deviceId: string, collaborator: string, deviceOwner: string, db: Queryable = pool): Promise<ShareRow['role'] | null> {
  if (!isUuid(deviceId) || !isUuid(collaborator) || !isUuid(deviceOwner)) return null;
  const { rows } = await db.query<{ role: ShareRow['role'] }>(
    'SELECT role FROM device_shares WHERE device_id = $1 AND collaborator_id = $2 AND owner_id = $3',
    [deviceId, collaborator, deviceOwner],
  );
  return rows[0]?.role ?? null;
}

export async function selectSharesOfDevice(deviceId: string, owner: string, db: Queryable = pool): Promise<ShareRow[]> {
  const { rows } = await db.query<ShareRow>(
    'SELECT * FROM device_shares WHERE device_id = $1 AND owner_id = $2 ORDER BY created_at',
    [deviceId, owner],
  );
  return rows;
}

export async function upsertShare(deviceId: string, owner: string, collaborator: string, role: ShareRow['role'], db: Queryable = pool): Promise<void> {
  await db.query(
    `INSERT INTO device_shares (device_id, owner_id, collaborator_id, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (device_id, collaborator_id) DO UPDATE SET owner_id = EXCLUDED.owner_id, role = EXCLUDED.role`,
    [deviceId, owner, collaborator, role],
  );
}

export async function deleteShare(deviceId: string, collaborator: string, db: Queryable = pool): Promise<number> {
  if (!isUuid(deviceId) || !isUuid(collaborator)) return 0;
  const { rowCount } = await db.query('DELETE FROM device_shares WHERE device_id = $1 AND collaborator_id = $2', [deviceId, collaborator]);
  return rowCount ?? 0;
}

/** Name and role only: never the license key or hardware ids of another user's device. */
export async function selectDevicesSharedWith(me: string, db: Queryable = pool): Promise<Array<{ id: string; device_name: string; role: ShareRow['role']; owner_id: string }>> {
  const { rows } = await db.query<{ id: string; device_name: string; role: ShareRow['role']; owner_id: string }>(
    `SELECT d.id, d.device_name, s.role, s.owner_id
       FROM device_shares s
       JOIN devices d ON d.id = s.device_id AND d.user_id = s.owner_id
      WHERE s.collaborator_id = $1
      ORDER BY s.created_at`,
    [me],
  );
  return rows;
}

// --------------------------------------------------------- shared items

export async function countPendingItems(sender: string, recipient: string, db: Queryable = pool): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM shared_items WHERE sender_id = $1 AND recipient_id = $2 AND status = 'pending'`,
    [sender, recipient],
  );
  return rows[0]?.count ?? 0;
}

export async function insertItem(sender: string, recipient: string, kind: SharedItemKind, name: string, payload: unknown, db: Queryable = pool): Promise<ItemRow> {
  const { rows } = await db.query<ItemRow>(
    `INSERT INTO shared_items (sender_id, recipient_id, kind, name, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [sender, recipient, kind, name, JSON.stringify(payload)],
  );
  return rows[0];
}

export async function selectItems(me: string, box: 'inbox' | 'sent', db: Queryable = pool): Promise<ItemRow[]> {
  // The column is chosen from a closed pair of literals, never from input.
  const column = box === 'inbox' ? 'recipient_id' : 'sender_id';
  const pendingOnly = box === 'inbox' ? `AND status = 'pending'` : '';
  const { rows } = await db.query<ItemRow>(
    `SELECT * FROM shared_items WHERE ${column} = $1 ${pendingOnly} ORDER BY created_at DESC LIMIT 50`,
    [me],
  );
  return rows;
}

/** A pending item addressed to `me`. With `lock`, held until the transaction ends so it can be answered once. */
export async function selectPendingItemForRecipient(id: string, me: string, db: Queryable = pool, lock = false): Promise<ItemRow | null> {
  if (!isUuid(id)) return null;
  const { rows } = await db.query<ItemRow>(
    `SELECT * FROM shared_items WHERE id = $1 AND recipient_id = $2 AND status = 'pending' ${lock ? 'FOR UPDATE' : ''}`,
    [id, me],
  );
  return rows[0] ?? null;
}

export async function markItemAccepted(id: string, db: Queryable = pool): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE shared_items SET status = 'accepted', responded_at = now() WHERE id = $1 AND status = 'pending'`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

export async function selectItemOfMember(id: string, me: string, db: Queryable = pool): Promise<ItemRow | null> {
  if (!isUuid(id)) return null;
  const { rows } = await db.query<ItemRow>(
    'SELECT * FROM shared_items WHERE id = $1 AND (recipient_id = $2 OR sender_id = $2)',
    [id, me],
  );
  return rows[0] ?? null;
}

export async function markItemDeclined(id: string, db: Queryable = pool): Promise<void> {
  await db.query(`UPDATE shared_items SET status = 'declined', responded_at = now() WHERE id = $1 AND status = 'pending'`, [id]);
}

export async function deletePendingItem(id: string, db: Queryable = pool): Promise<void> {
  await db.query(`DELETE FROM shared_items WHERE id = $1 AND status = 'pending'`, [id]);
}
