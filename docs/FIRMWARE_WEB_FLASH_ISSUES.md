# Web flashing investigation and corrections

The earlier browser install path could write an incomplete or incorrectly prepared image and still report a successful transfer. The setup guide also mixed original CrowPanel and V1.2 panel requirements, and the runtime firmware depended on removed backend APIs.

The corrected path addresses these independent failure modes:

| Failure | Correction |
|---|---|
| Unpatched split binaries, missing boot_app0 | Generate complete esptool-merged factory images with explicit flash parameters. |
| ESP32 versus ESP32-S3 and panel revision confused | Separate builds for Waveshare, original CrowPanel SSD1680 and CrowPanel V1.2 JD79661; choose the physical panel revision in the UI. |
| Old fallback assets and app-only custom versions installed as factories | Require complete factory releases; show unavailable instead of silently falling back to incompatible assets. |
| Cross-origin GitHub downloads or mutable latest URLs during install | Serve release-tag-pinned assets through backend proxy endpoints. |
| Wrong serial console target | CrowPanel uses external UART with USB CDC On Boot disabled. |
| No panel supply control / wrong controller commands | Enable GPIO7 and select the matching controller implementation. |
| Release version and API URL substitutions silently failed | Generate configuration by macro name and validate inputs, preserving defaults when the secret is absent. |
| Legacy pairing and display endpoints | Provision a registered device UUID and per-device token, then fetch the authenticated BMP device feed. |
| Documentation required a missing vendor library | Use the committed driver and the pinned PlatformIO build. |

The firmware workflow compiles every environment, runs packaging/configuration tests, and validates each merged output before creating a release artifact. The web/backend tests exercise manifest completeness, panel selection, proxy validation, and fail-closed behavior. Software checks do not prove that the user's physical panel has refreshed; complete the hardware checklist in [FIRMWARE_FLASHING.md](FIRMWARE_FLASHING.md).

The original diagnosis that the old release workflow produced complete browser images was incorrect: bootloader/partitions/application alone omitted boot_app0 and browser-specific flash-header preparation. The [ESP Web Tools preparation guide](https://esphome.github.io/esp-web-tools/) and [Espressif merge-bin reference](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/esptool/basic-commands.html#merge-binaries-for-flashing-merge-bin) explain why the release now produces merged images.
