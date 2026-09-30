export type ElecrowPanel = 'original' | 'v12';
export interface FlashManifest {
  name: string;
  version?: string;
  new_install_prompt_erase?: boolean;
  new_install_improv_wait_time?: number;
  builds: Array<{ chipFamily: string; parts: Array<{ path: string; offset: number }> }>;
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

export async function loadPublicFirmwareManifest(panel: ElecrowPanel, signal?: AbortSignal): Promise<FlashManifest> {
  const response = await fetch(`/api/firmware/public-manifest?panel=${panel}`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('No complete firmware release is available. Retry after the firmware build has been published.');
  const manifest = resolveFirmwareManifest(await response.json(), new URL('/api/firmware/', window.location.href).href);
  if (!manifest.builds.some(build => build.chipFamily === 'ESP32-S3' && build.parts.length === 1 && build.parts[0].offset === 0)) {
    throw new Error('The release does not contain a complete ESP32-S3 factory image.');
  }
  return manifest;
}
