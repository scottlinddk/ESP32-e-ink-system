import crypto from 'crypto';
import { withSignal } from '../db/pool';
import { withCause } from '../db/errors';
import {
  clearAiUsageToken, findAiUsageRow, findAiUsageRowByHash, replaceAiUsageToken, writeAiUsageProviders,
} from '../db/repositories/integrationTokens';
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

export function hashAiUsageToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function parseAiUsageBearer(header?: string): string | null {
  return /^Bearer eau_[a-f0-9]{64}$/.test(header ?? '') ? header!.slice(7) : null;
}

export async function getAiUsageRecord(userId: string, signal?: AbortSignal): Promise<AiUsageRecord | null> {
  let data;
  try { data = await withSignal(findAiUsageRow(userId), signal); }
  catch (cause) {
    throw withCause('Could not load AI usage data', cause);
  }
  if (!data) return null;
  const record = data as AiUsageRecord;
  return { ...record, providers: sanitizeStored(record.providers) };
}

export async function issueAiUsageToken(userId: string): Promise<string> {
  const token = `eau_${crypto.randomBytes(32).toString('hex')}`;
  try { await replaceAiUsageToken(userId, hashAiUsageToken(token)); }
  catch (cause) { throw withCause('Could not create an AI usage token', cause); }
  return token;
}

export async function revokeAiUsageToken(userId: string): Promise<void> {
  try { await clearAiUsageToken(userId); }
  catch (cause) { throw withCause('Could not revoke the AI usage token', cause); }
}

export async function findAiUsageOwner(tokenHash: string): Promise<AiUsageRecord | null> {
  let data;
  try { data = await findAiUsageRowByHash(tokenHash); }
  catch (cause) { throw withCause('Could not authenticate the AI usage token', cause); }
  return data ? { ...(data as AiUsageRecord), providers: sanitizeStored((data as AiUsageRecord).providers) } : null;
}

/**
 * Merges a push into the stored snapshot. The write is filtered on the token hash, so a
 * token revoked or replaced after lookup cannot publish. Concurrent pushes from two
 * machines may race; the later write wins and the loser's counts return on its next push.
 */
export async function saveAiUsagePush(record: AiUsageRecord, tokenHash: string, push: AiUsagePush, now = new Date()): Promise<StoredAiUsage | null> {
  const providers = mergeAiUsage(record.providers, push, now);
  let stored: boolean;
  try { stored = await writeAiUsageProviders(record.user_id, tokenHash, providers, now.toISOString()); }
  catch (cause) { throw withCause('Could not store AI usage data', cause); }
  return stored ? providers : null;
}
