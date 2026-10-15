import type { UserPreferences } from '../types';
import { getSupabaseClient } from './database';
import { DeviceNotFound } from './deviceDelivery';
import { DEFAULT_PREFS } from './displayData';
import { DEVICE_PRESENTATION_KEYS, getDeviceDisplay, saveDeviceDisplay } from './deviceDisplays';
import { createError } from '../middleware/errorHandler';
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

/** A rolling deployment may serve requests before migration 027 is applied. */
const missingTable = (error: { code?: string } | null) => error?.code === '42P01' || error?.code === 'PGRST205';
function check<T>(result: { data: T; error: { code?: string; message?: string } | null }): T {
  if (result.error) throw result.error;
  return result.data;
}
export function parseUuid(value: unknown, name: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw createError(`${name} must be a UUID.`, 400);
  return value;
}

// ---------------------------------------------------------------- users

async function publicUsers(ids: string[]): Promise<Map<string, PublicUser>> {
  if (ids.length === 0) return new Map();
  const rows = check(await getSupabaseClient().from('users').select('id, email, display_name').in('id', [...new Set(ids)])) as PublicUser[];
  return new Map(rows.map((row) => [row.id, { id: row.id, email: row.email, display_name: row.display_name }]));
}
const unknownUser = (id: string): PublicUser => ({ id, email: '', display_name: null });

