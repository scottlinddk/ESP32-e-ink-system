# Kindle Paperwhite and other KOReader e-readers

A Kindle is not flashed like an ESP32 board. It keeps its own firmware; you jailbreak it,
install [KOReader](https://github.com/koreader/koreader), and add the plugin in
[`koreader/einkdisplay.koplugin`](../koreader/einkdisplay.koplugin). The plugin then shows the
layout of a registered device full screen and keeps it up to date over Wi-Fi. The same plugin
runs on Kobo and other KOReader devices.

The approach follows [TRMNL's KOReader plugin](https://github.com/usetrmnl/trmnl-koreader). The
plugin itself is written for this project: it speaks the [device-feed protocol](DEVICE_DELIVERY.md#wire-protocol)
the ESP32 firmware uses, with a device token, an image integrity check and a heartbeat.

> **Status: not yet run on a physical e-reader.** The protocol handling, the pixel unpacking and a
> whole update cycle are tested under LuaJIT against stand-ins for KOReader
> (`luajit koreader/spec/run.lua`). Drawing on a real screen, Wi-Fi handling, sleep prevention and
> battery life still need a first run on a device. Start with **Update now** and read
> `koreader/crash.log` if something fails.

## What you need

- A Kindle Paperwhite that can be jailbroken. Whether it can depends on its firmware version, and
  Amazon patches jailbreaks with updates. Use the [KindleModding jailbreak wizard](https://kindlemodding.org/jailbreaking/)
  to find the method for your model and firmware, and read its notes about blocking updates first.
  A Kindle on a firmware without a jailbreak cannot be used until one is released.
- KOReader, installed after the jailbreak. Follow KindleModding's steps after jailbreaking or
  KOReader's [Kindle installation guide](https://github.com/koreader/koreader/wiki/Installation-on-Kindle-devices).
- An account in the web app with a registered device and a device token (below).
- The server reachable over HTTPS from the Kindle's Wi-Fi.

A jailbreak is at your own risk and outside this project. It does not remove the Kindle's normal
functions.

## Prepare the device in the web app

1. On **Devices**, add a device for the Kindle.
2. Open its **Automatic updates** and create a token. Copy the API address, the device UUID and the
   token now: the token is shown once.
3. Open the device on the **Dashboard** and set **Display size and orientation** to the Kindle's
   screen, so the preview and the layout editor match what the Kindle shows:

   | Model | Screen (portrait) |
   |---|---|
   | Paperwhite 1 and 2 (5th, 6th generation) | 758 × 1024 |
   | Paperwhite 3 and 4 (7th, 10th generation) | 1072 × 1448 |
   | Paperwhite 5 (11th generation, 2021) | 1236 × 1648 |
   | Paperwhite 6 (12th generation, 2024) | 1264 × 1680 |

   For a landscape dashboard keep these native dimensions and set **Content rotation** to 90° or 270°.
4. Arrange and save a layout for the device.

The plugin also tells the server its real screen size with every request, so the image fits even
when the saved size is wrong. Text and graphics are enlarged automatically on these screens (3× on
a Paperwhite 1 or 2, otherwise 4×); choose a text size per layout or widget under
[Zoom](WIDGET_OPTIONS.md#zoom).

## Install the plugin

1. Download this repository (**Code → Download ZIP**) and unzip it.
2. Open `koreader/einkdisplay.koplugin/config.txt` in a text editor and fill in the three values:

   ```
   api_url = https://your-host.example/api
   device_id = 3f2b8c1e-9d4a-4b6f-8e21-0a1b2c3d4e5f
   token = einkd_...
   ```

3. Connect the Kindle over USB and copy the whole `einkdisplay.koplugin` folder to
   `koreader/plugins/` on the Kindle.
4. Eject the Kindle and start (or restart) KOReader.
5. Open **Tools → E-Ink Display → Update now**. The layout appears full screen.

The values can also be typed on the Kindle under **Tools → E-Ink Display → Settings**. Typing a
token on an e-reader is slow, which is why `config.txt` exists. The file is read each time KOReader
starts, and its empty lines change nothing. It holds a secret once filled in: do not share it, and
create a new token under **Devices** if it leaks.

## Run it as a dashboard

1. In KOReader, set **Settings → Network → Action when Wi-Fi is off** to **turn on**, so updates
   do not stop at a question.
2. Choose **Tools → E-Ink Display → Start dashboard**.

The plugin fetches the layout, then checks again when the server says so (`Retry-After`, from the
device's schedule). During [quiet hours](DISPLAY_SCHEDULES.md) the last image stays. While the
dashboard runs:

- **Tap** the screen to update now. **Hold** to close the dashboard.
- The device is kept awake (on a Kindle with `preventScreenSaver`, as KOReader's Keep alive
  plugin does). Stopping the dashboard hands sleep control back. Turn this off with
  **Keep the device awake while the dashboard runs** if you manage sleep yourself.
- The dashboard starts again by itself after KOReader restarts.
- **Update device screen** in the web app is shown at the Kindle's next check and then marked as
  applied. [Instant updates](DEVICE_DELIVERY.md#instant-updates) are not supported: the plugin does
  not stay online between checks.

**Devices → Automatic updates** shows the Kindle's last report with battery level, Wi-Fi signal and
`koreader-plugin/1.0.0` as the firmware version.

## Make the battery last

An awake Kindle with Wi-Fi on lasts days, not weeks. These help:

- **Settings → Frontlight**: set to zero.
- **Settings → Network**: untick **Wi-Fi connection**, and set **Action when done with Wi-Fi** to
  **turn off**. The plugin asks KOReader for Wi-Fi before each check and releases it afterwards.
- Use a longer refresh interval for the device in the web app.
- Keep it on a charger if it is a permanent wall display.

## Settings

| Setting | What it does |
|---|---|
| **Settings** | API address, device ID and device token |
| **Keep the device awake while the dashboard runs** | On by default |
| **Verify the server certificate** | On by default. KOReader checks the certificate against its own CA bundle when it has one |
| **E-ink refresh type** | **Full** (default, cleanest), **UI** (no flash) or **Partial** (fastest, may ghost) |

Two actions are available for gestures and keys under **Settings → Taps and gestures → Gesture
manager**: **E-Ink Display: update now** and **E-Ink Display: start dashboard**.

## Troubleshooting

Messages are also written to `koreader/crash.log`, with the prefix `EinkDisplay:`.

| Message | What to do |
|---|---|
| The server rejected the device token | Create a new token under **Devices → Automatic updates** and enter it. Creating a token invalidates the previous one. The dashboard stops until then |
| Could not reach the server: certificate verify failed | The Kindle's clock or CA bundle is out of date. Check the date first. As a last resort turn off **Verify the server certificate**; the token is then sent without checking who receives it |
| Could not reach the server (other reasons) | Check Wi-Fi and the API address. Only `https://` addresses are accepted |
| The server does not know this address | The API address is wrong. It normally ends in `/api` (added when missing) |
| The image failed its integrity check, or is incomplete | The download was damaged. The plugin retries after a minute and keeps the previous image |
| The picture is small or has white borders | The server drew for another size: the Kindle's size is above the limits in [display profiles](DISPLAY_PROFILES.md), so the saved size was used |
| The device still falls asleep | Use **Start dashboard**, not only **Update now**, and keep the keep-awake setting on |

## How it works

| Step | Request |
|---|---|
| Fetch | `GET /api/device-feed/:id/frame?format=raw` with `Authorization: Bearer einkd_…`, `X-Device-Width`, `X-Device-Height` and `If-None-Match` while the image is still on screen |
| Check | Size headers, `X-Display-Encoding: mono-msb-white1`, body length and `X-Image-SHA256` |
| Draw | One bit per pixel is unpacked to an 8-bit buffer and shown with a full refresh |
| Report | `POST /api/device-feed/:id/heartbeat` with battery, signal, `last_applied_hash` and, for a manual request, `refresh_request_id` |

Failures back off from one minute to one hour. Redirects are refused, so the token is never sent
to another address. The image is monochrome; the Kindle's grey levels are not used.

## Develop and test

```sh
luajit koreader/spec/run.lua    # or: npm run test:koreader
```

| File | Purpose |
|---|---|
| `einkdisplay.koplugin/main.lua` | KOReader menu, settings, Wi-Fi, drawing and scheduling |
| `einkdisplay.koplugin/einkdisplay_feed.lua` | Protocol rules: requests, response checks, retry timing. No KOReader dependency |
| `einkdisplay.koplugin/einkdisplay_bitmap.lua` | Unpacks the 1-bit frame |
| `spec/run.lua`, `spec/stubs.lua` | Tests and the stand-ins for KOReader modules |

The tests need LuaJIT and `sha256sum`. They run in the application-check workflow.
