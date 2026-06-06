import type { LayoutDefinition, LayoutId, LayoutRegion, PixelRegion, ScreenProfile } from '@esp32-eink/types';

export const BUILT_IN_LAYOUTS: Record<LayoutId, LayoutDefinition> = {
  full: {
    id: 'full',
    regions: [{ xRatio: 0, yRatio: 0, wRatio: 1, hRatio: 1 }],
  },
  'half-horizontal': {
    id: 'half-horizontal',
    regions: [
      { xRatio: 0, yRatio: 0, wRatio: 1, hRatio: 0.5 },
      { xRatio: 0, yRatio: 0.5, wRatio: 1, hRatio: 0.5 },
    ],
    minHeightPx: 60,
  },
  'half-vertical': {
    id: 'half-vertical',
    regions: [
      { xRatio: 0, yRatio: 0, wRatio: 0.5, hRatio: 1 },
      { xRatio: 0.5, yRatio: 0, wRatio: 0.5, hRatio: 1 },
    ],
    minWidthPx: 100,
  },
  quarter: {
    id: 'quarter',
    regions: [
      { xRatio: 0, yRatio: 0, wRatio: 0.5, hRatio: 0.5 },
      { xRatio: 0.5, yRatio: 0, wRatio: 0.5, hRatio: 0.5 },
      { xRatio: 0, yRatio: 0.5, wRatio: 0.5, hRatio: 0.5 },
      { xRatio: 0.5, yRatio: 0.5, wRatio: 0.5, hRatio: 0.5 },
    ],
    minWidthPx: 100,
    minHeightPx: 60,
  },
};

function regionToPixels(region: LayoutRegion, profile: ScreenProfile): PixelRegion {
  return {
    widthPx: Math.floor(region.wRatio * profile.widthPx),
    heightPx: Math.floor(region.hRatio * profile.heightPx),
  };
}

/**
 * Resolves a layout definition against a screen profile to produce pixel regions.
 * Falls back to full-screen if the profile is too small for the requested layout.
 */
export function resolveLayout(
  definition: LayoutDefinition,
  profile: ScreenProfile
): PixelRegion[] {
  const toSmallWidth =
    definition.minWidthPx !== undefined && profile.widthPx < definition.minWidthPx;
  const tooSmallHeight =
    definition.minHeightPx !== undefined && profile.heightPx < definition.minHeightPx;

  if (toSmallWidth || tooSmallHeight) {
    return [{ widthPx: profile.widthPx, heightPx: profile.heightPx }];
  }

  return definition.regions.map((r) => regionToPixels(r, profile));
}
