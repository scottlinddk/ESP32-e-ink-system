import { createHash } from 'node:crypto';
import { aiUsageProblem } from './adminHttp';
import { fetchAnthropicAdminUsage } from './anthropicAdmin';
import { fetchOpenAiAdminUsage } from './openaiAdmin';
import { estimateCost, mergeModelTokens } from './pricing';
import { localTokensForDay, projectLimits } from './snapshot';
import { getAiUsageRecord } from './store';
import { localDay, startOfLocalDay, startOfUtcMonth } from './time';
import type { AdminUsage, AiProvider, AiProviderView, AiUsageData, AiUsageProblem, StoredAiUsage } from './types';

export type { AiUsageData, AiProviderView, AiLimitView, AiUsageProblem } from './types';

export const ADMIN_KEY_PROVIDERS: Record<AiProvider, 'anthropic_admin' | 'openai_admin'> = {
  claude: 'anthropic_admin', openai: 'openai_admin',
};
const LABELS: Record<AiProvider, string> = { claude: 'Claude', openai: 'OpenAI' };
const ADMIN_FETCHERS = { claude: fetchAnthropicAdminUsage, openai: fetchOpenAiAdminUsage };

// Admin reports lag about five minutes and Anthropic asks for at most one poll per
// minute, so results are cached per key and day. Failures are cached briefly too, so a
// rejected key is not retried on every display refresh.
const SUCCESS_TTL_MS = 5 * 60_000;
const FAILURE_TTL_MS = 2 * 60_000;
type AdminResult = { usage: AdminUsage } | { error: AiUsageProblem };
const cache = new Map<string, { result: AdminResult; expiresAt: number }>();

async function adminUsage(provider: AiProvider, key: string, timeZone: string, now: Date, signal?: AbortSignal,
  bypassCache = false): Promise<AdminResult> {
  const day = localDay(now, timeZone);
  const cacheKey = `${provider}:${createHash('sha256').update(key).digest('hex')}:${timeZone}:${day}`;
  for (const [entryKey, entry] of cache) if (entry.expiresAt <= now.getTime()) cache.delete(entryKey);
  const cached = bypassCache ? undefined : cache.get(cacheKey);
  if (cached) return cached.result;
  let result: AdminResult;
  try {
    result = { usage: await ADMIN_FETCHERS[provider](key, startOfLocalDay(now, timeZone), startOfUtcMonth(now), now, signal) };
  } catch (error) {
    result = { error: aiUsageProblem(error) };
    // A cancelled display request says nothing about the key: do not cache it.
    if (result.error.code === 'timeout') return result;
  }
  cache.set(cacheKey, { result, expiresAt: now.getTime() + ('usage' in result ? SUCCESS_TTL_MS : FAILURE_TTL_MS) });
  return result;
}

export function clearAiUsageCache(): void { cache.clear(); }

export interface AiUsageInputs {
  stored: StoredAiUsage;
  adminKeys: Partial<Record<AiProvider, string>>;
  timeZone: string;
  now?: Date;
  signal?: AbortSignal;
  bypassCache?: boolean;
}

/** Combines the stored push snapshot with live Admin API reports into display rows. */
export async function buildAiUsage({ stored, adminKeys, timeZone, now = new Date(), signal, bypassCache }: AiUsageInputs): Promise<AiUsageData> {
  const today = localDay(now, timeZone);
  const providers = await Promise.all((['claude', 'openai'] as const).map(async (provider): Promise<AiProviderView | null> => {
    const snapshot = stored[provider];
    const key = adminKeys[provider];
    const admin = key ? await adminUsage(provider, key, timeZone, now, signal, bypassCache) : null;
    if (!snapshot && !admin) return null;
    const local = localTokensForDay(snapshot, today);
    const api = admin && 'usage' in admin ? admin.usage : null;
    const counts = local || api ? mergeModelTokens(local ?? [], api?.today ?? []) : null;
    return {
      provider,
      label: LABELS[provider],
      limits: projectLimits(snapshot?.limits, now),
      limitsObservedAt: snapshot?.limits?.observed_at ?? null,
      today: counts ? estimateCost(counts) : null,
      monthCostUsd: api ? api.monthCostUsd : null,
      ...(admin && 'error' in admin ? { adminError: admin.error } : {}),
    };
  }));
  return { providers: providers.filter((entry): entry is AiProviderView => entry !== null) };
}

/** Loads the stored snapshot for a user and builds the display rows. */
export async function fetchAiUsage(userId: string, apiKeyMap: Record<string, string>, timeZone: string, signal?: AbortSignal): Promise<AiUsageData> {
  const record = await getAiUsageRecord(userId, signal);
  const adminKeys: Partial<Record<AiProvider, string>> = {};
  for (const provider of ['claude', 'openai'] as const) {
    const key = apiKeyMap[ADMIN_KEY_PROVIDERS[provider]];
    if (key) adminKeys[provider] = key;
  }
  return buildAiUsage({ stored: record?.token_hash ? record.providers : {}, adminKeys, timeZone, signal });
}
