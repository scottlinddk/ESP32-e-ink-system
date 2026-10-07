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
import { addTokens, count, dayIn, jsonLines, modelList, recentJsonlFiles } from './files.mjs';

export function codexSessionDirs(env = process.env, home = homedir()) {
  const root = env.CODEX_HOME?.trim() || join(home, '.codex');
  return [join(root, 'sessions'), join(root, 'archived_sessions')];
}

function payloadOf(record) {
  return record.payload && typeof record.payload === 'object' ? record.payload : record;
}

function usageOf(value) {
  if (!value || typeof value !== 'object') return null;
  const input = count(value.input_tokens);
  const cached = Math.min(input, count(value.cached_input_tokens));
  return { input: input - cached, output: count(value.output_tokens), cacheWrite: 0, cacheWrite1h: 0, cacheRead: cached };
}

function resetTime(window, eventTime) {
  if (typeof window.resets_at === 'number') return window.resets_at * (window.resets_at > 1e12 ? 1 : 1000);
  if (typeof window.resets_at === 'string') return Date.parse(window.resets_at);
  if (typeof window.resets_in_seconds === 'number') return eventTime + window.resets_in_seconds * 1000;
  return NaN;
}

function limitsOf(rateLimits, eventTime) {
  if (!rateLimits || typeof rateLimits !== 'object') return null;
  const windows = [];
  for (const name of ['primary', 'secondary']) {
    const window = rateLimits[name];
    if (!window || typeof window !== 'object') continue;
    const minutes = window.window_minutes;
    const used = window.used_percent;
    const resets = resetTime(window, eventTime);
    if (!Number.isInteger(minutes) || minutes < 1 || typeof used !== 'number' || !Number.isFinite(used) || used < 0 || !Number.isFinite(resets)) continue;
    if (windows.some((entry) => entry.window_minutes === minutes)) continue;
    windows.push({ window_minutes: minutes, used_percent: Math.round(used * 10) / 10, resets_at: new Date(resets).toISOString().replace(/\.\d{3}Z$/, 'Z') });
  }
  return windows.length ? { observed_at: new Date(eventTime).toISOString().replace(/\.\d{3}Z$/, 'Z'), windows } : null;
}

/** Today's tokens per model and the most recent rate limits from local Codex sessions. */
export async function readCodexUsage({ dirs = codexSessionDirs(), timeZone, now = new Date(), since }) {
  const today = dayIn(now, timeZone);
  const models = new Map();
  let limits = null;
  for (const dir of dirs) {
    for (const file of await recentJsonlFiles(dir, since)) {
      let model = 'unknown';
      let previous = null;
      for await (const record of jsonLines(file)) {
        const payload = payloadOf(record);
        if (record.type === 'turn_context' || record.type === 'session_meta') {
          if (typeof payload.model === 'string' && payload.model) model = payload.model;
          continue;
        }
        if (payload.type !== 'token_count') continue;
        const time = Date.parse(record.timestamp);
        if (!Number.isFinite(time)) continue;
        const info = payload.info && typeof payload.info === 'object' ? payload.info : null;
        const total = usageOf(info?.total_token_usage);
        // Cumulative totals make repeated events harmless: only the increase is counted.
        let delta = null;
        if (total) {
          const grew = previous && Object.keys(total).every((key) => total[key] >= previous[key]);
          delta = grew ? Object.fromEntries(Object.keys(total).map((key) => [key, total[key] - previous[key]])) : total;
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
