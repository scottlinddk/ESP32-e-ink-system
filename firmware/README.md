# Firmware: Elecrow CrowPanel, Waveshare 2.13-inch and Waveshare RLCD 4.2-inch

Use the web app's **Flash** page to install this firmware over USB. It downloads a complete factory image and chooses the ESP32 chip family automatically. **Choose the display revision yourself:** original CrowPanel uses SSD1680; CrowPanel V1.2 uses JD79661. Both are ESP32-S3 devices, so USB detection cannot identify the panel controller.

See the [browser installation and recovery guide](../docs/FIRMWARE_FLASHING.md).

| Hardware | PlatformIO environment | Browser image |
|---|---|---|
| Waveshare 2.13-inch HAT V2 on ESP32-WROOM-32 | `esp32dev` | `waveshare-esp32-213-v2_fw-<version>_factory.bin` |
| Original Elecrow CrowPanel 2.13-inch, SSD1680 | `elecrow_213` | `elecrow-crowpanel-213_fw-<version>_factory.bin` |
| Elecrow CrowPanel 2.13-inch V1.2, JD79661 | `elecrow_213_v12` | `elecrow-crowpanel-213-v12_fw-<version>_factory.bin` |
| Waveshare ESP32-S3-RLCD-4.2, ST7305 400 × 300 | `waveshare_rlcd_42` | `waveshare-esp32-s3-rlcd-42_fw-<version>_factory.bin` |

The bundled Elecrow driver is in `lib/EPD`; no vendor library download is required. This firmware pulls the current monochrome BMP from the app's device feed over Wi-Fi. It also accepts manual Bluetooth pushes as `EInk-XXXXXX` during first-boot setup or when holding MENU while resetting (Waveshare: press BOOT within 3 seconds after releasing reset). It also stays on whenever the device is awake between polls (Instant updates on USB power); deep sleep turns it off. Keep the browser online and use a 250 × 122 profile; see [Bluetooth delivery](../docs/BLUETOOTH_DELIVERY.md).

Each environment selects one board profile in `src/board_profile.h`: release slug, native panel size and setup button. The frame buffer, device-feed header checks and Bluetooth receiver all derive their sizes from it. The server sends frames in native orientation, so every content rotation (0°, 90°, 180°, 270°) is accepted. The profile ID must match the slug in `scripts/package_web_firmware.py`; the packaging tests enforce this.

`esp32dev` uses `huge_app.csv` (3 MiB app, no OTA) to fit Wi-Fi and the built-in BLE stack. Upgrade older units with the complete USB/factory image so the new partition table is installed. A standalone application binary does not update the partition table.

## First boot

1. Register a device in the web app and create its **Automatic updates** device token. Keep the device UUID and `einkd_...` token available.
2. Install the matching factory image. After installation, press RESET if the device does not restart.
3. Join `ESP32-Display-XXXXXX` and stay connected despite the no-internet warning. Open `http://192.168.4.1` if the setup page does not appear.
4. Enter your 2.4 GHz Wi-Fi, the HTTPS backend base URL, device UUID, and device token. Use **Show Wi-Fi password** to check your entry. Save and return to your normal Wi-Fi.
5. Saving only confirms the settings were stored. Check **Devices → Automatic updates → Last report** to confirm the device reaches the server. If it does not, open the USB installer's **Logs & Console** at 115200 baud and reset the display. If setup Wi-Fi returns, reconnect to read the connection error and correct the settings.

The token is entered during setup and stored on the device; release binaries contain no Wi-Fi or account credentials. See [device delivery](../docs/DEVICE_DELIVERY.md) for the feed and token lifecycle.

Reinstalling a complete factory image replaces the saved settings, even if the installer's erase option is off. Keep your device UUID and token available and repeat setup after flashing.

## Build and debug

Python 3.12 and PlatformIO 6.1.18 are used in CI. The platform and library versions are pinned in `platformio.ini`.

