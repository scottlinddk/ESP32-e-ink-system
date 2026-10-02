import type { UserPreferences } from '../types';
import { getPreferences, getSupabaseClient } from './database';
import { DEFAULT_PREFS } from './displayData';
import { assertDeviceOwner, DeviceNotFound } from './deviceDelivery';
import { createError } from '../middleware/errorHandler';
import { parseDisplayTemplate } from '../utils/displayTemplates';

export const DEVICE_PRESENTATION_KEYS = ['layout', 'display_schedule', 'active_layout_id',
  'display_profile', 'display_timezone', 'refresh_interval_minutes'] as const;
export type DevicePresentation = Required<Pick<UserPreferences, typeof DEVICE_PRESENTATION_KEYS[number]>>;
interface DeviceDisplayRow extends DevicePresentation {
  device_id: string;
  owner_id: string;
  revision: number;
  updated_at: string;
}
export interface DeviceDisplaySettings { preferences: UserPreferences; inherited: boolean }

/** Only omitted IDs select the account default. Invalid IDs must never fall back. */
export function parsePreviewDeviceId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw createError('device_id must be a device UUID.', 400);
  }
  return value;
}

function presentation(prefs: Pick<UserPreferences, typeof DEVICE_PRESENTATION_KEYS[number]>): DevicePresentation {
  return {
    layout: prefs.layout ?? null, display_schedule: prefs.display_schedule ?? null,
    active_layout_id: prefs.active_layout_id ?? null, display_profile: prefs.display_profile ?? null,
    display_timezone: prefs.display_timezone ?? DEFAULT_PREFS.display_timezone!,
    refresh_interval_minutes: prefs.refresh_interval_minutes,
  };
}

/** Reuse the existing bounded layout/profile/schedule validators. */
export function parseDeviceDisplayUpdates(input: unknown): Partial<DevicePresentation> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !(DEVICE_PRESENTATION_KEYS as readonly string[]).includes(key))
    || Object.keys(input).length === 0) throw createError('Submit only device presentation settings.', 400);
  const { active_layout_id, ...settings } = input as Record<string, unknown>;
  if (active_layout_id !== undefined && active_layout_id !== null
    && (typeof active_layout_id !== 'string' || !/^[A-Za-z0-9_-]{1,48}$/.test(active_layout_id))) {
    throw createError('active_layout_id must be a saved layout ID or null.', 400);
  }
  try {
    return {
      ...(Object.keys(settings).length ? parseDisplayTemplate({ format: 'esp32-eink-template', version: 1, settings }).settings : {}),
      ...(active_layout_id !== undefined ? { active_layout_id: active_layout_id as string | null } : {}),
    };
  } catch (error) { throw createError((error as Error).message, 400); }
}

async function readDeviceDisplay(owner: string, deviceId: string) {
  await assertDeviceOwner(owner, deviceId);
  const [saved, result] = await Promise.all([
    getPreferences(owner),
    getSupabaseClient().from('device_displays').select('*').eq('device_id', deviceId).maybeSingle(),
  ]);
  // A rolling deployment may serve old devices before migration 018 is applied.
  // Only an absent table/schema-cache entry preserves legacy delivery; outages fail.
  const missingTable = result.error?.code === '42P01' || result.error?.code === 'PGRST205';
  if (result.error && !missingTable) throw result.error;
  const base = saved ?? DEFAULT_PREFS;
  const row = result.data as DeviceDisplayRow | null;
  const preferences = row?.owner_id === owner ? { ...base, ...presentation(row) } : { ...base, active_layout_id: null };
  return { preferences, inherited: row?.owner_id !== owner, row, missingTable };
}

export async function getDeviceDisplay(owner: string, deviceId: string): Promise<DeviceDisplaySettings> {
  const { preferences, inherited } = await readDeviceDisplay(owner, deviceId);
  return { preferences, inherited };
}

/** Shared by token delivery and authenticated JSON, BMP, raw and draft previews. */
export async function resolveDevicePreferences(owner: string, deviceId?: string): Promise<UserPreferences> {
  if (!deviceId) return await getPreferences(owner) ?? DEFAULT_PREFS;
  const { preferences } = await getDeviceDisplay(owner, deviceId);
  if (!preferences.display_schedule?.enabled && preferences.active_layout_id) {
    const selected = preferences.display_schedule?.pages.find((page) => page.id === preferences.active_layout_id);
    if (selected) return { ...preferences, layout: selected.layout };
  }
  return preferences;
}

export async function saveDeviceDisplay(owner: string, deviceId: string, input: unknown): Promise<DeviceDisplaySettings> {
  const updates = parseDeviceDisplayUpdates(input);
  const current = await readDeviceDisplay(owner, deviceId);
  if (current.missingTable) throw createError('Apply database migration 018 before saving device display settings.', 503);
  const next = { ...presentation(current.preferences), ...updates };
  if (next.active_layout_id && !next.display_schedule?.pages.some((page) => page.id === next.active_layout_id)) {
    throw createError('Select another saved layout before removing the active layout.', 400);
  }
  const db = getSupabaseClient();
  const revision = (current.row?.revision ?? 0) + 1;
  const values = { ...(current.inherited ? next : updates), owner_id: owner, revision, updated_at: new Date().toISOString() };
  // Compare-and-swap protects partial updates and reassignment snapshots. A
  // concurrent first save is a conflict, never an upsert over the other writer.
  const result = current.row
    ? await db.from('device_displays').update(values).eq('device_id', deviceId)
      .eq('owner_id', current.row.owner_id).eq('revision', current.row.revision).select('*').maybeSingle()
    : await db.from('device_displays').insert({ ...values, device_id: deviceId }).select('*').single();
  if (result.error?.code === '23505' || (!result.error && !result.data)) {
    throw createError('Device settings changed. Reload them and try again.', 409);
  }
  // The composite foreign key checks ownership atomically with this write.
  if (result.error?.code === '23503') throw new DeviceNotFound('Device not found');
  if (result.error) throw result.error;
  return { preferences: { ...current.preferences, ...presentation(result.data as DeviceDisplayRow) }, inherited: false };
}
