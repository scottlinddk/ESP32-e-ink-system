import { describe, expect, it, vi } from 'vitest';
import { BmpCanvas } from '../utils/bmpGenerator';
import { fitOneLine, newsSource, renderNewsWidget } from '../utils/newsRenderer';

describe('newsSource', () => {
  it('returns the hostname without www', () => {
    expect(newsSource('https://www.example.com/a/b?c=1')).toBe('example.com');
    expect(newsSource('http://news.bbc.co.uk/x')).toBe('news.bbc.co.uk');
  });
  it('is empty for a missing, malformed or non-web URL', () => {
    expect(newsSource('')).toBe('');
    expect(newsSource('not a url')).toBe('');
    expect(newsSource('javascript:alert(1)')).toBe('');
  });
});

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
  const draw = (width: number, height: number, list = items, limit?: number) => {
    const canvas = new BmpCanvas({ width: Math.max(width, 64), height: Math.max(height, 64), rotation: 0, colorMode: 'bw' });
    const spy = vi.spyOn(canvas, 'drawText');
    renderNewsWidget(canvas, { x: 0, y: 0, width, height }, list, undefined, limit);
    return spy.mock.calls.map(([text, x, y]) => ({ text, x, y }));
  };

  it('numbers each headline and shows its source below the title', () => {
    const calls = draw(250, 122);
    expect(calls.map((c) => c.text).slice(0, 4)).toEqual(['1', 'Headline 1', 'Headline 1', 'site1.example']);
    expect(calls.filter((c) => /^site\d\.example$/.test(c.text))).toHaveLength(6);
  });
  it('stops at the item limit', () => {
    expect(draw(250, 122, items, 2).filter((c) => /^\d$/.test(c.text)).map((c) => c.text)).toEqual(['1', '2']);
  });
  it('does not draw a headline that does not fit the height', () => {
    expect(draw(250, 20).filter((c) => /^\d$/.test(c.text))).toHaveLength(1);
  });
  it('uses a single line per headline without a source', () => {
    const plain = items.map((item) => ({ ...item, url: '' }));
    expect(draw(250, 122, plain).filter((c) => /^\d$/.test(c.text))).toHaveLength(6);
  });
  it('splits headlines between two columns on a wide widget', () => {
    const ranks = draw(800, 480).filter((c) => /^\d$/.test(c.text));
    expect(ranks.map((c) => c.text)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(new Set(ranks.slice(0, 3).map((c) => c.x)).size).toBe(1);
    expect(ranks[3].x).toBeGreaterThan(ranks[0].x);
    expect(ranks[3].y).toBe(ranks[0].y);
  });
  it('keeps a narrow widget to one column', () => {
    expect(new Set(draw(250, 122).filter((c) => /^\d$/.test(c.text)).map((c) => c.x)).size).toBe(1);
  });
});
