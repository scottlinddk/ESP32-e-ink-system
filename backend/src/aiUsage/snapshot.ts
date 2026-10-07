import { AI_PROVIDERS } from './types';
import type {
  AiLimitView, AiProvider, ModelTokens, StoredAiUsage, StoredLimits, StoredMachineUsage, StoredProviderSnapshot,
} from './types';

// The push contract for POST /ai-usage/ingest. Collectors send only aggregates:
// quota percentages with reset times, and per-model token counts for one local day.
// Prompts, paths and project names never leave the collector.
//
// {
//   "machine": "laptop",                       optional, default "default"
//   "providers": {
//     "claude": {
//       "limits": { "observed_at": "…Z", "windows": [{ "window_minutes": 300, "used_percent": 58, "resets_at": "…Z" }] },
//       "usage":  { "day": "2026-10-07", "models": [{ "model": "claude-opus-5-5", "input_tokens": 1, "output_tokens": 2,
//                   "cache_write_tokens": 3, "cache_write_1h_tokens": 2, "cache_read_tokens": 4 }] }
//     },
//     "openai": { … }
//   }
// }

export const MAX_MACHINES = 6;
export const MAX_MODELS = 12;
export const MAX_WINDOWS = 4;
const MAX_TOKENS = 1e13;
const MACHINE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,79}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
/** Collectors may run a little ahead of the server clock. */
const CLOCK_SKEW_MS = 5 * 60_000;
const MAX_WINDOW_MINUTES = 31 * 24 * 60;

export class AiUsagePayloadError extends Error {
  constructor(message: string) { super(message); this.name = 'AiUsagePayloadError'; }
}

export interface AiUsagePush {
  machine: string;
  providers: Partial<Record<AiProvider, { limits?: StoredLimits; usage?: Omit<StoredMachineUsage, 'observed_at'> }>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[], name: string): void {
  const extra = Object.keys(value).find((key) => !keys.includes(key));
  if (extra) throw new AiUsagePayloadError(`${name} does not accept "${extra.slice(0, 40)}"`);
}

function utcTimestamp(value: unknown, name: string): number {
  if (typeof value !== 'string' || !UTC_PATTERN.test(value)) {
    throw new AiUsagePayloadError(`${name} must be a UTC timestamp such as 2026-10-07T12:00:00Z`);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new AiUsagePayloadError(`${name} is not a valid date`);
  }
  return time;
}

function count(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_TOKENS) {
    throw new AiUsagePayloadError(`${name} must be a whole number of tokens`);
  }
  return value;
}

function parseLimits(value: unknown, now: Date): StoredLimits {
  if (!isRecord(value)) throw new AiUsagePayloadError('limits must be an object');
  onlyKeys(value, ['observed_at', 'windows'], 'limits');
  const observed = utcTimestamp(value.observed_at, 'limits.observed_at');
  if (observed > now.getTime() + CLOCK_SKEW_MS) throw new AiUsagePayloadError('limits.observed_at is in the future');
  if (!Array.isArray(value.windows) || value.windows.length < 1 || value.windows.length > MAX_WINDOWS) {
    throw new AiUsagePayloadError(`limits.windows must contain 1–${MAX_WINDOWS} windows`);
  }
  const seen = new Set<number>();
  const windows = value.windows.map((entry, index) => {
    const name = `limits.windows[${index}]`;
    if (!isRecord(entry)) throw new AiUsagePayloadError(`${name} must be an object`);
    onlyKeys(entry, ['window_minutes', 'used_percent', 'resets_at'], name);
    const minutes = entry.window_minutes;
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > MAX_WINDOW_MINUTES) {
      throw new AiUsagePayloadError(`${name}.window_minutes must be a whole number of minutes up to 31 days`);
    }
    if (seen.has(minutes)) throw new AiUsagePayloadError('limits.windows must not repeat a window length');
    seen.add(minutes);
    const used = entry.used_percent;
    if (typeof used !== 'number' || !Number.isFinite(used) || used < 0 || used > 1000) {
      throw new AiUsagePayloadError(`${name}.used_percent must be a number from 0`);
    }
    const resets = utcTimestamp(entry.resets_at, `${name}.resets_at`);
    return { window_minutes: minutes, used_percent: Math.round(used * 10) / 10, resets_at: new Date(resets).toISOString() };
  }).sort((a, b) => a.window_minutes - b.window_minutes);
  return { observed_at: new Date(observed).toISOString(), windows };
}

