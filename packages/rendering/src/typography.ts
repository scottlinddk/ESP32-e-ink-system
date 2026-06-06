import type { ScreenProfile, TypographyScale } from '@esp32-eink/types';

/**
 * Derives a readable typography scale from a screen profile.
 *
 * Buckets: small (height ≤ 150 px), medium (≤ 350 px), large (> 350 px).
 * All values are in pixels. The 8×8 bitmap font is the minimum (xs = 8).
 */
export function deriveTypographyScale(profile: ScreenProfile): TypographyScale {
  const h = profile.heightPx;

  if (h <= 150) {
    // e.g. Waveshare 2.13" (250×122) — cramped, every pixel counts
    return { xs: 8, sm: 8, base: 10, lg: 12, xl: 16 };
  }

  if (h <= 350) {
    // e.g. Waveshare 4.2" (400×300) — comfortable reading area
    return { xs: 10, sm: 12, base: 14, lg: 20, xl: 32 };
  }

  // e.g. Waveshare 7.5" (800×480) — generous space for hero values
  return { xs: 12, sm: 14, base: 18, lg: 28, xl: 48 };
}
