export const FIRMWARE_ASSETS = [
  'firmware-factory.bin', 'firmware-elecrow-factory.bin', 'firmware-elecrow-v12-factory.bin',
  'firmware.bin', 'firmware-elecrow.bin', 'firmware-elecrow-v12.bin',
  'bootloader.bin', 'partitions.bin', 'bootloader-elecrow.bin', 'partitions-elecrow.bin',
  'bootloader-elecrow-v12.bin', 'partitions-elecrow-v12.bin',
] as const;
export type FirmwareAsset = typeof FIRMWARE_ASSETS[number];

export interface FirmwareRelease {
  tag: string;
  version: string;
  assets: Partial<Record<FirmwareAsset, string>>;
}

interface GithubRelease {
  draft: boolean;
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

const cache = new Map<string, { release: FirmwareRelease; fetchedAt: number }>();
const TTL = 5 * 60 * 1000;

function resolveRelease(release: GithubRelease): FirmwareRelease | null {
  if (release.draft || !release.tag_name || !Array.isArray(release.assets)) return null;
  const assets: FirmwareRelease['assets'] = {};
  for (const name of FIRMWARE_ASSETS) {
    const asset = release.assets.find(value => value.name === name);
    if (asset && /^https:\/\//.test(asset.browser_download_url)) assets[name] = asset.browser_download_url;
  }
  // App-only images cannot boot an erased device. Ignore incomplete uploads.
  if (!assets['firmware-factory.bin'] || !assets['firmware-elecrow-factory.bin'] || !assets['firmware-elecrow-v12-factory.bin']) return null;
  return { tag: release.tag_name, version: release.tag_name.replace(/^v/, ''), assets };
}

/** Dev prereleases are intentional. Choose the newest complete build. */
export async function fetchLatestFirmwareRelease(tag?: string): Promise<FirmwareRelease | null> {
  const repo = process.env.GITHUB_REPO?.trim() || 'scottlinddk/ESP32-e-ink-system';
  const key = `${repo}:${tag ?? 'latest'}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < TTL) return hit.release;
  const headers: Record<string, string> = { 'User-Agent': 'esp32-e-ink-backend', Accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  const endpoint = tag ? `releases/tags/${encodeURIComponent(tag)}` : 'releases?per_page=30';
  const response = await fetch(`https://api.github.com/repos/${repo}/${endpoint}`, {
    headers, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  const releases: GithubRelease[] = tag ? [payload] : Array.isArray(payload) ? payload : [];
  const release = releases.map(resolveRelease).find(value => value !== null) ?? null;
  if (release) {
    if (cache.size >= 64) cache.delete(cache.keys().next().value!);
    cache.set(key, { release, fetchedAt: Date.now() });
  }
  return release;
}

/** Paths are relative to /firmware/ unless a public backend base is configured. */
export function buildManifestFromRelease(release: FirmwareRelease, proxyBase?: string, panel: 'original' | 'v12' = 'original') {
  const prefix = proxyBase ? `${proxyBase.replace(/\/$/, '')}/firmware/` : '';
  const part = (name: FirmwareAsset) => ({
    path: `${prefix}releases/${encodeURIComponent(release.tag)}/${name}`,
    offset: 0,
  });
  return {
    name: 'ESP32 E-Ink Display',
    version: release.version,
    new_install_prompt_erase: true,
    new_install_improv_wait_time: 0,
    builds: panel === 'v12' ? [
      { chipFamily: 'ESP32-S3', parts: [part('firmware-elecrow-v12-factory.bin')] },
    ] : [
      { chipFamily: 'ESP32', parts: [part('firmware-factory.bin')] },
      { chipFamily: 'ESP32-S3', parts: [part('firmware-elecrow-factory.bin')] },
    ],
  };
}
