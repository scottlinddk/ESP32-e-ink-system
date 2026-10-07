import type { AiCostEstimate, ModelTokens } from './types';

// Public API list prices in USD per million tokens, used only to *estimate* what
// subscription usage would cost at API rates and to price today's Admin API tokens.
// Billed monthly cost comes from the providers' cost reports, never from this table.
//
// Anthropic: platform.claude.com pricing, checked 2026-10-07. Cache writes cost 1.25x
// input for the 5-minute lifetime and 2x for the 1-hour lifetime Claude Code uses.
// OpenAI: taken from published third-party summaries of the OpenAI pricing page,
// which was not reachable when this table was written; verify before relying on it.
// OpenAI has no cache-write charge.
//
// Model IDs are matched exactly after normalization: an unknown model is reported
// as unpriced rather than guessed from a similar name.

export interface ModelPrice { input: number; output: number; cacheWrite: number; cacheWrite1h: number; cacheRead: number }

const price = (input: number, output: number, cacheRead: number, cacheWrite = input * 1.25, cacheWrite1h = input * 2): ModelPrice =>
  ({ input, output, cacheWrite, cacheWrite1h, cacheRead });

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-fable-5-1': price(10, 50, 0.25),
  'claude-mythos-5-1': price(10, 50, 0.25),
  'claude-fable-5': price(10, 50, 1),
  'claude-mythos-5': price(10, 50, 1),
  'claude-opus-5-5': price(4, 20, 0.2),
  'claude-opus-5': price(5, 25, 0.5),
  'claude-opus-4-8': price(5, 25, 0.5),
  'claude-opus-4-7': price(5, 25, 0.5),
  'claude-opus-4-6': price(5, 25, 0.5),
  'claude-opus-4-5': price(5, 25, 0.5),
  'claude-opus-4-1': price(15, 75, 1.5),
  'claude-opus-4': price(15, 75, 1.5),
  'claude-sonnet-5-5': price(2, 10, 0.2),
  'claude-sonnet-5': price(2, 10, 0.2),
  'claude-sonnet-4-6': price(3, 15, 0.3),
  'claude-sonnet-4-5': price(3, 15, 0.3),
  'claude-sonnet-4': price(3, 15, 0.3),
  'claude-haiku-4-5': price(1, 5, 0.1),
  'gpt-6-astra': price(10, 50, 1, 0, 0),
  'gpt-6-sol': price(2, 10, 0.2, 0, 0),
  'gpt-6-luna': price(0.1, 0.5, 0.01, 0, 0),
};

/** Lowercases and removes provider prefixes, date snapshots and context-window suffixes. */
export function normalizeModelId(model: string): string {
  return model.trim().toLowerCase()
    .replace(/^(anthropic|openai)[./]/, '')
    .replace(/\[[^\]]*\]$/, '')
    .replace(/[-@]\d{8}$/, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

export function modelPrice(model: string): ModelPrice | null {
  return MODEL_PRICES[normalizeModelId(model)] ?? null;
}

export function totalTokens(tokens: Omit<ModelTokens, 'model' | 'cacheWrite1h'>): number {
  return tokens.input + tokens.output + tokens.cacheWrite + tokens.cacheRead;
}

export function estimateCost(models: ModelTokens[]): AiCostEstimate {
  let tokens = 0;
  let cost = 0;
  let priced = false;
  let partial = false;
  for (const entry of models) {
    const count = totalTokens(entry);
    tokens += count;
    if (count === 0) continue;
    const rate = modelPrice(entry.model);
    if (!rate) { partial = true; continue; }
    priced = true;
    const longWrites = Math.min(entry.cacheWrite1h, entry.cacheWrite);
    cost += (entry.input * rate.input + entry.output * rate.output + (entry.cacheWrite - longWrites) * rate.cacheWrite
      + longWrites * rate.cacheWrite1h + entry.cacheRead * rate.cacheRead) / 1_000_000;
  }
  return { tokens, costUsd: priced ? cost : null, partial: priced && partial };
}

/** Adds counts for the same normalized model together. */
export function mergeModelTokens(...lists: ModelTokens[][]): ModelTokens[] {
  const merged = new Map<string, ModelTokens>();
  for (const entry of lists.flat()) {
    const key = normalizeModelId(entry.model);
    const current = merged.get(key) ?? { model: key, input: 0, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 };
    current.input += entry.input;
    current.output += entry.output;
    current.cacheWrite += entry.cacheWrite;
    current.cacheWrite1h += entry.cacheWrite1h;
    current.cacheRead += entry.cacheRead;
    merged.set(key, current);
  }
  return [...merged.values()];
}
