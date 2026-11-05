import type { UserPreferences } from '../types';
import { DeviceNotFound } from './deviceDelivery';
import { DEFAULT_PREFS } from './displayData';
import { DEVICE_PRESENTATION_KEYS, getDeviceDisplay, saveDeviceDisplay } from './deviceDisplays';
import { createError } from '../middleware/errorHandler';
import { isMissingTable, isUuid, pgCode } from '../db/errors';
import { withTransaction, type Queryable } from '../db/pool';
import {
  acceptPendingConnection, countPendingItems, deleteConnectionRow, deletePendingItem, deletePendingItemsBetween, deleteShare,
  deleteSharesBetween, insertConnection, insertItem, lockAcceptedConnection, markItemAccepted, markItemDeclined,
  selectConnectionBetween, selectConnectionOfMember, selectConnectionsOf, selectDeviceOwner, selectDevicesSharedWith,
  selectItemOfMember, selectItems, selectPendingItemForRecipient, selectPublicUsers, selectShareRole, selectSharesOfDevice,
  selectUserIdByEmail, upsertShare, type ConnectionRow, type ItemRow,
} from '../db/repositories/sharing';
import {
  buildAcceptUpdates, parsePayload, portableLayout, portableWidget, SHARED_PAYLOAD_MAX_BYTES, SharedItemError, summarize,
  type DashboardPayload, type SharedItemKind, type SharedPayload,
} from '../utils/sharedItems';

export type ShareRole = 'viewer' | 'editor';
export type DeviceRole = 'owner' | ShareRole;
export interface DeviceAccess { ownerId: string; role: DeviceRole }
export interface PublicUser { id: string; email: string; display_name: string | null }

const RANK: Record<DeviceRole, number> = { viewer: 1, editor: 2, owner: 3 };
const MAX_PENDING_PER_PAIR = 20;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

export function parseUuid(value: unknown, name: string): string {
  if (!isUuid(value)) throw createError(`${name} must be a UUID.`, 400);
  return value;
}

// ---------------------------------------------------------------- users

async function publicUsers(ids: string[]): Promise<Map<string, PublicUser>> {
  const rows = await selectPublicUsers(ids);
  return new Map(rows.map((row) => [row.id, { id: row.id, email: row.email, display_name: row.display_name }]));
}
const unknownUser = (id: string): PublicUser => ({ id, email: '', display_name: null });

// ---------------------------------------------------------- connections

export interface Connection {
  id: string;
  status: 'connected' | 'incoming' | 'outgoing';
  user: PublicUser;
  created_at: string;
}

export async function areConnected(a: string, b: string): Promise<boolean> {
  return (await selectConnectionBetween(a, b))?.status === 'accepted';
}

export async function listConnections(me: string): Promise<Connection[]> {
  let rows: ConnectionRow[];
  try { rows = await selectConnectionsOf(me); }
  catch (error) { if (isMissingTable(error)) return []; throw error; }
  const users = await publicUsers(rows.map((row) => (row.requester_id === me ? row.addressee_id : row.requester_id)));
  return rows.map((row) => {
    const other = row.requester_id === me ? row.addressee_id : row.requester_id;
    return {
      id: row.id, created_at: row.created_at, user: users.get(other) ?? unknownUser(other),
      status: row.status === 'accepted' ? 'connected' : row.requester_id === me ? 'outgoing' : 'incoming',
    };
  });
}

/**
 * The answer never reveals whether an address has an account (no enumeration):
 * an unknown address, an existing request and a new request all look the same.
 */
export async function requestConnection(me: string, rawEmail: unknown): Promise<void> {
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  if (!EMAIL.test(email)) throw createError('Enter a valid email address.', 400);
  const other = await selectUserIdByEmail(email);
  if (other === me) throw createError('You cannot connect to yourself.', 400);
  if (!other) return;
  const existing = await selectConnectionBetween(me, other);
  if (existing) {
    // They already asked me: asking back is the same as accepting.
    if (existing.status === 'pending' && existing.addressee_id === me) await acceptPendingConnection(me, existing.id);
    return;
  }
  // A concurrent request from the other side wins; that is also a success.
  await insertConnection(me, other);
}

export async function acceptConnection(me: string, id: string): Promise<void> {
  if (!(await acceptPendingConnection(me, id))) throw createError('Request not found.', 404);
}

