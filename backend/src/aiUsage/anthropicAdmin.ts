import { AiUsageSourceError, amount, collectPages, getJson, isRecord } from './adminHttp';
import type { AdminUsage, ModelTokens } from './types';

// Anthropic Usage & Cost Admin API (organization accounts only; individual accounts
// have no Admin API). Requires an Admin API key, sk-ant-admin…
//   GET /v1/organizations/usage_report/messages  hourly buckets, grouped by model
//   GET /v1/organizations/cost_report            daily buckets, amounts in cents as decimal strings
// Data appears about 5 minutes after use; the API supports polling once per minute.

const BASE_URL = 'https://api.anthropic.com/v1/organizations';

export const ANTHROPIC_ADMIN_KEY_PATTERN = /^sk-ant-admin[0-9a-z]*-[A-Za-z0-9_-]{20,300}$/;

function headers(key: string): Record<string, string> {
  return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
}

function tokens(result: Record<string, unknown>): ModelTokens {
  const cacheCreation = isRecord(result.cache_creation) ? result.cache_creation : {};
  return {
    model: typeof result.model === 'string' && result.model ? result.model : 'unknown',
    input: amount(result.uncached_input_tokens ?? 0),
    output: amount(result.output_tokens ?? 0),
    cacheWrite: amount(cacheCreation.ephemeral_5m_input_tokens ?? 0) + amount(cacheCreation.ephemeral_1h_input_tokens ?? 0),
    cacheWrite1h: amount(cacheCreation.ephemeral_1h_input_tokens ?? 0),
    cacheRead: amount(result.cache_read_input_tokens ?? 0),
  };
}

export async function fetchAnthropicAdminUsage(key: string, dayStart: Date, monthStart: Date, now: Date, signal?: AbortSignal): Promise<AdminUsage> {
  if (!ANTHROPIC_ADMIN_KEY_PATTERN.test(key)) throw new AiUsageSourceError('invalid_key');
  const hours = Math.min(168, Math.max(1, Math.ceil((now.getTime() - dayStart.getTime()) / 3_600_000) + 1));
  const usage = collectPages((page) => {
    const url = new URL(`${BASE_URL}/usage_report/messages`);
    url.searchParams.set('starting_at', dayStart.toISOString().replace(/\.\d{3}Z$/, 'Z'));
    url.searchParams.set('bucket_width', '1h');
    url.searchParams.append('group_by[]', 'model');
    url.searchParams.set('limit', String(hours));
    if (page) url.searchParams.set('page', page);
    return getJson(url, headers(key), signal);
  });
  const cost = collectPages((page) => {
    const url = new URL(`${BASE_URL}/cost_report`);
    url.searchParams.set('starting_at', monthStart.toISOString().replace(/\.\d{3}Z$/, 'Z'));
    url.searchParams.set('limit', '31');
    if (page) url.searchParams.set('page', page);
    return getJson(url, headers(key), signal);
  });
  const [usageBuckets, costBuckets] = await Promise.all([usage, cost]);
  const today = usageBuckets.flatMap((bucket) => (bucket.results as unknown[]).map((result) => {
    if (!isRecord(result)) throw new AiUsageSourceError('invalid_response');
    return tokens(result);
  }));
  let cents = 0;
  for (const bucket of costBuckets) {
    for (const result of bucket.results as unknown[]) {
      if (!isRecord(result)) throw new AiUsageSourceError('invalid_response');
      if (typeof result.currency === 'string' && result.currency.toUpperCase() !== 'USD') throw new AiUsageSourceError('invalid_response');
      cents += amount(result.amount);
    }
  }
  return { today, monthCostUsd: cents / 100 };
}
