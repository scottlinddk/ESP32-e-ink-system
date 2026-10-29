import { describe, expect, it } from 'vitest';
import type { DisplayLayout, WidgetLayout, WidgetOptions } from '../types/index';
import { renderDisplayDataRaw } from '../utils/bmpGenerator';
import { LayoutValidationError, parseDisplayLayout } from '../utils/layoutValidation';
import { parseWidgetOptions } from '../utils/widgetOptions';
import { alignArea, alignOffset, chooseOutline, outlineBoxes } from '../utils/widgetFrame';

const STRIDE = 32; // 250 px wide panel, row-padded to 32 bytes
const layout = (widgets: WidgetLayout[], extra: Partial<DisplayLayout> = {}): DisplayLayout => ({ version: 1, cols: 10, rows: 6, widgets, ...extra });
const note = (options?: WidgetOptions, at: Partial<WidgetLayout> = {}): WidgetLayout =>
  ({ i: 'custom-text', x: 0, y: 0, w: 10, h: 3, ...at, ...(options ? { options } : {}) });
const data = { nextRefresh: 300_000, customText: 'Hi' };

function isBlack(raw: Buffer, x: number, y: number): boolean {
  return !(raw[y * STRIDE + (x >> 3)] & (0x80 >> (x & 7)));
}

/** The box around every black pixel in a region, or null when it is blank. */
function ink(raw: Buffer, x0 = 0, x1 = 250, y0 = 0, y1 = 122) {
  let left = Infinity, right = -1, top = Infinity, bottom = -1;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (!isBlack(raw, x, y)) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return right < 0 ? null : { left, right, top, bottom };
}

describe('alignment and outline validation', () => {
  it('accepts every alignment and outline on every widget, and drops the default alignment', () => {
    expect(parseWidgetOptions('custom-text', { align: 'bottom-right', outline: 'rounded' })).toEqual({ align: 'bottom-right', outline: 'rounded' });
    expect(parseWidgetOptions('custom-image', { align: 'middle-center' })).toEqual({ align: 'middle-center' });
    expect(parseWidgetOptions('energy', { view: 'day', align: 'top-left' })).toEqual({ view: 'day' });
    expect(parseWidgetOptions('status', { align: 'top-left' })).toBeUndefined();
    // 'none' is kept so a widget can opt out of the layout's outline.
    expect(parseWidgetOptions('weather', { outline: 'none' })).toEqual({ outline: 'none' });
  });

  it('rejects unknown alignments and outlines', () => {
    expect(() => parseWidgetOptions('news', { align: 'centre' })).toThrow('alignment');
    expect(() => parseWidgetOptions('news', { align: 3 })).toThrow('alignment');
    expect(() => parseWidgetOptions('news', { outline: 'double' })).toThrow('outline');
    expect(() => parseWidgetOptions('custom-image', { zoom: 2 })).toThrow('unsupported');
  });

  it('stores a layout outline unless it is none', () => {
    expect(parseDisplayLayout(layout([], { outline: 'thin' })).outline).toBe('thin');
    expect('outline' in parseDisplayLayout({ ...layout([]), outline: 'none' })).toBe(false);
    expect(() => parseDisplayLayout({ ...layout([]), outline: 'box' })).toThrow(LayoutValidationError);
  });

  it('lets a widget override the layout outline', () => {
    expect(chooseOutline(undefined, undefined)).toBe('none');
    expect(chooseOutline(undefined, 'thick')).toBe('thick');
    expect(chooseOutline('none', 'thick')).toBe('none');
    expect(chooseOutline('dashed', 'thick')).toBe('dashed');
  });
});

describe('alignment geometry', () => {
  const box = { x: 0, y: 0, width: 100, height: 40 };
  const content = { x: 2, y: 2, width: 16, height: 8 };

  it('keeps top left where the widget drew it', () => {
    expect(alignOffset(box, content, 'top-left', 2)).toEqual({ dx: 0, dy: 0 });
  });

  it('mirrors the margin at the right and bottom', () => {
    expect(alignOffset(box, content, 'bottom-right', 2)).toEqual({ dx: 80, dy: 28 });
  });

  it('centres within the box', () => {
    expect(alignOffset(box, content, 'middle-center', 2)).toEqual({ dx: 40, dy: 14 });
    expect(alignOffset(box, content, 'top-center', 2)).toEqual({ dx: 40, dy: 0 });
  });

  it('does not move content that already fills the box', () => {
    expect(alignOffset(box, { x: 0, y: 0, width: 100, height: 40 }, 'bottom-right', 2)).toEqual({ dx: 0, dy: 0 });
    expect(alignOffset(box, { x: 2, y: 2, width: 97, height: 8 }, 'top-right', 2)).toEqual({ dx: 0, dy: 0 });
  });

  it('places a sized area such as a photo', () => {
    expect(alignArea(box, 40, 40, 'top-right')).toEqual({ x: 60, y: 0, width: 40, height: 40 });
    expect(alignArea(box, 40, 20, 'bottom-center')).toEqual({ x: 30, y: 20, width: 40, height: 20 });
  });

  it('leaves a white gap outside the outline, so neighbours do not merge', () => {
    expect(outlineBoxes({ x: 0, y: 0, width: 100, height: 40 }, 'thin', 1)).toEqual({
      frame: { x: 1, y: 1, width: 98, height: 38 }, inner: { x: 3, y: 3, width: 94, height: 34 },
    });
    expect(outlineBoxes({ x: 0, y: 0, width: 100, height: 40 }, 'thick', 2).inner).toEqual({ x: 8, y: 8, width: 84, height: 24 });
  });
});

