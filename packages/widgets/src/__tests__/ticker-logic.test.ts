import { describe, expect, it } from 'vitest';
import { configSchema } from '../widgets/ticker/config';
import { directionOf } from '../widgets/ticker/direction';
import { displaySymbol, formatChange, formatClock, formatNumber, formatPercent, formatPrice } from '../widgets/ticker/format';
import { aggregateStatus, marketStateAt } from '../widgets/ticker/marketStatus';
import { pickPage } from '../widgets/ticker/rotation';
import { arrowElements, sparklineElements } from '../widgets/ticker/sparkline';

describe('directionOf', () => {
  it.each([[1.2, 'up'], [-0.01, 'down'], [0, 'flat'], [0.004, 'flat'], [-0.004, 'flat'], [NaN, 'flat']] as const)('%s is %s', (value, expected) => {
    expect(directionOf(value)).toBe(expected);
  });
});

describe('pickPage', () => {
  const items = ['A', 'B', 'C', 'D', 'E'];
  const dwell = 15 * 60_000;
  it('splits into pages and reports the total', () => {
    expect(pickPage(items, 2, 15, 0)).toEqual({ items: ['A', 'B'], page: 1, pageCount: 3 });
  });
  it('advances once per dwell period and wraps around', () => {
    expect(pickPage(items, 2, 15, dwell - 1).page).toBe(1);
    expect(pickPage(items, 2, 15, dwell).items).toEqual(['C', 'D']);
    expect(pickPage(items, 2, 15, 2 * dwell).items).toEqual(['E']);
    expect(pickPage(items, 2, 15, 3 * dwell).page).toBe(1);
  });
  it('is stable within a dwell period', () => {
    expect(pickPage(items, 2, 15, dwell + 5)).toEqual(pickPage(items, 2, 15, dwell + 899_000));
  });
  it('handles empty lists and nonsense sizes', () => {
    expect(pickPage([], 3, 15, 123)).toEqual({ items: [], page: 1, pageCount: 1 });
    expect(pickPage(items, 0, 0, 0).items).toEqual(['A']);
  });
});

describe('formatting', () => {
  it('formats Danish and English numbers', () => {
    expect(formatNumber(1234567.891, 2, 'da')).toBe('1.234.567,89');
    expect(formatNumber(1234.5, 2, 'en')).toBe('1,234.50');
    expect(formatNumber(-0.5, 2, 'da')).toBe('0,50');
  });
  it('places currencies like a reader expects', () => {
    expect(formatPrice(612.4, 'DKK', 'da')).toBe('612,40 kr');
    expect(formatPrice(187.54, 'USD', 'en')).toBe('$187.54');
    expect(formatPrice(12.3, 'EUR', 'da')).toBe('€12,30');
    expect(formatPrice(95.1, 'SEK', 'da')).toBe('95,10 SEK');
    expect(formatPrice(0.1234, 'USD', 'en')).toBe('$0.1234');
  });
  it('signs changes and drops the sign on a flat move', () => {
    expect(formatPercent(-0.8, 'down', 'da')).toBe('-0,80 %');
    expect(formatPercent(1.236, 'up', 'en')).toBe('+1.24%');
    expect(formatPercent(0.001, 'flat', 'da')).toBe('0,00 %');
    expect(formatChange(-1.32, 'down', 'da')).toBe('-1,32');
    expect(formatChange(7.5, 'up', 'en')).toBe('+7.50');
    // A sub-1 move on a normal price keeps the price's two decimals.
    expect(formatChange(-0.76, 'down', 'da')).toBe('-0,76');
    expect(formatChange(-0.0012, 'down', 'en', 4)).toBe('-0.0012');
  });
  it('shortens only the Copenhagen suffix', () => {
    expect(displaySymbol('NOVO-B.CO')).toBe('NOVO-B');
    expect(displaySymbol('VOD.L')).toBe('VOD.L');
  });
  it('shows the clock in the display time zone', () => {
    expect(formatClock(Date.UTC(2026, 9, 6, 12, 31), 'Europe/Copenhagen')).toBe('14:31');
    expect(formatClock(Date.UTC(2026, 11, 6, 12, 31), 'Europe/Copenhagen')).toBe('13:31');
  });
});

