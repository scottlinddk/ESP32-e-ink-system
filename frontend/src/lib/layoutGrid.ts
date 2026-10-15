import type { DisplayLayout } from '../types';

// Mirrors backend/src/utils/layoutGrid.ts. A finer grid multiplies the 10 × 6 base by a whole
// scale, so widgets can be made smaller and larger panels get more precise placement.
export const BASE_GRID_COLS = 10;
export const BASE_GRID_ROWS = 6;
export const GRID_SCALES = [1, 2, 4] as const;
export type GridScale = typeof GRID_SCALES[number];

export const gridLabel = (scale: GridScale) => `${BASE_GRID_COLS * scale} × ${BASE_GRID_ROWS * scale}`;

/** The scale of the layout's grid, or null for a size the server would reject. */
export function layoutScale(layout: Pick<DisplayLayout, 'cols' | 'rows'>): GridScale | null {
  return GRID_SCALES.find((scale) => layout.cols === BASE_GRID_COLS * scale && layout.rows === BASE_GRID_ROWS * scale) ?? null;
}

/**
 * The layout on another grid, or null when a widget would not land on whole cells. A finer grid
 * always works: every position and size is multiplied, so each widget keeps its exact pixels. A
 * coarser one works only when everything is a multiple of the ratio, because rounding could
 * overlap two widgets or change a widget's size without asking.
 */
export function changeGrid(layout: DisplayLayout, scale: GridScale): DisplayLayout | null {
  const current = layoutScale(layout);
  if (current === null) return null;
  if (current === scale) return layout;
  const finer = scale > current;
  const ratio = finer ? scale / current : current / scale;
  if (!finer && layout.widgets.some((w) => [w.x, w.y, w.w, w.h].some((n) => n % ratio !== 0))) return null;
  const map = (n: number) => (finer ? n * ratio : n / ratio);
  return {
    ...layout,
    cols: BASE_GRID_COLS * scale,
    rows: BASE_GRID_ROWS * scale,
    widgets: layout.widgets.map((w) => ({ ...w, x: map(w.x), y: map(w.y), w: map(w.w), h: map(w.h) })),
  };
}

export type InvertMode = 'off' | 'always' | 'sun';

/** The mode a layout is in; a missing or false flag is off. */
export function layoutInvertMode(layout: DisplayLayout): InvertMode {
  return layout.invert === 'sun' ? 'sun' : layout.invert === true ? 'always' : 'off';
}

/** Sets the layout's invert mode; off is the default and is not stored. */
export function updateLayoutInvert(layout: DisplayLayout, mode: InvertMode | boolean): DisplayLayout {
  const { invert: _previous, ...rest } = layout;
  if (mode === 'sun') return { ...rest, invert: 'sun' };
  return mode === true || mode === 'always' ? { ...rest, invert: true } : rest;
}
