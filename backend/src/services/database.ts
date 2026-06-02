import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { User, UserPreferences, ApiKey, Device } from '../types/index';
import { encrypt, decrypt, isEncrypted } from '../utils/crypto';

let supabase: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }

    supabase = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return supabase;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from('users')
    .select('*')
    .eq('email', email)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // no rows
    throw error;
  }
  return data as User;
}

export async function getUserById(id: string): Promise<User | null> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from('users')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data as User;
}

export async function upsertUser(email: string, displayName?: string): Promise<User> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from('users')
    .upsert(
      { email, display_name: displayName ?? null, updated_at: new Date().toISOString() },
      { onConflict: 'email' }
    )
    .select()
    .single();

  if (error) throw error;
  return data as User;
}

export async function getPreferences(userId: string): Promise<UserPreferences | null> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data as UserPreferences;
}

export async function upsertPreferences(
  userId: string,
  prefs: Partial<UserPreferences>
): Promise<UserPreferences> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from('user_preferences')
    .upsert(
      { user_id: userId, ...prefs, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (error) throw error;
  return data as UserPreferences;
}

export async function getApiKeys(userId: string): Promise<ApiKey[]> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from('api_keys')
    .select('*')
    .eq('user_id', userId);

  if (error) throw error;
  return (data ?? []).map((row) => {
    if (isEncrypted(row.api_key)) {
      return { ...row, api_key: decrypt(row.api_key) } as ApiKey;
    }
    // Legacy plaintext row — return as-is until migrated
    console.warn(`api_keys row ${row.id} for provider ${row.provider} is not encrypted`);
    return row as ApiKey;
  });
}

export async function upsertApiKey(
  userId: string,
  provider: string,
  apiKey: string
): Promise<ApiKey> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from('api_keys')
    .upsert(
      { user_id: userId, provider, api_key: encrypt(apiKey) },
      { onConflict: 'user_id,provider' }
    )
    .select()
    .single();

  if (error) throw error;
  // Return with decrypted key so callers work with the plaintext value
  return { ...data, api_key: apiKey } as ApiKey;
}

export async function getDeviceByLicenseKey(licenseKey: string): Promise<Device | null> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from('devices')
    .select('*')
    .eq('license_key', licenseKey)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data as Device;
}

export async function updateDeviceLastSeen(deviceId: string): Promise<void> {
  const db = getSupabaseClient();
  const { error } = await db
    .from('devices')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', deviceId);

  if (error) throw error;
}

export async function logApiUsage(userId: string, endpoint: string): Promise<void> {
  const db = getSupabaseClient();
  // Fire-and-forget — don't let logging failures break requests
  db.from('api_usage')
    .insert({ user_id: userId, endpoint, called_at: new Date().toISOString() })
    .then(({ error }) => {
      if (error) console.error('Failed to log API usage:', error.message);
    });
}
