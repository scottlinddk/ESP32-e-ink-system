# Elecrow controller reference and verification

The original CrowPanel SSD1680 path follows Elecrow's published original factory
source. The V1.2 JD79661 path uses its separate controller protocol. Neither
ESP32-S3 USB detection nor a successful firmware upload identifies the display
controller. A controller BUSY cycle is electrical evidence of progress, not a
measurement of the image visible on the panel.

## Pinned manufacturer references

The audit used Elecrow repository commit
[`11291e3e9a868be8943232b065f3e264dfaeeae3`](https://github.com/Elecrow-RD/CrowPanel-ESP32-2.13-E-paper-HMI-Display-with-122-250/tree/11291e3e9a868be8943232b065f3e264dfaeeae3)
(2026-09-22). Original factory references:

- [Reset, initialization, update and sleep](https://github.com/Elecrow-RD/CrowPanel-ESP32-2.13-E-paper-HMI-Display-with-122-250/blob/11291e3e9a868be8943232b065f3e264dfaeeae3/factory_soucecode/2.1.3_tow/main/EPD_Init.cpp).
- [GPIO SPI transfer](https://github.com/Elecrow-RD/CrowPanel-ESP32-2.13-E-paper-HMI-Display-with-122-250/blob/11291e3e9a868be8943232b065f3e264dfaeeae3/factory_soucecode/2.1.3_tow/main/spi.cpp) and [pin definitions](https://github.com/Elecrow-RD/CrowPanel-ESP32-2.13-E-paper-HMI-Display-with-122-250/blob/11291e3e9a868be8943232b065f3e264dfaeeae3/factory_soucecode/2.1.3_tow/main/spi.h).
- [Factory caller, GPIO7 power and refresh/sleep lifecycle](https://github.com/Elecrow-RD/CrowPanel-ESP32-2.13-E-paper-HMI-Display-with-122-250/blob/11291e3e9a868be8943232b065f3e264dfaeeae3/factory_soucecode/2.1.3_tow/main/main.ino).
- [Original V1.0 binary package and Burning Options screenshot](https://github.com/Elecrow-RD/CrowPanel-ESP32-2.13-E-paper-HMI-Display-with-122-250/tree/11291e3e9a868be8943232b065f3e264dfaeeae3/factory_firmware/Epaper-2.13(E)%20-V1.0).
- [SSD1680 datasheet](https://github.com/Elecrow-RD/CrowPanel-ESP32-2.13-E-paper-HMI-Display-with-122-250/blob/11291e3e9a868be8943232b065f3e264dfaeeae3/Datasheet/SSD1680_Datasheet%20(1).pdf), page 39, Figure 9-1: wait 10 ms after software reset (`0x12`) before continuing initialization.

The published source and binary are corresponding vendor references, not a
reproducibly verified source/binary pair. The original factory source was last
changed in vendor commit `15482892b00e1545a1977d0b3b9e1b2dd2ce245a`; the current
V1.0 binary's application descriptor reports ESP-IDF
`v5.1.4-497-gdc859c1e67-dirty`, dated July 16, 2024. Older vendor example notes
about Arduino 2.0.10 do not establish the binary's build environment.

The original package's screenshot and image headers specify ESP32-S3, DIO,
80 MHz, 8 MB. Its separate files are flashed at:

| File | Offset | SHA-256 |
|---|---|---|
| `main.ino.bootloader.bin` | `0x0` | `a64b0f63161841b429a79ce6050a0375b998ca522e031e0438cf169425b972a4` |
| `main.ino.partitions.bin` | `0x8000` | `aaae2888c5a6a348004b5b436f47abb25ae32e72d9003902955a998eda723edd` |
| `boot_app0.bin` | `0xe000` | `f94c5d786a7a8fab06ac5d10e33bf37711a6697636dc037559ea19cc410a17f0` |
| `main.ino.bin` | `0x10000` | `a0d52f76ac8c0b6c7bb7677dc79fd80f75a23771be56c7e20584295dad540eb2` |

These are vendor-package settings, not replacements for this application's
PlatformIO or merged-image settings. This change does not alter this project's
flash mode, PSRAM configuration or framework version. Its factory images still
install at offset zero, as described in [flashing and recovery](FIRMWARE_FLASHING.md).

## Driver behavior

The original SSD1680 transfer now follows the vendor's GPIO-driven, MSB-first,
rising-edge SPI sequence and 10 ms reset pulses. Software reset also waits
10 ms before polling BUSY, as required by the datasheet; an initially idle
sample must not skip a delayed reset BUSY assertion. Full refresh writes `0xF4` to
update control `0x22`, then activates with `0x20`; this leaves the boost and clock
enabled until a separate sleep. The setup path sleeps the panel after drawing
its local loading screen, before opening a potentially indefinite setup portal.
The polling path also sleeps before entering the next poll interval. A later
draw reinitializes a sleeping controller while retaining the pending canvas.

The framebuffer geometry, GPIO7 power enable and SSD1680 active-HIGH BUSY
polarity already agreed with the original vendor source. The JD79661 command
sequence and hardware SPI transport remain separate; its BUSY polarity is LOW.

For both controllers, refresh now requires idle before activation, BUSY
assertion after activation, and BUSY release. A line stuck at either logic level
cannot acknowledge a frame. Assertion is bounded to 1 second and release to
15 seconds; these are firmware diagnostic limits, not manufacturer timing
guarantees. An unusually slow panel or a missed pulse can produce a conservative
failure, requiring hardware investigation instead of a success claim.

Logs identify controller, stage, elapsed time, BUSY level, power-enable level and
reset level. Power-enable GPIO readback does not measure the actual panel rail.
An observed cycle is logged separately from physical image verification. A
timeout latches the driver unavailable for the rest of that awake session, so
later error screens do not each stall for another timeout. Reinitialization
clears the latch.

## Heartbeat deployment order

Deploy the API accepting nullable `last_applied_hash` before releasing this
firmware. A successful controller cycle supplies the frame hash. A failed or
unknown frame supplies JSON `null`, explicitly clearing an older acknowledgement
instead of leaving stale success in the dashboard. The server's receipt of a
heartbeat confirms communication, and its stored hash records the device's
controller acknowledgement; neither confirms visible pixels.

## Verification and remaining hardware work

Host tests decode the original path's GPIO edges and check payload orientation,
reset timing and vendor command ordering, including a delayed software-reset
BUSY pulse that must finish before configuration is sent. Time-driven BUSY traces cover both
controllers with immediate and delayed assertion, normal release, a line stuck
inactive, a line stuck active, failure latching, sleep/reinitialization and
32-bit clock rollover. These tests cannot establish physical refresh or prove
which controller is installed.

On the actual unit, record the firmware version and full serial log. Check the
setup screen before configuring any network. Then save one distinctive layout,
verify it visibly appears, save a different layout and verify that update too.
Confirm the logged BUSY assertion/release and subsequent dashboard report, and
repeat after reset and a sleep/wake cycle. If the correct build still fails,
compare with the pinned original vendor factory demo on the same power source
and hardware. Save device credentials first; factory flashing can replace saved
settings. Vendor alignment is a testable compatibility change, not a claim that
the reported hardware fault has been repaired.
