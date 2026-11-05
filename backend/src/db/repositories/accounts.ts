/**
 * Users, preferences and provider keys. SQL only: encryption of provider keys
 * and business rules stay in services/database.ts.
 */
import type { ApiKey, User, UserPreferences } from '../../types/index';
import { isUuid } from '../errors';
import { query, type Queryable } from '../pool';

const pool: Queryable = { query };

// ---------------------------------------------------------------- users

export async function findUserByEmail(email: string, db: Queryable = pool): Promise<User | null> {
  const { rows } = await db.query<User>('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
  return rows[0] ?? null;
}

export async function findUserById(id: string, db: Queryable = pool): Promise<User | null> {
  if (!isUuid(id)) return null;
  const { rows } = await db.query<User>('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
  return rows[0] ?? null;
}

/**
 * Insert or update by email. display_name is overwritten with whatever is passed,
 * including null: that is how the PostgREST upsert behaved and callers rely on it.
 */
export async function upsertUserRow(email: string, displayName: string | null, db: Queryable = pool): Promise<User> {
  const { rows } = await db.query<User>(
    `INSERT INTO users (email, display_name, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (email) DO UPDATE
       SET display_name = EXCLUDED.display_name, updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [email, displayName],
  );
  return rows[0];
}

export async function readDefaultDeviceId(userId: string, db: Queryable = pool): Promise<string | null> {
  if (!isUuid(userId)) return null;
  const { rows } = await db.query<{ default_device_id: string | null }>('SELECT default_device_id FROM users WHERE id = $1', [userId]);
  return rows[0]?.default_device_id ?? null;
}

/**
 * Sets or clears the default device in one statement. The ownership check and the
 * write cannot be separated by a reassignment. Returns false when the device is not the user's.
 */
export async function writeDefaultDeviceId(userId: string, deviceId: string | null, db: Queryable = pool): Promise<boolean> {
  if (!isUuid(userId) || (deviceId !== null && !isUuid(deviceId))) return false;
  const { rowCount } = await db.query(
    `UPDATE users SET default_device_id = $2::uuid
     WHERE id = $1
       AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM devices WHERE id = $2::uuid AND user_id = $1))`,
    [userId, deviceId],
  );
  return (rowCount ?? 0) > 0;
}

// ---------------------------------------------------------- preferences

/** jsonb columns: values are serialised explicitly, because pg would turn a JS array into a PostgreSQL array. */
const JSON_PREFERENCE_COLUMNS = [
  'layout', 'display_schedule', 'display_profile', 'custom_image', 'monta_fields', 'zaptec_fields',
  'energy_price_settings', 'news_feeds', 'ticker_widgets', 'calendar_widgets',
] as const;
const SCALAR_PREFERENCE_COLUMNS = [
  'show_energy_price', 'show_weather', 'show_news', 'show_air_quality', 'show_monta', 'show_zaptec', 'show_notion',
  'show_custom_text', 'show_custom_image', 'show_calendar', 'show_custom_webhook', 'show_ai_usage',
  'energy_price_location', 'weather_location', 'news_language', 'news_source', 'news_feed_url', 'news_item_limit',
  'custom_text', 'calendar_timezone', 'calendar_days', 'calendar_item_limit', 'custom_webhook_ttl_minutes',
  'display_timezone', 'refresh_interval_minutes',
] as const;
const JSON_COLUMNS = new Set<string>(JSON_PREFERENCE_COLUMNS);
/** Column names cannot be bound as parameters, so only names from this allow-list ever reach the SQL text. */
export const PREFERENCE_COLUMNS: ReadonlySet<string> = new Set<string>([...JSON_PREFERENCE_COLUMNS, ...SCALAR_PREFERENCE_COLUMNS]);

export async function findPreferences(userId: string, db: Queryable = pool): Promise<UserPreferences | null> {
  if (!isUuid(userId)) return null;
  const { rows } = await db.query<UserPreferences>('SELECT * FROM user_preferences WHERE user_id = $1 LIMIT 1', [userId]);
  return rows[0] ?? null;
}

/** Writes only the keys present (undefined is skipped, null stores SQL NULL), like a PostgREST merge upsert. */
export async function upsertPreferenceRow(userId: string, prefs: Partial<UserPreferences>, db: Queryable = pool): Promise<UserPreferences> {
  const entries = Object.entries(prefs).filter(([, value]) => value !== undefined);
  const unknown = entries.map(([key]) => key).filter((key) => !PREFERENCE_COLUMNS.has(key));
  if (unknown.length > 0) throw new Error(`Unknown preference column(s): ${unknown.join(', ')}`);

  const columns = ['user_id', ...entries.map(([key]) => key), 'updated_at'];
  const values: unknown[] = [userId, ...entries.map(([key, value]) => (JSON_COLUMNS.has(key) && value !== null ? JSON.stringify(value) : value))];
  const placeholders = [...values.map((_, index) => `$${index + 1}`), 'now()'];
  const updates = columns.filter((column) => column !== 'user_id').map((column) => `"${column}" = EXCLUDED."${column}"`);

  const { rows } = await db.query<UserPreferences>(
    `INSERT INTO user_preferences (${columns.map((column) => `"${column}"`).join(', ')})
     VALUES (${placeholders.join(', ')})
     ON CONFLICT (user_id) DO UPDATE SET ${updates.join(', ')}
     RETURNING *`,
    values,
  );
  return rows[0];
}

// ------------------------------------------------------------- api keys

export async function listApiKeyRows(userId: string, db: Queryable = pool): Promise<ApiKey[]> {
  if (!isUuid(userId)) return [];
  const { rows } = await db.query<ApiKey>('SELECT * FROM api_keys WHERE user_id = $1', [userId]);
  return rows;
}

/** Stores an already-encrypted value. Re-saving a provider replaces its key and keeps created_at. */
export async function upsertApiKeyRow(userId: string, provider: string, storedValue: string, db: Queryable = pool): Promise<ApiKey> {
  const { rows } = await db.query<ApiKey>(
    `INSERT INTO api_keys (user_id, provider, api_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, provider) DO UPDATE SET api_key = EXCLUDED.api_key
     RETURNING *`,
    [userId, provider, storedValue],
  );
  return rows[0];
}

export async function deleteApiKeyRow(userId: string, provider: string, db: Queryable = pool): Promise<void> {
  if (!isUuid(userId)) return;
  await db.query('DELETE FROM api_keys WHERE user_id = $1 AND provider = $2', [userId, provider]);
}

/** Maintenance script only: every row, to find plaintext values. */
export async function listAllApiKeyRows(db: Queryable = pool): Promise<Array<{ id: string; api_key: string; provider: string; user_id: string }>> {
  const { rows } = await db.query<{ id: string; api_key: string; provider: string; user_id: string }>(
    'SELECT id, api_key, provider, user_id FROM api_keys ORDER BY created_at',
  );
  return rows;
}

export async function updateApiKeyValue(id: string, storedValue: string, db: Queryable = pool): Promise<void> {
  await db.query('UPDATE api_keys SET api_key = $2 WHERE id = $1', [id, storedValue]);
}
