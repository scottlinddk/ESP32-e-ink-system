// File and calendar helpers shared by the Claude Code and Codex readers.
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/** The local calendar date of `instant` in `timeZone`, YYYY-MM-DD. */
export function dayIn(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * Every *.jsonl file below `root` modified at or after `since` (ms). Older files cannot
 * hold today's records, so skipping them keeps a run fast on large histories.
 */
export async function recentJsonlFiles(root, since, depth = 6) {
  const files = [];
  async function walk(directory, level) {
    let entries;
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
export async function* jsonLines(path) {
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line || line.length > 4_000_000) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object') yield value;
    } catch { /* partial line while the CLI is writing */ }
  }
}

export const count = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** Adds token counts into a per-model map. */
export function addTokens(models, model, tokens) {
  const current = models.get(model) ?? { input: 0, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 };
  for (const key of Object.keys(current)) current[key] += tokens[key] ?? 0;
  models.set(model, current);
}

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,79}$/;
export const MAX_MODELS = 12;

/**
 * The push contract's model list: largest first, at most MAX_MODELS entries. Anything
 * beyond that, or with an ID the server would reject, is summed as "other" (unpriced).
 */
export function modelList(models) {
  const valid = [];
  const other = { input: 0, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 };
  const total = (tokens) => tokens.input + tokens.output + tokens.cacheWrite + tokens.cacheRead;
  const sorted = [...models.entries()].filter(([, tokens]) => total(tokens) > 0).sort(([, a], [, b]) => total(b) - total(a));
  for (const [model, tokens] of sorted) {
    if (MODEL_ID.test(model) && model !== 'other' && valid.length < MAX_MODELS - 1) valid.push([model, tokens]);
    else for (const key of Object.keys(other)) other[key] += tokens[key];
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
