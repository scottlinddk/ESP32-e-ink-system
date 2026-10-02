# Unattended display delivery

Apply `backend/src/db/migrations/015_device_delivery.sql` and configure the backend's Supabase **service role** key. The new `device_delivery` table has RLS enabled and denies `anon`/`authenticated` access; tokens and telemetry never become columns on the legacy `devices` table.

When upgrading the complete feature set, apply missing migrations in order: `009_display_profile.sql`, `010_rss.sql`, `011_custom_content.sql`, `012_calendar.sql`, `013_display_schedule.sql`, `014_custom_webhook.sql`, then `015_device_delivery.sql`. Earlier installations must also have their preceding migrations. Automated validation uses isolated fixtures and mocked database services; these changes have not been applied to a live Supabase database or verified on a physical panel.

In **Devices → Automatic updates**, create a token for the registered device. Copy it immediately: only its SHA-256 hash is stored. Creating another token invalidates the previous token; **Revoke token** stops future frame/heartbeat requests. Management endpoints require the owning Clerk account. Frame/heartbeat tokens cannot read preferences or manage other devices.

Tokens are bound to both the device and issuing owner. Reassigning a device invalidates the earlier owner's credential; creating a replacement token clears previous telemetry until the client reports again.

## Bundled ESP32 Wi-Fi firmware

The firmware in `firmware/` implements the BMP device-feed protocol directly for Waveshare 2.13-inch HAT V2, original CrowPanel 2.13-inch SSD1680, and CrowPanel V1.2 JD79661. Install the matching factory image from the web **Flash** page, then enter the HTTPS API origin (optionally ending in `/api`), device UUID and token in its setup hotspot. Select a 250 × 122 display profile with rotation 0. It verifies TLS, frame metadata, SHA-256 and BMP bounds, preserves the panel for 204/304 responses, and reports RSSI and a hash only after the display driver completes the refresh.

This firmware uses NTP for TLS certificate time validation and sleeps until the next bounded retry interval. Invalid credentials reopen the setup portal; holding the CrowPanel menu button during reset or waking with it also opens setup. Battery reporting and automatic OTA are disabled. See the [flashing guide](FIRMWARE_FLASHING.md) for recovery, CA maintenance and hardware verification. Physical/first-boot setup also enables manual Bluetooth image delivery as `EInk-XXXXXX`; automatic error recovery does not.

## Reference bridge

The dependency-free client requires Node.js 20+ and stays running between checks. Run it on a computer or gateway with access to the panel's display driver. It is an alternative to running the bundled device-feed firmware directly on the ESP32.

Example PowerShell configuration (use your API origin, device UUID and actual physical dimensions):

```powershell
$env:DISPLAY_API_URL = 'https://your-host.example/api'
$env:DISPLAY_DEVICE_ID = 'device-uuid-from-the-device-card'
$env:DEVICE_TOKEN = 'paste-the-token-shown-once'
$env:DISPLAY_WIDTH = '250'
$env:DISPLAY_HEIGHT = '122'
$env:DISPLAY_ROTATION = '0'
$env:DISPLAY_OUTPUT_FILE = 'C:\display\frame.bmp'
node tools/display-client.mjs
```

The 250×122 example above is for file-only output. A valid server image does not establish support in a physical panel or external driver. The bundled Bluetooth service supports padded 250-pixel rows; the separate OpenDisplay path still rejects non-byte-aligned rows because installed firmware versions vary. Before attaching a driver, choose dimensions and a panel that it actually supports and verify its width/row-packing limits.

Keep credentials in your service manager's protected environment, not a committed script. A local development server can use `http://127.0.0.1:3001` with `ALLOW_HTTP_LOCALHOST=1`; HTTPS is mandatory for other hosts. `DISPLAY_ONCE=1` performs one check and exits with a failure code on error. The client remembers its ETag/applied hash for the lifetime of its process; restarting fetches and reapplies the current frame.

Without a driver, the client writes the verified image to disk and reports only its heartbeat. It does **not** claim the image reached a physical display. To update a panel, configure `DISPLAY_DRIVER` as an executable and `DISPLAY_DRIVER_ARGS` as a JSON array of arguments containing `{file}`. Optional placeholders are `{width}`, `{height}` and `{rotation}`. The client launches this executable directly (`shell:false`), with a 300-second default deadline. Set `DISPLAY_DRIVER_TIMEOUT_SECONDS` to an integer from 10 to 600 for your driver's upload/refresh budget. Exit status zero must mean that the driver successfully applied the frame; any other exit status leaves the frame unacknowledged and retries it. The API credential is removed from the child environment.

