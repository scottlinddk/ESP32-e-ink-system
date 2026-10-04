import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatReleaseDate, loadPublicFirmwareManifest, resolveFirmwareManifest } from '../firmwareManifest';

const manifest = { name: 'Display', builds: [{ chipFamily: 'ESP32-S3', parts: [{ path: 'releases/v1/firmware-elecrow-factory.bin', offset: 0 }] }] };
afterEach(() => { vi.unstubAllGlobals(); });

describe('browser factory manifests', () => {
  it('preserves HTTPS and the reverse-proxy /api prefix before converting the manifest to a blob', () => {
    const result = resolveFirmwareManifest(manifest, 'https://example.com/api/firmware/');
    expect(result.builds[0].parts[0].path).toBe('https://example.com/api/firmware/releases/v1/firmware-elecrow-factory.bin');
  });
  it('resolves local development and configured absolute backend URLs', () => {
    expect(resolveFirmwareManifest(manifest, 'http://localhost:5173/api/firmware/').builds[0].parts[0].path).toContain('http://localhost:5173/api/firmware/');
    const absolute = { ...manifest, builds: [{ chipFamily: 'ESP32-S3', parts: [{ path: 'https://api.example.com/firmware.bin', offset: 0 }] }] };
    expect(resolveFirmwareManifest(absolute, 'https://example.com/api/firmware/').builds[0].parts[0].path).toBe('https://api.example.com/firmware.bin');
  });
  it('keeps the release date and formats it as a calendar date in the requested time zone', () => {
    expect(resolveFirmwareManifest({ ...manifest, release_date: '2026-10-04T23:30:00Z' }, 'https://example.com/').release_date).toBe('2026-10-04T23:30:00Z');
    expect(formatReleaseDate('2026-10-04T23:30:00Z', 'en-GB', 'UTC')).toBe('4 October 2026');
    expect(formatReleaseDate('2026-10-04T23:30:00Z', 'en-GB', 'Europe/Copenhagen')).toBe('5 October 2026');
    for (const value of [undefined, '', 'not a date']) expect(formatReleaseDate(value)).toBeNull();
  });
  it('refuses malformed, insecure, and empty manifests', () => {
    expect(() => resolveFirmwareManifest({ name: 'Bad', builds: [] }, 'https://example.com/')).toThrow();
    for (const path of ['http://example.com/a.bin', 'javascript:alert(1)']) {
      expect(() => resolveFirmwareManifest({ ...manifest, builds: [{ chipFamily: 'ESP32-S3', parts: [{ path, offset: 0 }] }] }, 'https://example.com/')).toThrow();
    }
  });
  it('requests the chosen panel and never silently falls back to old GitHub binaries', async () => {
    vi.stubGlobal('window', { location: { href: 'https://example.com/flash' } });
    const fetcher = vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(loadPublicFirmwareManifest('v12')).rejects.toThrow('No complete firmware');
    expect(fetcher.mock.calls[0][0]).toBe('/api/firmware/public-manifest?panel=v12');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('blocks app-only ESP32-S3 images before enabling USB installation', async () => {
    vi.stubGlobal('window', { location: { href: 'https://example.com/flash' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...manifest, builds: [{ chipFamily: 'ESP32-S3', parts: [{ path: 'firmware.bin', offset: 65536 }] }] }))));
    await expect(loadPublicFirmwareManifest('original')).rejects.toThrow('complete ESP32-S3 factory image');
  });
});
