import crypto from 'crypto';
import { getSupabaseClient } from '../services/database';
import { mergeAiUsage, sanitizeStored, type AiUsagePush } from './snapshot';
import type { StoredAiUsage } from './types';

// One row per user in ai_usage_reports. The collector authenticates with a dedicated
// integration token (eau_…); only its SHA-256 hash is stored.

export interface AiUsageRecord {
  user_id: string;
  token_hash: string | null;
  token_created_at: string | null;
  providers: StoredAiUsage;
  received_at: string | null;
}

const TABLE = 'ai_usage_reports';
const FIELDS = 'user_id,token_hash,token_created_at,providers,received_at';

export function hashAiUsageToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function parseAiUsageBearer(header?: string): string | null {
  return /^Bearer eau_[a-f0-9]{64}$/.test(header ?? '') ? header!.slice(7) : null;
}

export async function getAiUsageRecord(userId: string, signal?: AbortSignal): Promise<AiUsageRecord | null> {
  let query = getSupabaseClient().from(TABLE).select(FIELDS).eq('user_id', userId);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error('Could not load AI usage data');
  if (!data) return null;
  const record = data as AiUsageRecord;
  return { ...record, providers: sanitizeStored(record.providers) };
}

export async function issueAiUsageToken(userId: string): Promise<string> {
  const token = `eau_${crypto.randomBytes(32).toString('hex')}`;
  const { error } = await getSupabaseClient().from(TABLE).upsert({
    user_id: userId, token_hash: hashAiUsageToken(token), token_created_at: new Date().toISOString(),
    providers: {}, received_at: null,
  }, { onConflict: 'user_id' });
  if (error) throw new Error('Could not create an AI usage token');
  return token;
}

export async function revokeAiUsageToken(userId: string): Promise<void> {
  const { error } = await getSupabaseClient().from(TABLE).update({
    token_hash: null, token_created_at: null, providers: {}, received_at: null,
  }).eq('user_id', userId);
  if (error) throw new Error('Could not revoke the AI usage token');
}

export async function findAiUsageOwner(tokenHash: string): Promise<AiUsageRecord | null> {
  const { data, error } = await getSupabaseClient().from(TABLE).select(FIELDS).eq('token_hash', tokenHash).maybeSingle();
  if (error) throw new Error('Could not authenticate the AI usage token');
  return data ? { ...(data as AiUsageRecord), providers: sanitizeStored((data as AiUsageRecord).providers) } : null;
}

/**
 * Merges a push into the stored snapshot. The write is filtered on the token hash, so a
 * token revoked or replaced after lookup cannot publish. Concurrent pushes from two
 * machines may race; the later write wins and the loser's counts return on its next push.
 */
export async function saveAiUsagePush(record: AiUsageRecord, tokenHash: string, push: AiUsagePush, now = new Date()): Promise<StoredAiUsage | null> {
  const providers = mergeAiUsage(record.providers, push, now);
  const { data, error } = await getSupabaseClient().from(TABLE).update({ providers, received_at: now.toISOString() })
    .eq('user_id', record.user_id).eq('token_hash', tokenHash).select('user_id').maybeSingle();
  if (error) throw new Error('Could not store AI usage data');
  return data ? providers : null;
}