For example, after separately installing the official [OpenDisplay CLI](https://github.com/OpenDisplay/py-opendisplay#cli), checking the device with `opendisplay info`, and verifying that its physical profile matches the server:

```powershell
$env:DISPLAY_DRIVER = 'opendisplay'
$env:DISPLAY_DRIVER_ARGS = '["upload","--device","AA:BB:CC:DD:EE:FF","{file}","--refresh-mode","full"]'
node tools/display-client.mjs
```

Use BMP for this driver. The server has already applied layout rotation; verify that the device's configured rotation and the driver's fitting behavior do not rotate or rescale it again. Encrypted OpenDisplay devices also need their own BLE key configured according to the CLI documentation. A different executable can drive other panels; its supported widths and success/acknowledgement semantics are the adapter author's responsibility. Full refresh is the default and required by this reference protocol. No partial-refresh or power-consumption claim is made.

The example's `upload`, `--device`, image argument and `--refresh-mode full` are confirmed in the [upstream CLI implementation](https://github.com/OpenDisplay/py-opendisplay/blob/main/src/opendisplay/cli.py). The CLI awaits `upload_image`; its [device implementation](https://github.com/OpenDisplay/py-opendisplay/blob/main/src/opendisplay/device.py) waits for the firmware's refresh-complete response and raises on a timeout or unexpected response. Thus a successful exit reports protocol-confirmed completion, not an independent visual check that the panel displayed the right pixels. Validate the installed CLI version and hardware before unattended use.

## Wire protocol

Paths below include the public `/api` prefix. All device requests carry `Authorization: Bearer einkd_…`; credentials are never accepted in query parameters.

| Method/path | Authentication | Result |
|---|---|---|
| GET `/api/devices/:id/delivery` | Owning Clerk account | Configured status and reported telemetry; no token or credential hash |
| POST `/api/devices/:id/delivery/token` | Owning Clerk account | New token, returned once; invalidates old token |
| DELETE `/api/devices/:id/delivery/token` | Owning Clerk account | Revocation |
| GET `/api/device-feed/:id/frame?format=bmp` | Device token | 1-bit top-down BMP |
| GET `/api/device-feed/:id/frame?format=raw` | Device token | Row-major `ceil(width/8)` bytes per row, MSB-first, 1=white |
| POST `/api/device-feed/:id/heartbeat` | Device token | Validated telemetry; `{ "accepted": true }` |

Frame responses provide `ETag` and `X-Image-SHA256` over the exact response bytes, `X-Display-Width`, `X-Display-Height`, `X-Display-Rotation`, `X-Display-Row-Bytes`, `X-Display-Encoding: mono-msb-white1`, `X-Refresh-Mode: full`, and `Retry-After` in seconds. Send `If-None-Match` for a verified cached frame to receive 304 when unchanged. Quiet schedules return 204 without an image, with a retry hint for waking again. The client keeps its prior frame during quiet periods.

The reference client rejects redirects, dimensions/rotation/encoding mismatches, corrupt hashes, malformed BMP/raw lengths and bodies over 512 KiB. Each HTTP operation has a 20-second deadline. Successful polls follow bounded 1–86,400 second retry hints, subtracting download, driver and heartbeat time before sleeping. Failures use exponential backoff starting at 15 seconds and reaching one hour, extended by server retry hints up to one day. Authentication failure stops the client so the token can be replaced. Image replacement uses an exclusive temporary file followed by an atomic rename.

When Upstash rate limiting is configured, authenticated devices each receive a 120-request/minute frame+heartbeat budget; they do not share the dashboard's per-IP allowance. Invalid credentials have a separate 30-request/minute per-IP budget.

Heartbeat example:

```json
{
  "firmware_version": "panel/1.0",
  "battery_percent": 78,
  "rssi": -65,
  "last_applied_hash": "64-lowercase-hex-characters"
}
```

`firmware_version` is required (1–64 safe version characters). Optional battery is 0–100 percent; RSSI is an integer from -150 to 0 dBm. Unknown fields are rejected. The example hash is a placeholder.

`last_applied_hash` has three meanings:

- A lowercase SHA-256 hex digest reports the image that the driver confirmed was applied.
- Explicit `null` reports an unknown current panel image and clears any previously stored applied hash. Send this after a failed or interrupted refresh that invalidates an earlier confirmation.
- Omitting the field leaves the stored applied hash unchanged, for compatibility with existing clients. Omission does not clear an earlier confirmation; a client without any confirmed image can send `null` explicitly.

For example, `{ "firmware_version": "1.1.0", "last_applied_hash": null }` records a heartbeat without claiming that the previous image is still applied. A later confirmed refresh can report a new digest. Deploy this nullable-hash API contract before updating clients to send explicit `null`.

Reports describe what the client said, not independently verified physical state. A frame download does not update `lastSeenAt` or acknowledge an image. The reference bridge reports its own `display-bridge/1.0` version and cannot measure panel battery/RSSI.

## Verification

`npm test` includes API token lifecycle/ownership, telemetry validation, frame metadata/304, reference-client/API integration, simulated full-driver success/failure, quiet responses, redirects, corrupted files and backoff. Browser BLE delivery separately verifies bounded operations and firmware ACK/NACK responses (see [Bluetooth delivery](BLUETOOTH_DELIVERY.md)). Hardware refresh, radio range, battery drain, gateway service setup and each selected driver still require device testing.
