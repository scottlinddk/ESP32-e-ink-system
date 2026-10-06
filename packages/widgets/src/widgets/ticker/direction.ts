import type { Direction } from './types';

/**
 * Classifies a move by what the display will actually show. A change that
 * rounds to 0.00 % is `flat`, so the screen never says "up" next to "+0,00 %".
 */
export function directionOf(changePercent: number): Direction {
  if (!Number.isFinite(changePercent)) return 'flat';
  const shown = Math.round(changePercent * 100) / 100;
  if (shown > 0) return 'up';
  if (shown < 0) return 'down';
  return 'flat';
}
