export interface DisplayProfile {
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  colorMode: 'bw';
}

export const DEFAULT_DISPLAY_PROFILE: DisplayProfile = { width: 250, height: 122, rotation: 0, colorMode: 'bw' };
/** Longest side and pixel count a profile may have. Sized for e-reader screens up to 1264 x 1680 (Kindle Paperwhite 12th generation). */
export const MAX_DISPLAY_SIDE = 2048;
export const MAX_DISPLAY_PIXELS = 2_200_000;

export function parseDisplayProfile(value: unknown): DisplayProfile {
  if (value == null) return { ...DEFAULT_DISPLAY_PROFILE };
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Display profile must be an object');
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some((key) => !['width', 'height', 'rotation', 'colorMode'].includes(key))) throw new Error('Unknown display profile field');
  if (!Number.isInteger(p.width) || !Number.isInteger(p.height) || Number(p.width) < 64 || Number(p.height) < 64 || Number(p.width) > MAX_DISPLAY_SIDE || Number(p.height) > MAX_DISPLAY_SIDE || Number(p.width) * Number(p.height) > MAX_DISPLAY_PIXELS) {
    throw new Error('Display dimensions must be integers from 64 to 2048, at most 2,200,000 pixels');
  }
  if (![0, 90, 180, 270].includes(Number(p.rotation)) || typeof p.rotation !== 'number' || p.colorMode !== 'bw') throw new Error('Only monochrome profiles and rotations 0, 90, 180, 270 are supported');
  return { width: Number(p.width), height: Number(p.height), rotation: p.rotation as DisplayProfile['rotation'], colorMode: 'bw' };
}

export function frameMetadata(value?: DisplayProfile | null) {
  const profile = parseDisplayProfile(value);
  const rowBytes = Math.ceil(profile.width / 8);
  return { ...profile, rowBytes, byteLength: rowBytes * profile.height, encoding: 'mono-msb-white1' as const };
}
