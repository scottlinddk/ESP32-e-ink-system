import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const names = ['firmware-factory.bin', 'firmware-elecrow-factory.bin', 'firmware-elecrow-v12-factory.bin'];
const release = (tag: string, assets = names, draft = false) => ({
  tag_name: tag, draft, prerelease: true,
  assets: assets.map(name => ({ name, browser_download_url: `https://github.com/example/releases/download/${tag}/${name}` })),
});

beforeEach(() => { vi.resetModules(); vi.stubEnv('GITHUB_REPO', 'test/firmware'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('factory release selection', () => {
  it('skips drafts and uploads missing any board, while allowing complete dev releases', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      release('draft', names, true), release('partial', names.slice(0, 2)), release('dev-tested'),
    ])));
    vi.stubGlobal('fetch', fetcher);
    const { fetchLatestFirmwareRelease, buildManifestFromRelease } = await import('../services/githubRelease');
    const selected = await fetchLatestFirmwareRelease();
    expect(selected?.tag).toBe('dev-tested');
    const manifest = buildManifestFromRelease(selected!);
    expect(manifest.new_install_improv_wait_time).toBe(0);
    expect(manifest.builds[1]).toEqual({ chipFamily: 'ESP32-S3', parts: [{ path: 'releases/dev-tested/elecrow-crowpanel-213_fw-dev-tested_factory.bin', offset: 0 }] });
    expect(buildManifestFromRelease(selected!, undefined, 'v12').builds).toEqual([
      { chipFamily: 'ESP32-S3', parts: [{ path: 'releases/dev-tested/elecrow-crowpanel-213-v12_fw-dev-tested_factory.bin', offset: 0 }] },
    ]);
    expect(buildManifestFromRelease(selected!, 'https://display.example/api/').builds[0].parts[0].path).toBe('https://display.example/api/firmware/releases/dev-tested/waveshare-esp32-213-v2_fw-dev-tested_factory.bin');
    await fetchLatestFirmwareRelease();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('resolves a pinned release by tag instead of selecting a newer release for downloads', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(release('v1.2'))));
    vi.stubGlobal('fetch', fetcher);
    const { fetchLatestFirmwareRelease } = await import('../services/githubRelease');
    expect((await fetchLatestFirmwareRelease('v1.2'))?.version).toBe('1.2');
    expect(fetcher.mock.calls[0][0]).toBe('https://api.github.com/repos/test/firmware/releases/tags/v1.2');
  });

  it('reports the publication date in the install manifest and omits an unknown date', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { ...release('dev-dated'), published_at: '2026-10-04T12:42:09Z', created_at: '2026-10-04T12:30:00Z' },
    ]))));
    const { fetchLatestFirmwareRelease, buildManifestFromRelease, releaseDate } = await import('../services/githubRelease');
    const selected = await fetchLatestFirmwareRelease();
    expect(selected?.releasedAt).toBe('2026-10-04T12:42:09.000Z');
    expect(buildManifestFromRelease(selected!).release_date).toBe('2026-10-04T12:42:09.000Z');
    const undated = buildManifestFromRelease({ ...selected!, releasedAt: null });
    expect('release_date' in undated).toBe(false);
    for (const value of [undefined, null, '', 'not a date', 42]) expect(releaseDate(value)).toBeNull();
  });

  it('falls back to the creation time when GitHub has no publication time', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { ...release('dev-created'), published_at: null, created_at: '2026-10-01T08:00:00Z' },
    ]))));
    const { fetchLatestFirmwareRelease } = await import('../services/githubRelease');
    expect((await fetchLatestFirmwareRelease())?.releasedAt).toBe('2026-10-01T08:00:00.000Z');
  });

  it('does not advertise legacy app-only firmware as a factory image', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([release('old', ['firmware.bin', 'firmware-elecrow.bin'])]))));
    const { fetchLatestFirmwareRelease } = await import('../services/githubRelease');
    expect(await fetchLatestFirmwareRelease()).toBeNull();
  });

  it('does not reuse a cached release after the repository changes', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify([release('v1')])));
    vi.stubGlobal('fetch', fetcher);
    const { fetchLatestFirmwareRelease } = await import('../services/githubRelease');
    await fetchLatestFirmwareRelease();
    vi.stubEnv('GITHUB_REPO', 'other/firmware');
    await fetchLatestFirmwareRelease();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('selects the most recently published release even when GitHub lists an older one first', async () => {
    // GitHub's actual order on 2026-10-04: 5d1d177 was listed before the newer 302d490 and 253c0e9.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { ...release('dev-20261004-5d1d177'), published_at: '2026-10-04T12:52:55Z' },
      { ...release('dev-20261004-302d490'), published_at: '2026-10-04T12:55:01Z' },
      { ...release('dev-20261004-253c0e9'), published_at: '2026-10-04T13:09:15Z' },
      { ...release('undated'), published_at: null, created_at: null },
      { ...release('dev-20261002-3244623'), published_at: '2026-10-02T12:52:10Z' },
    ]))));
    const { fetchLatestFirmwareRelease, fetchFirmwareReleases } = await import('../services/githubRelease');
    expect((await fetchLatestFirmwareRelease())?.tag).toBe('dev-20261004-253c0e9');
    expect((await fetchFirmwareReleases()).map(value => value.tag)).toEqual([
      'dev-20261004-253c0e9', 'dev-20261004-302d490', 'dev-20261004-5d1d177', 'dev-20261002-3244623', 'undated',
    ]);
  });

  it('offers only the five newest complete releases', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(
      Array.from({ length: 8 }, (_, day) => ({ ...release(`dev-${day}`), published_at: `2026-10-0${day + 1}T00:00:00Z` })),
    ))));
    const { fetchFirmwareReleases } = await import('../services/githubRelease');
    expect((await fetchFirmwareReleases()).map(value => value.tag)).toEqual(['dev-7', 'dev-6', 'dev-5', 'dev-4', 'dev-3']);
  });

  it('names firmware by board, FW and version', async () => {
    const { buildManifestFromRelease, describeAssetFilename } = await import('../services/githubRelease');
    const selected = { tag: 'dev-1', version: 'dev-1', releasedAt: null, assets: {} };
    expect(buildManifestFromRelease(selected).name).toBe('Elecrow CrowPanel 2.13 FW dev-1');
    expect(buildManifestFromRelease(selected, undefined, 'v12').name).toBe('Elecrow CrowPanel 2.13 V1.2 FW dev-1');
    expect(describeAssetFilename('firmware-elecrow-v12-factory.bin', 'dev-1')).toBe('elecrow-crowpanel-213-v12_fw-dev-1_factory.bin');
    expect(describeAssetFilename('firmware-elecrow.bin', '1.2.3+abc')).toBe('elecrow-crowpanel-213_fw-1.2.3_abc_app.bin');
    expect(describeAssetFilename('firmware-factory.bin', 'dev-1')).toBe('waveshare-esp32-213-v2_fw-dev-1_factory.bin');
    expect(describeAssetFilename('bootloader-elecrow-v12.bin', 'dev-1')).toBe('elecrow-crowpanel-213-v12_fw-dev-1_bootloader.bin');
  });

  it('prefers descriptive asset names and falls back to legacy names per asset', async () => {
    const url = (tag: string, name: string) => `https://github.com/example/releases/download/${tag}/${name}`;
    const named = (tag: string, assetNames: string[]) => ({ tag_name: tag, draft: false, assets: assetNames.map(name => ({ name, browser_download_url: url(tag, name) })) });
    const descriptive = ['waveshare-esp32-213-v2', 'elecrow-crowpanel-213', 'elecrow-crowpanel-213-v12'].map(slug => `${slug}_fw-2.0.0_factory.bin`);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { ...named('v2.0.0', [...descriptive, 'firmware-factory.bin']), published_at: '2026-10-05T00:00:00Z' },
      { ...named('v1.0.0', names), published_at: '2026-10-04T00:00:00Z' },
      { ...named('v0.9.0', descriptive), published_at: '2026-10-03T00:00:00Z' },
    ]))));
    const { fetchFirmwareReleases } = await import('../services/githubRelease');
    const [renamed, legacy, mismatched] = await fetchFirmwareReleases();
    expect(renamed.assets['firmware-factory.bin']).toBe(url('v2.0.0', 'waveshare-esp32-213-v2_fw-2.0.0_factory.bin'));
    expect(legacy.assets['firmware-elecrow-v12-factory.bin']).toBe(url('v1.0.0', 'firmware-elecrow-v12-factory.bin'));
    // Descriptive names must carry the release's own version.
    expect(mismatched).toBeUndefined();
  });

  it('maps descriptive and legacy filenames to the same logical asset', async () => {
    const { parseAssetFilename, isReleaseAssetFilename } = await import('../services/githubRelease');
    expect(parseAssetFilename('elecrow-crowpanel-213-v12_fw-dev-1_factory.bin')).toEqual({ asset: 'firmware-elecrow-v12-factory.bin', version: 'dev-1' });
    expect(parseAssetFilename('waveshare-esp32-213-v2_fw-1.2.3_abc_partitions.bin')).toEqual({ asset: 'partitions.bin', version: '1.2.3_abc' });
    expect(parseAssetFilename('elecrow-crowpanel-213_fw-dev-1_app.bin')).toEqual({ asset: 'firmware-elecrow.bin', version: 'dev-1' });
    expect(parseAssetFilename('firmware-elecrow.bin')).toEqual({ asset: 'firmware-elecrow.bin' });
    for (const name of ['other_fw-1_factory.bin', 'elecrow-crowpanel-213_fw-../x_factory.bin', 'boot_app0.bin']) expect(parseAssetFilename(name)).toBeNull();
    expect(isReleaseAssetFilename('elecrow-crowpanel-213_fw-dev-1_factory.bin', 'firmware-elecrow-factory.bin', 'dev-1')).toBe(true);
    expect(isReleaseAssetFilename('elecrow-crowpanel-213_fw-dev-2_factory.bin', 'firmware-elecrow-factory.bin', 'dev-1')).toBe(false);
  });
});
