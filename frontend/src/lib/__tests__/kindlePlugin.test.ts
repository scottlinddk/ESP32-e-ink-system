import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { buildConfigFile, buildPluginZip, findPluginsDirectory, pluginFiles, validateKindleSettings, writePluginToKindle, type DirectoryLike } from '../kindle/plugin';
import { crc32, createZip } from '../kindle/zip';

const settings = { apiUrl: 'https://display.example/api', deviceId: '3F2B8C1E-9D4A-4B6F-8E21-0A1B2C3D4E5F', token: `einkd_${'a'.repeat(43)}` };
const pluginDir = fileURLToPath(new URL('../../../../koreader/einkdisplay.koplugin/', import.meta.url));

/** Reads the archive back by its central directory, as an unzip tool would. */
function readZip(zip: Uint8Array): Map<string, Buffer> {
  const buffer = Buffer.from(zip);
  const end = buffer.length - 22;
  expect(buffer.readUInt32LE(end)).toBe(0x06054b50);
  const count = buffer.readUInt16LE(end + 10);
  let pos = buffer.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(buffer.readUInt32LE(pos)).toBe(0x02014b50);
    const crc = buffer.readUInt32LE(pos + 16), size = buffer.readUInt32LE(pos + 24);
    const nameLength = buffer.readUInt16LE(pos + 28), offset = buffer.readUInt32LE(pos + 42);
    const name = buffer.subarray(pos + 46, pos + 46 + nameLength).toString('utf8');
    expect(buffer.readUInt32LE(offset)).toBe(0x04034b50);
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    const data = buffer.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);
    files.set(name, data);
    pos += 46 + nameLength;
  }
  return files;
}

describe('zip writer', () => {
  it('computes the standard CRC-32', () => { expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926); });
  it('writes an archive that reads back, with UTF-8 names and empty files', () => {
    const files = readZip(createZip([{ name: 'a/æøå.txt', data: new TextEncoder().encode('hej') }, { name: 'b.txt', data: new Uint8Array() }]));
    expect(files.get('a/æøå.txt')!.toString()).toBe('hej');
    expect(files.get('b.txt')!.length).toBe(0);
  });
  it('is deterministic and rejects unsafe names', () => {
    const entry = { name: 'x.txt', data: new Uint8Array([1, 2, 3]) };
    expect(createZip([entry])).toEqual(createZip([entry]));
    for (const name of ['', '/etc/passwd', '../x']) expect(() => createZip([{ name, data: new Uint8Array() }])).toThrow();
  });
  it('is accepted by a real unzip implementation', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(`${tmpdir()}/kindle-zip-`);
    writeFileSync(`${dir}/p.zip`, buildPluginZip(settings));
    const listing = execFileSync('python3', ['-I', '-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print("\\n".join(sorted(z.namelist())))', `${dir}/p.zip`]).toString();
    expect(listing.split('\n')).toContain('einkdisplay.koplugin/main.lua');
    expect(inflateRawSync).toBeDefined();
  });
});

