import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import firmwareAssets from '../routes/firmwareAssets';
import { fetchLatestFirmwareRelease } from '../services/githubRelease';

vi.mock('../services/githubRelease', async () => ({
  ...await vi.importActual('../services/githubRelease'),
  fetchLatestFirmwareRelease: vi.fn(),
}));

describe('release binary proxy', () => {
  let server: Server;
  let base: string;
  const realFetch = global.fetch;
  beforeAll(async () => {
    const app = express();
    app.use('/api/firmware', firmwareAssets);
    await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/firmware/`;
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  it('downloads the exact tag including valid semver build metadata', async () => {
    const name = 'firmware-elecrow-factory.bin';
    const url = `https://github.com/example/releases/download/v1.2.3+abc/${name}`;
    vi.mocked(fetchLatestFirmwareRelease).mockResolvedValue({ tag: 'v1.2.3+abc', version: '1.2.3+abc', assets: { [name]: url } });
    const upstream = vi.fn().mockResolvedValue(new Response(new Uint8Array([0xe9, 1, 2, 3]), { headers: { 'Content-Length': '4' } }));
    vi.stubGlobal('fetch', upstream);
    const response = await realFetch(`${base}releases/v1.2.3%2Babc/${name}`);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0xe9, 1, 2, 3]));
    expect(fetchLatestFirmwareRelease).toHaveBeenCalledWith('v1.2.3+abc');
    expect(upstream.mock.calls[0][0]).toBe(url);
  });
  it('returns a recoverable failure when a release download fails', async () => {
    vi.mocked(fetchLatestFirmwareRelease).mockResolvedValue({ tag: 'v1', version: '1', assets: { 'firmware-factory.bin': 'https://example.com/firmware.bin' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
    const response = await realFetch(`${base}releases/v1/firmware-factory.bin`);
    expect(response.status).toBe(502);
  });
});
