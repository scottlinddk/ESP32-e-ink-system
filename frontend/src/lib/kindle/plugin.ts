import { createZip, type ZipEntry } from './zip';

/** Folder name KOReader expects; also the root folder inside the downloaded archive. */
export const PLUGIN_DIR = 'einkdisplay.koplugin';

/** Plugin sources, bundled at build time from koreader/einkdisplay.koplugin (config.txt is generated). */
const SOURCES = import.meta.glob('../../../../koreader/einkdisplay.koplugin/*.lua', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const REQUIRED = ['_meta.lua', 'main.lua', 'einkdisplay_feed.lua', 'einkdisplay_bitmap.lua'];

export interface KindleSettings { apiUrl: string; deviceId: string; token: string }
export interface PluginFile { name: string; text: string }

/** The same value rules as the plugin: https address, UUID, einkd_ token. Returns an error message or null. */
export function validateKindleSettings(settings: KindleSettings): string | null {
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~/-]*)?$/.test(settings.apiUrl.trim())) return 'The API address must be an https:// address without a query';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(settings.deviceId.trim())) return 'The device ID must be a UUID';
  if (!/^einkd_[A-Za-z0-9_-]{43}$/.test(settings.token.trim())) return 'The device token must start with einkd_';
  return null;
}

/** config.txt with the three values filled in; the plugin imports it when KOReader starts. */
export function buildConfigFile(settings: KindleSettings): string {
  const problem = validateKindleSettings(settings);
  if (problem) throw new Error(problem);
  return [
    '# E-Ink Display plugin settings, filled in by the web app.',
    '# This file holds a device token. Do not share it. Create a new token under Devices if it leaks.',
    '',
    `api_url = ${settings.apiUrl.trim()}`,
    `device_id = ${settings.deviceId.trim().toLowerCase()}`,
    `token = ${settings.token.trim()}`,
    '',
  ].join('\n');
}

export function pluginFiles(settings: KindleSettings): PluginFile[] {
  const byName = new Map(Object.entries(SOURCES).map(([path, text]) => [path.split('/').pop()!, text]));
  const missing = REQUIRED.filter(name => !byName.get(name));
  if (missing.length) throw new Error(`This build does not include the Kindle plugin (${missing.join(', ')} missing)`);
  return [
    ...[...byName.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, text]) => ({ name, text })),
    { name: 'config.txt', text: buildConfigFile(settings) },
  ];
}

export function buildPluginZip(settings: KindleSettings): Uint8Array {
  const encoder = new TextEncoder();
  const entries: ZipEntry[] = pluginFiles(settings).map(file => ({ name: `${PLUGIN_DIR}/${file.name}`, data: encoder.encode(file.text) }));
  return createZip(entries);
}

/** The subset of the File System Access API that the copy needs, so tests can supply a fake. */
export interface DirectoryLike {
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{ createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }> }>;
}

async function optionalDirectory(parent: DirectoryLike, name: string): Promise<DirectoryLike | null> {
  try { return await parent.getDirectoryHandle(name); }
  catch (error) { if ((error as Error).name === 'NotFoundError') return null; throw error; }
}

/** From the folder the person picked (the Kindle drive, its koreader folder or its plugins folder) to koreader/plugins. */
export async function findPluginsDirectory(picked: DirectoryLike): Promise<DirectoryLike> {
  if (picked.name === 'plugins') return picked;
  const koreader = picked.name === 'koreader' ? picked : await optionalDirectory(picked, 'koreader');
  if (!koreader) throw new Error('No koreader folder found. Pick the Kindle drive itself, after installing KOReader.');
  return koreader.getDirectoryHandle('plugins', { create: true });
}

/** Writes the plugin into koreader/plugins/einkdisplay.koplugin. Returns the number of files written. */
export async function writePluginToKindle(picked: DirectoryLike, settings: KindleSettings): Promise<number> {
  const files = pluginFiles(settings);
  const plugins = await findPluginsDirectory(picked);
  const target = await plugins.getDirectoryHandle(PLUGIN_DIR, { create: true });
  for (const file of files) {
    const writable = await (await target.getFileHandle(file.name, { create: true })).createWritable();
    await writable.write(file.text);
    await writable.close();
  }
  return files.length;
}

export function canPickDirectory(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && 'showDirectoryPicker' in window;
}