describe('market status', () => {
  const sessions = {
    pre: { start: 100, end: 200 },
    regular: { start: 200, end: 300 },
    post: { start: 300, end: 400 },
  };
  it.each([[150, 'PRE'], [200, 'OPEN'], [299, 'OPEN'], [300, 'POST'], [400, 'CLOSED'], [50, 'CLOSED']] as const)('at %s seconds is %s', (sec, expected) => {
    expect(marketStateAt(sessions, sec * 1000)).toBe(expected);
  });
  it('is closed when the provider gives no sessions', () => {
    expect(marketStateAt(undefined, 1000)).toBe('CLOSED');
  });
  it('reports MIXED only when symbols disagree', () => {
    expect(aggregateStatus(['OPEN', 'OPEN'])).toBe('OPEN');
    expect(aggregateStatus(['OPEN', 'CLOSED'])).toBe('MIXED');
    expect(aggregateStatus([])).toBe('CLOSED');
  });
});

describe('config', () => {
  it('normalises, deduplicates and applies defaults', () => {
    const parsed = configSchema.parse({ symbols: [' novo-b.co ', 'NOVO-B.CO', 'nvda'] });
    expect(parsed).toMatchObject({ symbols: ['NOVO-B.CO', 'NVDA'], view: 'full', dwellMinutes: 15, locale: 'da', timeZone: 'Europe/Copenhagen' });
  });
  it.each([
    [{ symbols: [] }], [{ symbols: ['bad symbol'] }], [{ symbols: ['../x'] }],
    [{ symbols: Array.from({ length: 11 }, (_, i) => `S${i}`) }],
    [{ symbols: ['A'], view: 'wide' }], [{ symbols: ['A'], perPage: 0 }], [{ symbols: ['A'], timeZone: 'Mars/Base' }],
  ])('rejects %j', (input) => {
    expect(configSchema.safeParse(input).success).toBe(false);
  });
});

describe('drawing helpers', () => {
  it('draws opposite triangles for up and down, and a bar for flat', () => {
    const up = arrowElements('up', 0, 0, 7);
    const down = arrowElements('down', 0, 0, 7);
    expect(up.map((e) => (e as { width: number }).width)).toEqual([1, 3, 5, 7]);
    expect(down.map((e) => (e as { width: number }).width)).toEqual([7, 5, 3, 1]);
    expect(arrowElements('flat', 0, 0, 7)).toHaveLength(1);
  });
  it('keeps the sparkline inside its box and joins steep moves', () => {
    const box = { x: 10, y: 20, width: 30, height: 20 };
    const elements = sparklineElements([1, 1, 50, 1, 1, 100, 2], box, 10);
    expect(elements.length).toBeGreaterThan(0);
    for (const e of elements) {
      if (e.kind !== 'rect') throw new Error('only rects expected');
      expect(e.x).toBeGreaterThanOrEqual(box.x);
      expect(e.x + e.width).toBeLessThanOrEqual(box.x + box.width);
      expect(e.y).toBeGreaterThanOrEqual(box.y);
      expect(e.y + e.height).toBeLessThanOrEqual(box.y + box.height);
    }
  });
  it('returns nothing when there is nothing to draw', () => {
    expect(sparklineElements([], { x: 0, y: 0, width: 50, height: 20 })).toEqual([]);
    expect(sparklineElements([1], { x: 0, y: 0, width: 50, height: 20 })).toEqual([]);
    expect(sparklineElements([1, NaN, 2], { x: 0, y: 0, width: 1, height: 20 })).toEqual([]);
  });
  it('draws a flat series as a single level', () => {
    const rows = new Set(sparklineElements([5, 5, 5, 5], { x: 0, y: 0, width: 10, height: 11 }).map((e) => (e as { y: number }).y));
    expect(rows).toEqual(new Set([5]));
  });
});
