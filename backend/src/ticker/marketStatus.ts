import type { MarketState, MarketStatus, TradingSessions } from './types';

const within = (period: { start: number; end: number } | undefined, nowSec: number): boolean =>
  !!period && nowSec >= period.start && nowSec < period.end;

/** Derives the session from the exchange's own trading periods, not from the clock alone. */
export function marketStateAt(sessions: TradingSessions | undefined, nowMs: number): MarketState {
  const nowSec = nowMs / 1000;
  if (within(sessions?.regular, nowSec)) return 'OPEN';
  if (within(sessions?.pre, nowSec)) return 'PRE';
  if (within(sessions?.post, nowSec)) return 'POST';
  return 'CLOSED';
}

/** One state if every symbol agrees, otherwise `MIXED` (e.g. Copenhagen closed, New York open). */
export function aggregateStatus(states: readonly MarketState[]): MarketStatus {
  if (states.length === 0) return 'CLOSED';
  return states.every((s) => s === states[0]) ? states[0] : 'MIXED';
}