describe('rendering alignment', () => {
  const plain = ink(renderDisplayDataRaw(data, layout([note()])))!;

  it('draws a widget without options exactly as before', () => {
    expect(plain.left).toBe(2);
    expect(plain.top).toBe(2);
  });

  it.each([
    ['top-right', (b: NonNullable<ReturnType<typeof ink>>) => b.right > 230 && b.top === plain.top],
    ['bottom-left', (b: NonNullable<ReturnType<typeof ink>>) => b.left === plain.left && b.bottom > 50],
    ['middle-center', (b: NonNullable<ReturnType<typeof ink>>) => Math.abs((b.left + b.right) / 2 - 125) <= 2 && Math.abs((b.top + b.bottom) / 2 - 30) <= 2],
    ['bottom-right', (b: NonNullable<ReturnType<typeof ink>>) => b.right > 230 && b.bottom > 50],
  ] as const)('moves the content to %s inside its area', (align, check) => {
    const box = ink(renderDisplayDataRaw(data, layout([note({ align })])))!;
    expect(box.right - box.left).toBe(plain.right - plain.left);
    expect(box.bottom - box.top).toBe(plain.bottom - plain.top);
    expect(check(box)).toBe(true);
  });

  it('keeps the content inside the widget area', () => {
    const raw = renderDisplayDataRaw(data, layout([note({ align: 'bottom-right' }, { x: 0, y: 0, w: 5, h: 3 })]));
    const box = ink(raw)!;
    expect(box.right).toBeLessThan(125);
    expect(box.bottom).toBeLessThan(60);
  });

  it('keeps the rule along the top of a widget in place while its text moves', () => {
    const raw = renderDisplayDataRaw({ nextRefresh: 300_000 }, layout([{ i: 'status', x: 0, y: 3, w: 10, h: 3, options: { align: 'bottom-right' } }]));
    // The status bar's rule spans the whole width at its top edge.
    for (let x = 0; x < 250; x++) expect(isBlack(raw, x, 60)).toBe(true);
    const text = ink(raw, 0, 250, 61, 122)!;
    expect(text.bottom).toBeGreaterThan(110);
  });
});

describe('rendering outlines', () => {
  it('draws a closed thin box inside a 1 px gap', () => {
    const raw = renderDisplayDataRaw(data, layout([note({ outline: 'thin' })]));
    for (let x = 1; x < 249; x++) {
      expect(isBlack(raw, x, 1)).toBe(true);
      expect(isBlack(raw, x, 58)).toBe(true);
      expect(isBlack(raw, x, 0)).toBe(false);
    }
    for (let y = 1; y < 59; y++) expect(isBlack(raw, 1, y) && isBlack(raw, 248, y)).toBe(true);
    // The text moves in with the outline instead of touching it.
    expect(ink(raw, 3, 247, 3, 57)!.left).toBe(5);
  });

  it('applies the layout outline to every widget unless one opts out', () => {
    const raw = renderDisplayDataRaw(data, layout([note(undefined, { w: 5 }), note({ outline: 'none' }, { i: 'status', x: 5, w: 5 })], { outline: 'thick' }));
    expect(isBlack(raw, 1, 30) && isBlack(raw, 2, 30)).toBe(true);
    expect(isBlack(raw, 126, 30)).toBe(false);
  });

  it('leaves the corners of a rounded box open', () => {
    const raw = renderDisplayDataRaw(data, layout([note({ outline: 'rounded' })]));
    expect(isBlack(raw, 1, 1)).toBe(false);
    expect(isBlack(raw, 2, 2)).toBe(true);
    expect(isBlack(raw, 10, 1)).toBe(true);
  });

  it('breaks a dashed box into dashes but closes its corners', () => {
    const raw = renderDisplayDataRaw(data, layout([note({ outline: 'dashed' })]));
    const top = Array.from({ length: 248 }, (_, i) => isBlack(raw, i + 1, 1));
    expect(top.filter(Boolean).length).toBeGreaterThan(100);
    expect(top.filter((on) => !on).length).toBeGreaterThan(60);
    expect(isBlack(raw, 1, 1) && isBlack(raw, 248, 1) && isBlack(raw, 1, 58) && isBlack(raw, 248, 58)).toBe(true);
  });

  it('drops the separator rule inside an outline, so there is one line, not two', () => {
    const raw = renderDisplayDataRaw({ nextRefresh: 300_000 }, layout([{ i: 'status', x: 0, y: 3, w: 10, h: 3, options: { outline: 'thin' } }]));
    expect(isBlack(raw, 100, 61)).toBe(true); // the outline
    expect(isBlack(raw, 100, 62)).toBe(false);
    expect(isBlack(raw, 100, 63)).toBe(false); // where the status rule would be
  });

  it('leaves the outline out of a widget too small to hold it and a line of text', () => {
    const raw = renderDisplayDataRaw(data, { version: 1, cols: 20, rows: 12, widgets: [note({ outline: 'thin' }, { w: 20, h: 1 })] });
    expect(isBlack(raw, 100, 1)).toBe(false);
  });
});
