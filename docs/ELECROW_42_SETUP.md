# Elecrow CrowPanel ESP32 4.2-inch e-paper

The [CrowPanel 4.2-inch](https://github.com/Elecrow-RD/CrowPanel-ESP32-4.2-E-paper-HMI-Display-with-400-300) is an ESP32-S3-WROOM-1-N8R8 (8 MB flash, 8 MB OPI PSRAM) with a 400 × 300 black-and-white e-paper panel. It runs the same device-feed firmware as the other boards: Wi-Fi polling, the setup hotspot and manual Bluetooth pushes.

In the dashboard, set the device's display profile to **400 × 300**. Any content rotation works. See [display profiles](DISPLAY_PROFILES.md).

## Which revision do you have?

Elecrow sells two hardware revisions that use **different display controllers**. A wrong choice leaves the screen blank or garbled. It does not damage the panel, and flashing the other image fixes it.

| Look at the back of the board | PlatformIO environment | Browser image | Controller |
|---|---|---|---|
| No sticker | `elecrow_42` | `elecrow-crowpanel-42_fw-<version>_factory.bin` | SSD1683 |
| Green circular sticker | `elecrow_42_v2` | `elecrow-crowpanel-42-v2_fw-<version>_factory.bin` | Updated vendor driver, a different command set |

The vendor's own examples split the same way: `example/arduino` and `example/arduino_A_green_circular_sticker_on_the_back`, whose readme says the display driver was updated. The vendor's factory firmware readme also advises trying the other driver if the screen does not turn on.

The sources are `src/epd42_controller_ssd1683.cpp` and `src/epd42_controller_v2.cpp`; each environment links exactly one. Everything else (`epd42_bus`, `epd42_panel`, `epd42_frame.h`, `display_epd42.cpp`) is shared.

## Install

Use the web app's **Flash** page and pick the matching CrowPanel 4.2 option, or build from source:

```sh
cd firmware
pio run -e elecrow_42 --target upload        # no sticker
pio run -e elecrow_42_v2 --target upload     # green sticker
pio device monitor -e elecrow_42 --baud 115200
```

Then follow [first boot](../firmware/README.md#first-boot). `flash.sh` accepts `--elecrow-42` and `--elecrow-42-v2`.

Hold **HOME** (GPIO2) while resetting, or press it while the device sleeps, to open setup and the `EInk-XXXXXX` Bluetooth receiver.

## Wiring used by the firmware

From the vendor readme and examples. The display pins are fixed in `src/epd42_bus.h` and are deliberately not read from `config.h`, so a stale local `config.h` cannot drive another board's pins.

| Signal | GPIO |
|---|---:|
| SCK | 12 |
| MOSI | 11 |
| CS | 45 |
| DC | 46 |
| RESET | 47 |
| BUSY | 48 (HIGH = busy) |
| Panel power enable | 7 (HIGH = on) |
| HOME key (setup, active low) | 2 |

The vendor key example also defines EXIT = 1, PRV = 6, NEXT = 4 and OK = 5, and GPIO41 drives a power indicator LED. The firmware does not use these yet. GPIO45 and GPIO46 are ESP32-S3 strapping pins; the vendor board uses them for CS and DC, so this firmware does too.

## What was verified

| Check | Result |
|---|---|
| Both environments compile and link with the pinned toolchain (`pio run -e elecrow_42 -e elecrow_42_v2`) | Yes: 1.58 MB of the 3.34 MB app partition, 35% RAM, no warnings |
| Command sequences, payloads, GPIO bit order and chip-select framing, BUSY assert/release, failure latch, sleep and wake | Host tests, `epd42_controller_test.cpp`, run for both controllers |
| Pixel order and BMP loading | Host test, `epd42_frame_test.cpp` |
| Command sequences against the vendor source | Reviewed by hand against vendor commit `cb6d6b4` (2026-07-30), `example/arduino/Examples/4.2_GPIO` and `example/arduino_A_green_circular_sticker_on_the_back/Examples/4.2_Example7_Global_Refresh` |
| **Visible image on a real panel, refresh timing, BUSY polarity, deep-sleep current, USB serial path** | **Not yet verified on hardware** |

Host tests prove the firmware sends the vendor's bytes in the vendor's order. They cannot prove the panel draws the image the right way up or that BUSY behaves as the vendor code implies. An observed BUSY cycle in the log means the controller reported activity; it is not a measurement of the visible image.

Things to check on the first real unit:

- **Polarity of the picture.** Both drivers write 1 = white, as the vendor examples do. If black and white are swapped, tell us which revision.
- **BUSY.** The vendor code polls until BUSY reads LOW, so the firmware treats HIGH as busy. If the log shows `BUSY did not assert` or `BUSY did not release` on every refresh, build with `-D EPD42_BUSY_ACTIVE=0`.
- **Serial logs.** The 2.13-inch CrowPanel reaches the PC through a CH340 UART bridge, so this environment copies its `ARDUINO_USB_CDC_ON_BOOT=0`. The 4.2-inch lists a UART0 header; if the USB-C port is native USB instead, no logs appear. Set `ARDUINO_USB_CDC_ON_BOOT=1` in that case.

## Behaviour and limits

- **Full refresh only.** Every update flashes the whole panel, as on the 2.13-inch boards. The panel also supports partial refresh, which the vendor's examples use. It is left out on purpose: it needs its own waveform and ghosting handling and should be tested on hardware first.
- E-paper is bistable. The image stays visible without power, so the firmware configures the controller on boot without refreshing it.
- A refresh timeout latches the driver unavailable until the next boot, so later status screens do not each stall for another 15 seconds.
- Not used: rotary switch navigation, EXIT/PRV/NEXT/OK keys, TF card, battery reporting (no verified ADC pin), the power LED, 4-level grayscale.
- Status screens (loading, errors) are drawn with Adafruit GFX. Server frames bypass it and go straight to the controller buffer.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Screen stays blank or shows noise after flashing | Wrong revision. Flash the other image. |
| Log: `BUSY did not assert` | Wrong revision, no panel power (GPIO7), or inverted BUSY. See above. |
| Log: `BUSY did not release` after 15 s | Wrong revision or inverted BUSY. |
| Setup hotspot never appears | Check the serial settings above, then read the log. |

References: [vendor repository](https://github.com/Elecrow-RD/CrowPanel-ESP32-4.2-E-paper-HMI-Display-with-400-300), [firmware flashing and recovery](FIRMWARE_FLASHING.md).
