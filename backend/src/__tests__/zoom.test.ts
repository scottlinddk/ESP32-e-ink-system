import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DisplayLayout, WidgetLayout } from '../types/index';
import { autoZoom, chooseZoom, fitZoom, isWidgetZoom, isZoom } from '../utils/zoom';
import { ZoomCanvas, logicalBounds } from '../utils/zoomCanvas';
import { BmpCanvas, renderDisplayData, renderDisplayDataRaw } from '../utils/bmpGenerator';
import { LayoutValidationError, parseDisplayLayout } from '../utils/layoutValidation';
import { parseWidgetOptions } from '../utils/widgetOptions';
import { parseDisplaySchedule } from '../utils/scheduleValidation';

const RLCD = { width: 400, height: 300, rotation: 0 as const, colorMode: 'bw' as const };
const layout = (zoom: number | undefined, ...widgets: WidgetLayout[]): DisplayLayout =>
  ({ version: 1, cols: 10, rows: 6, ...(zoom === undefined ? {} : { zoom }), widgets });
const weather = { condition: 'Clear', temp: 12, windSpeed: 3 } as never;

describe('zoom choice', () => {
  it('derives an automatic zoom from the panel', () => {
    expect(autoZoom(250, 122)).toBe(1);
    expect(autoZoom(296, 128)).toBe(1);
    expect(autoZoom(400, 300)).toBe(2);
    expect(autoZoom(300, 400)).toBe(1); // judged on the width after rotation
    expect(autoZoom(400, 240)).toBe(2);
    expect(autoZoom(800, 480)).toBe(4);
    expect(autoZoom(1600, 1200)).toBe(4); // capped
    expect(autoZoom(64, 64)).toBe(1);
  });

  it('lets a widget override the layout, which overrides the panel', () => {
    expect(chooseZoom(3, 2, RLCD)).toBe(3);
    expect(chooseZoom(undefined, 1, RLCD)).toBe(1);
    expect(chooseZoom(undefined, undefined, RLCD)).toBe(2);
  });

  it('lowers a zoom that would leave no room for a line of text', () => {
    expect(fitZoom(4, 160, 50)).toBe(4);
    expect(fitZoom(4, 160, 25)).toBe(2); // 25 / 3 = 8 rows is too short, 25 / 2 = 12 is not
    expect(fitZoom(3, 80, 20)).toBe(2);
    expect(fitZoom(2, 20, 100)).toBe(1); // too narrow for a few characters
    expect(fitZoom(4, 10, 5)).toBe(1);
  });

  it('accepts only whole numbers from 1 to 4', () => {
    expect([1, 2, 3, 4].every(isZoom)).toBe(true);
    for (const bad of [0, 5, 1.5, -1, '2', null, undefined, NaN]) expect(isZoom(bad)).toBe(false);
  });

  it('lets a widget zoom move in steps of 0.2', () => {
    expect([1, 1.2, 1.4, 2.6, 3, 3.8, 4].every(isWidgetZoom)).toBe(true);
    for (const bad of [0.8, 1.1, 2.5, 4.2, 5, -1, '2', null, undefined, NaN, Infinity]) expect(isWidgetZoom(bad)).toBe(false);
  });

  it('lowers a fine zoom in fine steps and a whole zoom in whole ones', () => {
    expect(fitZoom(3.4, 160, 50)).toBe(3.4);
    expect(fitZoom(3.4, 160, 25)).toBe(2.4); // 25 / 2.4 = 10 rows is the most that still fits
    expect(fitZoom(1.4, 20, 100)).toBe(1);
    expect(fitZoom(4, 160, 25)).toBe(2); // unchanged for whole zooms
  });
});

