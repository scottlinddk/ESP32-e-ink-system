import { CustomImage, UserPreferences } from '../types';

export const MAX_CUSTOM_TEXT_LENGTH = 2000;
export const MAX_CUSTOM_IMAGE_DIMENSION = 512;

export function parseCustomImage(value: unknown): CustomImage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('custom_image must be an image object or null');
  const image = value as Record<string, unknown>;
  const { width, height, pixels, fit } = image;
  if (typeof width !== 'number' || !Number.isInteger(width) || width < 1 || width > MAX_CUSTOM_IMAGE_DIMENSION ||
      typeof height !== 'number' || !Number.isInteger(height) || height < 1 || height > MAX_CUSTOM_IMAGE_DIMENSION) {
    throw new Error('custom_image dimensions must be integers between 1 and 512');
  }
  if (fit !== 'contain' && fit !== 'cover') throw new Error('custom_image fit must be contain or cover');
  const byteLength = Math.ceil(width / 8) * height;
  if (typeof pixels !== 'string' || pixels.length !== Math.ceil(byteLength / 3) * 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(pixels)) throw new Error('custom_image pixels must be a correctly sized base64 bitmap');
  const bytes = Buffer.from(pixels, 'base64');
  if (bytes.length !== byteLength || bytes.toString('base64') !== pixels) throw new Error('custom_image pixels must use canonical base64');
  // Row padding must be white; there are no hidden pixels outside the image.
  const paddingMask = (1 << ((8 - width % 8) % 8)) - 1;
  const stride = Math.ceil(width / 8);
  for (let y = 0; y < height; y++) {
    if ((bytes[(y + 1) * stride - 1] & paddingMask) !== paddingMask) throw new Error('custom_image unused row bits must be white');
  }
  return { width, height, pixels, fit };
}

export function parseCustomContentUpdates(body: Record<string, unknown>): Partial<UserPreferences> {
  const updates: Partial<UserPreferences> = {};
  for (const field of ['show_custom_text', 'show_custom_image'] as const) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== 'boolean') throw new Error(`${field} must be a boolean`);
      updates[field] = body[field];
    }
  }
  if (body.custom_text !== undefined) {
    if (typeof body.custom_text !== 'string') {
      throw new Error('custom_text must be a string of at most 2000 characters');
    }
    const text = body.custom_text.normalize('NFC');
    if (text.length > MAX_CUSTOM_TEXT_LENGTH) throw new Error('custom_text must be a string of at most 2000 characters');
    if (text.includes('\0') || Array.from(text).some((character) => {
      const point = character.codePointAt(0)!;
      return point >= 0xd800 && point <= 0xdfff;
    })) throw new Error('custom_text must contain valid Unicode text without null characters');
    updates.custom_text = text;
  }
  if (body.custom_image !== undefined) {
    updates.custom_image = body.custom_image === null ? null : parseCustomImage(body.custom_image);
  }
  return updates;
}

interface PixelCanvas { setPixel(x: number, y: number, black: boolean): void; }
interface Bounds { x: number; y: number; width: number; height: number; }

export function drawCustomImage(canvas: PixelCanvas, bounds: Bounds, image: CustomImage, viewport: Bounds): void {
  if (!Object.values(bounds).every(Number.isFinite) || bounds.width < 1 || bounds.height < 1) return;
  const bytes = Buffer.from(image.pixels, 'base64');
  const scale = (image.fit === 'cover' ? Math.max : Math.min)(bounds.width / image.width, bounds.height / image.height);
  const offsetX = (bounds.width - image.width * scale) / 2;
  const offsetY = (bounds.height - image.height * scale) / 2;
  const stride = Math.ceil(image.width / 8);
  // Clip before iterating, rather than relying only on setPixel's clipping.
  const startX = Math.max(0, Math.ceil(viewport.x - bounds.x));
  const startY = Math.max(0, Math.ceil(viewport.y - bounds.y));
  const endX = Math.min(bounds.width, viewport.x + viewport.width - bounds.x);
  const endY = Math.min(bounds.height, viewport.y + viewport.height - bounds.y);
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const sourceX = Math.floor((x + 0.5 - offsetX) / scale);
      const sourceY = Math.floor((y + 0.5 - offsetY) / scale);
      const inside = sourceX >= 0 && sourceX < image.width && sourceY >= 0 && sourceY < image.height;
      const black = inside && (bytes[sourceY * stride + Math.floor(sourceX / 8)] & (0x80 >> (sourceX % 8))) === 0;
      canvas.setPixel(bounds.x + x, bounds.y + y, black);
    }
  }
}
