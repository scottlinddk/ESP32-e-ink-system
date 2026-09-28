import type { CustomImage } from '../types';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_SOURCE_PIXELS = 16_000_000;
export const MAX_IMAGE_DIMENSION = 512;

export interface Raster { width: number; height: number; data: Uint8ClampedArray; }
export interface ConversionOptions {
  width: number;
  height: number;
  fit: 'contain' | 'cover';
  mode: 'threshold' | 'floyd-steinberg';
  threshold?: number;
}

function checkSourceSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width * height > MAX_SOURCE_PIXELS || width > 16384 || height > 16384) {
    throw new Error('Use an image with at most 16 million pixels and no side longer than 16,384 pixels.');
  }
}

// Inspect dimensions before decoding so a small compressed file cannot allocate
// an unbounded bitmap. PNG and JPEG are the only accepted input formats.
export function readUploadSize(bytes: Uint8Array): { width: number; height: number; type: string } {
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('Choose a PNG or JPEG smaller than 5 MiB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n) &&
      view.getUint32(8) === 13 && String.fromCharCode(...bytes.slice(12, 16)) === 'IHDR') {
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    checkSourceSize(width, height);
    return { width, height, type: 'image/png' };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda || offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        const height = view.getUint16(offset + 3);
        const width = view.getUint16(offset + 5);
        checkSourceSize(width, height);
        return { width, height, type: 'image/jpeg' };
      }
      offset += length;
    }
  }
  throw new Error('Choose a valid PNG or JPEG image.');
}

export function fittedImageSize(width: number, height: number): { width: number; height: number } {
  checkSourceSize(width, height);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function convertImage(source: Raster, options: ConversionOptions): Uint8Array {
  checkSourceSize(source.width, source.height);
  if (source.data.length !== source.width * source.height * 4) throw new Error('Invalid RGBA pixel data.');
  const { width, height, fit, mode, threshold = 128 } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION ||
      !Number.isFinite(threshold) || threshold < 0 || threshold > 255 ||
      !['contain', 'cover'].includes(fit) || !['threshold', 'floyd-steinberg'].includes(mode)) {
    throw new Error('Invalid image conversion settings.');
  }
  const scale = (fit === 'cover' ? Math.max : Math.min)(width / source.width, height / source.height);
  const offsetX = (width - source.width * scale) / 2;
  const offsetY = (height - source.height * scale) / 2;
  const luminance = new Float64Array(width * height).fill(255);
  const content = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.floor((x + 0.5 - offsetX) / scale);
      const sy = Math.floor((y + 0.5 - offsetY) / scale);
      if (sx < 0 || sx >= source.width || sy < 0 || sy >= source.height) continue;
      const index = (sy * source.width + sx) * 4;
      const alpha = source.data[index + 3] / 255;
      luminance[y * width + x] = (0.2126 * source.data[index] + 0.7152 * source.data[index + 1] +
        0.0722 * source.data[index + 2]) * alpha + 255 * (1 - alpha);
      content[y * width + x] = 1;
    }
  }
  const stride = Math.ceil(width / 8);
  const pixels = new Uint8Array(stride * height).fill(0xff);
  function diffuse(x: number, y: number, error: number, weight: number): void {
    if (x >= 0 && x < width && y < height && content[y * width + x]) luminance[y * width + x] += error * weight;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!content[y * width + x]) continue;
      const value = luminance[y * width + x];
      const black = value < threshold;
      if (black) pixels[y * stride + Math.floor(x / 8)] &= ~(0x80 >> (x % 8));
      if (mode === 'floyd-steinberg') {
        const error = value - (black ? 0 : 255);
        diffuse(x + 1, y, error, 7 / 16);
        diffuse(x - 1, y + 1, error, 3 / 16);
        diffuse(x, y + 1, error, 5 / 16);
        diffuse(x + 1, y + 1, error, 1 / 16);
      }
    }
  }
  return pixels;
}

export function encodePixels(pixels: Uint8Array): string {
  let binary = '';
  for (const byte of pixels) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function decodeUpload(file: File): Promise<Raster> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Choose a PNG or JPEG smaller than 5 MiB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dimensions = readUploadSize(bytes);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: dimensions.type }));
  } catch {
    throw new Error('This image could not be decoded. Choose another PNG or JPEG.');
  }
  try {
    // EXIF orientation may swap the width and height, but never the pixel count.
    checkSourceSize(bitmap.width, bitmap.height);
    if (bitmap.width * bitmap.height !== dimensions.width * dimensions.height) throw new Error('Image dimensions do not match its header.');
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Image conversion is unavailable in this browser.');
    context.drawImage(bitmap, 0, 0);
    return { width: bitmap.width, height: bitmap.height, data: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
  } finally {
    bitmap.close();
  }
}

export function imagePreviewUrl(image: CustomImage): string {
  const bytes = atob(image.pixels);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) return '';
  const rgba = context.createImageData(image.width, image.height);
  const stride = Math.ceil(image.width / 8);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const value = bytes.charCodeAt(y * stride + Math.floor(x / 8)) & (0x80 >> (x % 8)) ? 255 : 0;
      const offset = (y * image.width + x) * 4;
      rgba.data.set([value, value, value, 255], offset);
    }
  }
  context.putImageData(rgba, 0, 0);
  return canvas.toDataURL('image/png');
}
