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
  const items = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'].map((title, i) => ({ title, url: `https://site${i + 1}.example/a` }));
  /** Draws in a widget of the given size on a canvas big enough to hold it. */
  const draw = (width: number, height: number, list = items, limit?: number, columns?: number, weight?: 'light' | 'regular' | 'bold') => {
    const canvas = new BmpCanvas({ width: Math.max(width, 64), height: Math.max(height, 64), rotation: 0, colorMode: 'bw' });
    const spy = vi.spyOn(canvas, 'drawText');
    renderNewsWidget(canvas, { x: 0, y: 0, width, height }, list, undefined, limit, undefined, columns, weight);
    return spy.mock.calls.map(([text, x, y]) => ({ text, x, y }));
  };

  it('numbers each headline and draws its bold title, without a source line', () => {
    const calls = draw(250, 122);
    expect(calls.map((c) => c.text).slice(0, 4)).toEqual(['1', 'Alpha', 'Alpha', '2']);
    expect(calls.some((c) => c.text.includes('.example'))).toBe(false);
  });
  it('draws a regular title once and a bold one twice, a pixel apart', () => {
    const titles = (weight?: 'light' | 'regular' | 'bold') => draw(250, 122, items, 1, undefined, weight).filter((c) => c.text === 'Alpha');
    expect(titles('regular')).toHaveLength(1);
    const bold = titles('bold');
    expect(bold).toHaveLength(2);
    expect(bold[1].x - bold[0].x).toBe(1);
    expect(titles()).toEqual(bold); // bold is the default
  });
  it('draws a light title once, with every other glyph pixel left out', () => {
    const black = (weight: 'light' | 'regular') => {
      const canvas = new BmpCanvas({ width: 250, height: 64, rotation: 0, colorMode: 'bw' });
      renderNewsWidget(canvas, { x: 0, y: 0, width: 250, height: 64 }, items, undefined, 1, undefined, undefined, weight);
      return canvas.toRawPixels().reduce((sum, byte) => sum + (8 - byte.toString(2).replace(/0/g, '').length), 0);
    };
    const regular = black('regular');
    const light = black('light');
    expect(light).toBeGreaterThan(0);
    expect(light).toBeLessThan(regular * 0.75);
    expect(draw(250, 122, items, 1, undefined, 'light').filter((c) => c.text === 'Alpha')).toHaveLength(1);
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

describe('headline wrapping', () => {
  const long = { title: 'A rather long headline about energy prices in Denmark today', url: '' };
  const draw = (width: number, height: number, list: Array<{ title: string; url: string }>, columns?: number) => {
    const canvas = new BmpCanvas({ width: Math.max(width, 64), height: Math.max(height, 64), rotation: 0, colorMode: 'bw' });
    const spy = vi.spyOn(canvas, 'drawText');
    renderNewsWidget(canvas, { x: 0, y: 0, width, height }, list, undefined, undefined, undefined, columns);
    return spy.mock.calls.map(([text, x, y]) => ({ text, x, y }));
  };
  // Every line is drawn twice (bold), so read each once.
  const lines = (calls: ReturnType<typeof draw>) => calls.filter((_, i, all) => i === 0 || all[i - 1].text !== all[i].text || all[i - 1].y !== all[i].y);

  it('wraps a long title over several lines instead of cutting it', () => {
    const calls = draw(250, 122, [long]);
    const body = lines(calls).filter((c) => c.text !== '1');
    expect(body.length).toBeGreaterThan(1);
    expect(body.map((c) => c.text).join(' ')).toBe(long.title);
    expect(body.some((c) => c.text.includes('...'))).toBe(false);
    expect(new Set(body.map((c) => c.x)).size).toBe(1);
    expect(body.map((c) => c.y)).toEqual([...body.map((c) => c.y)].sort((a, b) => a - b));
    expect(new Set(body.map((c) => c.y)).size).toBe(body.length);
  });
  it('starts the next headline below the last line of the previous one', () => {
    const calls = draw(250, 122, [long, { title: 'Short', url: '' }]);
    const second = calls.find((c) => c.text === '2')!;
    const lastOfFirst = Math.max(...lines(calls).filter((c) => c.text !== '1' && c.text !== '2' && c.text !== 'Short').map((c) => c.y));
    expect(second.y).toBeGreaterThan(lastOfFirst + 7);
  });
  it('moves a headline that does not fit the rest of a column to the next column whole', () => {
    const list = [long, long, { title: 'Short', url: '' }];
    // Two narrow columns: the first headline takes five lines, leaving room for one more line.
    const calls = draw(250, 60, list, 2);
    const ranks = calls.filter((c) => /^\d$/.test(c.text));
    expect(ranks.map((c) => c.text)).toEqual(['1', '2', '3']);
    expect(ranks[1].x).toBeGreaterThan(ranks[0].x);
    // The second headline starts at the top of its column with all of its lines.
    expect(ranks[1].y).toBe(ranks[0].y);
  });
  it('stops at the first headline that does not fit, rather than skipping to a shorter one', () => {
    // In a 10 character column the long headline needs seven lines, more than remain; a short one would still fit after it.
    const calls = draw(100, 60, [{ title: 'First', url: '' }, long, { title: 'Last', url: '' }]);
    expect(calls.filter((c) => /^\d$/.test(c.text)).map((c) => c.text)).toEqual(['1']);
  });
  it('cuts a headline taller than the whole widget, ending its last line in an ellipsis', () => {
    const calls = draw(250, 22, [long]);
    const body = lines(calls).filter((c) => c.text !== '1');
    expect(body).toHaveLength(2);
    expect(body[body.length - 1].text.endsWith('...')).toBe(true);
    expect(body[0].text.endsWith('...')).toBe(false);
  });
  it('wraps to the zoomed width, so larger text takes more lines', () => {
    const wrapped = (zoom?: number) => {
      const spy = vi.spyOn(BmpCanvas.prototype, 'drawText');
      try {
        renderDisplayDataRaw({ nextRefresh: 1, news: [long] }, { version: 1, cols: 10, rows: 6,
          widgets: [{ i: 'news', x: 0, y: 0, w: 10, h: 6, ...(zoom ? { options: { zoom } } : {}) }] });
        return new Set(spy.mock.calls.filter((c) => c[0] !== '1').map((c) => c[2])).size;
      } finally { spy.mockRestore(); }
    };
    expect(wrapped(2)).toBeGreaterThan(wrapped());
  });
});

describe('news text size', () => {
  const news = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'].map((title) => ({ title, url: '' }));
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
