import type { DisplayData } from '../types/index';
import { normalizeBitmapText } from './bitmapText';
import type { Bounds, DrawingCanvas } from './zoomCanvas';
import { DEFAULT_DISPLAY_LANGUAGE, type DisplayLanguage } from './displayLanguage';
import { displayStrings } from './displayStrings';

const GLYPH = 8;
/** A headline row is the title and a few pixels of air. */
const ROW_PITCH = 12;
/** The narrowest column that still holds a rank and a few characters of title. */
const MIN_COLUMN_W = 64;
const COLUMN_GAP = 6;

/** Fits text on one line of `maxChars` glyphs, ending in "..." when it is cut. */
export function fitOneLine(text: string, maxChars: number): string {
  const characters = Array.from(normalizeBitmapText(text).replace(/\s+/gu, ' ').trim());
  if (maxChars < 1) return '';
  if (characters.length <= maxChars) return characters.join('');
  if (maxChars <= 3) return characters.slice(0, maxChars).join('');
  return `${characters.slice(0, maxChars - 3).join('').trimEnd()}...`;
}

/** The 8x8 font has no bold, so a title is drawn twice, one pixel apart. */
function drawBold(canvas: DrawingCanvas, text: string, x: number, y: number, maxWidth: number): void {
  canvas.drawText(text, x, y, maxWidth);
  canvas.drawText(text, x + 1, y, maxWidth);
}

/**
 * Numbered headlines, one per row: a rank and a bold title cut to one line.
 * `columns` splits them side by side, as many as the width allows at the least.
 */
export function renderNewsWidget(
  canvas: DrawingCanvas,
  bounds: Bounds,
  news?: DisplayData['news'],
  problem?: DisplayData['newsError'],
  limit?: number,
  language: DisplayLanguage = DEFAULT_DISPLAY_LANGUAGE,
  columns = 1,
): void {
  const { x, y, width, height } = bounds;
  const t = displayStrings(language).news;
  if (y > 0) canvas.drawHLine(x, y, width);
  const top = y + 2;
  const inner = width - 4;
  if (!news || news.length === 0) {
    canvas.drawText(news ? t.none : problem ? t.errors[problem.code] : t.unavailable, x + 2, top, inner);
    return;
  }

  const items = news.slice(0, limit);
  // A request for more columns than fit is lowered, so a narrow widget never shows slivers.
  const fits = Math.max(1, Math.floor((inner + COLUMN_GAP) / (MIN_COLUMN_W + COLUMN_GAP)));
  const columnCount = Math.min(Number.isInteger(columns) && columns >= 1 ? columns : 1, fits);
  const columnW = Math.floor((inner - COLUMN_GAP * (columnCount - 1)) / columnCount);
  // The rank column is as wide as the largest rank, so titles line up.
  const rankW = String(items.length).length * GLYPH + 3;
  const textChars = Math.floor((columnW - rankW) / GLYPH);

  // Headlines are split evenly between the columns, unless a column runs out of room first.
  const perColumn = Math.ceil(items.length / columnCount);
  let column = 0;
  let inColumn = 0;
  let cursor = top;
  items.forEach((item, index) => {
    if (inColumn >= perColumn || cursor + GLYPH > y + height) {
      // Continue in the next column, or stop when the last one is full.
      if (column + 1 >= columnCount || top + GLYPH > y + height) return;
      column++;
      inColumn = 0;
      cursor = top;
    }
    inColumn++;
    const left = x + 2 + column * (columnW + COLUMN_GAP);
    canvas.drawText(String(index + 1), left, cursor, rankW);
    drawBold(canvas, fitOneLine(item.title, textChars), left + rankW, cursor, columnW - rankW);
    cursor += ROW_PITCH;
  });
}
