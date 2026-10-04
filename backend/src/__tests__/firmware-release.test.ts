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
    expect(manifest.builds[1]).toEqual({ chipFamily: 'ESP32-S3', parts: [{ path: 'releases/dev-tested/firmware-elecrow-factory.bin', offset: 0 }] });
    expect(buildManifestFromRelease(selected!, undefined, 'v12').builds).toEqual([
      { chipFamily: 'ESP32-S3', parts: [{ path: 'releases/dev-tested/firmware-elecrow-v12-factory.bin', offset: 0 }] },
    ]);
    expect(buildManifestFromRelease(selected!, 'https://display.example/api/').builds[0].parts[0].path).toBe('https://display.example/api/firmware/releases/dev-tested/firmware-factory.bin');
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
});
