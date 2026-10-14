import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DisplayLayout, WidgetLayout } from '../types/index';
import { BmpCanvas, renderDisplayData, renderDisplayDataRaw } from '../utils/bmpGenerator';
import { LayoutValidationError, parseDisplayLayout } from '../utils/layoutValidation';
import { gridScale } from '../utils/layoutGrid';
import { parseWidgetOptions } from '../utils/widgetOptions';

const layout = (cols: number, rows: number, widgets: WidgetLayout[], extra: Partial<DisplayLayout> = {}): DisplayLayout =>
  ({ version: 1, cols, rows, widgets, ...extra });
const data = { nextRefresh: 300_000 };
const STRIDE = 32;

/** Black pixels (bit 0) of a 250 × 122 raw bitmap inside a region. */
function black(raw: Buffer, x0: number, x1: number, y0: number, y1: number): number {
  let count = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (!(raw[y * STRIDE + (x >> 3)] & (0x80 >> (x & 7)))) count++;
  return count;
}

describe('layout grid sizes', () => {
  it('knows the supported scales', () => {
    expect(gridScale(10, 6)).toBe(1);
    expect(gridScale(20, 12)).toBe(2);
    expect(gridScale(40, 24)).toBe(4);
    expect(gridScale(20, 6)).toBeNull();
    expect(gridScale(30, 18)).toBeNull();
    expect(gridScale('10', 6)).toBeNull();
  });

  it.each([[10, 6], [20, 12], [40, 24]])('accepts a %i × %i grid and keeps its size', (cols, rows) => {
    const parsed = parseDisplayLayout(layout(cols, rows, [{ i: 'status', x: cols - 2, y: rows - 1, w: 2, h: 1 }]));
    expect(parsed.cols).toBe(cols);
    expect(parsed.rows).toBe(rows);
  });

  it.each([[20, 6], [10, 12], [30, 18], [5, 3], [0, 0]])('rejects a %i × %i grid', (cols, rows) => {
    expect(() => parseDisplayLayout(layout(cols, rows, []))).toThrow(LayoutValidationError);
  });

  it('bounds widgets by the layout grid, not by 10 × 6', () => {
    expect(() => parseDisplayLayout(layout(10, 6, [{ i: 'status', x: 0, y: 6, w: 10, h: 1 }]))).toThrow('10 × 6');
    expect(() => parseDisplayLayout(layout(20, 12, [{ i: 'status', x: 0, y: 6, w: 20, h: 1 }]))).not.toThrow();
    expect(() => parseDisplayLayout(layout(20, 12, [{ i: 'status', x: 19, y: 0, w: 2, h: 1 }]))).toThrow('20 × 12');
  });
});

describe('inverting a layout', () => {
  it('validates the flag and stores only a true one', () => {
    expect(parseDisplayLayout(layout(10, 6, [], { invert: true })).invert).toBe(true);
    expect('invert' in parseDisplayLayout(layout(10, 6, [], { invert: false }))).toBe(false);
    expect('invert' in parseDisplayLayout(layout(10, 6, []))).toBe(false);
    expect(() => parseDisplayLayout({ ...layout(10, 6, []), invert: 'yes' })).toThrow('invert');
    expect(() => parseDisplayLayout({ ...layout(10, 6, []), invert: 1 })).toThrow('invert');
  });

  it('turns an empty layout from white to black', () => {
    const plain = renderDisplayDataRaw(data, layout(10, 6, []));
    const inverted = renderDisplayDataRaw(data, layout(10, 6, [], { invert: true }));
    expect(black(plain, 0, 250, 0, 122)).toBe(0);
    expect(black(inverted, 0, 250, 0, 122)).toBe(250 * 122);
  });

  it('is the exact negative of the normal rendering and never touches row padding', () => {
    const widgets: WidgetLayout[] = [{ i: 'status', x: 0, y: 0, w: 10, h: 2 }, { i: 'week-number', x: 0, y: 3, w: 5, h: 3 }];
    const plain = renderDisplayDataRaw(data, layout(10, 6, widgets));
    const inverted = renderDisplayDataRaw(data, layout(10, 6, widgets, { invert: true }));
    for (let y = 0; y < 122; y++) {
      for (let x = 0; x < 250; x++) {
        const bit = (raw: Buffer) => raw[y * STRIDE + (x >> 3)] & (0x80 >> (x & 7));
        expect(!!bit(inverted)).toBe(!bit(plain));
      }
      // The six padding bits after pixel 249 stay white, as the display protocol expects.
      expect(inverted[y * STRIDE + 31] & 0x3f).toBe(0x3f);
    }
  });

  it('gives the same bitmap in the BMP and raw outputs', () => {
    const l = layout(10, 6, [{ i: 'status', x: 0, y: 0, w: 10, h: 1 }], { invert: true });
    expect(renderDisplayData(data, l).subarray(62)).toEqual(renderDisplayDataRaw(data, l));
  });

  it.each([90, 180, 270] as const)('inverts a panel rotated %i degrees completely', (rotation) => {
    const profile = { width: 250, height: 122, rotation, colorMode: 'bw' as const };
    const inverted = new BmpCanvas(profile);
    inverted.invertArea({ x: 0, y: 0, width: inverted.width, height: inverted.height });
    const raw = inverted.toRawPixels();
    const rowBytes = Math.ceil(250 / 8);
    for (let y = 0; y < 122; y++) {
      for (let x = 0; x < 250; x++) expect(raw[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7))).toBe(0);
    }
    // Padding bits beyond the 250th pixel are not pixels and stay set.
    expect(raw[rowBytes - 1] & 0x3f).toBe(0x3f);
  });

  it('keeps a photo as it was instead of turning it into a negative', () => {
    const image = { width: 8, height: 8, pixels: Buffer.alloc(8, 0x00).toString('base64'), fit: 'cover' as const }; // all black
    const widgets: WidgetLayout[] = [{ i: 'custom-image', x: 0, y: 0, w: 4, h: 3 }];
    const photoData = { nextRefresh: 1, customImage: image };
    const plain = renderDisplayDataRaw(photoData, layout(10, 6, widgets));
    const inverted = renderDisplayDataRaw(photoData, layout(10, 6, widgets, { invert: true }));
    // Inside the photo's cell (100 × 60 px) the pixels are identical; around it the background went black.
    expect(black(plain, 0, 100, 0, 60)).toBe(100 * 60);
    expect(black(inverted, 0, 100, 0, 60)).toBe(100 * 60);
    expect(black(inverted, 100, 250, 0, 122)).toBe(150 * 122);
    expect(black(inverted, 0, 100, 60, 122)).toBe(100 * 62);
  });
});