describe('ZoomCanvas', () => {
  it('draws each logical pixel as a block and keeps clipping', () => {
    const canvas = new BmpCanvas(RLCD);
    const zoomed = new ZoomCanvas(canvas, 2);
    expect([zoomed.width, zoomed.height]).toEqual([200, 150]);
    zoomed.setPixel(3, 4, true);
    zoomed.drawHLine(10, 10, 3);
    zoomed.fillRect(20, 20, 2, 2);
    const black = new Set<string>();
    const raw = canvas.toRawPixels();
    for (let y = 0; y < 300; y++) for (let x = 0; x < 400; x++) {
      if (!(raw[y * 50 + (x >> 3)] & (0x80 >> (x & 7)))) black.add(`${x},${y}`);
    }
    expect(black.has('6,8') && black.has('7,9') && !black.has('8,8')).toBe(true); // one logical pixel
    expect(black.has('20,20') && black.has('25,21') && !black.has('26,20') && !black.has('20,22')).toBe(true); // a 2-thick line of 3
    expect(black.size).toBe(4 + 12 + 16);

    const clipped = new BmpCanvas(RLCD);
    new ZoomCanvas(clipped, 2).withClip({ x: 0, y: 0, width: 5, height: 5 }, () => new ZoomCanvas(clipped, 2).fillRect(0, 0, 50, 50));
    const clippedRaw = clipped.toRawPixels();
    expect(clippedRaw[0]).toBe(0x00); // x 0-7 of row 0 ... only 10 px wide are black
    expect(clippedRaw[1] & 0xc0).toBe(0x00);
    expect(clippedRaw[1] & 0x20).toBe(0x20);
    expect(clippedRaw[10 * 50]).toBe(0xff); // row 10 untouched
  });

  it('scales text, its width limit and its font scale', () => {
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    const zoomed = new ZoomCanvas(new BmpCanvas(RLCD), 3);
    zoomed.drawText('Hi', 4, 5, 40, 2, false);
    expect(draw).toHaveBeenCalledWith('Hi', 12, 15, 120, 6, false);
    draw.mockRestore();
  });

  it('wraps text at the logical width and reports a logical y', () => {
    const canvas = new BmpCanvas(RLCD);
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    const zoomed = new ZoomCanvas(canvas, 2);
    // 40 logical px = 5 characters per line.
    const after = zoomed.drawWrappedText('hello world', 0, 0, 40);
    expect(draw.mock.calls.map(([text]) => text)).toEqual(['hello', 'world']);
    expect(after).toBe(20);
    draw.mockRestore();
  });

  it('draws a fine zoom with block edges rounded, leaving no gaps', () => {
    const canvas = new BmpCanvas(RLCD);
    const zoomed = new ZoomCanvas(canvas, 1.4);
    expect([zoomed.width, zoomed.height]).toEqual([285, 214]);
    // Three neighbouring logical pixels cover 0..4 physical pixels: 1.4, 2.8 and 4.2 round to 1, 3, 4.
    for (const x of [0, 1, 2]) zoomed.setPixel(x, 0, true);
    const raw = canvas.toRawPixels();
    const blackAt = (x: number, y: number) => !(raw[y * 50 + (x >> 3)] & (0x80 >> (x & 7)));
    expect([0, 1, 2, 3, 4].map((x) => blackAt(x, 0))).toEqual([true, true, true, true, false]);
    expect(blackAt(0, 0)).toBe(true); // logical row 0 spans 0 to round(1.4) = 1
    expect(blackAt(0, 1)).toBe(false);
  });

  it('draws text at a fine zoom within the widget', () => {
    const canvas = new BmpCanvas(RLCD);
    new ZoomCanvas(canvas, 1.4).drawText('Hi', 2, 2, 40);
    const raw = canvas.toRawPixels();
    let black = 0;
    for (let y = 0; y < 300; y++) for (let x = 0; x < 400; x++) if (!(raw[y * 50 + (x >> 3)] & (0x80 >> (x & 7)))) black++;
    expect(black).toBeGreaterThan(0);
  });

  it('rejects a zoom outside the supported range', () => {
    expect(() => new ZoomCanvas(new BmpCanvas(RLCD), 5)).toThrow(RangeError);
    expect(() => new ZoomCanvas(new BmpCanvas(RLCD), 1.5)).toThrow(RangeError);
  });

  it('puts logical bounds inside the physical ones and keeps y > 0 below the top', () => {
    expect(logicalBounds({ x: 0, y: 0, width: 400, height: 50 }, 2)).toEqual({ x: 0, y: 0, width: 200, height: 25 });
    expect(logicalBounds({ x: 41, y: 51, width: 100, height: 100 }, 4)).toEqual({ x: 11, y: 13, width: 24, height: 24 });
    const odd = logicalBounds({ x: 1, y: 1, width: 7, height: 7 }, 4);
    expect(odd.y).toBeGreaterThan(0);
    expect((odd.x + odd.width) * 4).toBeLessThanOrEqual(8);
  });
});

