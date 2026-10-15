import { describe, expect, it } from 'vitest';
import { drawWeatherIcon, iconFamily } from '../utils/weatherIcons';

/** A tiny pixel grid that records what an icon paints. */
function grid(size: number) {
  const pixels = new Set<string>();
  const outside: string[] = [];
  const set = (x: number, y: number, black: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) { if (black) outside.push(`${x},${y}`); return; }
    if (black) pixels.add(`${x},${y}`); else pixels.delete(`${x},${y}`);
  };
  return {
    pixels, outside,
    setPixel: set,
    fillRect(x: number, y: number, w: number, h: number, black = true) {
      for (let row = y; row < y + h; row++) for (let column = x; column < x + w; column++) set(column, row, black);
    },
  };
}
const draw = (icon: string, size: number) => {
  const canvas = grid(size);
  drawWeatherIcon(canvas, icon, 0, 0, size);
  return canvas;
};

const FAMILIES = ['01', '02', '03', '04', '09', '10', '11', '13', '50'];
const CODES = FAMILIES.flatMap((family) => [`${family}d`, `${family}n`]);

describe('weather icons', () => {
  it('knows the family and the time of day of an OpenWeatherMap code', () => {
    expect(iconFamily('10n')).toEqual({ family: '10', night: true });
    expect(iconFamily('01d')).toEqual({ family: '01', night: false });
  });

  it.each(CODES.flatMap((code) => [12, 16, 24, 32, 48].map((size) => [code, size] as const)))(
    '%s paints something and stays inside a %i px box', (code, size) => {
      const { pixels, outside } = draw(code, size);
      expect(pixels.size).toBeGreaterThan(size);
      expect(outside).toEqual([]);
      // It never fills the box: an icon is a drawing, not a block.
      expect(pixels.size).toBeLessThan(size * size * 0.6);
    });

  it('is deterministic', () => {
    expect([...draw('10d', 24).pixels].sort()).toEqual([...draw('10d', 24).pixels].sort());
  });

  it('draws every family differently, and day differently from night where it matters', () => {
    const drawings = FAMILIES.map((family) => [...draw(`${family}d`, 32).pixels].sort().join('|'));
    expect(new Set(drawings).size).toBe(FAMILIES.length);
    for (const family of ['01', '02', '10']) {
      expect([...draw(`${family}d`, 32).pixels].sort()).not.toEqual([...draw(`${family}n`, 32).pixels].sort());
    }
  });

  it('draws nothing below a readable size and falls back to a cloud for an unknown family', () => {
    expect(draw('01d', 5).pixels.size).toBe(0);
    expect([...draw('99d', 24).pixels].sort()).toEqual([...draw('03d', 24).pixels].sort());
  });

  it('draws clouds solid when tiny and outlined when larger', () => {
    const tiny = draw('03d', 12).pixels;
    const large = draw('03d', 32).pixels;
    // The middle of a large cloud is empty; the middle of a tiny one is filled.
    expect(tiny.has('6,7')).toBe(true);
    expect(large.has('16,19')).toBe(false);
  });
});
