// Claude Code writes one JSONL transcript per session under <config>/projects/. Each
// assistant record carries message.model and message.usage. A response with several
// content blocks is written once per block with the same usage, so records are counted
// once per message ID and request ID.
//
// Subscription quota (5-hour and 7-day windows) is not in the transcripts: Claude Code
// passes it to the status line command as `rate_limits` (see statusLineLimits).
import { homedir } from 'node:os';
import { join } from 'node:path';
import { addTokens, count, dayIn, jsonLines, modelList, recentJsonlFiles } from './files.ts';
import { isRecord, utcIso, type LimitWindow, type Limits, type Tokens, type Usage } from './types.ts';

export function claudeProjectDirs(env: NodeJS.ProcessEnv = process.env, home = homedir()): string[] {
  const configured = (env.CLAUDE_CONFIG_DIR ?? '').split(',').map((dir) => dir.trim()).filter(Boolean);
  const roots = configured.length ? configured : [join(home, '.config', 'claude'), join(home, '.claude')];
  return [...new Set(roots.map((root) => join(root, 'projects')))];
}

export interface ReadOptions {
  dirs?: string[];
  timeZone: string;
  now?: Date;
  since: number;
}

/** Today's tokens per model from local Claude Code transcripts. */
export async function readClaudeUsage({ dirs = claudeProjectDirs(), timeZone, now = new Date(), since }: ReadOptions): Promise<Usage> {
  const today = dayIn(now, timeZone);
  const seen = new Set<string>();
  const models = new Map<string, Tokens>();
  for (const dir of dirs) {
    for (const file of await recentJsonlFiles(dir, since)) {
      for await (const record of jsonLines(file)) {
        if (record.type !== 'assistant' || !isRecord(record.message)) continue;
        const { model, usage, id } = record.message;
        if (typeof model !== 'string' || !isRecord(usage) || model === '<synthetic>') continue;
        const time = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
        if (!Number.isFinite(time) || dayIn(new Date(time), timeZone) !== today) continue;
        const key = `${String(id ?? record.uuid)}:${String(record.requestId ?? '')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const creation = isRecord(usage.cache_creation) ? usage.cache_creation : null;
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

const STATUS_WINDOWS = { five_hour: 300, seven_day: 10080 } as const;

/**
 * Quota windows from the JSON Claude Code sends to a status line command on stdin.
 * Present only on Pro/Max plans and after the session's first response.
 */
export function statusLineLimits(input: unknown, now = new Date()): Limits | null {
  const limits = isRecord(input) ? input.rate_limits : null;
  if (!isRecord(limits)) return null;
  const windows: LimitWindow[] = [];
  for (const [name, minutes] of Object.entries(STATUS_WINDOWS)) {
    const window = limits[name];
    if (!isRecord(window)) continue;
    const used = window.used_percentage;
    const resetsAt = window.resets_at;
    const resets = typeof resetsAt === 'number' ? resetsAt * (resetsAt > 1e12 ? 1 : 1000)
      : typeof resetsAt === 'string' ? Date.parse(resetsAt) : NaN;
    if (typeof used !== 'number' || !Number.isFinite(used) || used < 0 || !Number.isFinite(resets)) continue;
    windows.push({ window_minutes: minutes, used_percent: Math.round(used * 10) / 10, resets_at: utcIso(resets) });
  }
  return windows.length ? { observed_at: utcIso(now), windows } : null;
}
