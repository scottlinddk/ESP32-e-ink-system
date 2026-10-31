import { normalizeBitmapText, wrapBitmapText } from './bitmapText';
import type { Bounds, DrawingCanvas } from './zoomCanvas';

/** Shared rhythm in logical pixels; ZoomCanvas scales it with the rest of the widget. */
export const WIDGET_PAD = 2;
export const WIDGET_GLYPH = 8;
export const WIDGET_LINE = 10;

export function fitWidgetText(text: string, width: number, scale = 1): string {
  const chars = Array.from(normalizeBitmapText(text));
  const count = Math.max(0, Math.floor(width / (WIDGET_GLYPH * scale)));
  if (chars.length <= count) return chars.join('');
  if (count < 1) return '';
  return `${chars.slice(0, count - 1).join('').trimEnd()}…`;
}

/** Prefer a complete shorter label to truncating a reading or its unit. */
export function widgetLabel(candidates: string[], width: number): string {
  return candidates.find(text => Array.from(normalizeBitmapText(text)).length * WIDGET_GLYPH <= width)
    ?? fitWidgetText(candidates[candidates.length - 1] ?? '', width);
}

/** Shorten the label first so the reading and its unit stay together. */
export function widgetReading(label: string, value: string, width: number): string {
  const room = width - (Array.from(normalizeBitmapText(value)).length + 2) * WIDGET_GLYPH;
  return widgetLabel([`${label}: ${value}`, ...(room >= 2 * WIDGET_GLYPH ? [`${fitWidgetText(label, room)}: ${value}`] : []), value], width);
}

/** A consistent inset heading and list, without a rule when the widget is only two lines tall. */
export function drawWidgetRows(canvas: DrawingCanvas, bounds: Bounds, title: string, rows: string[]): void {
  const x = bounds.x + WIDGET_PAD;
  const width = bounds.width - 2 * WIDGET_PAD;
  const bottom = bounds.y + bounds.height;
  let y = bounds.y + WIDGET_PAD;
  if (y + WIDGET_GLYPH > bottom) return;
  canvas.drawText(title, x, y, width);
  y += WIDGET_LINE;
  if (rows.length && bounds.height >= 34) {
    canvas.drawHLine(x, y, width);
    y += 4;
  }
  for (const row of rows) {
    if (y + WIDGET_GLYPH > bottom) break;
    canvas.drawText(row, x, y, width);
    y += WIDGET_LINE;
  }
}

/**
 * All text widgets get the same overflow behavior, including fine zooms and rotated panels.
 * Keep intentional inner clipping (inverse labels, week progress) on the target canvas;
 * only the outer widget bounds decide whether a whole line fits.
 */
export class WidgetCanvas implements DrawingCanvas {
  readonly width: number;
  readonly height: number;

  constructor(private readonly target: DrawingCanvas, private readonly bounds: Bounds, private readonly suppressTopRule = false) {
    this.width = target.width;
    this.height = target.height;
  }

  setPixel(x: number, y: number, black: boolean): void { this.target.setPixel(x, y, black); }
  fillRect(x: number, y: number, w: number, h: number, black = true): void { this.target.fillRect(x, y, w, h, black); }
  drawHLine(x: number, y: number, w: number): void {
    // Remove boundary rules before zoom rounds logical pixels to physical pixels.
    // Raster-row detection misses rules shortened by fractional zoom rounding.
    if (this.suppressTopRule && y === this.bounds.y) return;
    this.target.drawHLine(x, y, w);
  }
  withClip(bounds: Bounds, draw: () => void): void { this.target.withClip(bounds, draw); }

  drawText(text: string, x: number, y: number, maxWidth = this.width, scale?: number, black?: boolean, light?: boolean): void {
    if (y < this.bounds.y || y + WIDGET_GLYPH * (scale ?? 1) > this.bounds.y + this.bounds.height) return;
    const room = Math.min(maxWidth, this.bounds.x + this.bounds.width - x);
    const fitted = fitWidgetText(text, room, scale);
    if (!fitted) return;
    // Preserve optional argument shapes for ordinary text and the light news weight.
    if (light) this.target.drawText(fitted, x, y, room, scale, black, true);
    else if (black !== undefined) this.target.drawText(fitted, x, y, room, scale, black);
    else if (scale !== undefined) this.target.drawText(fitted, x, y, room, scale);
    else this.target.drawText(fitted, x, y, room);
  }

  drawWrappedText(text: string, x: number, y: number, width: number, lineH = WIDGET_LINE, scale = 1): number {
    const room = Math.min(width, this.bounds.x + this.bounds.width - x);
    const glyph = WIDGET_GLYPH * scale;
    const chars = Math.floor(room / glyph);
    if (chars < 1 || y < this.bounds.y || !Number.isFinite(lineH) || lineH < 1) return y;
    const count = Math.max(0, Math.floor((this.bounds.y + this.bounds.height - y - glyph) / lineH) + 1);
    if (!count) return y;
    const lines: string[] = [];
    for (const line of wrapBitmapText(text, chars)) {
      if (lines.length === count) {
        lines[count - 1] = fitWidgetText(`${lines[count - 1]} …`, room, scale);
        break;
      }
      lines.push(line);
    }
    lines.forEach((line, index) => this.drawText(line, x, y + index * lineH, room, scale));
    return y + lines.length * lineH;
  }
}
