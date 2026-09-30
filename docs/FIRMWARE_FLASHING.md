# Firmware flashing and recovery

## Install from the web interface

1. Use desktop Chrome or Edge. Open the app's **Flash** page over HTTPS (or localhost for development).
2. Select your board. **CrowPanel original / SSD1680** and **CrowPanel V1.2 / JD79661** use different drivers despite both containing ESP32-S3 chips. Check the board's revision label and Elecrow purchase documentation. If unclear, check the vendor's source for that revision before installing.
3. Connect the display directly using a USB data cable. Close Arduino Serial Monitor, PlatformIO monitor, and other browser tabs using the serial port.
4. Click **Install firmware**, select the board's USB serial port, and follow the installer. An empty board needs the complete factory image. Erasing also removes saved device configuration, so keep the device token available.
5. Wait for installation to finish. Press RESET if the board remains in download mode.
6. Join `ESP32-Display-XXXXXX`, then open `http://192.168.4.1` if the captive portal does not appear. Keep connected even if the computer reports no internet access.
7. Enter the 2.4 GHz Wi-Fi credentials, HTTPS backend base URL, registered device UUID, and the `einkd_...` token created in the dashboard under **Devices → Automatic updates**. Save, then return to normal Wi-Fi.
8. Confirm that the panel shows your saved layout and the dashboard receives a device acknowledgement. Review 115200-baud serial logs if either fails.

A successful USB transfer only verifies that flash memory was written. A working setup also needs the correct panel driver, network, TLS time synchronization, device token, and server-rendered 250 × 122 monochrome BMP.

The bundled firmware uses Wi-Fi polling. The dashboard's Bluetooth push feature requires OpenDisplay firmware and does not configure this firmware.

## If the USB installer cannot connect

For a CrowPanel, hold **BOOT**, press and release **RESET**, release BOOT, and retry the installer. After installation, press RESET without holding BOOT. This uses the ESP32 ROM downloader; the old application does not need to work.

| Symptom | Check |
|---|---|
| No serial port listed | Try a known data cable and another USB socket; inspect Device Manager/System Information. |
| Unknown USB UART device | Install the driver matching the bridge reported by the OS. CrowPanel uses WCH CH340; Waveshare ESP32 boards vary. |
| Port busy or access denied | Close serial monitors and other installer tabs. On Linux, verify serial device permissions. |
| Connection timeout | Enter BOOT/RESET download mode; disconnect unneeded USB hubs. |
| Wrong chip family | Select the intended board; do not flash classic ESP32 files on ESP32-S3. |
| Firmware unavailable | The backend needs a complete published factory-image release. Old app-only releases are deliberately unavailable for browser installation. |
| Upload succeeds but screen does not refresh | Confirm original SSD1680 versus V1.2 JD79661, GPIO7 display power, and serial BUSY-timeout errors. |
| Serial monitor is silent | Press RESET and use 115200 baud; CrowPanel uses the external UART bridge, with USB CDC On Boot disabled. |
| No setup hotspot | Check serial output; previously saved settings may already be in use. Use the firmware's setup reset button or reinstall with erase. |
| Wi-Fi cannot connect | Use 2.4 GHz Wi-Fi and re-enter the password. |
| TLS/time error | Permit NTP (UDP 123); verify the API hostname and certificate chain. |
| HTTP 401/403/404 | Verify backend URL, device UUID, and device token, and ensure the device still exists. |

