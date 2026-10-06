import type { DisplayLayout, WidgetLayout } from '../types';

/** Prefer a full-width row, then the widest available gap, without moving widgets. */
export function findWidgetSpace(layout: DisplayLayout): Omit<WidgetLayout, 'i'> | null {
  for (let width = layout.cols; width >= 2; width--) {
    for (let y = 0; y < layout.rows; y++) {
      for (let x = 0; x <= layout.cols - width; x++) {
        const overlaps = layout.widgets.some((widget) =>
          x < widget.x + widget.w && x + width > widget.x &&
          y < widget.y + widget.h && y + 1 > widget.y,
        );
        if (!overlaps) return { x, y, w: width, h: 1 };
      }
    }
  }
  return null;
}

const MIN_SIZE = 1;

/** Keeps a widget inside the grid: whole numbers, at least 1 × 1, and never past the last column or row. */
export function clampWidgetToGrid<T extends Omit<WidgetLayout, 'i'>>(widget: T, cols: number, rows: number): T {
  const whole = (value: number, fallback: number) => (Number.isFinite(value) ? Math.round(value) : fallback);
  const w = Math.min(cols, Math.max(MIN_SIZE, whole(widget.w, MIN_SIZE)));
  const h = Math.min(rows, Math.max(MIN_SIZE, whole(widget.h, MIN_SIZE)));
  const x = Math.min(cols - w, Math.max(0, whole(widget.x, 0)));
  const y = Math.min(rows - h, Math.max(0, whole(widget.y, 0)));
  return { ...widget, x, y, w, h };
}

export type LayoutProblem = 'outside-grid' | 'overlap';

/** What would make the backend reject this layout: a widget outside the grid, or two that overlap. */
export function layoutProblem(layout: DisplayLayout): LayoutProblem | null {
  const { cols, rows, widgets } = layout;
  const whole = (n: number) => Number.isInteger(n);
  if (widgets.some((w) => ![w.x, w.y, w.w, w.h].every(whole) || w.x < 0 || w.y < 0 || w.w < 1 || w.h < 1
    || w.x + w.w > cols || w.y + w.h > rows)) return 'outside-grid';
  const overlaps = widgets.some((a, i) => widgets.slice(i + 1).some((b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y));
  return overlaps ? 'overlap' : null;
}