/**
 * Decline, cancel or disconnect. Ending a connection also ends every device share between the two.
 * One transaction: a half-finished disconnect would leave shares alive without a connection.
 */
export async function removeConnection(me: string, id: string): Promise<void> {
  const row = await selectConnectionOfMember(id, me);
  if (!row) throw createError('Connection not found.', 404);
  const other = row.requester_id === me ? row.addressee_id : row.requester_id;
  await withTransaction(async (tx) => {
    // The connection row goes first: it is what concurrent sharing locks (see lockAcceptedConnection).
    await deleteConnectionRow(id, tx);
    await deleteSharesBetween(me, other, tx);
    await deletePendingItemsBetween(me, other, tx);
  });
}

// -------------------------------------------------------- device shares

/** Who may do what with this device. Anything else is "not found", never "forbidden". */
export async function resolveDeviceAccess(userId: string, deviceId: string, minimum: DeviceRole = 'viewer', db?: Queryable): Promise<DeviceAccess> {
  const ownerId = await selectDeviceOwner(deviceId, db);
  if (!ownerId) throw new DeviceNotFound('Device not found');
  let access: DeviceAccess | null = ownerId === userId ? { ownerId: userId, role: 'owner' } : null;
  if (!access) {
    let role: ShareRole | null = null;
    // A rolling deployment may serve requests before migration 027 is applied.
    try { role = await selectShareRole(deviceId, userId, ownerId, db); }
    catch (error) { if (!isMissingTable(error)) throw error; }
    // A share only counts while the person who granted it still owns the device.
    if (role) access = { ownerId, role };
  }
  if (!access) throw new DeviceNotFound('Device not found');
  // Visible to the user but not allowed to do this: say so, there is nothing to hide.
  if (RANK[access.role] < RANK[minimum]) throw createError(minimum === 'owner' ? 'Only the device owner can do this.' : 'You have view-only access to this device.', 403);
  return access;
}

/** The owner's integration choices, locations and notes stay private: a collaborator gets presentation only. */
const COLLABORATOR_KEYS = [
  ...DEVICE_PRESENTATION_KEYS,
  'show_energy_price', 'show_weather', 'show_news', 'show_air_quality', 'show_monta', 'show_zaptec', 'show_notion',
  'show_custom_text', 'show_custom_image', 'show_calendar', 'show_custom_webhook', 'show_ai_usage',
  'news_feeds', 'ticker_widgets', 'calendar_widgets',
] as const;
export function redactForCollaborator(preferences: UserPreferences): UserPreferences {
  const visible = Object.fromEntries(COLLABORATOR_KEYS.filter((key) => key in preferences).map((key) => [key, preferences[key as keyof UserPreferences]]));
  return { ...DEFAULT_PREFS, ...visible } as UserPreferences;
}

export interface DeviceShare { collaborator: PublicUser; role: ShareRole; created_at: string }

export async function listDeviceShares(owner: string, deviceId: string): Promise<DeviceShare[]> {
  await resolveDeviceAccess(owner, deviceId, 'owner');
  let rows;
  try { rows = await selectSharesOfDevice(deviceId, owner); }
  catch (error) { if (isMissingTable(error)) return []; throw error; }
  const users = await publicUsers(rows.map((row) => row.collaborator_id));
  return rows.map((row) => ({ collaborator: users.get(row.collaborator_id) ?? unknownUser(row.collaborator_id), role: row.role, created_at: row.created_at }));
}

export async function shareDevice(owner: string, deviceId: string, collaboratorId: string, role: unknown): Promise<void> {
  if (role !== 'viewer' && role !== 'editor') throw createError('role must be viewer or editor.', 400);
  await resolveDeviceAccess(owner, deviceId, 'owner');
  if (collaboratorId === owner) throw createError('You already own this device.', 400);
  if (!(await areConnected(owner, collaboratorId))) throw createError('Connect with this person before sharing a device.', 403);
  try {
    await withTransaction(async (tx) => {
      // Re-check under a lock: a disconnect that raced ahead is not undone by a late share.
      if (!(await lockAcceptedConnection(owner, collaboratorId, tx))) throw createError('Connect with this person before sharing a device.', 403);
      await upsertShare(deviceId, owner, collaboratorId, role, tx);
    });
  } catch (error) {
    if (isMissingTable(error)) throw createError('Apply database migration 027 before sharing devices.', 503);
    // The composite foreign key rejects an owner who no longer owns the device.
    if (pgCode(error) === '23503') throw new DeviceNotFound('Device not found');
    throw error;
  }
}