describe('finer grids', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('places a scaled layout on exactly the same pixels as the base grid', () => {
    const base = layout(10, 6, [{ i: 'week-number', x: 2, y: 1, w: 4, h: 2 }, { i: 'status', x: 0, y: 5, w: 10, h: 1 }]);
    const fine = layout(20, 12, [{ i: 'week-number', x: 4, y: 2, w: 8, h: 4 }, { i: 'status', x: 0, y: 10, w: 20, h: 2 }]);
    const finest = layout(40, 24, [{ i: 'week-number', x: 8, y: 4, w: 16, h: 8 }, { i: 'status', x: 0, y: 20, w: 40, h: 4 }]);
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    const expected = renderDisplayDataRaw(data, base);
    expect(renderDisplayDataRaw(data, fine)).toEqual(expected);
    expect(renderDisplayDataRaw(data, finest)).toEqual(expected);
  });

  it('makes a status bar half as tall on the 20 × 12 grid', () => {
    // Text sits at y + 2, so a 10 px bar still shows the whole 8 px line.
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    const raw = renderDisplayDataRaw(data, layout(20, 12, [{ i: 'status', x: 0, y: 11, w: 20, h: 1 }]));
    expect(draw.mock.calls[0][0]).toMatch(/^Refresh: 5min/);
    expect(black(raw, 0, 250, 110, 120)).toBeGreaterThan(0);
    expect(black(raw, 0, 250, 0, 110)).toBe(0);
    draw.mockRestore();
  });
});

describe('compact status', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('accepts a view for the status widget only', () => {
    expect(parseWidgetOptions('status', { view: 'condensed' })).toEqual({ view: 'condensed' });
    expect(parseWidgetOptions('status', { view: 'full', zoom: 2 })).toEqual({ view: 'full', zoom: 2 });
    expect(() => parseWidgetOptions('status', { view: 'day' })).toThrow('view');
    expect(() => parseWidgetOptions('status', { items: 3 })).toThrow('unsupported');
    expect(() => parseWidgetOptions('week-number', { view: 'condensed' })).toThrow();
  });

  it('draws the time alone when condensed', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    const widgets = (view?: 'condensed'): WidgetLayout[] => [{ i: 'status', x: 0, y: 0, w: 3, h: 1, ...(view ? { options: { view } } : {}) }];
    renderDisplayDataRaw(data, layout(10, 6, widgets('condensed')), { display_timezone: 'UTC' });
    expect(draw.mock.calls.map(([text]) => text)).toEqual(['12:00']);
    draw.mockClear();
    renderDisplayDataRaw(data, layout(10, 6, widgets()), { display_timezone: 'UTC' });
    expect(draw.mock.calls[0][0]).toBe('Refresh: 5min  12:00');
  });
});