describe('rendering with zoom', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const weatherAt = (zoom: number | undefined, options?: WidgetLayout['options'], profile: typeof RLCD | null = RLCD) => {
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    renderDisplayDataRaw({ nextRefresh: 1000, weather }, layout(zoom, { i: 'weather', x: 0, y: 0, w: 10, h: 2, ...(options ? { options } : {}) }),
      { display_profile: profile });
    const [call] = draw.mock.calls;
    draw.mockRestore();
    return call;
  };

  it('keeps small panels exactly as before', () => {
    // 250 x 122 picks zoom 1: text at scale 1, 2 px in.
    expect(weatherAt(undefined, undefined, null)).toEqual(['Clear  12C', 2, 2, 246]);
  });

  it('enlarges a 400 x 300 panel automatically', () => {
    // zoom 2: logical x 2 -> 4, maxWidth (200 - 4) -> 392, font scale 2.
    expect(weatherAt(undefined)).toEqual(['Clear  12C', 4, 4, 392, 2, true]);
  });

  it('lets the layout and then the widget choose', () => {
    expect(weatherAt(1)).toEqual(['Clear  12C', 2, 2, 396]);
    expect(weatherAt(1, { zoom: 3 })).toEqual(['Clear  12C', 6, 6, 387, 3, true]);
    expect(weatherAt(4, { zoom: 1 })).toEqual(['Clear  12C', 2, 2, 396]);
  });

  it('shows fewer news items at a larger zoom, never past the widget', () => {
    const news = Array.from({ length: 10 }, (_, index) => ({ title: `Headline ${index}`, url: 'https://example.com' }));
    const titles = (zoom: number) => {
      const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
      renderDisplayDataRaw({ nextRefresh: 1000, news }, layout(zoom, { i: 'news', x: 0, y: 0, w: 10, h: 3 }), { display_profile: RLCD });
      const rows = draw.mock.calls.map(([text]) => text);
      draw.mockRestore();
      return rows.length;
    };
    expect(titles(1)).toBeGreaterThan(titles(2));
    expect(titles(2)).toBeGreaterThan(titles(4));
    expect(titles(4)).toBeGreaterThan(0);
  });

  it('sizes news text between the whole zooms', () => {
    const news = Array.from({ length: 10 }, (_, index) => ({ title: `Headline ${index}`, url: 'https://example.com' }));
    const scales = (zoom: number) => {
      const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
      renderDisplayDataRaw({ nextRefresh: 1000, news }, layout(1, { i: 'news', x: 0, y: 0, w: 10, h: 6, options: { zoom } }), { display_profile: RLCD });
      const scale = draw.mock.calls[1][4];
      draw.mockRestore();
      return scale;
    };
    expect(scales(1.4)).toBeCloseTo(1.4);
    expect(scales(2.6)).toBeCloseTo(2.6);
  });

  it('lowers a zoom that does not fit a single-row widget', () => {
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    // A 250 x 122 panel has 20 px rows: zoom 3 would leave 6 logical px, too few for a line, so it gives way to 2.
    renderDisplayDataRaw({ nextRefresh: 1000, weather }, layout(3, { i: 'weather', x: 0, y: 0, w: 10, h: 1 }));
    expect(draw.mock.calls[0]).toEqual(['Clear  12C', 4, 4, 242, 2, true]);
  });

  it('draws nothing outside a zoomed widget', () => {
    const news = Array.from({ length: 5 }, (_, index) => ({ title: `Long headline number ${index} that wraps`, url: 'https://example.com' }));
    // The zoom is the widget's own, so fine steps are allowed (the layout's stays whole).
    const widget = (zoom: number): WidgetLayout => ({ i: 'news', x: 0, y: 0, w: 5, h: 2, options: { zoom } });
    const bmp = (zoom: number) => renderDisplayData({ nextRefresh: 1000, news }, layout(undefined, widget(zoom)), { display_profile: RLCD });
    const raw = (zoom: number) => renderDisplayDataRaw({ nextRefresh: 1000, news }, layout(undefined, widget(zoom)), { display_profile: RLCD });
    for (const zoom of [1, 1.4, 2, 2.6, 4]) {
      const pixels = raw(zoom);
      expect(bmp(zoom).length).toBeGreaterThan(0);
      for (let y = 0; y < 300; y++) for (let byte = 0; byte < 50; byte++) {
        const insideBytes = y < 100 && byte < 25;
        if (!insideBytes) expect(pixels[y * 50 + byte]).toBe(0xff);
      }
    }
  });

  it('leaves a custom image at full resolution', () => {
    const image = { width: 8, height: 1, pixels: Buffer.from([0x00]).toString('base64'), fit: 'contain' as const };
    const raw = (zoom: number | undefined) => renderDisplayDataRaw({ nextRefresh: 1000, customImage: image },
      layout(zoom, { i: 'custom-image', x: 0, y: 0, w: 10, h: 6 }), { display_profile: RLCD });
    expect(raw(4).equals(raw(1))).toBe(true);
    expect(raw(undefined).equals(raw(1))).toBe(true);
  });
});