function parseUsage(value: unknown): Omit<StoredMachineUsage, 'observed_at'> {
  if (!isRecord(value)) throw new AiUsagePayloadError('usage must be an object');
  onlyKeys(value, ['day', 'models'], 'usage');
  if (typeof value.day !== 'string' || !DAY_PATTERN.test(value.day)
    || new Date(`${value.day}T00:00:00Z`).toISOString().slice(0, 10) !== value.day) {
    throw new AiUsagePayloadError('usage.day must be a date such as 2026-10-07');
  }
  if (!Array.isArray(value.models) || value.models.length > MAX_MODELS) {
    throw new AiUsagePayloadError(`usage.models must contain at most ${MAX_MODELS} models`);
  }
  const names = new Set<string>();
  const models = value.models.map((entry, index) => {
    const name = `usage.models[${index}]`;
    if (!isRecord(entry)) throw new AiUsagePayloadError(`${name} must be an object`);
    onlyKeys(entry, ['model', 'input_tokens', 'output_tokens', 'cache_write_tokens', 'cache_write_1h_tokens', 'cache_read_tokens'], name);
    if (typeof entry.model !== 'string' || !MODEL_PATTERN.test(entry.model)) {
      throw new AiUsagePayloadError(`${name}.model must be a model ID`);
    }
    if (names.has(entry.model)) throw new AiUsagePayloadError('usage.models must not repeat a model');
    names.add(entry.model);
    const cacheWrites = count(entry.cache_write_tokens ?? 0, `${name}.cache_write_tokens`);
    const longWrites = count(entry.cache_write_1h_tokens ?? 0, `${name}.cache_write_1h_tokens`);
    if (longWrites > cacheWrites) throw new AiUsagePayloadError(`${name}.cache_write_1h_tokens is part of cache_write_tokens and cannot exceed it`);
    return {
      model: entry.model,
      input_tokens: count(entry.input_tokens, `${name}.input_tokens`),
      output_tokens: count(entry.output_tokens, `${name}.output_tokens`),
      cache_write_tokens: cacheWrites,
      cache_write_1h_tokens: longWrites,
      cache_read_tokens: count(entry.cache_read_tokens ?? 0, `${name}.cache_read_tokens`),
    };
  });
  return { day: value.day, models };
}

export function parseAiUsagePush(value: unknown, now = new Date()): AiUsagePush {
  if (!isRecord(value)) throw new AiUsagePayloadError('Payload must be an object');
  onlyKeys(value, ['machine', 'providers'], 'Payload');
  const machine = value.machine ?? 'default';
  if (typeof machine !== 'string' || !MACHINE_PATTERN.test(machine)) {
    throw new AiUsagePayloadError('machine must be 1–32 lowercase letters, digits, "-" or "_"');
  }
  if (!isRecord(value.providers)) throw new AiUsagePayloadError('providers must be an object');
  onlyKeys(value.providers, AI_PROVIDERS, 'providers');
  const providers: AiUsagePush['providers'] = {};
  for (const provider of AI_PROVIDERS) {
    const entry = value.providers[provider];
    if (entry === undefined) continue;
    if (!isRecord(entry)) throw new AiUsagePayloadError(`providers.${provider} must be an object`);
    onlyKeys(entry, ['limits', 'usage'], `providers.${provider}`);
    if (entry.limits === undefined && entry.usage === undefined) continue;
    providers[provider] = {
      ...(entry.limits === undefined ? {} : { limits: parseLimits(entry.limits, now) }),
      ...(entry.usage === undefined ? {} : { usage: parseUsage(entry.usage) }),
    };
  }
  if (!Object.keys(providers).length) throw new AiUsagePayloadError('providers must report limits or usage for claude or openai');
  return { machine, providers };
}

