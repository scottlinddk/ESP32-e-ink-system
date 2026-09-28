import { describe, expect, it } from 'vitest';
import { convertImage, encodePixels, fittedImageSize, MAX_SOURCE_PIXELS, MAX_UPLOAD_BYTES, Raster, readUploadSize } from '../imageConversion';

function raster(rows: number[][], alpha = 255): Raster {
  return { width: rows[0].length, height: rows.length, data: new Uint8ClampedArray(rows.flat().flatMap((value) => [value, value, value, alpha])) };
}

function rows(pixels: Uint8Array, width: number, height: number): string[] {
  const stride = Math.ceil(width / 8);
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) =>
    pixels[y * stride + Math.floor(x / 8)] & (0x80 >> (x % 8)) ? '.' : '#').join(''));
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}

describe('image conversion pixels', () => {
  it('preserves monochrome pixels and pads each tight row white', () => {
    const pixels = convertImage(raster([[0, 255, 0], [255, 0, 255]]), { width: 3, height: 2, fit: 'contain', mode: 'threshold' });
    expect(Array.from(pixels)).toEqual([0x5f, 0xbf]);
    expect(encodePixels(pixels)).toBe('X78=');
  });

  it('composites transparency over white before thresholding', () => {
    const source = raster([[0, 0, 0]]);
    source.data[3] = 0; source.data[7] = 127; source.data[11] = 255;
    expect(rows(convertImage(source, { width: 3, height: 1, fit: 'contain', mode: 'threshold' }), 3, 1)).toEqual(['..#']);
  });

  it('contains a wide image with white bars without stretching it', () => {
    const pixels = convertImage(raster([[0, 0]]), { width: 4, height: 4, fit: 'contain', mode: 'threshold' });
    expect(rows(pixels, 4, 4)).toEqual(['....', '####', '####', '....']);
  });

  it('crops a wide image symmetrically when filling a square', () => {
    const pixels = convertImage(raster([[0, 255]]), { width: 4, height: 4, fit: 'cover', mode: 'threshold' });
    expect(rows(pixels, 4, 4)).toEqual(['##..', '##..', '##..', '##..']);
  });

  it('keeps a known Floyd–Steinberg gray fixture stable', () => {
    const source = raster([[128, 128, 128, 128], [128, 128, 128, 128]]);
    const options = { width: 4, height: 2, fit: 'contain' as const, mode: 'floyd-steinberg' as const };
    expect(rows(convertImage(source, options), 4, 2)).toEqual(['.#.#', '#.#.']);
    expect(convertImage(source, options)).toEqual(convertImage(source, options));
    expect(rows(convertImage(source, { ...options, mode: 'threshold' }), 4, 2)).toEqual(['....', '....']);
  });

  it('does not diffuse image error into contain letterboxes', () => {
    const pixels = convertImage(raster([[128, 128]]), { width: 4, height: 4, fit: 'contain', mode: 'floyd-steinberg' });
    expect(rows(pixels, 4, 4)[0]).toBe('....');
    expect(rows(pixels, 4, 4)[3]).toBe('....');
  });

  it('limits stored image size while preserving portrait and landscape aspect ratios', () => {
    expect(fittedImageSize(1200, 600)).toEqual({ width: 512, height: 256 });
    expect(fittedImageSize(600, 1200)).toEqual({ width: 256, height: 512 });
    expect(fittedImageSize(80, 60)).toEqual({ width: 80, height: 60 });
    expect(fittedImageSize(1, 16384)).toEqual({ width: 1, height: 512 });
  });

  it('rejects invalid raster dimensions, data lengths and output settings', () => {
    const options = { width: 1, height: 1, fit: 'contain' as const, mode: 'threshold' as const };
    expect(() => convertImage({ ...raster([[0]]), data: new Uint8ClampedArray(3) }, options)).toThrow('RGBA');
    expect(() => convertImage(raster([[0]]), { ...options, width: 513 })).toThrow();
    expect(() => convertImage(raster([[0]]), { ...options, threshold: Number.NaN })).toThrow();
    expect(() => fittedImageSize(10000, 10000)).toThrow();
  });
});

describe('bounded local upload headers', () => {
  it('reads PNG dimensions before bitmap allocation', () => {
    expect(readUploadSize(pngHeader(800, 600))).toEqual({ width: 800, height: 600, type: 'image/png' });
  });

  it('reads baseline and progressive JPEG dimensions, skipping metadata segments', () => {
    for (const marker of [0xc0, 0xc2]) {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, marker, 0, 8, 8, 0, 100, 0, 200, 0]);
      expect(readUploadSize(bytes)).toEqual({ width: 200, height: 100, type: 'image/jpeg' });
    }
  });

  it('rejects malformed or truncated headers and unsupported formats', () => {
    expect(() => readUploadSize(new Uint8Array())).toThrow('valid PNG or JPEG');
    expect(() => readUploadSize(new TextEncoder().encode('<svg/>'))).toThrow();
    expect(() => readUploadSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff]))).toThrow();
    expect(() => readUploadSize(pngHeader(0, 20))).toThrow();
    expect(() => readUploadSize(pngHeader(100, 100).subarray(0, 20))).toThrow();
  });

  it('rejects both excessive compressed bytes and decompressed pixel counts', () => {
    expect(() => readUploadSize(new Uint8Array(MAX_UPLOAD_BYTES + 1))).toThrow('5 MiB');
    expect(() => readUploadSize(pngHeader(4096, 4096))).toThrow('16 million');
    expect(MAX_SOURCE_PIXELS).toBe(16000000);
  });
});