```sh
python -m pip install platformio==6.1.18
cd firmware
pio run -e elecrow_213
pio run -e elecrow_213 --target upload
pio device monitor -e elecrow_213 --baud 115200
```

For V1.2, substitute `elecrow_213_v12`; for Waveshare, `esp32dev`. PlatformIO discovers the port, or supply `--upload-port COM4` / monitor `--port COM4` on Windows. Only one program can open the port at a time. Native PowerShell can run these commands; Bash/npm flashing shortcuts are optional.

A stock build reads `config.h.example`. To change local defaults, copy it to `firmware/config.h`, which is ignored by Git. `src/config.h` resolves the local override or the example consistently. Runtime Wi-Fi and device credentials belong in the setup portal.

The CrowPanel has 8 MB QSPI flash and 8 MB OPI PSRAM. Its USB-C socket is connected through a CH340 UART bridge; serial logs must use UART0 (`ARDUINO_USB_CDC_ON_BOOT=0`). GPIO7 powers the display and must be high while updating. GPIO2 is the menu/setup button.

The pinned ESP-IDF 4.4.7 needs an explicit `WPA3_SAE_PWE_BOTH` station setting to connect to WPA3 access points requiring H2E. The Wi-Fi manager applies [Espressif advisory AR2026-003, issue 4.1](https://documentation.espressif.com/AR2026-003_OTA_Bug_Advisory_for_WPA3-SAE_H2E_Configuration_Issues_in_ESP-IDF_EN.html) before connecting, preserving the configured authentication threshold and PMF policy. An `AUTH_FAIL` log still requires checking the network password and access point settings; it does not establish a single cause.

| Signal | CrowPanel GPIO | Waveshare / ESP32 GPIO |
|---|---:|---:|
| CS | 14 | 5 |
| DC | 13 | 17 |
| RESET | 10 | 16 |
| BUSY | 9 | 4 |
| MOSI | 11 | 23 |
| SCK | 12 | 18 |
| Display power enable | 7 | — |

The SSD1680 and JD79661 controllers require different commands and BUSY polarity. A build that uploads successfully but does not refresh the display may target the wrong revision. Do not infer the panel controller only from the ESP32-S3 chip name.

Both drivers require a BUSY assertion/release cycle before acknowledging a frame.
The log and reported hash describe controller progress; verify the actual image
on the panel. See the [pinned Elecrow reference and verification notes](../docs/ELECROW_DRIVER_REFERENCE.md)
for the original SSD1680 sequence, failure diagnostics, host-test coverage, and
the API-first deployment requirement for explicit unknown/failed frame reports.

## Waveshare ESP32-S3-RLCD-4.2

The [ESP32-S3-RLCD-4.2](https://docs.waveshare.com/ESP32-S3-RLCD-4.2) is an ESP32-S3-WROOM-1-N16R8 (16 MB flash, 8 MB OPI PSRAM) with a 4.2-inch 400 × 300 monochrome reflective LCD on a Sitronix ST7305. Set the device's dashboard display profile to **400 × 300**; any content rotation works.

```sh
pio run -e waveshare_rlcd_42 --target upload
pio device monitor -e waveshare_rlcd_42 --baud 115200
```

The board's USB-C is the ESP32-S3's native USB (Hardware CDC/JTAG), so serial logs use USB CDC (`ARDUINO_USB_CDC_ON_BOOT=1`). If upload cannot find the port, hold BOOT while pressing RESET to enter the ROM downloader. The CDC port disappears while the device is in deep sleep; reset it to read logs.

| Signal | GPIO |
|---|---:|
| SCK | 11 |
| MOSI | 12 |
| CS | 40 |
| DC | 5 |
| RESET | 41 |
| KEY (setup button, active low) | 18 |
| Battery ADC (1:3 divider) | 4 |

Hold **KEY** while resetting, or press it while the device sleeps, to open setup and the `EInk-XXXXXX` Bluetooth receiver. BOOT (GPIO0) is a strap pin and is not used.

The controller init sequence and pixel layout come from Waveshare's own examples ([waveshareteam/ESP32-S3-RLCD-4.2](https://github.com/waveshareteam/ESP32-S3-RLCD-4.2), `08_LVGL_V8_Test/display_bsp.cpp`). Each controller byte holds a 2 × 4 pixel block; `src/st7305_frame.h` does the mapping and `tests/st7305_frame_test.cpp` checks every pixel against Waveshare's formula.

Unlike e-paper, a reflective LCD is not bistable: the ST7305 keeps scanning its RAM while powered. Between polls the firmware switches the panel to its low-power scan mode (`0x39`, set `RLCD_LOW_POWER_IDLE 0` in `config.h` to keep high-power mode) and latches RESET and CS high with GPIO hold, so the image stays visible through ESP32 deep sleep. A timer or KEY wake resumes the controller without a reset; only a power-on or RESET button reinitializes and clears it. An image update is written in about 12 ms with no refresh flash.

Bluetooth pushes work at 400 × 300, but the 15,000-byte frame travels in 18-byte packets, so a manual push takes noticeably longer than on the 2.13-inch boards. The Flash page does not list this board yet: install it with PlatformIO, or with ESP Web Tools using `manifest-waveshare-rlcd-42.json` from a release.

Not yet verified on hardware: the visible image after deep sleep, low-power mode appearance, battery reading accuracy, and current draw. The board's audio codec, microphones, SHTC3 sensor, PCF85063 RTC and TF card are not used.

## Browser release packaging

```sh
python firmware/scripts/prepare_config.py --version 1.2.0
pio run --project-dir firmware -e esp32dev -e elecrow_213 -e elecrow_213_v12 -e waveshare_rlcd_42
python firmware/scripts/package_web_firmware.py --version 1.2.0 --output-dir build/firmware-release
python -m unittest discover -s firmware/scripts -p 'test_*.py' -v
```

`PRODUCTION_API_URL` or `prepare_config.py --api-url` optionally overrides the setup page's default backend URL. An empty secret preserves the example default. The package script uses PlatformIO's esptool to patch flash headers and merge bootloader, partition table, boot_app0, and app. It validates chip family, app partition capacity, flash capacity, merged offsets, and flash header, and writes SHA256SUMS. The original app files are retained for diagnostics and future OTA tooling; this firmware does not implement automatic OTA updates.

`manifest.json` contains Waveshare and original CrowPanel. `manifest-elecrow-v12.json` contains only CrowPanel V1.2. Factory images are written at **0x0**; app-only binaries must never be substituted in a factory manifest.

For a local web-flash test before publishing, set the backend environment variable `FIRMWARE_RELEASE_DIR` to the absolute path of `build/firmware-release` and restart the backend. The backend verifies factory-image checksums and serves those assets with hash-pinned URLs. Unset this variable to return to published GitHub releases. Use the local frontend's `/flash` page on localhost; a page accessed through an ordinary LAN HTTP address cannot use Web Serial.

The firmware workflow builds and validates all four environments on firmware pull requests. Manual runs upload an artifact without publishing. Merging firmware changes to `main` publishes a development release, and `v*.*.*` tags publish versioned releases. The web app and backend must be deployed with the matching factory-image resolver before installation is available.

## Evidence and hardware verification

The controller protocols, pin map, power enable, UART connection, flash size and PSRAM configuration are based on [Elecrow's official source and schematics](https://github.com/Elecrow-RD/CrowPanel-ESP32-2.13-E-paper-HMI-Display-with-122-250). Factory packaging follows [ESP Web Tools](https://esphome.github.io/esp-web-tools/) and [Espressif's merge-bin documentation](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/esptool/basic-commands.html#merge-binaries-for-flashing-merge-bin).

Compilation and software tests cannot confirm USB upload, physical panel refresh, or battery operation. Finish verification on the actual board using the checklist in the flashing guide.
