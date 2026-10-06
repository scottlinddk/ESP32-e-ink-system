import type { PixelRegion } from '@esp32-eink/types';

/** Width of one character cell. The display font is a fixed 8x8 bitmap, scaled in integer steps. */
export const CELL = 8;

export interface CondensedLayout {
  rows: number;
  twoLine: boolean;
  /** Header and footer (rule + text) are dropped in very small regions. */
  chrome: boolean;
  headerHeight: number;
  footerHeight: number;
  rowHeight: number;
  /** Symbol and price size. Change line is always `CELL`. */
  primary: number;
}

const MAX_ROWS = 10;
const CHROME = 12;

/**
 * Derives the condensed grid from the region alone. The widget's `fetch` and
 * `render` both call this, so the number of symbols loaded for a page is exactly
 * the number of rows drawn.
 */
export function condensedLayout(region: PixelRegion): CondensedLayout {
  const primary = region.heightPx > 200 ? CELL * 2 : CELL;
  const chrome = region.heightPx >= 48;
  const headerHeight = chrome ? CHROME : 0;
  const footerHeight = chrome ? CHROME : 0;
  const available = Math.max(0, region.heightPx - headerHeight - footerHeight);

  const twoLineHeight = primary + CELL + 4;
  const oneLineHeight = primary + 3;
  const twoLineRows = Math.floor(available / twoLineHeight);

  // Two lines read best, but three rows beats one cramped two-line row.
  if (twoLineRows >= 3) {
    return { rows: Math.min(twoLineRows, MAX_ROWS), twoLine: true, chrome, headerHeight, footerHeight, rowHeight: twoLineHeight, primary };
  }
  const oneLineRows = Math.max(1, Math.floor(available / oneLineHeight));
  return { rows: Math.min(oneLineRows, MAX_ROWS), twoLine: false, chrome, headerHeight, footerHeight, rowHeight: oneLineHeight, primary };
}
