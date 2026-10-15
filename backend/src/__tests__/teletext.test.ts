import { describe, expect, it } from 'vitest';
import type { DisplayData, DisplayLayout, WidgetLayout } from '../types/index';
import { renderDisplayDataRaw } from '../utils/bmpGenerator';
import { parseDisplayLayout } from '../utils/layoutValidation';
import {
  drawTeletextTitleBar, renderTeletextHeader, teletextClock, teletextKind, teletextPages, teletextTitle, TITLE_BAR_HEIGHT,
} from '../utils/teletext';
import type { DrawingCanvas } from '../utils/zoomCanvas';

const widget = (i: string, x: number, y: number, w: number, h: number): WidgetLayout => ({ i, x, y, w, h });
const layout = (widgets: WidgetLayout[], extra: Partial<DisplayLayout> = {}): DisplayLayout => ({ version: 1, cols: 10, rows: 6, widgets, ...extra });
const data: DisplayData = { nextRefresh: 300_000, price: { now: 182, average: 150, trend: 'up' } };
// 21:03 UTC on Wednesday 14 October is 23:03 in Copenhagen.
const NOW = new Date('2026-10-14T21:03:00Z');

const isWhite = (raw: Buffer, x: number, y: number) => (raw[y * 32 + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
/** True when every pixel of the row, from `from` to `to` (exclusive), is black. */
const blackRow = (raw: Buffer, y: number, from = 0, to = 250) => Array.from({ length: to - from }, (_, i) => !isWhite(raw, from + i, y)).every(Boolean);

/** Records what a renderer asks for, so the text and bars can be checked without reading pixels. */
function recorder(width = 250, height = 122) {
  const fills: Array<[number, number, number, number]> = [];
  const texts: Array<{ text: string; x: number; y: number; black: boolean | undefined }> = [];
  const canvas: DrawingCanvas = {
    width, height,
    setPixel: () => undefined,
    withClip: (_bounds, draw) => draw(),
    drawHLine: () => undefined,
    fillRect: (x, y, w, h) => { fills.push([x, y, w, h]); },
    drawText: (text, x, y, _maxWidth, _scale, black) => { texts.push({ text, x, y, black }); },
    drawWrappedText: (_text, _x, y) => y,
  };
  return { canvas, fills, texts };
}

describe('teletext layout flag', () => {
  it('is kept when true and not stored when false', () => {
    expect(parseDisplayLayout(layout([], { teletext: true })).teletext).toBe(true);
    expect('teletext' in parseDisplayLayout(layout([], { teletext: false }))).toBe(false);
    expect('teletext' in parseDisplayLayout(layout([]))).toBe(false);
  });

  it('rejects anything that is not a boolean', () => {
    for (const bad of ['yes', 1, null, {}]) {
      expect(() => parseDisplayLayout({ ...layout([]), teletext: bad })).toThrow('teletext');
    }
  });

  it('combines with inverted colours', () => {
    const parsed = parseDisplayLayout(layout([], { teletext: true, invert: 'sun' }));
    expect(parsed.teletext).toBe(true);
    expect(parsed.invert).toBe('sun');
  });
});

describe('which widgets get a bar', () => {
  it('titles every widget by kind, extra feeds and calendars included', () => {
    expect(teletextKind('energy')).toBe('energy');
    expect(teletextKind('news')).toBe('news');
    expect(teletextKind('news:abc123')).toBe('news');
    expect(teletextKind('weather')).toBe('weather');
    expect(teletextKind('custom-text')).toBe('text');
    expect(teletextKind('week-number')).toBe('week');
    expect(teletextKind('ai-usage')).toBe('aiUsage');
  });

  it('leaves a photo and the status bar without one', () => {
    expect(teletextKind('custom-image')).toBeNull();
    expect(teletextKind('status')).toBeNull();
    expect(teletextTitle('custom-image', 'da')).toBeNull();
  });

  it('names the widgets in the display language', () => {
    expect(teletextTitle('news', 'da')).toBe('NYHEDER');
    expect(teletextTitle('news', 'en')).toBe('NEWS');
    expect(teletextTitle('energy', 'da')).toBe('ELPRIS');
  });

  it('numbers pages from 101 in reading order, whatever the order in the layout', () => {
    const pages = teletextPages(layout([
      widget('news', 0, 3, 10, 2), widget('status', 0, 5, 10, 1), widget('weather', 5, 0, 5, 3),
      widget('energy', 0, 0, 5, 3), widget('custom-image', 0, 4, 2, 1),
    ]));
    expect(Object.fromEntries(pages)).toEqual({ energy: 101, weather: 102, news: 103 });
  });
});

describe('title bar', () => {
  const bounds = { x: 10, y: 20, width: 100, height: 40 };

  it('fills the top of the widget, writes the title in white and the page at the right edge', () => {
    const { canvas, fills, texts } = recorder();
    const rest = drawTeletextTitleBar(canvas, bounds, 'NYHEDER', 103);
    expect(fills).toEqual([[10, 20, 100, TITLE_BAR_HEIGHT]]);
    expect(texts).toEqual([
      { text: 'NYHEDER', x: 12, y: 21, black: false },
      { text: '103', x: 10 + 100 - 2 - 24, y: 21, black: false },
    ]);
    expect(rest).toEqual({ x: 10, y: 20 + TITLE_BAR_HEIGHT, width: 100, height: 40 - TITLE_BAR_HEIGHT });
  });

  it('drops the page number before it would crowd the title', () => {
    const { canvas, texts } = recorder();
    drawTeletextTitleBar(canvas, { ...bounds, width: 56 }, 'NYHEDER', 103);
    expect(texts.map((item) => item.text)).toEqual(['NYH...']);
  });

  it('leaves a widget too small for a line below the bar exactly as it was', () => {
    const { canvas, fills, texts } = recorder();
    const small = { x: 0, y: 0, width: 100, height: TITLE_BAR_HEIGHT + 10 };
    expect(drawTeletextTitleBar(canvas, small, 'NYHEDER', 103)).toBe(small);
    const narrow = { x: 0, y: 0, width: 40, height: 40 };
    expect(drawTeletextTitleBar(canvas, narrow, 'NYHEDER', 103)).toBe(narrow);
    expect(fills).toEqual([]);
    expect(texts).toEqual([]);
  });
});

describe('page header', () => {
  const bar = { x: 0, y: 100, width: 250, height: 20 };

  it('reads the date and time in the display time zone, in the display language', () => {
    expect(teletextClock(NOW, 'Europe/Copenhagen', 'da')).toEqual({ date: 'ons 14 okt', time: '23:03' });
    expect(teletextClock(NOW, 'Europe/Copenhagen', 'en')).toEqual({ date: 'Wed 14 Oct', time: '23:03' });
    // Two hours earlier in UTC, and still Wednesday; one day later in Auckland.
    expect(teletextClock(NOW, 'UTC', 'da')).toEqual({ date: 'ons 14 okt', time: '21:03' });
    expect(teletextClock(NOW, 'Pacific/Auckland', 'da')).toEqual({ date: 'tor 15 okt', time: '10:03' });
  });

  it('shortens Danish weekdays and months to three letters', () => {
    expect(teletextClock(new Date('2026-03-03T12:00:00Z'), 'UTC', 'da').date).toBe('tir 3 mar');
    expect(teletextClock(new Date('2026-05-07T12:00:00Z'), 'UTC', 'da').date).toBe('tor 7 maj');
  });

  it('puts the page and date at the left and the time at the right of one bar', () => {
    const { canvas, fills, texts } = recorder();
    renderTeletextHeader(canvas, bar, { now: NOW, timeZone: 'Europe/Copenhagen', language: 'da' });
    // A 250 px bar is 30 characters: the name does not fit beside the rest, the page does.
    expect(texts.map((item) => item.text)).toEqual(['S100  ons 14 okt', '23:03']);
    expect(texts.every((item) => item.black === false)).toBe(true);
    expect(fills).toEqual([[0, 108, 250, 12]]);
    expect(texts[1].x).toBe(250 - 2 - 5 * 8);
  });

  it('adds the name on a wider panel and uses the English page letter', () => {
    const { canvas, texts } = recorder(400, 300);
    renderTeletextHeader(canvas, { x: 0, y: 0, width: 400, height: 12 }, { now: NOW, timeZone: 'UTC', language: 'en' });
    expect(texts[0].text).toBe('TELETEXT  P100  Wed 14 Oct');
  });

  it('keeps the time alone in the condensed view and on a narrow bar', () => {
    const condensed = recorder();
    renderTeletextHeader(condensed.canvas, bar, { now: NOW, timeZone: 'UTC', language: 'da', condensed: true });
    expect(condensed.texts.map((item) => item.text)).toEqual(['21:03']);
    const narrow = recorder();
    renderTeletextHeader(narrow.canvas, { x: 0, y: 0, width: 56, height: 10 }, { now: NOW, timeZone: 'UTC', language: 'da' });
    expect(narrow.texts.map((item) => item.text)).toEqual(['21:03']);
  });

  it('leaves the battery outside the bar, where it can be drawn black on white', () => {
    const { canvas, fills } = recorder();
    renderTeletextHeader(canvas, bar, { now: NOW, timeZone: 'UTC', language: 'da', battery: { percent: 64 } });
    const [x, , width] = fills[0];
    expect(x + width).toBeLessThan(250 - 4 * 8);
    // The bar is not drawn over the cell: every later fill is the battery's own, to the right of it.
    expect(fills.slice(1).every(([fx]) => fx >= x + width)).toBe(true);
  });
});

describe('rendering a Tekst TV layout', () => {
  const widgets = [widget('energy', 0, 0, 10, 2), widget('status', 0, 5, 10, 1)];

  it('draws a bar across the top of a widget, edge to edge', () => {
    const plain = renderDisplayDataRaw(data, layout(widgets), { display_language: 'da' }, NOW);
    const teletext = renderDisplayDataRaw(data, layout(widgets, { teletext: true }), { display_language: 'da' }, NOW);
    expect(isWhite(plain, 0, 0)).toBe(true);
    for (let y = 0; y < TITLE_BAR_HEIGHT; y++) {
      // The title and page number are white, so only the margins are always black.
      expect(!isWhite(teletext, 0, y) && !isWhite(teletext, 1, y) && !isWhite(teletext, 248, y) && !isWhite(teletext, 249, y), `row ${y}`).toBe(true);
    }
    expect(isWhite(teletext, 0, TITLE_BAR_HEIGHT + 1)).toBe(true);
  });

  it('turns the status bar into the page header and does not draw the refresh interval', () => {
    const teletext = renderDisplayDataRaw(data, layout(widgets, { teletext: true }), { display_language: 'da', display_timezone: 'Europe/Copenhagen' }, NOW);
    // The bar is 12 px at the bottom of the 20 px status row (y 100 to 120), flush with its bottom edge.
    expect(blackRow(teletext, 108, 0, 4)).toBe(true);
    expect(isWhite(teletext, 0, 104)).toBe(true);
    const plain = renderDisplayDataRaw(data, layout(widgets), { display_language: 'da' }, NOW);
    expect(Buffer.compare(plain, teletext)).not.toBe(0);
  });

  it('draws nothing extra on a layout that is not Tekst TV', () => {
    const off = renderDisplayDataRaw(data, layout(widgets, { teletext: false } as Partial<DisplayLayout>), undefined, NOW);
    const missing = renderDisplayDataRaw(data, layout(widgets), undefined, NOW);
    expect(Buffer.compare(off, missing)).toBe(0);
  });

  it('gives a widget too small for a bar all of its room', () => {
    // On a 20 x 12 grid a row is 10 px, too little for a bar and a line of text.
    const fine = { version: 1 as const, cols: 20, rows: 12, widgets: [widget('energy', 0, 0, 20, 1)] };
    const plain = renderDisplayDataRaw(data, fine, undefined, NOW);
    const teletext = renderDisplayDataRaw(data, { ...fine, teletext: true }, undefined, NOW);
    expect(Buffer.compare(plain, teletext)).toBe(0);
  });

  it('inverts together with the rest when colours are inverted', () => {
    const inverted = renderDisplayDataRaw(data, layout(widgets, { teletext: true, invert: true }), undefined, NOW);
    expect(blackRow(inverted, 0, 0, 250)).toBe(false);
    expect(isWhite(inverted, 0, 0)).toBe(true);
    expect(isWhite(inverted, 249, 4)).toBe(true);
    expect(isWhite(inverted, 0, TITLE_BAR_HEIGHT + 1)).toBe(false);
  });
});
