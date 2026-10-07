// Codex CLI writes one rollout JSONL per session under $CODEX_HOME/sessions/YYYY/MM/DD/
// (default ~/.codex). `token_count` events carry cumulative token totals for the
// session and the plan's rate limits:
//   {"timestamp":"…","type":"event_msg","payload":{"type":"token_count",
//     "info":{"total_token_usage":{"input_tokens":5200,"cached_input_tokens":2048,"output_tokens":14,…},
//             "last_token_usage":{…}},
//     "rate_limits":{"primary":{"used_percent":12,"window_minutes":299,"resets_in_seconds":17940},
//                    "secondary":{"used_percent":22,"window_minutes":10079,"resets_at":1791400000}}}}
// The model comes from the latest `turn_context` (or `session_meta`) record. The format
// is not a published contract, so every field is optional here and missing data is skipped.
// OpenAI counts cached tokens inside input_tokens, and reasoning tokens inside output_tokens.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { addTokens, count, dayIn, jsonLines, modelList, recentJsonlFiles } from './files.ts';
import type { ReadOptions } from './claudeCode.ts';
import { isRecord, utcIso, type JsonRecord, type LimitWindow, type Limits, type Tokens, type Usage } from './types.ts';

export function codexSessionDirs(env: NodeJS.ProcessEnv = process.env, home = homedir()): string[] {
  const root = env.CODEX_HOME?.trim() || join(home, '.codex');
  return [join(root, 'sessions'), join(root, 'archived_sessions')];
}

function payloadOf(record: JsonRecord): JsonRecord {
  return isRecord(record.payload) ? record.payload : record;
}

function usageOf(value: unknown): Tokens | null {
  if (!isRecord(value)) return null;
  const input = count(value.input_tokens);
  const cached = Math.min(input, count(value.cached_input_tokens));
  return { input: input - cached, output: count(value.output_tokens), cacheWrite: 0, cacheWrite1h: 0, cacheRead: cached };
}

function resetTime(window: JsonRecord, eventTime: number): number {
  if (typeof window.resets_at === 'number') return window.resets_at * (window.resets_at > 1e12 ? 1 : 1000);
  if (typeof window.resets_at === 'string') return Date.parse(window.resets_at);
  if (typeof window.resets_in_seconds === 'number') return eventTime + window.resets_in_seconds * 1000;
  return NaN;
}

function limitsOf(rateLimits: unknown, eventTime: number): Limits | null {
  if (!isRecord(rateLimits)) return null;
  const windows: LimitWindow[] = [];
  for (const name of ['primary', 'secondary']) {
    const window = rateLimits[name];
    if (!isRecord(window)) continue;
    const minutes = window.window_minutes;
    const used = window.used_percent;
    const resets = resetTime(window, eventTime);
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || typeof used !== 'number' || !Number.isFinite(used) || used < 0 || !Number.isFinite(resets)) continue;
    if (windows.some((entry) => entry.window_minutes === minutes)) continue;
    windows.push({ window_minutes: minutes, used_percent: Math.round(used * 10) / 10, resets_at: utcIso(resets) });
  }
  return windows.length ? { observed_at: utcIso(eventTime), windows } : null;
}

const TOKEN_KEYS = ['input', 'output', 'cacheWrite', 'cacheWrite1h', 'cacheRead'] as const;

/** Today's tokens per model and the most recent rate limits from local Codex sessions. */
export async function readCodexUsage({ dirs = codexSessionDirs(), timeZone, now = new Date(), since }: ReadOptions): Promise<{ usage: Usage; limits: Limits | null }> {
  const today = dayIn(now, timeZone);
  const models = new Map<string, Tokens>();
  let limits: Limits | null = null;
  for (const dir of dirs) {
    for (const file of await recentJsonlFiles(dir, since)) {
      let model = 'unknown';
      let previous: Tokens | null = null;
      for await (const record of jsonLines(file)) {
        const payload = payloadOf(record);
        if (record.type === 'turn_context' || record.type === 'session_meta') {
          if (typeof payload.model === 'string' && payload.model) model = payload.model;
          continue;
        }
        if (payload.type !== 'token_count') continue;
        const time = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
        if (!Number.isFinite(time)) continue;
        const info = isRecord(payload.info) ? payload.info : null;
        const total = usageOf(info?.total_token_usage);
        // Cumulative totals make repeated events harmless: only the increase is counted.
        let delta: Tokens | null;
        if (total) {
          const last = previous;
          const grew = last !== null && TOKEN_KEYS.every((key) => total[key] >= last[key]);
          delta = grew ? { ...total, ...Object.fromEntries(TOKEN_KEYS.map((key) => [key, total[key] - last[key]])) } : total;
          previous = total;
        } else {
          delta = usageOf(info?.last_token_usage);
        }
        if (delta && dayIn(new Date(time), timeZone) === today) addTokens(models, model, delta);
        const reported = limitsOf(payload.rate_limits ?? info?.rate_limits, time);
        if (reported && (!limits || Date.parse(limits.observed_at) <= time)) limits = reported;
      }
    }
  }
  return { usage: { day: today, models: modelList(models) }, limits };
}