Get USB drivers from the manufacturers: [WCH](https://www.wch-ic.com/downloads/CH341SER_EXE.html) or [Silicon Labs](https://www.silabs.com/developer-tools/usb-to-uart-bridge-vcp-drivers). Install a driver only if the OS does not already expose a working serial port.

## Build locally as a diagnostic alternative

No external Elecrow library download is required; the driver is included in `firmware/lib/EPD`.

```sh
python -m pip install platformio==6.1.18
cd firmware
pio device list
pio run -e elecrow_213 --target upload
pio device monitor -e elecrow_213 --baud 115200
```

Use `elecrow_213_v12` for V1.2 or `esp32dev` for Waveshare. With multiple ports, append `--upload-port COM4` to upload or `--port COM4` to monitor. On macOS/Linux substitute the actual `/dev/cu.*`, `/dev/ttyUSB*`, or `/dev/ttyACM*` path. If communication is unreliable, add `--upload-port` and lower `upload_speed` to 115200 locally.

PlatformIO pins the supported Arduino core and dependencies. It handles build settings and port detection on Windows, macOS, and Linux. The [firmware README](../firmware/README.md) documents optional configuration and release packaging. Arduino IDE is an expert alternative; see the [Arduino notes](ARDUINO_IDE_ELECROW_SETUP.md).

## Factory images and releases

The browser manifest must contain a complete merged image at offset **0**. The merge includes bootloader (0 for S3, 0x1000 for ESP32), partitions (0x8000), boot_app0 (0xe000), and application (0x10000). The packaging tool patches bootloader mode/frequency/size with esptool, validates the result, and calculates SHA-256 hashes.

| Board | Factory image | Manifest |
|---|---|---|
| Waveshare / ESP32 | `firmware-factory.bin` | `manifest.json` |
| Original CrowPanel / SSD1680 | `firmware-elecrow-factory.bin` | `manifest.json` |
| CrowPanel V1.2 / JD79661 | `firmware-elecrow-v12-factory.bin` | `manifest-elecrow-v12.json` |

The app-only files named `firmware.bin`, `firmware-elecrow.bin`, and `firmware-elecrow-v12.bin` do not install a blank board. Do not write these files at 0 or place them in a factory manifest. Automatic OTA is not implemented by this device-feed firmware.

Production requires both the updated web/backend deployment and a published release containing these images. The release workflow first compiles and validates all boards. Pull requests and manual runs provide downloadable artifacts; a firmware merge to `main` or a version tag publishes the release. A selected release stays fixed throughout a browser download, even if a newer release is published.

For local validation before publishing, package the builds and set backend `FIRMWARE_RELEASE_DIR` to the absolute output directory. Restart the backend, start the frontend, and open `/flash` on localhost. The backend checks SHA256SUMS and serves hash-pinned assets. Remove this setting to use published releases again.

## TLS certificate maintenance

The device verifies HTTPS and synchronizes its clock through NTP before connecting. The compiled CA bundle in `firmware/src/tls_roots.h` contains Let's Encrypt ISRG Root X1/X2 and Google Trust Services R1–R4, covering the intended hosted endpoints. A backend using a different trust root requires adding that root and rebuilding; do not disable certificate verification.

Authoritative certificate downloads: [ISRG Root X1](https://letsencrypt.org/certs/isrgrootx1.pem), [ISRG Root X2](https://letsencrypt.org/certs/isrg-root-x2.pem), [GTS R1](https://pki.goog/repo/certs/gtsr1.pem), [GTS R2](https://pki.goog/repo/certs/gtsr2.pem), [GTS R3](https://pki.goog/repo/certs/gtsr3.pem), [GTS R4](https://pki.goog/repo/certs/gtsr4.pem). Review expiry and chain changes when maintaining firmware releases.

## Verify on the actual unit

Record the board/panel revision, release version, and serial log. Verify that browser installation completes, RESET starts the application, the setup hotspot appears, Wi-Fi and TLS connect, the device token authenticates, the 250 × 122 BMP displays with correct orientation, and a later update changes the screen. Confirm the saved configuration survives reset and the setup button can recover it. Sleep current and battery behavior require measurement on hardware; software tests do not establish battery-life estimates.

## Sources

- [Elecrow source, examples, and schematic](https://github.com/Elecrow-RD/CrowPanel-ESP32-2.13-E-paper-HMI-Display-with-122-250)
- [ESP Web Tools firmware preparation, manifests, HTTPS and CORS](https://esphome.github.io/esp-web-tools/)
- [Espressif esptool image merging](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/esptool/basic-commands.html#merge-binaries-for-flashing-merge-bin)
- [Espressif Arduino USB CDC documentation](https://docs.espressif.com/projects/arduino-esp32/en/latest/tutorials/cdc_dfu_flash.html)