/**
 * Applies a push to the stored snapshot. Quota windows are account-wide, so the most
 * recently observed report wins whichever machine sent it; token counts are kept per
 * machine and summed when displayed. The machines that reported least recently are dropped
 * beyond MAX_MACHINES.
 */
export function mergeAiUsage(stored: StoredAiUsage | null | undefined, push: AiUsagePush, now = new Date()): StoredAiUsage {
  const next: StoredAiUsage = structuredClone(sanitizeStored(stored));
  for (const provider of AI_PROVIDERS) {
    const update = push.providers[provider];
    if (!update) continue;
    const current: StoredProviderSnapshot = next[provider] ?? {};
    if (update.limits && (!current.limits || Date.parse(current.limits.observed_at) <= Date.parse(update.limits.observed_at))) {
      current.limits = update.limits;
    }
    if (update.usage) {
      const usage = { ...current.usage, [push.machine]: { ...update.usage, observed_at: now.toISOString() } };
      const machines = Object.entries(usage)
        .sort(([, a], [, b]) => Date.parse(b.observed_at) - Date.parse(a.observed_at))
        .slice(0, MAX_MACHINES);
      current.usage = Object.fromEntries(machines);
    }
    next[provider] = current;
  }
  return next;
}

/** Re-validates stored JSON, dropping anything malformed, so display code can trust its shape. */
export function sanitizeStored(value: unknown): StoredAiUsage {
  if (!isRecord(value)) return {};
  const result: StoredAiUsage = {};
  const farFuture = new Date(8.64e15);
  for (const provider of AI_PROVIDERS) {
    const entry = value[provider];
    if (!isRecord(entry)) continue;
    const snapshot: StoredProviderSnapshot = {};
    try { if (entry.limits !== undefined) snapshot.limits = parseLimits(entry.limits, farFuture); } catch { /* dropped */ }
    if (isRecord(entry.usage)) {
      const usage: Record<string, StoredMachineUsage> = {};
      for (const [machine, report] of Object.entries(entry.usage).slice(0, MAX_MACHINES)) {
        if (!MACHINE_PATTERN.test(machine) || !isRecord(report)) continue;
        try {
          const observed = utcTimestamp(new Date(String(report.observed_at)).toISOString(), 'observed_at');
          usage[machine] = { ...parseUsage({ day: report.day, models: report.models }), observed_at: new Date(observed).toISOString() };
        } catch { /* dropped */ }
      }
      if (Object.keys(usage).length) snapshot.usage = usage;
    }
    if (snapshot.limits || snapshot.usage) result[provider] = snapshot;
  }
  return result;
}

/** "5h", "7d", … Codex reports windows a minute short (299, 10079), so close values round. */
export function windowLabel(minutes: number): string {
  const near = (unit: number) => Math.round(minutes / unit) >= 1 && Math.abs(minutes - Math.round(minutes / unit) * unit) <= 2;
  if (near(1440)) return `${Math.round(minutes / 1440)}d`;
  if (near(60)) return `${Math.round(minutes / 60)}h`;
  return `${minutes}m`;
}

/**
 * Quota windows as they stand now. A window whose reset time has passed is shown as
 * reset (usage unknown, starting from zero) instead of repeating the old percentage,
 * so the widget stays truthful while the reporting computer is off.
 */
export function projectLimits(limits: StoredLimits | undefined, now = new Date()): AiLimitView[] {
  return (limits?.windows ?? []).map((window) => ({
    label: windowLabel(window.window_minutes),
    usedPercent: Date.parse(window.resets_at) <= now.getTime() ? null : window.used_percent,
    resetsAt: window.resets_at,
  }));
}

/** Today's tokens from every machine whose report covers `today` (YYYY-MM-DD). */
export function localTokensForDay(snapshot: StoredProviderSnapshot | undefined, today: string): ModelTokens[] | null {
  const reports = Object.values(snapshot?.usage ?? {}).filter((report) => report.day === today);
  if (!reports.length) return null;
  return reports.flatMap((report) => report.models.map((entry) => ({
    model: entry.model, input: entry.input_tokens, output: entry.output_tokens,
    cacheWrite: entry.cache_write_tokens, cacheWrite1h: entry.cache_write_1h_tokens, cacheRead: entry.cache_read_tokens,
  })));
}