describe('Kindle plugin package', () => {
  it('validates the same way the plugin does', () => {
    expect(validateKindleSettings(settings)).toBeNull();
    expect(validateKindleSettings({ ...settings, apiUrl: 'http://display.example/api' })).toMatch(/https/);
    expect(validateKindleSettings({ ...settings, apiUrl: 'https://user:pw@display.example/api' })).toMatch(/https/);
    expect(validateKindleSettings({ ...settings, apiUrl: 'https://display.example/api?x=1' })).toMatch(/https/);
    expect(validateKindleSettings({ ...settings, deviceId: 'kindle' })).toMatch(/UUID/);
    expect(validateKindleSettings({ ...settings, token: 'einkd_short' })).toMatch(/token/);
    expect(validateKindleSettings({ ...settings, token: ` ${settings.token}\n` })).toBeNull(); // surrounding whitespace is trimmed
    expect(validateKindleSettings({ ...settings, token: `${settings.token}\nX: 1` })).toMatch(/token/);
  });
  it('rejects a token with an embedded line break', () => {
    expect(validateKindleSettings({ ...settings, token: `einkd_${'a'.repeat(20)}\n${'a'.repeat(23)}` })).toMatch(/token/);
    expect(() => buildConfigFile({ ...settings, token: `einkd_${'a'.repeat(20)}\n${'a'.repeat(23)}` })).toThrow();
  });
  it('writes a config.txt that the plugin parses back to the same values', () => {
    const text = buildConfigFile(settings);
    expect(text).toContain('device_id = 3f2b8c1e-9d4a-4b6f-8e21-0a1b2c3d4e5f');
    const lines = Object.fromEntries(text.split('\n').filter(l => /^\w+ = /.test(l)).map(l => l.split(' = ')));
    expect(lines).toEqual({ api_url: settings.apiUrl, device_id: settings.deviceId.toLowerCase(), token: settings.token });
  });
  it('bundles every plugin source file from the repository, unchanged', () => {
    const names = readdirSync(pluginDir).filter(name => name.endsWith('.lua')).sort();
    expect(names).toEqual(['_meta.lua', 'einkdisplay_bitmap.lua', 'einkdisplay_feed.lua', 'main.lua']);
    const files = readZip(buildPluginZip(settings));
    expect([...files.keys()].sort()).toEqual([...names, 'config.txt'].map(name => `einkdisplay.koplugin/${name}`).sort());
    for (const name of names) expect(files.get(`einkdisplay.koplugin/${name}`)!.toString()).toBe(readFileSync(`${pluginDir}${name}`, 'utf8'));
    expect(pluginFiles(settings).find(file => file.name === 'config.txt')!.text).toContain(settings.token);
  });
});

/** A folder tree held in memory that behaves like File System Access handles. */
function fakeFolder(name: string, tree: Record<string, unknown> = {}, written: Record<string, string> = {}, path = name): DirectoryLike {
  return {
    name,
    async getDirectoryHandle(child, options) {
      if (!(child in tree)) {
        if (!options?.create) throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
        tree[child] = {};
      }
      return fakeFolder(child, tree[child] as Record<string, unknown>, written, `${path}/${child}`);
    },
    async getFileHandle(file) {
      return { async createWritable() { let text = ''; return { async write(data: string) { text += data; }, async close() { written[`${path}/${file}`] = text; } }; } };
    },
  };
}

describe('copying to a mounted Kindle', () => {
  it('writes into koreader/plugins when the drive is picked', async () => {
    const written: Record<string, string> = {};
    const count = await writePluginToKindle(fakeFolder('Kindle', { koreader: { plugins: {} }, documents: {} }, written), settings);
    expect(count).toBe(5);
    expect(Object.keys(written).sort()).toEqual(['main.lua', '_meta.lua', 'config.txt', 'einkdisplay_bitmap.lua', 'einkdisplay_feed.lua'].sort().map(name => `Kindle/koreader/plugins/einkdisplay.koplugin/${name}`).sort());
    expect(written['Kindle/koreader/plugins/einkdisplay.koplugin/config.txt']).toContain(settings.token);
  });
  it('accepts the koreader or plugins folder, and creates plugins when missing', async () => {
    expect((await findPluginsDirectory(fakeFolder('plugins'))).name).toBe('plugins');
    expect((await findPluginsDirectory(fakeFolder('koreader', { plugins: {} }))).name).toBe('plugins');
    expect((await findPluginsDirectory(fakeFolder('koreader'))).name).toBe('plugins');
  });
  it('explains when the folder is not a Kindle with KOReader, and writes nothing', async () => {
    const written: Record<string, string> = {};
    await expect(writePluginToKindle(fakeFolder('Documents', { notes: {} }, written), settings)).rejects.toThrow(/koreader folder/);
    expect(written).toEqual({});
  });
  it('does not write anything when the settings are invalid', async () => {
    const written: Record<string, string> = {};
    await expect(writePluginToKindle(fakeFolder('Kindle', { koreader: { plugins: {} } }, written), { ...settings, token: 'x' })).rejects.toThrow();
    expect(written).toEqual({});
  });
});
