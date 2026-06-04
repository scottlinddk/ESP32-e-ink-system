import fetch from 'node-fetch';

interface ResolvedRelease {
  version: string;
  firmwareUrl: string;
  bootloaderUrl: string | null;
  partitionsUrl: string | null;
  fetchedAt: number;
}

let cache: ResolvedRelease | null = null;
const TTL = 5 * 60 * 1000;

export interface FirmwareRelease {
  version: string;
  firmwareUrl: string;
  bootloaderUrl: string | null;
  partitionsUrl: string | null;
}

export async function fetchLatestFirmwareRelease(): Promise<FirmwareRelease | null> {
  const repo = process.env.GITHUB_REPO?.trim();
  if (!repo) return null;

  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL) {
    return {
      version: cache.version,
      firmwareUrl: cache.firmwareUrl,
      bootloaderUrl: cache.bootloaderUrl,
      partitionsUrl: cache.partitionsUrl,
    };
  }

  const headers: Record<string, string> = { 'User-Agent': 'esp32-e-ink-backend' };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com/repos/${repo}/releases`, { headers });
  if (!res.ok) return null;

  const releases = (await res.json()) as Array<{
    draft: boolean;
    tag_name: string;
    assets: Array<{ name: string; browser_download_url: string }>;
  }>;

  const release = releases.find(r => !r.draft);
  if (!release) return null;

  const asset = release.assets.find(a => a.name === 'firmware.bin');
  if (!asset) return null;

  cache = {
    version: release.tag_name.replace(/^v/, ''),
    firmwareUrl: asset.browser_download_url,
    bootloaderUrl: release.assets.find(a => a.name === 'bootloader.bin')?.browser_download_url ?? null,
    partitionsUrl: release.assets.find(a => a.name === 'partitions.bin')?.browser_download_url ?? null,
    fetchedAt: now,
  };
  return {
    version: cache.version,
    firmwareUrl: cache.firmwareUrl,
    bootloaderUrl: cache.bootloaderUrl,
    partitionsUrl: cache.partitionsUrl,
  };
}

export function buildManifestFromRelease(release: FirmwareRelease): object {
  const parts: Array<{ path: string; offset: number }> = [];
  if (release.bootloaderUrl) parts.push({ path: release.bootloaderUrl, offset: 4096 });
  if (release.partitionsUrl) parts.push({ path: release.partitionsUrl, offset: 32768 });
  parts.push({ path: release.firmwareUrl, offset: 65536 });
  return {
    name: `ESP32 Display v${release.version}`,
    builds: [{ chipFamily: 'ESP32', parts }],
  };
}
