# Arduino IDE notes for CrowPanel

The supported installation path is the app's **Flash** page. For a reproducible source build, use the pinned PlatformIO environments in the [firmware README](../firmware/README.md). The legacy Arduino helper now prints the supported build commands and these notes; it does not change IDE libraries or settings.

Arduino IDE users must reproduce these settings and dependencies themselves:

| Setting | Original CrowPanel | CrowPanel V1.2 |
|---|---|---|
| Board | ESP32S3 Dev Module | ESP32S3 Dev Module |
| Arduino ESP32 core | 2.0.17, matching PlatformIO | 2.0.17, matching PlatformIO |
| Flash | 8 MB, QIO, 80 MHz | 8 MB, QIO, 80 MHz |
| PSRAM | OPI PSRAM | OPI PSRAM |
| USB CDC On Boot | Disabled (external CH340 UART) | Disabled (external CH340 UART) |
| Upload | UART0 / Hardware CDC | UART0 / Hardware CDC |
| Build define | `ELECROW_EPAPER_213` | `ELECROW_EPAPER_213` and `ELECROW_PANEL_JD79661` |
| Driver | SSD1680 | JD79661 |

Use the partition table selected by `firmware/platformio.ini`. Match its flash capacity and application offsets; do not assume the IDE's default partition selection matches. This firmware does not currently use OTA.

The bundled `firmware/lib/EPD` driver includes display power enable on GPIO7. Copy that library into the Arduino sketchbook's `libraries/EPD` directory if building in Arduino IDE. Install the exact external dependencies from `platformio.ini`; older web-server ZIP examples in previous versions of this guide are obsolete.

Arduino requires the main sketch filename to match its directory. Create a dedicated sketch directory, place all required `firmware/src` source/header files there, rename `main.ino` to match the directory, and put the chosen configuration beside it as `config.h` (the repository wrapper's relative paths assume the original layout). Keep the board/revision defines in the configuration before the hardware settings. The source may use PlatformIO build selection, so include only the modules used by the selected environment.

A successful Arduino compilation does not produce a ready-to-install factory image by itself. The supported release packaging script reads PlatformIO build outputs and patches/merges the complete image. Use that pipeline when publishing to the web flasher.

There is no evidence that Arduino core versions newer than 2.0.15 universally prevent this board from flashing. This repository pins the tested 2.0.17 toolchain for reproducibility; the external UART connection is the reason USB CDC On Boot is disabled.

See [Elecrow's hardware source](https://github.com/Elecrow-RD/CrowPanel-ESP32-2.13-E-paper-HMI-Display-with-122-250) and [Espressif's USB CDC guide](https://docs.espressif.com/projects/arduino-esp32/en/latest/tutorials/cdc_dfu_flash.html) for the distinction between an external serial bridge and native USB.
