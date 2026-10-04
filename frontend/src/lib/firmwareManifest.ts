export type ElecrowPanel = 'original' | 'v12';
export interface FlashManifest {
  name: string;
  version?: string;
  /** ISO 8601 release time reported by the backend; omitted when unknown. */
  release_date?: string;
  new_install_prompt_erase?: boolean;
  new_install_improv_wait_time?: number;
  builds: Array<{ chipFamily: string; parts: Array<{ path: string; offset: number }> }>;
}

/** A calendar date in the display time zone, or null for a missing or invalid value. */
export function formatReleaseDate(value: string | undefined, locale?: string, timeZone?: string): string | null {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toLocaleDateString(locale, { dateStyle: 'long', timeZone } as Intl.DateTimeFormatOptions) : null;
}

/** Blob manifests need absolute part URLs: blob: URLs have no relative base. */
export function resolveFirmwareManifest(value: unknown, firmwareBaseUrl: string): FlashManifest {
  const manifest = value as FlashManifest;
  if (!manifest || typeof manifest.name !== 'string' || !Array.isArray(manifest.builds) || !manifest.builds.length) {
    throw new Error('Invalid firmware manifest');
  }
  return {
    ...manifest,
    builds: manifest.builds.map(build => {
      if (!build || typeof build.chipFamily !== 'string' || !Array.isArray(build.parts) || !build.parts.length) {
        throw new Error('Firmware image is missing');
      }
      return {
        ...build,
        parts: build.parts.map(part => {
          if (!part || typeof part.path !== 'string' || !part.path || !Number.isInteger(part.offset) || part.offset < 0) {
            throw new Error('Invalid firmware image');
          }
          const url = new URL(part.path, firmwareBaseUrl);
          if (!['http:', 'https:'].includes(url.protocol) || (new URL(firmwareBaseUrl).protocol === 'https:' && url.protocol !== 'https:')) {
            throw new Error('Firmware images must use a secure download URL');
          }
          return { ...part, path: url.href };
        }),
      };
    }),
  };
}

export interface FirmwareReleaseOption {
  /** Empty for a local build, which has no GitHub tag. */
  tag: string;
  version: string;
  releasedAt: string | null;
}

/** Recent installable releases, newest first. An unavailable list is not fatal: the newest release still installs. */
export async function loadPublicFirmwareReleases(signal?: AbortSignal): Promise<FirmwareReleaseOption[]> {
  const response = await fetch('/api/firmware/public-releases', { signal, cache: 'no-store' });
  if (!response.ok) return [];
  const body = await response.json() as { releases?: unknown };
  if (!Array.isArray(body.releases)) return [];
  return body.releases.filter((value): value is FirmwareReleaseOption => !!value
    && typeof value.tag === 'string' && typeof value.version === 'string'
    && (value.releasedAt === null || typeof value.releasedAt === 'string'));
}

/** `tag` pins one release; omit it for the newest. */
export async function loadPublicFirmwareManifest(panel: ElecrowPanel, signal?: AbortSignal, tag?: string): Promise<FlashManifest> {
  const query = new URLSearchParams({ panel, ...(tag ? { tag } : {}) });
  const response = await fetch(`/api/firmware/public-manifest?${query}`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('No complete firmware release is available. Retry after the firmware build has been published.');
  const manifest = resolveFirmwareManifest(await response.json(), new URL('/api/firmware/', window.location.href).href);
  if (!manifest.builds.some(build => build.chipFamily === 'ESP32-S3' && build.parts.length === 1 && build.parts[0].offset === 0)) {
    throw new Error('The release does not contain a complete ESP32-S3 factory image.');
  }
  return manifest;
}
