import { describe, it, expect } from 'vitest';
import { deriveTypographyScale } from '../typography';
import type { ScreenProfile } from '@esp32-eink/types';

function makeProfile(widthPx: number, heightPx: number): ScreenProfile {
  return {
    id: 'test',
    slug: 'test',
    widthPx,
    heightPx,
    physicalWidthMm: 59.2,
    physicalHeightMm: 29.0,
    colorMode: 'bw',
    partialRefresh: true,
    orientation: 'landscape',
    dpiApprox: 107,
  };
}

const PROFILES = [
  { label: 'waveshare-2-13-v3 (250×122)', w: 250, h: 122 },
  { label: 'waveshare-2-13-bwr (250×122)', w: 250, h: 122 },
  { label: 'waveshare-4-2-v2 (400×300)', w: 400, h: 300 },
  { label: 'waveshare-7-5-v2 (800×480)', w: 800, h: 480 },
  { label: 'waveshare-7-5-bwr (800×480)', w: 800, h: 480 },
] as const;

describe('deriveTypographyScale', () => {
  it('returns small scale for 250×122 (2.13" display)', () => {
    const scale = deriveTypographyScale(makeProfile(250, 122));
    expect(scale.xs).toBe(8);
    expect(scale.sm).toBe(8);
    expect(scale.base).toBe(10);
    expect(scale.lg).toBe(12);
    expect(scale.xl).toBe(16);
  });

  it('returns medium scale for 400×300 (4.2" display)', () => {
    const scale = deriveTypographyScale(makeProfile(400, 300));
    expect(scale.xs).toBe(10);
    expect(scale.sm).toBe(12);
    expect(scale.base).toBe(14);
    expect(scale.lg).toBe(20);
    expect(scale.xl).toBe(32);
  });

  it('returns large scale for 800×480 (7.5" display)', () => {
    const scale = deriveTypographyScale(makeProfile(800, 480));
    expect(scale.xs).toBe(12);
    expect(scale.sm).toBe(14);
    expect(scale.base).toBe(18);
    expect(scale.lg).toBe(28);
    expect(scale.xl).toBe(48);
  });

  it.each(PROFILES)('scale values are in ascending order for $label', ({ w, h }) => {
    const s = deriveTypographyScale(makeProfile(w, h));
    expect(s.xs).toBeLessThanOrEqual(s.sm);
    expect(s.sm).toBeLessThanOrEqual(s.base);
    expect(s.base).toBeLessThanOrEqual(s.lg);
    expect(s.lg).toBeLessThanOrEqual(s.xl);
  });

  it.each(PROFILES)('xs is at least 8 (minimum bitmap font) for $label', ({ w, h }) => {
    const s = deriveTypographyScale(makeProfile(w, h));
    expect(s.xs).toBeGreaterThanOrEqual(8);
  });
});
