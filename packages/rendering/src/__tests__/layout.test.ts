import { describe, it, expect } from 'vitest';
import { resolveLayout, BUILT_IN_LAYOUTS } from '../layout';
import type { ScreenProfile } from '@esp32-eink/types';

const PROFILE_213: ScreenProfile = {
  id: 'ws-213',
  slug: 'waveshare-2-13-v3',
  widthPx: 250,
  heightPx: 122,
  physicalWidthMm: 59.2,
  physicalHeightMm: 29.0,
  colorMode: 'bw',
  partialRefresh: true,
  orientation: 'landscape',
  dpiApprox: 107,
};

const PROFILE_75: ScreenProfile = {
  id: 'ws-75',
  slug: 'waveshare-7-5-v2',
  widthPx: 800,
  heightPx: 480,
  physicalWidthMm: 163.2,
  physicalHeightMm: 97.9,
  colorMode: 'bw',
  partialRefresh: false,
  orientation: 'landscape',
  dpiApprox: 125,
};

describe('resolveLayout — full', () => {
  it('returns one region covering the entire profile', () => {
    const regions = resolveLayout(BUILT_IN_LAYOUTS.full, PROFILE_213);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toEqual({ widthPx: 250, heightPx: 122 });
  });
});

describe('resolveLayout — half-horizontal', () => {
  it('returns two stacked regions of equal height on large display', () => {
    const regions = resolveLayout(BUILT_IN_LAYOUTS['half-horizontal'], PROFILE_75);
    expect(regions).toHaveLength(2);
    expect(regions[0]).toEqual({ widthPx: 800, heightPx: 240 });
    expect(regions[1]).toEqual({ widthPx: 800, heightPx: 240 });
  });

  it('falls back to full region when display is too short', () => {
    const tiny: ScreenProfile = { ...PROFILE_213, heightPx: 50 };
    const regions = resolveLayout(BUILT_IN_LAYOUTS['half-horizontal'], tiny);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toEqual({ widthPx: 250, heightPx: 50 });
  });
});

describe('resolveLayout — half-vertical', () => {
  it('returns two side-by-side regions of equal width on large display', () => {
    const regions = resolveLayout(BUILT_IN_LAYOUTS['half-vertical'], PROFILE_75);
    expect(regions).toHaveLength(2);
    expect(regions[0]).toEqual({ widthPx: 400, heightPx: 480 });
    expect(regions[1]).toEqual({ widthPx: 400, heightPx: 480 });
  });

  it('falls back to full region when display is too narrow', () => {
    const tiny: ScreenProfile = { ...PROFILE_213, widthPx: 80 };
    const regions = resolveLayout(BUILT_IN_LAYOUTS['half-vertical'], tiny);
    expect(regions).toHaveLength(1);
  });
});

describe('resolveLayout — quarter', () => {
  it('returns four quadrant regions on large display', () => {
    const regions = resolveLayout(BUILT_IN_LAYOUTS.quarter, PROFILE_75);
    expect(regions).toHaveLength(4);
    expect(regions[0]).toEqual({ widthPx: 400, heightPx: 240 });
  });

  it('falls back to full when display is too small in either dimension', () => {
    const tooNarrow: ScreenProfile = { ...PROFILE_213, widthPx: 80 };
    expect(resolveLayout(BUILT_IN_LAYOUTS.quarter, tooNarrow)).toHaveLength(1);

    const tooShort: ScreenProfile = { ...PROFILE_213, heightPx: 50 };
    expect(resolveLayout(BUILT_IN_LAYOUTS.quarter, tooShort)).toHaveLength(1);
  });
});
