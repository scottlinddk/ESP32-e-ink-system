// The push contract of POST /api/ai-usage/ingest (see docs/AI_USAGE.md), as the collector
// builds it. The server validates every field again in backend/src/aiUsage/snapshot.ts.

/** Token counts for one model while aggregating. `input` excludes cache reads and writes. */
export interface Tokens {
  input: number;
  output: number;
  /** All cache writes, including the 1-hour ones counted in cacheWrite1h. */
  cacheWrite: number;
  cacheWrite1h: number;
  cacheRead: number;
}

export interface ModelUsage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_write_1h_tokens: number;
  cache_read_tokens: number;
}

export interface Usage {
  /** Local calendar date the counts cover, YYYY-MM-DD. */
  day: string;
  models: ModelUsage[];
}

export interface LimitWindow {
  window_minutes: number;
  used_percent: number;
  /** UTC ISO timestamp without milliseconds. */
  resets_at: string;
}

export interface Limits {
  observed_at: string;
  windows: LimitWindow[];
}

export interface ProviderReport {
  limits?: Limits;
  usage?: Usage;
}

export interface Payload {
  machine: string;
  providers: { claude?: ProviderReport; openai?: ProviderReport };
}

export interface Config {
  url?: string;
  token?: string;
  machine: string;
  timeZone: string;
}

/** A parsed JSON value whose shape is not known yet. */
export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** UTC ISO timestamp without milliseconds, as the server expects. */
export function utcIso(time: number | Date): string {
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
