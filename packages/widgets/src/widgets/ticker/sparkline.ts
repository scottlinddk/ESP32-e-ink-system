import type { RenderElement } from '@esp32-eink/types';
import type { Direction } from './types';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Draws a line chart using only `rect` elements, so any renderer that can fill
 * rectangles can draw it. One 1px-wide rect per column joins each point to the
 * previous one, which keeps steep moves connected.
 *
 * `baseline` (the previous close) is drawn as a dotted line and included in the
 * scale, so the reader sees whether the day is above or below yesterday.
 */
export function sparklineElements(series: readonly number[], box: Box, baseline?: number): RenderElement[] {
  const values = series.filter(Number.isFinite);
  if (values.length < 2 || box.width < 2 || box.height < 2) return [];

  const scaled = baseline !== undefined && Number.isFinite(baseline) ? [...values, baseline] : values;
  const min = Math.min(...scaled);
  const max = Math.max(...scaled);
  const span = max - min;
  const rowOf = (v: number): number =>
    span === 0 ? Math.floor((box.height - 1) / 2) : Math.round(((max - v) / span) * (box.height - 1));

  const columns = Math.min(box.width, values.length);
  const elements: RenderElement[] = [];

  if (baseline !== undefined && Number.isFinite(baseline)) {
    const y = box.y + rowOf(baseline);
    for (let x = box.x; x < box.x + box.width; x += 4) {
      elements.push({ kind: 'rect', x, y, width: Math.min(2, box.x + box.width - x), height: 1, fill: true });
    }
  }

  let previous: number | undefined;
  for (let c = 0; c < columns; c++) {
    // Last value of each bucket: the series is already oldest-first.
    const index = columns === 1 ? 0 : Math.round((c * (values.length - 1)) / (columns - 1));
    const row = rowOf(values[index]);
    const from = previous === undefined ? row : Math.min(previous, row);
    const to = previous === undefined ? row : Math.max(previous, row);
    elements.push({ kind: 'rect', x: box.x + Math.floor((c * (box.width - 1)) / Math.max(1, columns - 1)), y: box.y + from, width: 1, height: to - from + 1, fill: true });
    previous = row;
  }
  return elements;
}

/**
 * Direction arrows are drawn as shapes: the display font has no triangle glyph
 * (unsupported characters render as `?`). `size` is the base width in pixels.
 */
export function arrowElements(direction: Direction, x: number, y: number, size = 7): RenderElement[] {
  const width = size % 2 === 0 ? size + 1 : size;
  const height = (width + 1) / 2;
  if (direction === 'flat') {
    return [{ kind: 'rect', x, y: y + Math.floor(height / 2), width, height: 2, fill: true }];
  }
  const elements: RenderElement[] = [];
  for (let row = 0; row < height; row++) {
    const rowWidth = direction === 'up' ? 1 + row * 2 : width - row * 2;
    elements.push({ kind: 'rect', x: x + (width - rowWidth) / 2, y: y + row, width: rowWidth, height: 1, fill: true });
  }
  return elements;
}

export function arrowSize(size = 7): { width: number; height: number } {
  const width = size % 2 === 0 ? size + 1 : size;
  return { width, height: (width + 1) / 2 };
}
