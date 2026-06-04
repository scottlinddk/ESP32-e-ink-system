import fetch from 'node-fetch';

interface ResolvedRelease {
  version: string;
  firmwareUrl: string;
  fetchedAt: number;
}

let cache: ResolvedRelease | null = null;
const TTL = 5 * 60 * 1000;

export async function fetchLatestFirmwareRelease(): Promise<{ version: string; firmwareUrl: string } | null> {
  const repo = process.env.GITHUB_REPO?.trim();
  if (!repo) return null;

  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL) {
    return { version: cache.version, firmwareUrl: cache.firmwareUrl };
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
    fetchedAt: now,
  };
  return { version: cache.version, firmwareUrl: cache.firmwareUrl };
}
