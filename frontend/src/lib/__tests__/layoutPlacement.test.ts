import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, type DisplayLayout } from '../../types';
import { clampWidgetToGrid, findWidgetSpace, layoutProblem } from '../layoutPlacement';

describe('new widget placement', () => {
  it('refuses to overlap a full display including its locked status row', () => {
    expect(findWidgetSpace(DEFAULT_LAYOUT)).toBeNull();
  });

  it('uses the row vacated by a removed widget', () => {
    const layout = { ...DEFAULT_LAYOUT, widgets: DEFAULT_LAYOUT.widgets.filter((w) => w.i !== 'news') };
    expect(findWidgetSpace(layout)).toEqual({ x: 0, y: 4, w: 10, h: 1 });
  });

  it('fits into a gap alongside a tall widget when no whole row is free', () => {
    const layout: DisplayLayout = {
      ...DEFAULT_LAYOUT,
      widgets: [
        { i: 'energy', x: 0, y: 0, w: 6, h: 5 },
        { i: 'status', x: 0, y: 5, w: 10, h: 1, static: true },
      ],
    };
    expect(findWidgetSpace(layout)).toEqual({ x: 6, y: 0, w: 4, h: 1 });
  });

  it('refuses a gap narrower than the editor minimum widget width', () => {
    const layout: DisplayLayout = {
      ...DEFAULT_LAYOUT,
      widgets: [{ i: 'energy', x: 0, y: 0, w: 9, h: 6 }],
    };
    expect(findWidgetSpace(layout)).toBeNull();
  });
});

describe('keeping widgets inside the 10 × 6 grid', () => {
  it('leaves a widget that already fits untouched', () => {
    expect(clampWidgetToGrid({ x: 2, y: 1, w: 4, h: 2 }, 10, 6)).toEqual({ x: 2, y: 1, w: 4, h: 2 });
  });
  it.each([
    ['too wide', { x: 6, y: 0, w: 9, h: 1 }, { x: 1, y: 0, w: 9, h: 1 }],
    ['too tall', { x: 0, y: 4, w: 2, h: 5 }, { x: 0, y: 1, w: 2, h: 5 }],
    ['past the right edge', { x: 9, y: 0, w: 2, h: 1 }, { x: 8, y: 0, w: 2, h: 1 }],
    ['past the bottom edge', { x: 0, y: 6, w: 2, h: 1 }, { x: 0, y: 5, w: 2, h: 1 }],
    ['negative position', { x: -3, y: -1, w: 2, h: 1 }, { x: 0, y: 0, w: 2, h: 1 }],
    ['zero size', { x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 1, h: 1 }],
    ['larger than the grid', { x: 4, y: 4, w: 99, h: 99 }, { x: 0, y: 0, w: 10, h: 6 }],
    ['fractional values', { x: 0.4, y: 1.6, w: 2.4, h: 1.2 }, { x: 0, y: 2, w: 2, h: 1 }],
    ['not a number', { x: NaN, y: NaN, w: NaN, h: NaN }, { x: 0, y: 0, w: 1, h: 1 }],
  ])('clamps a widget that is %s', (_name, widget, expected) => {
    expect(clampWidgetToGrid(widget, 10, 6)).toEqual(expected);
  });
  it('keeps the extra fields of a widget', () => {
    expect(clampWidgetToGrid({ x: 9, y: 0, w: 3, h: 1, static: true }, 10, 6)).toEqual({ x: 7, y: 0, w: 3, h: 1, static: true });
  });

  const grid = (...widgets: DisplayLayout['widgets']): DisplayLayout => ({ version: 1, cols: 10, rows: 6, widgets });
  it('accepts the default layout and a widget that fills the whole grid', () => {
    expect(layoutProblem(DEFAULT_LAYOUT)).toBeNull();
    expect(layoutProblem(grid({ i: 'a', x: 0, y: 0, w: 10, h: 6 }))).toBeNull();
  });
  it.each([
    [{ i: 'a', x: 6, y: 0, w: 5, h: 1 }],
    [{ i: 'a', x: 0, y: 5, w: 1, h: 2 }],
    [{ i: 'a', x: -1, y: 0, w: 2, h: 1 }],
    [{ i: 'a', x: 0, y: 0, w: 0, h: 1 }],
    [{ i: 'a', x: 0, y: 0, w: 1.5, h: 1 }],
  ])('reports a widget outside the grid %j', (widget) => {
    expect(layoutProblem(grid(widget))).toBe('outside-grid');
  });
  it('reports overlapping widgets, but not widgets that only touch', () => {
    expect(layoutProblem(grid({ i: 'a', x: 0, y: 0, w: 5, h: 2 }, { i: 'b', x: 4, y: 1, w: 3, h: 2 }))).toBe('overlap');
    expect(layoutProblem(grid({ i: 'a', x: 0, y: 0, w: 5, h: 2 }, { i: 'b', x: 5, y: 0, w: 5, h: 2 }, { i: 'c', x: 0, y: 2, w: 10, h: 1 }))).toBeNull();
  });
});
