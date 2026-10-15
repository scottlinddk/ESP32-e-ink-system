import { describe, expect, it, vi } from 'vitest';
import { BmpCanvas, renderDisplayDataRaw } from '../utils/bmpGenerator';
import { fitOneLine, renderNewsWidget } from '../utils/newsRenderer';

describe('fitOneLine', () => {
  it('keeps text that fits and cuts the rest with an ellipsis', () => {
    expect(fitOneLine('Short', 10)).toBe('Short');
    expect(fitOneLine('A headline that is far too long', 12)).toBe('A headlin...');
  });
  it('collapses whitespace and never exceeds the width', () => {
    expect(fitOneLine('  two   words ', 20)).toBe('two words');
    for (const max of [0, 1, 2, 3, 4, 8]) expect(Array.from(fitOneLine('x'.repeat(40), max)).length).toBeLessThanOrEqual(max);
  });
});

describe('renderNewsWidget', () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ title: `Headline ${i + 1}`, url: `https://site${i + 1}.example/a` }));
  /** Draws in a widget of the given size on a canvas big enough to hold it. */
  const draw = (width: number, height: number, list = items, limit?: number, columns?: number) => {
    const canvas = new BmpCanvas({ width: Math.max(width, 64), height: Math.max(height, 64), rotation: 0, colorMode: 'bw' });
    const spy = vi.spyOn(canvas, 'drawText');
    renderNewsWidget(canvas, { x: 0, y: 0, width, height }, list, undefined, limit, undefined, columns);
    return spy.mock.calls.map(([text, x, y]) => ({ text, x, y }));
  };

  it('numbers each headline and draws its bold title, without a source line', () => {
    const calls = draw(250, 122);
    expect(calls.map((c) => c.text).slice(0, 4)).toEqual(['1', 'Headline 1', 'Headline 1', '2']);
    expect(calls.some((c) => c.text.includes('.example'))).toBe(false);
  });
  it('stops at the item limit', () => {
    expect(draw(250, 122, items, 2).filter((c) => /^\d$/.test(c.text)).map((c) => c.text)).toEqual(['1', '2']);
  });
  it('does not draw a headline that does not fit the height', () => {
    expect(draw(250, 20).filter((c) => /^\d$/.test(c.text))).toHaveLength(1);
  });
  const ranks = (calls: ReturnType<typeof draw>) => calls.filter((c) => /^\d$/.test(c.text));
  it('defaults to one column, however wide the widget is', () => {
    expect(new Set(ranks(draw(800, 480)).map((c) => c.x)).size).toBe(1);
  });
  it('splits headlines evenly between the requested columns', () => {
    const two = ranks(draw(800, 480, items, undefined, 2));
    expect(two.map((c) => c.text)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(new Set(two.slice(0, 3).map((c) => c.x)).size).toBe(1);
    expect(two[3].x).toBeGreaterThan(two[0].x);
    expect(two[3].y).toBe(two[0].y);
    expect(new Set(ranks(draw(800, 480, items, undefined, 3)).map((c) => c.x)).size).toBe(3);
  });
  it('shows fewer columns than requested when the widget is too narrow', () => {
    expect(new Set(ranks(draw(100, 122, items, undefined, 4)).map((c) => c.x)).size).toBe(1);
    expect(new Set(ranks(draw(250, 122, items, undefined, 4)).map((c) => c.x)).size).toBe(3);
  });
  it('treats an invalid column count as one', () => {
    for (const columns of [0, -1, 1.5, Number.NaN]) {
      expect(new Set(ranks(draw(800, 480, items, undefined, columns)).map((c) => c.x)).size).toBe(1);
    }
  });
  it('moves to the next column when the first runs out of height', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ title: `H${i + 1}`, url: '' }));
    const placed = ranks(draw(800, 40, many, undefined, 2));
    // Three rows fit a column, so six of the nine headlines show and the rest are dropped.
    expect(placed.map((c) => c.text)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(new Set(placed.slice(0, 3).map((c) => c.x)).size).toBe(1);
    expect(placed[3].x).toBeGreaterThan(placed[0].x);
  });
});

describe('news text size', () => {
  const news = Array.from({ length: 6 }, (_, i) => ({ title: `Headline ${i + 1}`, url: '' }));
  const layout = (zoom?: number) => ({ version: 1 as const, cols: 10, rows: 6,
    widgets: [{ i: 'news', x: 0, y: 0, w: 10, h: 6, ...(zoom ? { options: { zoom } } : {}) }] });
  const scales = (zoom?: number) => {
    const spy = vi.spyOn(BmpCanvas.prototype, 'drawText');
    try {
      renderDisplayDataRaw({ nextRefresh: 60_000, news }, layout(zoom));
      return { scales: new Set(spy.mock.calls.map((call) => call[4] ?? 1)), ranks: spy.mock.calls.filter((call) => /^\d$/.test(call[0])).length };
    } finally { spy.mockRestore(); }
  };

  it('draws the headlines larger with the widget text size, so fewer fit', () => {
    const normal = scales();
    const large = scales(2);
    expect([...normal.scales]).toEqual([1]);
    expect([...large.scales]).toEqual([2]);
    expect(normal.ranks).toBe(6);
    expect(large.ranks).toBeLessThan(normal.ranks);
    expect(large.ranks).toBeGreaterThan(0);
  });
});
