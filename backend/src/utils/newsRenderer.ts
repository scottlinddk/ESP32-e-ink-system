import type { DisplayData } from '../types/index';
import { normalizeBitmapText } from './bitmapText';
import type { Bounds, DrawingCanvas } from './zoomCanvas';
import { DEFAULT_DISPLAY_LANGUAGE, type DisplayLanguage } from './displayLanguage';
import { displayStrings } from './displayStrings';

const GLYPH = 8;
/** A headline row is the title, a one pixel gap and the source line. */
const META_ROW_H = GLYPH * 2 + 1;
const META_PITCH = META_ROW_H + 3;
/** Without a source the row is the title alone. */
const PLAIN_PITCH = 12;
/** Two columns once each can hold a readable title beside its rank. */
const MIN_COLUMN_W = 160;
const COLUMN_GAP = 6;

/** The hostname of an article, without a leading "www."; empty when the URL is missing or unusable. */
export function newsSource(url: string): string {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? hostname.replace(/^www\./, '') : '';
  } catch { return ''; }
}

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
 * Numbered headlines, one per row: a bold title cut to one line over the article's source.
 * A wide widget fills a second column, so more headlines show without shrinking the text.
 */
export function renderNewsWidget(
  canvas: DrawingCanvas,
  bounds: Bounds,
  news?: DisplayData['news'],
  problem?: DisplayData['newsError'],
  limit?: number,
  language: DisplayLanguage = DEFAULT_DISPLAY_LANGUAGE,
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
  const columns = inner >= MIN_COLUMN_W * 2 + COLUMN_GAP ? 2 : 1;
  const columnW = Math.floor((inner - COLUMN_GAP * (columns - 1)) / columns);
  // The rank column is as wide as the largest rank, so titles line up.
  const rankW = String(items.length).length * GLYPH + 3;
  const textChars = Math.floor((columnW - rankW) / GLYPH);

  // Headlines are split evenly between the columns, unless a column runs out of room first.
  const perColumn = Math.ceil(items.length / columns);
  let column = 0;
  let inColumn = 0;
  let cursor = top;
  items.forEach((item, index) => {
    const source = newsSource(item.url);
    const rowH = source ? META_ROW_H : GLYPH;
    if (inColumn >= perColumn || cursor + rowH > y + height) {
      // Continue in the next column, or stop when the last one is full.
      if (column + 1 >= columns || top + rowH > y + height) return;
      column++;
      inColumn = 0;
      cursor = top;
    }
    inColumn++;
    const left = x + 2 + column * (columnW + COLUMN_GAP);
    canvas.drawText(String(index + 1), left, cursor, rankW);
    drawBold(canvas, fitOneLine(item.title, textChars), left + rankW, cursor, columnW - rankW);
    if (source) canvas.drawText(fitOneLine(source, textChars), left + rankW, cursor + GLYPH + 1, columnW - rankW);
    cursor += source ? META_PITCH : PLAIN_PITCH;
  });
}
