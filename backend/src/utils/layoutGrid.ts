// Layout grid sizes. The base grid is 10 × 6; a finer grid multiplies both by a whole scale, so a
// layout can be refined without moving anything: a widget on the base grid keeps its exact pixels
// when its x, y, w and h are multiplied by the scale. Larger panels (400 × 300 and up) have room
// for the finer cells; on the 250 × 122 panel a cell shrinks to 12 × 10 px at 2× and 6 × 5 px at 4×.
// Mirrored in frontend/src/lib/layoutGrid.ts.

export const BASE_GRID_COLS = 10;
export const BASE_GRID_ROWS = 6;
export const GRID_SCALES = [1, 2, 4] as const;
export type GridScale = typeof GRID_SCALES[number];

/** The scale of a grid with this many columns and rows, or null when it is not a supported size. */
export function gridScale(cols: unknown, rows: unknown): GridScale | null {
  return GRID_SCALES.find((scale) => cols === BASE_GRID_COLS * scale && rows === BASE_GRID_ROWS * scale) ?? null;
}