/** The owner removes a collaborator, or a collaborator leaves a device shared with them. */
export async function revokeDeviceShare(me: string, deviceId: string, collaboratorId: string): Promise<void> {
  if (me !== collaboratorId) await resolveDeviceAccess(me, deviceId, 'owner');
  if ((await deleteShare(deviceId, collaboratorId)) === 0) throw createError('Share not found.', 404);
}

export interface SharedDevice { id: string; device_name: string; role: ShareRole; owner: PublicUser }
/** Never selects the license key or hardware identifiers of someone else's device. */
export async function listDevicesSharedWithMe(me: string): Promise<SharedDevice[]> {
  let shared;
  try { shared = await selectDevicesSharedWith(me); }
  catch (error) { if (isMissingTable(error)) return []; throw error; }
  if (shared.length === 0) return [];
  const owners = await publicUsers(shared.map((share) => share.owner_id));
  return shared.map((share) => ({ id: share.id, device_name: share.device_name, role: share.role, owner: owners.get(share.owner_id) ?? unknownUser(share.owner_id) }));
}

// --------------------------------------------------------- shared items

export type ItemSource =
  | { kind: 'layout'; device_id: string; page_id?: string | null }
  | { kind: 'widget'; device_id: string; page_id?: string | null; widget_id: string }
  | { kind: 'dashboard'; device_id: string };

export interface SharedItem {
  id: string; kind: SharedItemKind; name: string; status: string; created_at: string;
  from: PublicUser; to: PublicUser; summary: { widgets: string[]; pages: number };
}
function parseSource(value: unknown): ItemSource {
  const source = value as Record<string, unknown> | null;
  if (!source || typeof source !== 'object') throw createError('Choose what to share.', 400);
  const device_id = parseUuid(source.device_id, 'device_id');
  const page_id = source.page_id === undefined || source.page_id === null ? null : String(source.page_id);
  if (source.kind === 'dashboard') return { kind: 'dashboard', device_id };
  if (source.kind === 'layout') return { kind: 'layout', device_id, page_id };
  if (source.kind === 'widget' && typeof source.widget_id === 'string') return { kind: 'widget', device_id, page_id, widget_id: source.widget_id };
  throw createError('Choose a layout, widget or dashboard to share.', 400);
}

/** The payload is built from the sender's saved settings, never from client-supplied layouts. */
async function buildPayload(sender: string, source: ItemSource): Promise<{ payload: SharedPayload; defaultName: string; dropped: number }> {
  const access = await resolveDeviceAccess(sender, source.device_id, 'editor');
  const { preferences } = await getDeviceDisplay(access.ownerId, source.device_id);
  const pages = preferences.display_schedule?.pages ?? [];
  if (source.kind === 'dashboard') {
    let dropped = 0;
    const base = preferences.layout ? portableLayout(preferences.layout) : null;
    dropped += base?.dropped ?? 0;
    const payload: DashboardPayload = {
      layout: base?.layout ?? null,
      enabled: preferences.display_schedule?.enabled === true,
      pages: pages.map((page) => { const portable = portableLayout(page.layout); dropped += portable.dropped; return { name: page.name, duration_seconds: page.duration_seconds, layout: portable.layout }; }),
    };
    if (!payload.layout && payload.pages.length === 0) throw createError('This device has no layouts to share yet.', 409);
    return { payload, defaultName: 'Dashboard', dropped };
  }
  const page = source.page_id ? pages.find((entry) => entry.id === source.page_id) : undefined;
  if (source.page_id && !page) throw createError('Saved layout not found.', 404);
  const layout = page?.layout ?? preferences.layout;
  if (!layout) throw createError('This device has no base layout yet.', 409);
  if (source.kind === 'widget') return { payload: portableWidget(layout, source.widget_id), defaultName: source.widget_id, dropped: 0 };
  const portable = portableLayout(layout);
  return { payload: { layout: portable.layout }, defaultName: page?.name ?? 'Base layout', dropped: portable.dropped };
}

