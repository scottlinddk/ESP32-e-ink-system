import { describe, expect, it } from 'vitest';
import { parseCustomContentUpdates, parseCustomImage, drawCustomImage } from '../utils/customContent';
import { BmpCanvas, renderDisplayData, renderDisplayDataRaw } from '../utils/bmpGenerator';
import type { CustomImage, DisplayLayout } from '../types';

const image: CustomImage = { width: 2, height: 1, pixels: 'fw==', fit: 'contain' };

describe('custom content input validation', () => {
  it('accepts normalized notes, explicit enabled states and canonical one-bit images', () => {
    expect(parseCustomContentUpdates({ custom_text: 'Pa\u030A ferie', show_custom_text: true, custom_image: image, show_custom_image: false }))
      .toEqual({ custom_text: 'På ferie', show_custom_text: true, custom_image: image, show_custom_image: false });
    expect(parseCustomContentUpdates({ custom_image: null })).toEqual({ custom_image: null });
    expect(parseCustomContentUpdates({})).toEqual({});
  });

  it.each([null, [], 'https://example.com/image.png', { ...image, width: 0 }, { ...image, height: 513 }, { ...image, width: 1.5 },
    { ...image, fit: 'stretch' }, { ...image, pixels: '' }, { ...image, pixels: 'fw=' }, { ...image, pixels: 'f!== ' },
    { ...image, pixels: 'fx==' }, { ...image, pixels: 'AA==' }, { ...image, height: 2 }, { ...image, pixels: '////' }])(
    'rejects invalid images without accepting URLs or hidden padding: %j', (value) => {
      expect(() => parseCustomImage(value)).toThrow();
    });

  it('bounds notes, image allocation and booleans', () => {
    expect(() => parseCustomContentUpdates({ custom_text: 'x'.repeat(2001) })).toThrow('2000');
    expect(() => parseCustomContentUpdates({ custom_text: null })).toThrow();
    expect(() => parseCustomContentUpdates({ custom_text: '\0' })).toThrow('Unicode');
    expect(() => parseCustomContentUpdates({ custom_text: '\ud800' })).toThrow('Unicode');
    expect(() => parseCustomContentUpdates({ custom_text: '\u0344'.repeat(2000) })).toThrow('2000');
    expect(() => parseCustomContentUpdates({ show_custom_image: 'true' })).toThrow('boolean');
    const largest = { width: 512, height: 512, pixels: Buffer.alloc(32768, 0xff).toString('base64'), fit: 'cover' };
    expect(parseCustomImage(largest)).toEqual(largest);
    expect(() => parseCustomImage({ ...largest, width: 513 })).toThrow();
  });

  it('strips unexpected image metadata and ignores unrelated update fields', () => {
    expect(parseCustomImage({ ...image, url: 'http://localhost/private', user_id: 'other' })).toEqual(image);
    expect(parseCustomContentUpdates({ user_id: 'other' })).toEqual({});
  });
});

describe('custom content rendering', () => {
  function capture(value: CustomImage, width = 4, height = 4): string[] {
    const rows = Array.from({ length: height }, () => Array(width).fill('.'));
    drawCustomImage({ setPixel(x, y, black) { rows[y][x] = black ? '#' : '.'; } }, { x: 0, y: 0, width, height }, value, { x: 0, y: 0, width, height });
    return rows.map((row) => row.join(''));
  }

  it('contains or crops the same saved pixels according to widget bounds', () => {
    expect(capture(image)).toEqual(['....', '##..', '##..', '....']);
    expect(capture({ ...image, fit: 'cover' })).toEqual(['##..', '##..', '##..', '##..']);
    expect(capture({ ...image, width: 1, height: 2, pixels: 'f/8=' })).toEqual(['.##.', '.##.', '....', '....']);
  });

  it('clips image drawing and clearing to its widget without changing neighboring pixels', () => {
    const actual = new BmpCanvas();
    actual.setPixel(0, 0, true);
    actual.withClip({ x: 8, y: 10, width: 4, height: 4 }, () => {
      drawCustomImage(actual, { x: 8, y: 10, width: 4, height: 4 }, { ...image, fit: 'cover' }, { x: 0, y: 0, width: 250, height: 122 });
    });
    const expected = new BmpCanvas();
    expected.setPixel(0, 0, true);
    expected.fillRect(8, 10, 2, 4);
    expect(actual.toRawPixels()).toEqual(expected.toRawPixels());
  });

  it('bounds work to the viewport even when a widget is much larger than the display', () => {
    const points: number[][] = [];
    drawCustomImage({ setPixel(x, y) { points.push([x, y]); } },
      { x: -100, y: -100, width: 1e9, height: 1e9 }, image,
      { x: 0, y: 0, width: 4, height: 4 });
    expect(points).toHaveLength(16);
    expect(points.every(([x, y]) => x >= 0 && x < 4 && y >= 0 && y < 4)).toBe(true);
  });

  it('renders saved custom text and images through both output entry points', () => {
    const layout: DisplayLayout = { version: 1, cols: 10, rows: 6, widgets: [
      { i: 'custom-text', x: 0, y: 0, w: 5, h: 3 },
      { i: 'custom-image', x: 5, y: 0, w: 5, h: 3 },
    ] };
    const data = { customText: 'Husk mælk\nog æbler', customImage: image, nextRefresh: 300000 };
    const raw = renderDisplayDataRaw(data, layout);
    expect(raw).not.toEqual(renderDisplayDataRaw({ nextRefresh: 300000 }, layout));
    expect(renderDisplayData(data, layout).subarray(62)).toEqual(raw);
    expect(renderDisplayDataRaw({ nextRefresh: 300000 }, layout).every((byte) => byte === 0xff)).toBe(true);
  });
});
