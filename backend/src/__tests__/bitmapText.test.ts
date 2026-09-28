import { describe, expect, it } from 'vitest';
import { BmpCanvas, renderDisplayData, renderDisplayDataRaw } from '../utils/bmpGenerator';
import { wrapBitmapText } from '../utils/bitmapText';
import { DisplayLayout } from '../types/index';

function render(text: string): BmpCanvas {
  const canvas = new BmpCanvas();
  canvas.drawText(text, 0, 0);
  return canvas;
}

function glyphRows(canvas: BmpCanvas): string[] {
  const bmp = canvas.toBmp();
  const stride = Math.ceil(bmp.readInt32LE(18) / 32) * 4;
  return Array.from({ length: 8 }, (_, y) =>
    Array.from({ length: 8 }, (_, x) =>
      bmp[62 + y * stride] & (0x80 >> x) ? '.' : '#').join(''));
}

describe('readable Danish bitmap glyphs', () => {
  const fixtures = [
    { text: 'æ', rows: ['........', '........', '.##.##..', '...#..#.', '.######.', '#..#....', '.##.###.', '........'] },
    { text: 'Æ', rows: ['...####.', '..###...', '.##.#...', '.######.', '##..#...', '##..#...', '##..###.', '........'] },
    { text: 'ø', rows: ['........', '......#.', '.#####..', '#..#.#..', '#.#..#..', '##...#..', '#####...', '........'] },
    { text: 'Ø', rows: ['..###.#.', '.##.##..', '##..###.', '##.#.##.', '###..##.', '.##.##..', '#.###...', '........'] },
    { text: 'å', rows: ['..##....', '.#..#...', '..##....', '.####...', '....##..', '.#####..', '##..##..', '.###.##.'] },
    { text: 'Å', rows: ['..##....', '.#..#...', '..##....', '.####...', '##..##..', '######..', '##..##..', '##..##..'] },
    { text: '°', rows: ['..##....', '.#..#...', '.#..#...', '..##....', '........', '........', '........', '........'] },
  ];

  it.each(fixtures)('draws $text with the expected orientation and pixels', ({ text, rows }) => {
    const canvas = render(text);
    expect(glyphRows(canvas)).toEqual(rows);
    expect(canvas.toBmp().subarray(62)).toEqual(canvas.toRawPixels());
  });

  it.each(['å Å', 'é È ï Ä', 'ñ Ç ü ÿ'])('renders composed and decomposed %s identically', (text) => {
    expect(render(text.normalize('NFD')).toRawPixels()).toEqual(render(text).toRawPixels());
    const wrapped = new BmpCanvas();
    wrapped.drawWrappedText(text.normalize('NFD'), 0, 0, 16);
    const expected = new BmpCanvas();
    expected.drawWrappedText(text, 0, 0, 16);
    expect(wrapped.toRawPixels()).toEqual(expected.toRawPixels());
  });

  it('provides every documented extra glyph without the unknown-character fallback', () => {
    const extras = 'æøåÆØÅÀÁÂÃÄÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸàáâãäèéêëìíîïñòóôõöùúûüýÿÇçß°€£±×÷‘’“”„«»–—−…•';
    const fallback = render('?').toRawPixels();
    for (const character of extras) {
      expect(render(character).toRawPixels(), character).not.toEqual(fallback);
    }
  });

  it('draws quotation marks, ellipsis and dash as distinct legible punctuation', () => {
    expect(glyphRows(render('…'))).toEqual([
      '........', '........', '........', '........', '........', '........', '#..#..#.', '........',
    ]);
    expect(glyphRows(render('—'))[3]).toBe('########');
    expect(glyphRows(render('“'))).not.toEqual(glyphRows(render('”')));
    expect(render('\u00a0').toRawPixels()).toEqual(render(' ').toRawPixels());
  });

  it('draws one visible fallback per unsupported code point, including astral characters', () => {
    expect(render('中😀').toRawPixels()).toEqual(render('??').toRawPixels());
    const canvas = new BmpCanvas();
    canvas.drawChar(0x1f600, 0, 0);
    expect(canvas.toRawPixels()).toEqual(render('?').toRawPixels());
    canvas.drawChar(Number.NaN, 0, 0);
    expect(canvas.toRawPixels()).toEqual(render('?').toRawPixels());
  });

  it('preserves Unicode pixels across the real widget BMP and raw entry points', () => {
    const data = { news: [{ title: 'Ærø får 20°C — “sådan!”', url: 'https://example.com' }], nextRefresh: 300000 };
    const layout: DisplayLayout = { version: 1, cols: 10, rows: 6, widgets: [{ i: 'news', x: 0, y: 0, w: 10, h: 3 }] };
    expect(renderDisplayData(data, layout).subarray(62)).toEqual(renderDisplayDataRaw(data, layout));
  });
});

describe('Unicode text wrapping', () => {
  it('measures astral code points and normalized accents as one cell each', () => {
    expect([...wrapBitmapText('😀a åb', 2)]).toEqual(['😀a', 'åb']);
    expect([...wrapBitmapText('a\u030Ab e\u0301c', 2)]).toEqual(['åb', 'éc']);
  });

  it('retains the remainder of long words without splitting surrogate pairs', () => {
    expect([...wrapBitmapText('A😀BCæDE', 3)]).toEqual(['A😀B', 'CæD', 'E']);
    expect([...wrapBitmapText('Hi extraordinarily end', 4)])
      .toEqual(['Hi', 'extr', 'aord', 'inar', 'ily', 'end']);
  });

  it('honors paragraph breaks and handles spaces, tabs and non-breaking spaces deliberately', () => {
    expect([...wrapBitmapText('a\r\nb\rc\n\nd', 3)]).toEqual(['a', 'b', 'c', '', 'd']);
    expect([...wrapBitmapText('  a\t b   c ', 3)]).toEqual(['a b', 'c']);
    expect([...wrapBitmapText('a\u00a0b c', 4)]).toEqual(['a\u00a0b', 'c']);
    expect([...wrapBitmapText('a', 0)]).toEqual([]);
    expect([...wrapBitmapText('', 3)]).toEqual([]);
  });

  it('clips continued long words and leaves surrounding pixels untouched', () => {
    const actual = new BmpCanvas();
    let endY = 0;
    actual.withClip({ x: 8, y: 10, width: 24, height: 28 }, () => {
      endY = actual.drawWrappedText('A😀BCæDEmore words', 8, 10, 24);
    });
    const expected = new BmpCanvas();
    expected.drawText('A?B', 8, 10);
    expected.drawText('CæD', 8, 20);
    expected.drawText('Emo', 8, 30);
    expect(endY).toBe(40);
    expect(actual.toRawPixels()).toEqual(expected.toRawPixels());
  });
});
