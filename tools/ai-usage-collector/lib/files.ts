// File and calendar helpers shared by the Claude Code and Codex readers.
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { isRecord, type JsonRecord, type ModelUsage, type Tokens } from './types.ts';

/** The local calendar date of `instant` in `timeZone`, YYYY-MM-DD. */
export function dayIn(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * Every *.jsonl file below `root` modified at or after `since` (ms). Older files cannot
 * hold today's records, so skipping them keeps a run fast on large histories.
 */
export async function recentJsonlFiles(root: string, since: number, depth = 6): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string, level: number): Promise<void> {
    let entries: Dirent[];
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink() && level < depth) await walk(path, level + 1);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try { if ((await stat(path)).mtimeMs >= since) files.push(path); } catch { /* removed meanwhile */ }
      }
    }
  }
  await walk(root, 0);
  return files.sort();
}

/** Parsed JSON objects from a JSONL file; unreadable lines are skipped. */
export async function* jsonLines(path: string): AsyncGenerator<JsonRecord> {
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line || line.length > 4_000_000) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isRecord(value)) yield value;
    } catch { /* partial line while the CLI is writing */ }
  }
}

export const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

const TOKEN_KEYS = ['input', 'output', 'cacheWrite', 'cacheWrite1h', 'cacheRead'] as const satisfies readonly (keyof Tokens)[];

export const emptyTokens = (): Tokens => ({ input: 0, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 });

/** Adds token counts into a per-model map. */
export function addTokens(models: Map<string, Tokens>, model: string, tokens: Partial<Tokens>): void {
  const current = models.get(model) ?? emptyTokens();
  for (const key of TOKEN_KEYS) current[key] += tokens[key] ?? 0;
  models.set(model, current);
}

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,79}$/;
export const MAX_MODELS = 12;

/**
 * The push contract's model list: largest first, at most MAX_MODELS entries. Anything
 * beyond that, or with an ID the server would reject, is summed as "other" (unpriced).
 */
export function modelList(models: Map<string, Tokens>): ModelUsage[] {
  const valid: Array<[string, Tokens]> = [];
  const other = emptyTokens();
  const total = (tokens: Tokens) => tokens.input + tokens.output + tokens.cacheWrite + tokens.cacheRead;
  const sorted = [...models.entries()].filter(([, tokens]) => total(tokens) > 0).sort(([, a], [, b]) => total(b) - total(a));
  for (const [model, tokens] of sorted) {
    if (MODEL_ID.test(model) && model !== 'other' && valid.length < MAX_MODELS - 1) valid.push([model, tokens]);
    else for (const key of TOKEN_KEYS) other[key] += tokens[key];
  }
  if (total(other) > 0) valid.push(['other', other]);
  return valid.map(([model, tokens]) => ({
    model,
    input_tokens: tokens.input,
    output_tokens: tokens.output,
    cache_write_tokens: tokens.cacheWrite,
    cache_write_1h_tokens: Math.min(tokens.cacheWrite1h, tokens.cacheWrite),
    cache_read_tokens: tokens.cacheRead,
  }));
}
