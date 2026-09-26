import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, type DisplayLayout } from '../../types';
import { findWidgetSpace } from '../layoutPlacement';

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
