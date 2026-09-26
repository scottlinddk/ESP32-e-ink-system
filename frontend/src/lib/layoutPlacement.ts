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