describe('zoom validation', () => {
  it('keeps layout and widget zoom and drops nothing else', () => {
    const parsed = parseDisplayLayout(layout(3,
      { i: 'energy', x: 0, y: 0, w: 10, h: 3, options: { view: 'day', zoom: 2 } },
      { i: 'weather', x: 0, y: 3, w: 10, h: 2, options: { zoom: 1 } },
    ));
    expect(parsed.zoom).toBe(3);
    expect(parsed.widgets.map((widget) => widget.options)).toEqual([{ view: 'day', zoom: 2 }, { zoom: 1 }]);
    expect('zoom' in parseDisplayLayout(layout(undefined, { i: 'status', x: 0, y: 5, w: 10, h: 1 }))).toBe(false);
  });

  it.each([0, 5, 1.5, '2', null])('rejects layout zoom %j', (zoom) => {
    expect(() => parseDisplayLayout({ ...layout(undefined, { i: 'status', x: 0, y: 5, w: 10, h: 1 }), zoom })).toThrow(LayoutValidationError);
  });

  it('accepts a widget zoom in steps of 0.2 but a layout zoom only whole', () => {
    expect(parseWidgetOptions('news', { items: 3, zoom: 1.4 })).toEqual({ zoom: 1.4, items: 3 });
    expect(parseWidgetOptions('status', { zoom: 3.8 })).toEqual({ zoom: 3.8 });
    expect(() => parseDisplayLayout({ ...layout(undefined, { i: 'status', x: 0, y: 5, w: 10, h: 1 }), zoom: 1.4 })).toThrow(LayoutValidationError);
  });

  it.each([['energy', { zoom: 0 }], ['news', { zoom: 5 }], ['weather', { zoom: 2.5 }], ['status', { zoom: '2' }], ['news', { zoom: 1.1 }],
    ['weather', { zoom: 2, days: 3 }], ['custom-image', { zoom: 2 }]])('rejects %s options %j', (id, options) => {
    expect(() => parseWidgetOptions(id, options)).toThrow();
  });

  it('accepts a news font weight, storing only what differs from the default', () => {
    expect(parseWidgetOptions('news', { weight: 'regular', columns: 2 })).toEqual({ weight: 'regular', columns: 2 });
    expect(parseWidgetOptions('news:feed1', { weight: 'regular' })).toEqual({ weight: 'regular' });
    expect(parseWidgetOptions('news', { weight: 'light' })).toEqual({ weight: 'light' });
    expect(parseWidgetOptions('news', { weight: 'bold' })).toBeUndefined();
    for (const bad of ['heavy', 'Regular', 1, null]) expect(() => parseWidgetOptions('news', { weight: bad })).toThrow();
    expect(() => parseWidgetOptions('weather', { weight: 'regular' })).toThrow();
  });

  it('accepts zoom on widgets that have no other options', () => {
    for (const id of ['weather', 'status', 'monta', 'notion', 'custom-text', 'battery', 'week-number']) {
      expect(parseWidgetOptions(id, { zoom: 2 })).toEqual({ zoom: 2 });
    }
  });

  it('is kept by scheduled pages', () => {
    const page = { id: 'p1', name: 'Page', duration_seconds: 60, layout: layout(2, { i: 'weather', x: 0, y: 0, w: 10, h: 2, options: { zoom: 3 } }) };
    const parsed = parseDisplaySchedule({ enabled: true, timezone: 'Europe/Copenhagen', pages: [page], quiet_hours: { enabled: false, start: '22:00', end: '06:00' } });
    expect(parsed.pages[0].layout.zoom).toBe(2);
    expect(parsed.pages[0].layout.widgets[0].options).toEqual({ zoom: 3 });
  });
});
