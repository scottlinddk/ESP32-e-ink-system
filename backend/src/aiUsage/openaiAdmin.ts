import { AiUsageSourceError, amount, collectPages, getJson, isRecord } from './adminHttp';
import type { AdminUsage, ModelTokens } from './types';

// OpenAI organization Usage and Costs API. Requires an Admin key (sk-admin-…), which
// only an organization Owner can create.
//   GET /v1/organization/usage/completions  hourly buckets, grouped by model
//   GET /v1/organization/costs              daily buckets, amount.value in dollars
// Codex used through a ChatGPT plan is not API usage and does not appear here.

const BASE_URL = 'https://api.openai.com/v1/organization';

export const OPENAI_ADMIN_KEY_PATTERN = /^sk-admin-[A-Za-z0-9_-]{20,300}$/;

function tokens(result: Record<string, unknown>): ModelTokens {
  const input = amount(result.input_tokens ?? 0);
  // OpenAI counts cached tokens as part of input_tokens.
  const cached = Math.min(input, amount(result.input_cached_tokens ?? 0));
  return {
    model: typeof result.model === 'string' && result.model ? result.model : 'unknown',
    input: input - cached,
    output: amount(result.output_tokens ?? 0),
    cacheWrite: 0,
    cacheWrite1h: 0,
    cacheRead: cached,
  };
}

export async function fetchOpenAiAdminUsage(key: string, dayStart: Date, monthStart: Date, now: Date, signal?: AbortSignal): Promise<AdminUsage> {
  if (!OPENAI_ADMIN_KEY_PATTERN.test(key)) throw new AiUsageSourceError('invalid_key');
  const headers = { Authorization: `Bearer ${key}` };
  const hours = Math.min(168, Math.max(1, Math.ceil((now.getTime() - dayStart.getTime()) / 3_600_000) + 1));
  const usage = collectPages((page) => {
    const url = new URL(`${BASE_URL}/usage/completions`);
    url.searchParams.set('start_time', String(Math.floor(dayStart.getTime() / 1000)));
    url.searchParams.set('bucket_width', '1h');
    url.searchParams.append('group_by', 'model');
    url.searchParams.set('limit', String(hours));
    if (page) url.searchParams.set('page', page);
    return getJson(url, headers, signal);
  });
  const cost = collectPages((page) => {
    const url = new URL(`${BASE_URL}/costs`);
    url.searchParams.set('start_time', String(Math.floor(monthStart.getTime() / 1000)));
    url.searchParams.set('limit', '31');
    if (page) url.searchParams.set('page', page);
    return getJson(url, headers, signal);
  });
  const [usageBuckets, costBuckets] = await Promise.all([usage, cost]);
  const today = usageBuckets.flatMap((bucket) => (bucket.results as unknown[]).map((result) => {
    if (!isRecord(result)) throw new AiUsageSourceError('invalid_response');
    return tokens(result);
  }));
  let dollars = 0;
  for (const bucket of costBuckets) {
    for (const result of bucket.results as unknown[]) {
      if (!isRecord(result) || !isRecord(result.amount)) throw new AiUsageSourceError('invalid_response');
      const currency = result.amount.currency;
      if (typeof currency === 'string' && currency.toLowerCase() !== 'usd') throw new AiUsageSourceError('invalid_response');
      dollars += amount(result.amount.value);
    }
  }
  return { today, monthCostUsd: dollars };
}
