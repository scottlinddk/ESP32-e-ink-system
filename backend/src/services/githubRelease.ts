
interface ResolvedRelease {
  version: string;
  firmwareUrl: string;
  bootloaderUrl: string | null;
  partitionsUrl: string | null;
  firmwareElecrowUrl: string | null;
  bootloaderElecrowUrl: string | null;
  partitionsElecrowUrl: string | null;
  fetchedAt: number;
}

let cache: ResolvedRelease | null = null;
const TTL = 5 * 60 * 1000;

export interface FirmwareRelease {
  version: string;
  firmwareUrl: string;
  bootloaderUrl: string | null;
  partitionsUrl: string | null;
  firmwareElecrowUrl: string | null;
  bootloaderElecrowUrl: string | null;
  partitionsElecrowUrl: string | null;
}

export async function fetchLatestFirmwareRelease(): Promise<FirmwareRelease | null> {
  const repo = process.env.GITHUB_REPO?.trim() || 'scottlinddk/ESP32-e-ink-system';
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
    firmwareElecrowUrl: release.assets.find(a => a.name === 'firmware-elecrow.bin')?.browser_download_url ?? null,
    bootloaderElecrowUrl: release.assets.find(a => a.name === 'bootloader-elecrow.bin')?.browser_download_url ?? null,
    partitionsElecrowUrl: release.assets.find(a => a.name === 'partitions-elecrow.bin')?.browser_download_url ?? null,
    fetchedAt: now,
  };
  return {
    version: cache.version,
    firmwareUrl: cache.firmwareUrl,
    bootloaderUrl: cache.bootloaderUrl,
    partitionsUrl: cache.partitionsUrl,
    firmwareElecrowUrl: cache.firmwareElecrowUrl,
    bootloaderElecrowUrl: cache.bootloaderElecrowUrl,
    partitionsElecrowUrl: cache.partitionsElecrowUrl,
  };
}

export function buildManifestFromRelease(release: FirmwareRelease): object {
  const esp32Parts: Array<{ path: string; offset: number }> = [];
  if (release.bootloaderUrl) esp32Parts.push({ path: release.bootloaderUrl, offset: 4096 });
  if (release.partitionsUrl) esp32Parts.push({ path: release.partitionsUrl, offset: 32768 });
  esp32Parts.push({ path: release.firmwareUrl, offset: 65536 });

  const builds: Array<{ chipFamily: string; parts: Array<{ path: string; offset: number }> }> = [
    { chipFamily: 'ESP32', parts: esp32Parts },
  ];

  if (release.firmwareElecrowUrl) {
    const esp32s3Parts: Array<{ path: string; offset: number }> = [];
    if (release.bootloaderElecrowUrl) esp32s3Parts.push({ path: release.bootloaderElecrowUrl, offset: 0 });
    if (release.partitionsElecrowUrl) esp32s3Parts.push({ path: release.partitionsElecrowUrl, offset: 32768 });
    esp32s3Parts.push({ path: release.firmwareElecrowUrl, offset: 65536 });
    builds.push({ chipFamily: 'ESP32-S3', parts: esp32s3Parts });
  }

  return { name: `ESP32 Display v${release.version}`, builds };
}
