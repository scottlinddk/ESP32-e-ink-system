export interface DisplayProfile {
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  colorMode: 'bw';
}

export const DEFAULT_DISPLAY_PROFILE: DisplayProfile = { width: 250, height: 122, rotation: 0, colorMode: 'bw' };

export function parseDisplayProfile(value: unknown): DisplayProfile {
  if (value == null) return { ...DEFAULT_DISPLAY_PROFILE };
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Display profile must be an object');
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some((key) => !['width', 'height', 'rotation', 'colorMode'].includes(key))) throw new Error('Unknown display profile field');
  if (!Number.isInteger(p.width) || !Number.isInteger(p.height) || Number(p.width) < 64 || Number(p.height) < 64 || Number(p.width) > 1600 || Number(p.height) > 1600 || Number(p.width) * Number(p.height) > 1920000) {
    throw new Error('Display dimensions must be integers from 64 to 1600, at most 1,920,000 pixels');
  }
  if (![0, 90, 180, 270].includes(Number(p.rotation)) || typeof p.rotation !== 'number' || p.colorMode !== 'bw') throw new Error('Only monochrome profiles and rotations 0, 90, 180, 270 are supported');
  return { width: Number(p.width), height: Number(p.height), rotation: p.rotation as DisplayProfile['rotation'], colorMode: 'bw' };
}

export function frameMetadata(value?: DisplayProfile | null) {
  const profile = parseDisplayProfile(value);
  const rowBytes = Math.ceil(profile.width / 8);
  return { ...profile, rowBytes, byteLength: rowBytes * profile.height, encoding: 'mono-msb-white1' as const };
}

/**
 * Native panel size a device declares with X-Device-Width / X-Device-Height, or null when absent or invalid.
 * A fixed-panel board knows its own size, so it must not depend on a manually saved profile.
 */
export function declaredPanelSize(width: unknown, height: unknown): { width: number; height: number } | null {
  if (typeof width !== 'string' || typeof height !== 'string' || !/^\d{2,4}$/.test(width) || !/^\d{2,4}$/.test(height)) return null;
  try {
    const { width: w, height: h } = parseDisplayProfile({ width: Number(width), height: Number(height), rotation: 0, colorMode: 'bw' });
    return { width: w, height: h };
  } catch { return null; }
}
