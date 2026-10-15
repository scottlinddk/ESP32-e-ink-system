import type { DisplayData } from '../types/index';
import { normalizeBitmapText, wrapBitmapText } from './bitmapText';
import type { Bounds, DrawingCanvas } from './zoomCanvas';
import { DEFAULT_DISPLAY_LANGUAGE, type DisplayLanguage } from './displayLanguage';
import { displayStrings } from './displayStrings';
import { DEFAULT_NEWS_WEIGHT, type NewsWeight } from './widgetOptions';

const GLYPH = 8;
/** A line of title is the glyph and a pixel of air; headlines are set apart by a few more. */
const LINE_H = GLYPH + 1;
const ROW_GAP = 4;
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

/** The first `limit` lines of a title wrapped to `maxChars` glyphs, without laying out the rest. */
function takeLines(text: string, maxChars: number, limit: number): string[] {
  const lines: string[] = [];
  for (const line of wrapBitmapText(text.replace(/\s+/gu, ' ').trim(), maxChars)) {
    if (lines.length >= limit) break;
    lines.push(line);
  }
  return lines;
}

/** How many lines of title fit in `room` pixels; the last line needs no air below it. */
const linesIn = (room: number) => Math.max(0, Math.floor((room + 1) / LINE_H));

/**
 * The 8x8 font has one weight with 1 px strokes. Bold is a title drawn twice, one pixel apart; a
 * heavier smear runs the letters together. Light cannot thin a 1 px stroke, so it drops every other
 * glyph pixel instead, a dithered paler text that is the least legible of the three.
 */
function drawTitle(canvas: DrawingCanvas, text: string, x: number, y: number, maxWidth: number, weight: NewsWeight): void {
  if (weight === 'light') {
    canvas.drawText(text, x, y, maxWidth, 1, true, true);
    return;
  }
  canvas.drawText(text, x, y, maxWidth);
  if (weight === 'bold') canvas.drawText(text, x + 1, y, maxWidth);
}

/**
 * Numbered headlines: a rank and a bold title that wraps over as many lines as it needs. A headline
 * is never split between columns; one too long for a whole column is cut with "..." on its last line.
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
  weight: NewsWeight = DEFAULT_NEWS_WEIGHT,
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
  const columnRoom = y + height - top;
  let column = 0;
  let inColumn = 0;
  let cursor = top;
  for (const [index, item] of items.entries()) {
    const wanted = takeLines(item.title, textChars, linesIn(columnRoom) + 1);
    let room = y + height - cursor;
    if (inColumn >= perColumn || (inColumn > 0 && wanted.length > linesIn(room))) {
      // Continue in the next column, or stop when the last one is full.
      if (column + 1 >= columnCount) break;
      column++;
      inColumn = 0;
      cursor = top;
      room = columnRoom;
    }
    const fit = linesIn(room);
    if (fit < 1) break;
    const lines = wanted.length ? wanted.slice(0, fit) : [''];
    // Only a headline taller than its column gets here cut: mark where its last line stops.
    if (wanted.length > fit) lines[fit - 1] = fitOneLine(`${wanted[fit - 1]} ${wanted[fit]}`, textChars);
    inColumn++;
    const left = x + 2 + column * (columnW + COLUMN_GAP);
    canvas.drawText(String(index + 1), left, cursor, rankW);
    lines.forEach((line, row) => drawTitle(canvas, line, left + rankW, cursor + row * LINE_H, columnW - rankW, weight));
    cursor += lines.length * LINE_H - 1 + ROW_GAP;
  }
}