function toItem(row: ItemRow, users: Map<string, PublicUser>): SharedItem {
  return {
    id: row.id, kind: row.kind, name: row.name, status: row.status, created_at: row.created_at,
    from: users.get(row.sender_id) ?? unknownUser(row.sender_id), to: users.get(row.recipient_id) ?? unknownUser(row.recipient_id),
    summary: summarize(row.kind, parsePayload(row.kind, row.payload)),
  };
}

export async function sendItem(sender: string, input: { recipient_id: unknown; source: unknown; name?: unknown }): Promise<{ item: SharedItem; dropped: number }> {
  const recipient = parseUuid(input.recipient_id, 'recipient_id');
  if (recipient === sender) throw createError('Send items to a connection, not to yourself.', 400);
  if (!(await areConnected(sender, recipient))) throw createError('Connect with this person before sharing with them.', 403);
  const source = parseSource(input.source);
  if ((await countPendingItems(sender, recipient)) >= MAX_PENDING_PER_PAIR) throw createError('This person has too many unanswered items from you. Wait for them to respond.', 429);
  let built;
  try { built = await buildPayload(sender, source); }
  catch (error) { if (error instanceof SharedItemError) throw createError(error.message, error.statusCode); throw error; }
  if (Buffer.byteLength(JSON.stringify(built.payload), 'utf8') > SHARED_PAYLOAD_MAX_BYTES) throw createError('That is too large to share.', 413);
  const name = (typeof input.name === 'string' && input.name.trim() ? input.name : built.defaultName).trim().slice(0, 80);
  const row = await withTransaction(async (tx) => {
    // Re-check under a lock so an item cannot be created after the connection ended.
    if (!(await lockAcceptedConnection(sender, recipient, tx))) throw createError('Connect with this person before sharing with them.', 403);
    if ((await countPendingItems(sender, recipient, tx)) >= MAX_PENDING_PER_PAIR) throw createError('This person has too many unanswered items from you. Wait for them to respond.', 429);
    return insertItem(sender, recipient, source.kind, name, built.payload, tx);
  });
  return { item: toItem(row, await publicUsers([sender, recipient])), dropped: built.dropped };
}

export async function listItems(me: string, box: 'inbox' | 'sent'): Promise<SharedItem[]> {
  let rows: ItemRow[];
  try { rows = await selectItems(me, box); }
  catch (error) { if (isMissingTable(error)) return []; throw error; }
  const users = await publicUsers(rows.flatMap((row) => [row.sender_id, row.recipient_id]));
  return rows.flatMap((row) => { try { return [toItem(row, users)]; } catch { return []; } });
}

/**
 * One transaction: the item is locked, applied to the device and marked accepted together.
 * If applying fails (validation, a settings conflict) the item simply stays pending, and a
 * double click waits on the lock and then finds nothing pending.
 */
export async function acceptItem(me: string, id: string, input: { device_id: unknown; page_id?: unknown }): Promise<void> {
  const deviceId = parseUuid(input.device_id, 'device_id');
  await withTransaction(async (tx) => {
    const row = await selectPendingItemForRecipient(id, me, tx, true);
    if (!row) throw createError('Shared item not found.', 404);
    // Applying changes the device, so the recipient must be allowed to edit it.
    const access = await resolveDeviceAccess(me, deviceId, 'editor', tx);
    const { preferences } = await getDeviceDisplay(access.ownerId, deviceId, tx);
    let updates;
    try {
      const pageId = input.page_id === undefined || input.page_id === null ? null : String(input.page_id);
      updates = buildAcceptUpdates(row.kind, row.payload, preferences, { page_id: pageId, name: row.name });
    } catch (error) { if (error instanceof SharedItemError) throw createError(error.message, error.statusCode); throw error; }
    await saveDeviceDisplay(access.ownerId, deviceId, updates, tx);
    if (!(await markItemAccepted(id, tx))) throw createError('This item was already answered.', 409);
  });
}

/** The recipient declines, or the sender withdraws an unanswered item. */
export async function dismissItem(me: string, id: string): Promise<void> {
  const row = await selectItemOfMember(id, me);
  if (!row) throw createError('Shared item not found.', 404);
  if (row.recipient_id === me) await markItemDeclined(id);
  else await deletePendingItem(id);
}
