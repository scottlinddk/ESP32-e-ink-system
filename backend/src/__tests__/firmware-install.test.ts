import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import firmwareAssets from '../routes/firmwareAssets';
import { getInstallManifest } from '../services/firmwareInstall';

describe('local factory installation', () => {
  let directory: string;
  let server: Server;
  let base: string;
  const names = ['firmware-factory.bin', 'firmware-elecrow-factory.bin', 'firmware-elecrow-v12-factory.bin'];

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'eink-factory-'));
    const sums: string[] = [];
    for (const name of names) {
      const bytes = Buffer.alloc(65560, 255);
      bytes[name === names[0] ? 4096 : 0] = 0xe9;
      bytes[65536] = 0xe9;
      await writeFile(path.join(directory, name), bytes);
      sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
    }
    await writeFile(path.join(directory, 'SHA256SUMS'), sums.join('\n'));
    const builds = names.map((name, index) => ({ chipFamily: index === 0 ? 'ESP32' : 'ESP32-S3', parts: [{ path: name, offset: 0 }] }));
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ name: 'Test', version: 'test-build', release_date: '2026-10-04T12:00:00Z', builds: builds.slice(0, 2) }));
    await writeFile(path.join(directory, 'manifest-elecrow-v12.json'), JSON.stringify({ name: 'Test', version: 'test-build', release_date: 'tomorrow', builds: builds.slice(2) }));
    const app = express();
    app.use('/api/firmware', firmwareAssets);
    await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/firmware/`;
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  it('serves each selected panel through a same-origin hash-pinned factory URL without GitHub', async () => {
    vi.stubEnv('FIRMWARE_RELEASE_DIR', directory);
    for (const panel of ['original', 'v12']) {
      const response = await fetch(`${base}manifest.json?panel=${panel}`);
      expect(response.status).toBe(200);
      const manifest = await response.json() as { builds: Array<{ chipFamily: string; parts: Array<{ path: string; offset: number }> }> };
      const s3 = manifest.builds.find(build => build.chipFamily === 'ESP32-S3')!;
      expect(s3.parts[0].offset).toBe(0);
      expect(s3.parts[0].path).toContain(panel === 'v12' ? names[2] : names[1]);
      const binary = await fetch(new URL(s3.parts[0].path, base));
      expect(binary.status).toBe(200);
      expect(binary.headers.get('content-type')).toContain('application/octet-stream');
      expect(Buffer.from(await binary.arrayBuffer())).toEqual(await readFile(path.join(directory, panel === 'v12' ? names[2] : names[1])));
    }
  });

  it('rejects stale hashes and undeclared filenames', async () => {
    vi.stubEnv('FIRMWARE_RELEASE_DIR', directory);
    expect((await fetch(`${base}local/stale/${names[0]}`)).status).toBe(409);
    expect((await fetch(`${base}local/anything/config.h`)).status).toBe(404);
    expect((await fetch(`${base}releases/v1/secret.txt`)).status).toBe(404);
  });

  it('passes through a valid packaged release date and drops an invalid one', async () => {
    vi.stubEnv('FIRMWARE_RELEASE_DIR', directory);
    expect((await getInstallManifest('original'))?.release_date).toBe('2026-10-04T12:00:00.000Z');
    expect(await getInstallManifest('v12')).not.toHaveProperty('release_date');
  });

  it('refuses a local image that no longer matches the packaging checksum', async () => {
    vi.stubEnv('FIRMWARE_RELEASE_DIR', directory);
    const filename = path.join(directory, names[2]);
    const original = await readFile(filename);
    try {
      await writeFile(filename, Buffer.from('not firmware'));
      await expect(getInstallManifest('v12')).rejects.toThrow('checksum');
    } finally { await writeFile(filename, original); }
  });
});
