# Potential Issues with Web and In-App Firmware Flashing

This document summarizes several potential issues observed when attempting to flash ESP32 devices directly from the browser (using the web installer) or from within the dashboard app.

These were identified by reviewing the flashing-related code paths, manifest generation, CI release process, and static assets.

## Overview

The browser-based flashing relies on `esp-web-tools` (`<esp-web-install-button manifest=...>`). Two primary entry points exist:

- Public: `FlashPage` (straight from web / unauthenticated)
- Authenticated: `FirmwarePage` (from the app, for the default firmware and any user-managed firmware versions)

Manifests control which binaries (bootloader + partitions + app) and which chip families are offered.

## Key Observations

### 1. User-managed firmware versions always produce incomplete manifests (in-app flow)

**Primary file:** `backend/src/routes/firmware.ts`

The handler for `GET /:id/manifest` (used by `getFirmwareManifest` when selecting a version in the Firmware page):

```ts
// backend/src/routes/firmware.ts
res.json({
  name: `ESP32 Display v${fw.version}`,
  builds: [{ 
    chipFamily: 'ESP32', 
    parts: [{ path: fw.download_path, offset: 65536 }] 
  }],
});
```

- Hardcoded `chipFamily: 'ESP32'`.
- Contains **only the app binary** at offset 65536.
- Bootloader and partitions are never included.
- The `/default/manifest` non-GitHub fallback has the same shape.

**Impact:** 
- ESP32-S3 devices (Elecrow CrowPanel) cannot be flashed this way.
- Flashing a clean device (or after full erase) often fails or results in a non-booting board.

See also: `frontend/src/pages/FirmwarePage.tsx` (the select + `esp-web-install-button` block) and `frontend/src/lib/api.ts:getFirmwareManifest`.

### 2. Stale and incomplete static fallback manifest

**File:** `frontend/public/firmware/manifest.json`

```json
{
  "name": "ESP32 E-Ink Display",
  "new_install_prompt_erase": true,
  "builds": [
    {
      "chipFamily": "ESP32",
      "parts": [
        { "path": "https://github.com/scottlinddk/ESP32-e-ink-system/releases/download/dev-20260604-28438a7/...", "offset": 4096 },
        ...
      ]
    }
    // No ESP32-S3 entry
  ]
}
```

This file is served from the frontend static assets and used as fallback in `FlashPage.tsx` (see the `useEffect` that fetches `/api/firmware/public-manifest` and falls back to `/firmware/manifest.json`).

It is pinned to an old dev tag and only covers the classic ESP32.

### 3. Dynamic "correct" manifests are inconsistently applied

**Key files:**
- `backend/src/services/githubRelease.ts` — `buildManifestFromRelease` and `fetchLatestFirmwareRelease`
- `backend/src/routes/firmware.ts` — `/public-manifest` and `/default/manifest` (GH path)
- `backend/src/app.ts` — special `/firmware/manifest.json` handler + `/firmware/default.bin` proxy
- `.github/workflows/firmware-release.yml`

The workflow builds both environments, extracts `bootloader*`, `partitions*`, and `firmware*` for each, and generates a manifest with correct offsets:

- ESP32: bootloader@4096, partitions@32768, firmware@65536
- ESP32-S3: bootloader@0, partitions@32768, firmware-elecrow@65536

It also uploads a `manifest.json` asset to releases.

However, the in-app path for non-default versions and several fallback paths synthesize their own limited manifests instead of using (or emulating) this structure.

`fetchLatestFirmwareRelease` depends on the GitHub REST API. Without a `GITHUB_TOKEN` the call is subject to rate limits.

### 4. `new_install_prompt_erase` flag is missing from generated manifests

Only the old static file includes `"new_install_prompt_erase": true`.

### 5. No support for targeting different boards with custom firmwares

The creation form in `FirmwarePage.tsx` and the manifest builders have no notion of chip family or "full image vs app-only update".

## Potential Approaches (Suggestions Only)

These are ideas for consideration. No implementation is included in this PR.

**Make manifests for custom versions more complete**

Extend handling so that when full images are available, the manifest includes all parts for both families:

```ts
// Illustration only
const builds = [
  {
    chipFamily: 'ESP32',
    parts: [
      { path: blUrl, offset: 4096 },
      { path: partUrl, offset: 32768 },
      { path: fw.download_path, offset: 65536 }
    ]
  },
  {
    chipFamily: 'ESP32-S3',
    parts: [
      { path: blS3Url, offset: 0 },
      { path: partS3Url, offset: 32768 },
      { path: fwS3DownloadPath || fw.download_path, offset: 65536 }
    ]
  }
];
```

For simple app-only cases, keep the current minimal form but document the limitation clearly (existing bootloader + partitions required on device).

**Improve the static fallback**

Options:
- Remove reliance on the committed `frontend/public/firmware/manifest.json` (always prefer dynamic endpoints).
- Wire the frontend `/firmware/manifest.json` to the backend dynamic handler.
- Have a post-release step (or manual update) keep a "latest" static manifest in sync.

**Add the erase prompt flag to dynamic manifests**

```ts
// In githubRelease.ts buildManifestFromRelease
return {
  name: `ESP32 Display v${release.version}`,
  new_install_prompt_erase: true,
  builds
};
```

**Reduce direct GitHub asset exposure during flashing**

Leverage (or expand) the proxy logic already present in `backend/src/app.ts` (`/firmware/default.bin`) so that manifests can point at same-origin URLs where possible.

**Other considerations**

- Add an optional "board" or "chip" field when creating firmware versions.
- Make error paths in FlashPage and FirmwarePage more visible when a manifest is incomplete (e.g. surface a note "This version only provides an app binary...").
- Ensure `GITHUB_TOKEN` is configured in the backend environment for reliable release lookups.

## CI / Release Artifacts (Appear Functional)

The release workflow produces the expected assets for both boards on pushes to `main` (as dev- tags) and on version tags. The generated release `manifest.json` contains entries for both chip families with full part lists.

## Reproduction Notes

- Authenticated flow: Firmware page → pick version (including default) → observe generated manifest at `/api/firmware/.../manifest`.
- Public flow: Visit flash page. If the public-manifest endpoint 503s or errors, the stale static file is used.
- Compare against a release asset manifest (e.g. `https://github.com/scottlinddk/ESP32-e-ink-system/releases/download/<tag>/manifest.json`).

## Related Code Pointers

- `frontend/src/pages/FlashPage.tsx`
- `frontend/src/pages/FirmwarePage.tsx`
- `frontend/src/lib/api.ts`
- `backend/src/routes/firmware.ts`
- `backend/src/services/githubRelease.ts`
- `backend/src/app.ts`
- `frontend/public/firmware/manifest.json`
- `firmware/platformio.ini` (build environments and partition choice)
- `.github/workflows/firmware-release.yml`

This document is provided as a findings summary only.
