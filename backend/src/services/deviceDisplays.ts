import type { UserPreferences } from '../types';
import { DEFAULT_PREFS } from './displayData';
import { DeviceNotFound, isMissingColumn, isMissingTable, pgCode } from '../db/errors';
import type { Queryable } from '../db/pool';
import { isDeviceOwnedBy } from '../db/repositories/deviceDelivery';
import { findPreferences } from '../db/repositories/accounts';
import { getPreferences } from './database';
import {
  findDeviceDisplay, insertDeviceDisplay, updateDeviceDisplay, type DeviceDisplayRow as StoredDisplayRow,
} from '../db/repositories/deviceDisplays';
import { createError } from '../middleware/errorHandler';
import { parseDisplayTemplate } from '../utils/displayTemplates';
import { displayLanguageOrDefault, parseDisplayLanguage } from '../utils/displayLanguage';

export const DEVICE_PRESENTATION_KEYS = ['layout', 'display_schedule', 'active_layout_id',
  'display_profile', 'display_timezone', 'display_language', 'refresh_interval_minutes'] as const;
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
    // A row from before migration 025 has no such column and draws English.
    display_language: displayLanguageOrDefault(prefs.display_language),
    refresh_interval_minutes: prefs.refresh_interval_minutes,
  };
}

/** Reuse the existing bounded layout/profile/schedule validators. */
export function parseDeviceDisplayUpdates(input: unknown): Partial<DevicePresentation> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !(DEVICE_PRESENTATION_KEYS as readonly string[]).includes(key))
    || Object.keys(input).length === 0) throw createError('Submit only device presentation settings.', 400);
  const { active_layout_id, display_language, ...settings } = input as Record<string, unknown>;
  if (active_layout_id !== undefined && active_layout_id !== null
    && (typeof active_layout_id !== 'string' || !/^[A-Za-z0-9_-]{1,48}$/.test(active_layout_id))) {
    throw createError('active_layout_id must be a saved layout ID or null.', 400);
  }
  try {
    return {
      // Not a template setting: templates are account-wide starting points and omit device-only choices.
      ...(display_language !== undefined ? { display_language: parseDisplayLanguage(display_language) } : {}),
      ...(Object.keys(settings).length ? parseDisplayTemplate({ format: 'esp32-eink-template', version: 1, settings }).settings : {}),
      ...(active_layout_id !== undefined ? { active_layout_id: active_layout_id as string | null } : {}),
    };
  } catch (error) { throw createError((error as Error).message, 400); }
}

/** `db` lets a caller read on the same transaction it later writes in. */
async function readDeviceDisplay(owner: string, deviceId: string, db?: Queryable) {
  if (!(await isDeviceOwnedBy(owner, deviceId, db))) throw new DeviceNotFound('Device not found');
  const loadDisplay = () => findDeviceDisplay(deviceId, db).then((row) => ({ row, error: null as unknown }), (error: unknown) => ({ row: null, error }));
  const loadPreferences = () => (db ? findPreferences(owner, db) : getPreferences(owner));
  // A single transaction client runs one statement at a time; the pool can overlap them.
  const [saved, found] = db
    ? [await loadPreferences(), await loadDisplay()] as const
    : await Promise.all([loadPreferences(), loadDisplay()]);
  // A rolling deployment may serve old devices before migration 018 is applied.
  // Only an absent table preserves legacy delivery; outages fail.
  const missingTable = isMissingTable(found.error);
  if (found.error && !missingTable) throw found.error;
  const base = saved ?? DEFAULT_PREFS;
  const row = found.row as DeviceDisplayRow | null;
  const preferences = row?.owner_id === owner ? { ...base, ...presentation(row) } : { ...base, active_layout_id: null };
  return { preferences, inherited: row?.owner_id !== owner, row, missingTable };
}

export async function getDeviceDisplay(owner: string, deviceId: string, db?: Queryable): Promise<DeviceDisplaySettings> {
  const { preferences, inherited } = await readDeviceDisplay(owner, deviceId, db);
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

/**
 * Saves presentation settings with compare-and-swap on the stored revision. Pass the
 * transaction client when the save is one step of a larger change that must succeed or fail whole.
 */
export async function saveDeviceDisplay(owner: string, deviceId: string, input: unknown, db?: Queryable): Promise<DeviceDisplaySettings> {
  const updates = parseDeviceDisplayUpdates(input);
  const current = await readDeviceDisplay(owner, deviceId, db);
  if (current.missingTable) throw createError('Apply database migration 018 before saving device display settings.', 503);
  const next = { ...presentation(current.preferences), ...updates };
  if (next.active_layout_id && !next.display_schedule?.pages.some((page) => page.id === next.active_layout_id)) {
    throw createError('Select another saved layout before removing the active layout.', 400);
  }
  const revision = (current.row?.revision ?? 0) + 1;
  const values: Record<string, unknown> = { ...(current.inherited ? next : updates) };
  // Written only when chosen, so saving any other setting still works before migration 025.
  if (updates.display_language === undefined) delete values.display_language;
  // Compare-and-swap protects partial updates and reassignment snapshots. A
  // concurrent first save is a conflict, never an upsert over the other writer.
  let saved: StoredDisplayRow | null;
  try {
    saved = current.row
      ? await updateDeviceDisplay(deviceId, current.row.owner_id, current.row.revision, owner, revision, values, db)
      : await insertDeviceDisplay(deviceId, owner, revision, values, db);
  } catch (error) {
    if (pgCode(error) === '23505') throw createError('Device settings changed. Reload them and try again.', 409);
    // The composite foreign key checks ownership atomically with this write.
    if (pgCode(error) === '23503') throw new DeviceNotFound('Device not found');
    if (isMissingColumn(error, /display_language/)) throw createError('Apply database migration 025 before changing the display language.', 503);
    throw error;
  }
  if (!saved) throw createError('Device settings changed. Reload them and try again.', 409);
  return { preferences: { ...current.preferences, ...presentation(saved as DeviceDisplayRow) }, inherited: false };
}
