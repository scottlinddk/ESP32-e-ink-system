import { readFile } from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { buildManifestFromRelease, fetchLatestFirmwareRelease } from './githubRelease';

export const FACTORY_FILES = ['firmware-factory.bin', 'firmware-elecrow-factory.bin', 'firmware-elecrow-v12-factory.bin'];

/** Explicit opt-in for locally packaged artifacts; never guess a build directory. */
export async function readLocalFactory(name: string): Promise<{ bytes: Buffer; hash: string }> {
  const directory = process.env.FIRMWARE_RELEASE_DIR;
  if (!directory || !FACTORY_FILES.includes(name)) throw new Error('Unknown local factory image');
  const [bytes, sums] = await Promise.all([
    readFile(path.resolve(directory, name)), readFile(path.resolve(directory, 'SHA256SUMS'), 'utf8'),
  ]);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (!sums.split(/\r?\n/).some(line => line.trim() === `${hash}  ${name}`)) throw new Error('Local factory image checksum mismatch');
  const bootOffset = name === 'firmware-factory.bin' ? 4096 : 0;
  if (bytes.length <= 65536 || bytes[bootOffset] !== 0xe9 || bytes[65536] !== 0xe9) throw new Error('Local image is not a complete factory build');
  return { bytes, hash };
}

export async function getInstallManifest(panel: 'original' | 'v12' = 'original') {
  const directory = process.env.FIRMWARE_RELEASE_DIR;
  if (!directory) {
    const release = await fetchLatestFirmwareRelease();
    return release ? buildManifestFromRelease(release, process.env.BACKEND_PUBLIC_BASE_URL?.trim(), panel) : null;
  }
  const filename = panel === 'v12' ? 'manifest-elecrow-v12.json' : 'manifest.json';
  const manifest = JSON.parse(await readFile(path.resolve(directory, filename), 'utf8'));
  const expected = panel === 'v12'
    ? [['ESP32-S3', 'firmware-elecrow-v12-factory.bin']]
    : [['ESP32', 'firmware-factory.bin'], ['ESP32-S3', 'firmware-elecrow-factory.bin']];
  if (!manifest.name || typeof manifest.version !== 'string' || !Array.isArray(manifest.builds) || manifest.builds.length !== expected.length) throw new Error('Invalid local factory manifest');
  const builds = await Promise.all(expected.map(async ([chipFamily, name]) => {
    const build = manifest.builds.find((entry: { chipFamily: string }) => entry.chipFamily === chipFamily);
    if (build?.parts?.length !== 1 || build.parts[0].path !== name || build.parts[0].offset !== 0) throw new Error('Local factory manifest does not match its board');
    const { hash } = await readLocalFactory(name);
    return { chipFamily, parts: [{ path: `local/${hash}/${name}`, offset: 0 }] };
  }));
  return { name: manifest.name as string, version: manifest.version as string, new_install_prompt_erase: true, new_install_improv_wait_time: 0, builds };
}