/** Case-insensitive exact match: LIKE wildcards in the address are escaped. */
async function findUserIdByEmail(email: string): Promise<string | null> {
  const pattern = email.replace(/[\\%_]/g, (char) => `\\${char}`);
  const { data, error } = await getSupabaseClient().from('users').select('id').ilike('email', pattern).limit(1).maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

// ---------------------------------------------------------- connections

interface ConnectionRow { id: string; requester_id: string; addressee_id: string; status: 'pending' | 'accepted'; created_at: string }
export interface Connection {
  id: string;
  status: 'connected' | 'incoming' | 'outgoing';
  user: PublicUser;
  created_at: string;
}

async function connectionBetween(a: string, b: string): Promise<ConnectionRow | null> {
  const rows = check(await getSupabaseClient().from('user_connections').select('*')
    .or(`and(requester_id.eq.${a},addressee_id.eq.${b}),and(requester_id.eq.${b},addressee_id.eq.${a})`)) as ConnectionRow[];
  return rows[0] ?? null;
}
export async function areConnected(a: string, b: string): Promise<boolean> {
  return (await connectionBetween(a, b))?.status === 'accepted';
}

export async function listConnections(me: string): Promise<Connection[]> {
  const result = await getSupabaseClient().from('user_connections').select('*')
    .or(`requester_id.eq.${me},addressee_id.eq.${me}`).order('created_at', { ascending: false });
  if (missingTable(result.error)) return [];
  const rows = check(result) as ConnectionRow[];
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
  const other = await findUserIdByEmail(email);
  if (other === me) throw createError('You cannot connect to yourself.', 400);
  if (!other) return;
  const db = getSupabaseClient();
  const existing = await connectionBetween(me, other);
  if (existing) {
    // They already asked me: asking back is the same as accepting.
    if (existing.status === 'pending' && existing.addressee_id === me) {
      check(await db.from('user_connections').update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('id', existing.id).eq('status', 'pending'));
    }
    return;
  }
  const inserted = await db.from('user_connections').insert({ requester_id: me, addressee_id: other });
  // A concurrent request from the other side wins; that is also a success.
  if (inserted.error && inserted.error.code !== '23505') throw inserted.error;
}

export async function acceptConnection(me: string, id: string): Promise<void> {
  const rows = check(await getSupabaseClient().from('user_connections')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', id).eq('addressee_id', me).eq('status', 'pending').select('id')) as Array<{ id: string }>;
  if (rows.length === 0) throw createError('Request not found.', 404);
}

/** Decline, cancel or disconnect. Ending a connection also ends every device share between the two. */
export async function removeConnection(me: string, id: string): Promise<void> {
  const db = getSupabaseClient();
  const row = check(await db.from('user_connections').select('*').eq('id', id).or(`requester_id.eq.${me},addressee_id.eq.${me}`).maybeSingle()) as ConnectionRow | null;
  if (!row) throw createError('Connection not found.', 404);
  const other = row.requester_id === me ? row.addressee_id : row.requester_id;
  check(await db.from('user_connections').delete().eq('id', id));
  check(await db.from('device_shares').delete().or(`and(owner_id.eq.${me},collaborator_id.eq.${other}),and(owner_id.eq.${other},collaborator_id.eq.${me})`));
  check(await db.from('shared_items').delete().eq('status', 'pending')
    .or(`and(sender_id.eq.${me},recipient_id.eq.${other}),and(sender_id.eq.${other},recipient_id.eq.${me})`));
}

// -------------------------------------------------------- device shares

/** Who may do what with this device. Anything else is "not found", never "forbidden". */
export async function resolveDeviceAccess(userId: string, deviceId: string, minimum: DeviceRole = 'viewer'): Promise<DeviceAccess> {
  const db = getSupabaseClient();
  const device = check(await db.from('devices').select('user_id').eq('id', deviceId).maybeSingle()) as { user_id: string } | null;
  if (!device) throw new DeviceNotFound('Device not found');
  let access: DeviceAccess | null = device.user_id === userId ? { ownerId: userId, role: 'owner' } : null;
  if (!access) {
    const share = await db.from('device_shares').select('role, owner_id').eq('device_id', deviceId).eq('collaborator_id', userId).maybeSingle();
    if (share.error && !missingTable(share.error)) throw share.error;
    const row = share.data as { role: ShareRole; owner_id: string } | null;
    if (row && row.owner_id === device.user_id) access = { ownerId: row.owner_id, role: row.role };
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
  const result = await getSupabaseClient().from('device_shares').select('*').eq('device_id', deviceId).eq('owner_id', owner).order('created_at');
  if (missingTable(result.error)) return [];
  const rows = check(result) as Array<{ collaborator_id: string; role: ShareRole; created_at: string }>;
  const users = await publicUsers(rows.map((row) => row.collaborator_id));
  return rows.map((row) => ({ collaborator: users.get(row.collaborator_id) ?? unknownUser(row.collaborator_id), role: row.role, created_at: row.created_at }));
}

export async function shareDevice(owner: string, deviceId: string, collaboratorId: string, role: unknown): Promise<void> {
  if (role !== 'viewer' && role !== 'editor') throw createError('role must be viewer or editor.', 400);
  await resolveDeviceAccess(owner, deviceId, 'owner');
  if (collaboratorId === owner) throw createError('You already own this device.', 400);
  if (!(await areConnected(owner, collaboratorId))) throw createError('Connect with this person before sharing a device.', 403);
  const result = await getSupabaseClient().from('device_shares')
    .upsert({ device_id: deviceId, owner_id: owner, collaborator_id: collaboratorId, role }, { onConflict: 'device_id,collaborator_id' });
  if (missingTable(result.error)) throw createError('Apply database migration 027 before sharing devices.', 503);
  if (result.error) throw result.error;
}

/** The owner removes a collaborator, or a collaborator leaves a device shared with them. */
export async function revokeDeviceShare(me: string, deviceId: string, collaboratorId: string): Promise<void> {
  const db = getSupabaseClient();
  if (me !== collaboratorId) await resolveDeviceAccess(me, deviceId, 'owner');
  const rows = check(await db.from('device_shares').delete().eq('device_id', deviceId).eq('collaborator_id', collaboratorId).select('device_id')) as unknown[];
  if (rows.length === 0) throw createError('Share not found.', 404);
}

export interface SharedDevice { id: string; device_name: string; role: ShareRole; owner: PublicUser }
/** Never selects the license key or hardware identifiers of someone else's device. */
export async function listDevicesSharedWithMe(me: string): Promise<SharedDevice[]> {
  const db = getSupabaseClient();
  const result = await db.from('device_shares').select('device_id, owner_id, role').eq('collaborator_id', me);
  if (missingTable(result.error)) return [];
  const shares = check(result) as Array<{ device_id: string; owner_id: string; role: ShareRole }>;
  if (shares.length === 0) return [];
  const devices = check(await db.from('devices').select('id, device_name').in('id', shares.map((share) => share.device_id))) as Array<{ id: string; device_name: string }>;
  const owners = await publicUsers(shares.map((share) => share.owner_id));
  return shares.flatMap((share) => {
    const device = devices.find((entry) => entry.id === share.device_id);
    return device ? [{ id: device.id, device_name: device.device_name, role: share.role, owner: owners.get(share.owner_id) ?? unknownUser(share.owner_id) }] : [];
  });
}

// --------------------------------------------------------- shared items

export type ItemSource =
  | { kind: 'layout'; device_id: string; page_id?: string | null }
  | { kind: 'widget'; device_id: string; page_id?: string | null; widget_id: string }
  | { kind: 'dashboard'; device_id: string };

interface ItemRow { id: string; sender_id: string; recipient_id: string; kind: SharedItemKind; name: string; payload: unknown; status: string; created_at: string }
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
  const db = getSupabaseClient();
  const pending = check(await db.from('shared_items').select('id').eq('sender_id', sender).eq('recipient_id', recipient).eq('status', 'pending')) as unknown[];
  if (pending.length >= MAX_PENDING_PER_PAIR) throw createError('This person has too many unanswered items from you. Wait for them to respond.', 429);
  let built;
  try { built = await buildPayload(sender, source); }
  catch (error) { if (error instanceof SharedItemError) throw createError(error.message, error.statusCode); throw error; }
  if (Buffer.byteLength(JSON.stringify(built.payload), 'utf8') > SHARED_PAYLOAD_MAX_BYTES) throw createError('That is too large to share.', 413);
  const name = (typeof input.name === 'string' && input.name.trim() ? input.name : built.defaultName).trim().slice(0, 80);
  const row = check(await db.from('shared_items').insert({ sender_id: sender, recipient_id: recipient, kind: source.kind, name, payload: built.payload }).select('*').single()) as ItemRow;
  return { item: toItem(row, await publicUsers([sender, recipient])), dropped: built.dropped };
}

export async function listItems(me: string, box: 'inbox' | 'sent'): Promise<SharedItem[]> {
  const column = box === 'inbox' ? 'recipient_id' : 'sender_id';
  let query = getSupabaseClient().from('shared_items').select('*').eq(column, me).order('created_at', { ascending: false }).limit(50);
  if (box === 'inbox') query = query.eq('status', 'pending');
  const result = await query;
  if (missingTable(result.error)) return [];
  const rows = check(result) as ItemRow[];
  const users = await publicUsers(rows.flatMap((row) => [row.sender_id, row.recipient_id]));
  return rows.flatMap((row) => { try { return [toItem(row, users)]; } catch { return []; } });
}

export async function acceptItem(me: string, id: string, input: { device_id: unknown; page_id?: unknown }): Promise<void> {
  const deviceId = parseUuid(input.device_id, 'device_id');
  const db = getSupabaseClient();
  const row = check(await db.from('shared_items').select('*').eq('id', id).eq('recipient_id', me).eq('status', 'pending').maybeSingle()) as ItemRow | null;
  if (!row) throw createError('Shared item not found.', 404);
  // Applying changes the device, so the recipient must be allowed to edit it.
  const access = await resolveDeviceAccess(me, deviceId, 'editor');
  const { preferences } = await getDeviceDisplay(access.ownerId, deviceId);
  let updates;
  try {
    const pageId = input.page_id === undefined || input.page_id === null ? null : String(input.page_id);
    updates = buildAcceptUpdates(row.kind, row.payload, preferences, { page_id: pageId, name: row.name });
  } catch (error) { if (error instanceof SharedItemError) throw createError(error.message, error.statusCode); throw error; }
  // Claim before applying so a double click cannot add the item twice; give it back if applying fails.
  const claimed = check(await db.from('shared_items').update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'pending').select('id')) as unknown[];
  if (claimed.length === 0) throw createError('This item was already answered.', 409);
  try {
    await saveDeviceDisplay(access.ownerId, deviceId, updates);
  } catch (error) {
    await db.from('shared_items').update({ status: 'pending', responded_at: null }).eq('id', id);
    throw error;
  }
}

/** The recipient declines, or the sender withdraws an unanswered item. */
export async function dismissItem(me: string, id: string): Promise<void> {
  const db = getSupabaseClient();
  const row = check(await db.from('shared_items').select('*').eq('id', id).or(`recipient_id.eq.${me},sender_id.eq.${me}`).maybeSingle()) as ItemRow | null;
  if (!row) throw createError('Shared item not found.', 404);
  if (row.recipient_id === me) check(await db.from('shared_items').update({ status: 'declined', responded_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending'));
  else check(await db.from('shared_items').delete().eq('id', id).eq('status', 'pending'));
}
