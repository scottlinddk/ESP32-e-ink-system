/**
 * Logical asset identities, spelled as the legacy release filenames. Releases since the rename
 * publish descriptive names instead (see describeAssetFilename); both resolve to these keys.
 */
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
  /** ISO 8601 publication time; null when the source does not report one. */
  releasedAt: string | null;
  assets: Partial<Record<FirmwareAsset, string>>;
}

interface GithubRelease {
  draft: boolean;
  tag_name: string;
  published_at?: string | null;
  created_at?: string | null;
  assets: Array<{ name: string; browser_download_url: string }>;
}

/** Normalizes a reported timestamp; anything unparseable is treated as unknown. */
export function releaseDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

const cache = new Map<string, { releases: FirmwareRelease[]; fetchedAt: number }>();
const TTL = 5 * 60 * 1000;
/** How many recent releases the installer offers. */
export const SELECTABLE_RELEASES = 5;

export type FirmwarePanel = 'original' | 'v12';
/** Human-readable hardware each install manifest targets. */
export const PANEL_BOARD_NAMES: Record<FirmwarePanel, string> = {
  original: 'Elecrow CrowPanel 2.13',
  v12: 'Elecrow CrowPanel 2.13 V1.2',
};

/** A descriptive firmware name: board, "FW" and version. */
export function firmwareDisplayName(panel: FirmwarePanel, version: string): string {
  return `${PANEL_BOARD_NAMES[panel]} FW ${version}`;
}

// Keep in sync with Board.slug and asset_name() in firmware/scripts/package_web_firmware.py.
const ASSET_BOARD_SLUGS: Record<string, string> = {
  '': 'waveshare-esp32-213-v2', '-elecrow': 'elecrow-crowpanel-213', '-elecrow-v12': 'elecrow-crowpanel-213-v12',
};
const LEGACY_ASSET = /^(firmware|bootloader|partitions)(-elecrow(?:-v12)?)?(-factory)?\.bin$/;
const DESCRIPTIVE_ASSET = /^(waveshare-esp32-213-v2|elecrow-crowpanel-213(?:-v12)?)_fw-([a-zA-Z0-9._-]+)_(factory|app|bootloader|partitions)\.bin$/;

/** Release filename naming the board, "fw", the version and the image type. */
export function describeAssetFilename(name: FirmwareAsset, version: string): string {
  const [, kind, suffix = '', factory] = LEGACY_ASSET.exec(name) ?? [];
  const image = factory ? 'factory' : kind === 'firmware' ? 'app' : kind;
  const safeVersion = version.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${ASSET_BOARD_SLUGS[suffix]}_fw-${safeVersion}_${image}.bin`;
}

/** Maps a legacy or descriptive filename to its logical asset; null for anything else. */
export function parseAssetFilename(name: string): { asset: FirmwareAsset; version?: string } | null {
  if (FIRMWARE_ASSETS.includes(name as FirmwareAsset)) return { asset: name as FirmwareAsset };
  const match = DESCRIPTIVE_ASSET.exec(name);
  if (!match) return null;
  const [, slug, version, image] = match;
  const suffix = Object.keys(ASSET_BOARD_SLUGS).find(key => ASSET_BOARD_SLUGS[key] === slug)!;
  const asset = image === 'factory' ? `firmware${suffix}-factory.bin` : `${image === 'app' ? 'firmware' : image}${suffix}.bin`;
  return FIRMWARE_ASSETS.includes(asset as FirmwareAsset) ? { asset: asset as FirmwareAsset, version } : null;
}

/** True when `name` is how this release names `asset`, in either the descriptive or legacy spelling. */
export function isReleaseAssetFilename(name: string, asset: FirmwareAsset, version: string): boolean {
  return name === asset || name === describeAssetFilename(asset, version);
}

function resolveRelease(release: GithubRelease): FirmwareRelease | null {
  if (release.draft || !release.tag_name || !Array.isArray(release.assets)) return null;
  const version = release.tag_name.replace(/^v/, '');
  const assets: FirmwareRelease['assets'] = {};
  for (const name of FIRMWARE_ASSETS) {
    // Prefer the descriptive name; releases published before the rename only have the legacy one.
    const asset = release.assets.find(value => value.name === describeAssetFilename(name, version))
      ?? release.assets.find(value => value.name === name);
    if (asset && /^https:\/\//.test(asset.browser_download_url)) assets[name] = asset.browser_download_url;
  }
  // App-only images cannot boot an erased device. Ignore incomplete uploads.
  if (!assets['firmware-factory.bin'] || !assets['firmware-elecrow-factory.bin'] || !assets['firmware-elecrow-v12-factory.bin']) return null;
  // Publication is when the release became installable; a draft's creation time is a fallback.
  const releasedAt = releaseDate(release.published_at) ?? releaseDate(release.created_at);
  return { tag: release.tag_name, version, releasedAt, assets };
}

/** Newest first. GitHub does not order its release list by publication time, so never trust its order. */
function byReleaseDateDescending(a: FirmwareRelease, b: FirmwareRelease): number {
  const time = (release: FirmwareRelease) => release.releasedAt ? Date.parse(release.releasedAt) : -Infinity;
  return time(b) - time(a);
}

async function fetchReleases(tag?: string): Promise<FirmwareRelease[]> {
  const repo = process.env.GITHUB_REPO?.trim() || 'scottlinddk/ESP32-e-ink-system';
  const key = `${repo}:${tag ?? 'list'}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < TTL) return hit.releases;
  const headers: Record<string, string> = { 'User-Agent': 'esp32-e-ink-backend', Accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  const endpoint = tag ? `releases/tags/${encodeURIComponent(tag)}` : 'releases?per_page=30';
  const response = await fetch(`https://api.github.com/repos/${repo}/${endpoint}`, {
    headers, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return [];
  const payload = await response.json();
  const listed: GithubRelease[] = tag ? [payload] : Array.isArray(payload) ? payload : [];
  const releases = listed.map(resolveRelease).filter((value): value is FirmwareRelease => value !== null).sort(byReleaseDateDescending);
  if (releases.length) {
    if (cache.size >= 64) cache.delete(cache.keys().next().value!);
    cache.set(key, { releases, fetchedAt: Date.now() });
  }
  return releases;
}

/** The newest complete releases, newest first. Dev prereleases are intentional. */
export async function fetchFirmwareReleases(limit = SELECTABLE_RELEASES): Promise<FirmwareRelease[]> {
  return (await fetchReleases()).slice(0, limit);
}

/** The newest complete build, or the exact release for a pinned tag. */
export async function fetchLatestFirmwareRelease(tag?: string): Promise<FirmwareRelease | null> {
  return (await fetchReleases(tag))[0] ?? null;
}

/** Paths are relative to /firmware/ unless a public backend base is configured. */
export function buildManifestFromRelease(release: FirmwareRelease, proxyBase?: string, panel: FirmwarePanel = 'original') {
  const prefix = proxyBase ? `${proxyBase.replace(/\/$/, '')}/firmware/` : '';
  const part = (name: FirmwareAsset) => ({
    path: `${prefix}releases/${encodeURIComponent(release.tag)}/${describeAssetFilename(name, release.version)}`,
    offset: 0,
  });
  return {
    name: firmwareDisplayName(panel, release.version),
    version: release.version,
    ...(release.releasedAt ? { release_date: release.releasedAt } : {}),
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
