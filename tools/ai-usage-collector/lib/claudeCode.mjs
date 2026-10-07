// Claude Code writes one JSONL transcript per session under <config>/projects/. Each
// assistant record carries message.model and message.usage. A response with several
// content blocks is written once per block with the same usage, so records are counted
// once per message ID and request ID.
//
// Subscription quota (5-hour and 7-day windows) is not in the transcripts: Claude Code
// passes it to the status line command as `rate_limits` (see statusLineLimits).
import { homedir } from 'node:os';
import { join } from 'node:path';
import { addTokens, count, dayIn, jsonLines, modelList, recentJsonlFiles } from './files.mjs';

export function claudeProjectDirs(env = process.env, home = homedir()) {
  const configured = (env.CLAUDE_CONFIG_DIR ?? '').split(',').map((dir) => dir.trim()).filter(Boolean);
  const roots = configured.length ? configured : [join(home, '.config', 'claude'), join(home, '.claude')];
  return [...new Set(roots.map((root) => join(root, 'projects')))];
}

/** Today's tokens per model from local Claude Code transcripts. */
export async function readClaudeUsage({ dirs = claudeProjectDirs(), timeZone, now = new Date(), since }) {
  const today = dayIn(now, timeZone);
  const seen = new Set();
  const models = new Map();
  for (const dir of dirs) {
    for (const file of await recentJsonlFiles(dir, since)) {
      for await (const record of jsonLines(file)) {
        if (record.type !== 'assistant' || !record.message || typeof record.message !== 'object') continue;
        const { model, usage, id } = record.message;
        if (typeof model !== 'string' || !usage || typeof usage !== 'object' || model === '<synthetic>') continue;
        const time = Date.parse(record.timestamp);
        if (!Number.isFinite(time) || dayIn(new Date(time), timeZone) !== today) continue;
        const key = `${id ?? record.uuid}:${record.requestId ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const creation = usage.cache_creation && typeof usage.cache_creation === 'object' ? usage.cache_creation : null;
        const longWrites = count(creation?.ephemeral_1h_input_tokens);
        const writes = creation ? count(creation.ephemeral_5m_input_tokens) + longWrites : count(usage.cache_creation_input_tokens);
        addTokens(models, model, {
          input: count(usage.input_tokens),
          output: count(usage.output_tokens),
          cacheWrite: Math.max(writes, count(usage.cache_creation_input_tokens)),
          cacheWrite1h: longWrites,
          cacheRead: count(usage.cache_read_input_tokens),
        });
      }
    }
  }
  return { day: today, models: modelList(models) };
}

const STATUS_WINDOWS = { five_hour: 300, seven_day: 10080 };

/**
 * Quota windows from the JSON Claude Code sends to a status line command on stdin.
 * Present only on Pro/Max plans and after the session's first response.
 */
export function statusLineLimits(input, now = new Date()) {
  const limits = input && typeof input === 'object' ? input.rate_limits : null;
  if (!limits || typeof limits !== 'object') return null;
  const windows = [];
  for (const [name, minutes] of Object.entries(STATUS_WINDOWS)) {
    const window = limits[name];
    if (!window || typeof window !== 'object') continue;
    const used = window.used_percentage;
    const resets = typeof window.resets_at === 'number' ? window.resets_at * (window.resets_at > 1e12 ? 1 : 1000) : Date.parse(window.resets_at);
    if (typeof used !== 'number' || !Number.isFinite(used) || used < 0 || !Number.isFinite(resets)) continue;
    windows.push({ window_minutes: minutes, used_percent: Math.round(used * 10) / 10, resets_at: new Date(resets).toISOString().replace(/\.\d{3}Z$/, 'Z') });
  }
  return windows.length ? { observed_at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'), windows } : null;
}
