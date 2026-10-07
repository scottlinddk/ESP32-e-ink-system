// Domain types for the AI usage widget. Two kinds of source feed it:
//  - pushed snapshots from the local collector (subscription quota windows and
//    token counts read from Claude Code / Codex session files), stored server-side;
//  - Admin API reports pulled by the server (organization token usage and billed cost).
// The server keeps the last pushed snapshot, so the widget renders without the
// pushing computer being online.

export const AI_PROVIDERS = ['claude', 'openai'] as const;
export type AiProvider = typeof AI_PROVIDERS[number];

/** Token counts for one model. `input` excludes cache reads and writes. */
export interface ModelTokens {
  model: string;
  input: number;
  output: number;
  /** All cache writes, including the 1-hour ones counted in cacheWrite1h. */
  cacheWrite: number;
  /** Cache writes with the 1-hour lifetime, billed at a higher rate (Claude Code uses these). */
  cacheWrite1h: number;
  cacheRead: number;
}

/** A subscription quota window as reported by the CLI, e.g. Claude's 5-hour and 7-day limits. */
export interface StoredLimitWindow {
  window_minutes: number;
  used_percent: number;
  resets_at: string; // UTC ISO
}

export interface StoredLimits {
  observed_at: string;
  windows: StoredLimitWindow[];
}

export interface StoredMachineUsage {
  /** Local calendar date the counts cover, YYYY-MM-DD, in the collector's time zone. */
  day: string;
  observed_at: string;
  models: Array<{
    model: string; input_tokens: number; output_tokens: number;
    cache_write_tokens: number; cache_write_1h_tokens: number; cache_read_tokens: number;
  }>;
}

export interface StoredProviderSnapshot {
  limits?: StoredLimits;
  /** Keyed by machine name, so several computers can report the same day. */
  usage?: Record<string, StoredMachineUsage>;
}

export type StoredAiUsage = Partial<Record<AiProvider, StoredProviderSnapshot>>;

export type AiUsageErrorCode = 'invalid_key' | 'forbidden' | 'rate_limited' | 'unavailable' | 'timeout' | 'invalid_response';
export interface AiUsageProblem { code: AiUsageErrorCode; message: string }

/** Organization usage from an Admin API. */
export interface AdminUsage {
  /** Today's tokens per model, local day in the display time zone. */
  today: ModelTokens[];
  /** Billed cost this calendar month (UTC), in USD. */
  monthCostUsd: number;
}

export interface AiLimitView {
  /** "5h", "7d", … */
  label: string;
  /** Null once the window has reset since the last report: current use is unknown but starts from zero. */
  usedPercent: number | null;
  resetsAt: string;
}

export interface AiCostEstimate {
  tokens: number;
  /** Estimated at public API list prices. Null when no model in the counts has a known price. */
  costUsd: number | null;
  /** Some tokens belong to models without a known price, so costUsd is a lower bound. */
  partial: boolean;
}

export interface AiProviderView {
  provider: AiProvider;
  label: string;
  limits: AiLimitView[];
  /** When the quota windows were last reported, or null when never. */
  limitsObservedAt: string | null;
  /** Today's tokens from local CLI sessions plus Admin API usage, with an estimated cost. */
  today: AiCostEstimate | null;
  /** Billed API cost this month from the Admin API. */
  monthCostUsd: number | null;
  adminError?: AiUsageProblem;
}

export interface AiUsageData {
  providers: AiProviderView[];
}
