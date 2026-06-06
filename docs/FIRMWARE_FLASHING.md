# Firmware Flashing Guide

This guide explains how to flash the ESP32 firmware for the ESP32 Display project.

## Hardware

| Component | Model | Notes |
|---|---|---|
| Microcontroller | ESP32 (any variant) | ESP32-WROOM-32 recommended |
| Display | Waveshare 2.13" e-Paper HAT V2 | 250×122px, black/white |
| Connection | SPI | See wiring table below |

## Wiring (ESP32 → Waveshare 2.13" HAT)

| e-Paper Pin | ESP32 GPIO | Description |
|---|---|---|
| VCC | 3.3V | Power |
| GND | GND | Ground |
| DIN (MOSI) | GPIO 23 | SPI Data In |
| CLK (SCK) | GPIO 18 | SPI Clock |
| CS | GPIO 5 | Chip Select (active low) |
| DC | GPIO 17 | Data/Command select |
| RST | GPIO 16 | Hardware reset |
| BUSY | GPIO 4 | Busy indicator (active high) |

## Web Browser Flashing (Easiest)

Flash directly from Chrome or Edge — no IDE or toolchain required.

### Step 1: Install USB-to-Serial Driver (macOS / Windows)

Most ESP32 boards use a CH340 or CP210x chip to expose the serial port over USB:

| Chip | macOS driver | Windows | Linux |
|------|-------------|---------|-------|
| CH340 / CH341 | [WCH CH34x driver](https://www.wch-ic.com/downloads/CH34XSER_MAC_ZIP.html) | Auto via Windows Update | Built-in |
| CP2102 / CP2104 | [Silicon Labs driver](https://www.silabs.com/developer-tools/usb-to-uart-bridge-vcp-drivers) | Auto via Windows Update | Built-in |

After installing, unplug and replug the ESP32 USB cable.

### Step 2: Flash via the Dashboard

1. Open the **Flash** page in the dashboard (`/flash`).
2. Click **Install Firmware**.
3. In the browser dialog, select the serial port (e.g. `/dev/cu.usbserial-…` on Mac, `COM3` on Windows). Do not select a Bluetooth entry.
4. Wait ~30 seconds for the flash to complete.

> **Can't see a port?** The USB cable might be charge-only — try a different cable. Make sure the driver is installed (step 1).

### Step 3: Full Setup After Flashing

After a successful flash the device boots and broadcasts a WiFi hotspot:

1. **Connect to the hotspot** — network name is `ESP32-Display-XXXXXX` (where XXXXXX is the device's MAC suffix).
2. **Fill in the captive portal** — a setup page opens automatically (or navigate to `192.168.4.1`). Enter your home WiFi SSID, password, and backend API URL, then tap Save.
3. **Claim the device** — in the dashboard, go to **Devices** and enter the device ID shown in the portal to link it to your account.
4. **Add API keys** — get free keys from OpenWeatherMap and NewsAPI and paste them on the Account page.
5. **Toggle sources** — enable Weather, News, or Energy on the Dashboard. The display updates within one refresh cycle.

---

## Software Setup

## Quick Start (Recommended)

The easiest way to flash firmware is using npm from the project root:

```bash
# 1. Install PlatformIO (one-time)
pip install platformio

# 2. Configure firmware
cd firmware
cp config.h.example config.h
# Edit config.h: WiFi SSID, password, API URL, user ID, license key

# 3. Flash to ESP32
cd ..
npm run flash

# 4. View serial output
npm run flash:monitor
```

### npm Flash Commands

| Command | Purpose |
|---------|---------|
| `npm run flash` | Build and upload firmware |
| `npm run flash:build` | Build only (no upload) |
| `npm run flash:monitor` | View serial output (115200 baud) |
| `npm run flash:full` | Build, upload, and monitor |
| `npm run flash:clean` | Clean build artifacts |

## Alternative: Manual Flashing

```bash
cd firmware
bash scripts/flash.sh upload      # Build and upload
bash scripts/flash.sh monitor     # View logs
bash scripts/flash.sh help        # Show all commands
```

## Software Setup (Details)

### Option A: PlatformIO (recommended)

1. Install [VS Code](https://code.visualstudio.com/) and the PlatformIO extension
2. Open the firmware folder in VS Code
3. PlatformIO will automatically install dependencies

**platformio.ini:**
```ini
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino
monitor_speed = 115200
lib_deps =
    zinggjm/GxEPD2@^1.5.3
    bblanchon/ArduinoJson@^7.0.0
upload_speed = 921600
```

### Option B: Arduino IDE

1. Install [Arduino IDE 2.x](https://www.arduino.cc/en/software)
2. Add ESP32 board support:
   - File → Preferences → Additional Board Manager URLs:
   - `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
3. Install libraries:
   - GxEPD2 by ZinggJM
   - ArduinoJson by Benoit Blanchon

## Configuration

Copy `config.h.example` to `config.h` and fill in your values:

```cpp
// config.h
#pragma once

// WiFi credentials
#define WIFI_SSID     "YourNetworkName"
#define WIFI_PASSWORD "YourNetworkPassword"

// ESP32 Display API
#define API_BASE_URL  "https://api.yourdomain.com"
#define USER_ID       "your-supabase-user-uuid"
#define LICENSE_KEY   "your-license-key"

// Display refresh (in minutes — must match dashboard setting)
#define REFRESH_MINUTES 30

// Display GPIO pins
#define PIN_CS   5
#define PIN_DC   17
#define PIN_RST  16
#define PIN_BUSY 4
```

## Flashing

### PlatformIO
```bash
# Build
pio run

# Upload
pio run --target upload

# Monitor serial output
pio device monitor
```

### Arduino IDE
1. Select board: **ESP32 Dev Module**
2. Select the correct COM port
3. Click **Upload**
4. Open **Serial Monitor** at 115200 baud

## Expected Serial Output

```
[Boot] ESP32 Display v1.0.0
[WiFi] Connecting to YourNetworkName...
[WiFi] Connected! IP: 192.168.1.42
[API] Fetching: https://api.yourdomain.com/api/display-data/abc...?licenseKey=xyz...
[API] HTTP 200 OK (342 bytes)
[Parse] Price: 142.5 øre/kWh (trend: up)
[Parse] Weather: 12°C, cloudy, 6 m/s
[Parse] Headlines: 3 items
[Display] Starting full refresh...
[Display] Render complete (2.4s)
[Sleep] Entering deep sleep for 1800 seconds
```

## Power Consumption

| State | Current |
|---|---|
| Active (WiFi + rendering) | ~150 mA |
| Deep sleep | ~10 µA |
| Average (30 min refresh) | ~0.5 mA |

With a 1000 mAh LiPo battery, expected battery life is approximately **80+ days** on a 30-minute refresh cycle.

## Troubleshooting

### Display shows nothing / white screen

### WiFi won't connect

### API returns 401

### Display updates but shows old data

### USB/Serial Issues
- **No COM port detected?** → Install CH340 driver: https://dlldownload.com/ch340-drivers/
- **Gibberish in serial output?** → Verify baud rate is 115200
- **Connection drops?** → Try a different USB cable (some are "charging only")
- **Still not working?** → Run `pio device list` to see detected devices

### High Battery Drain
- Ensure `DEEP_SLEEP_ENABLED 1` in config.h
- Increase `REFRESH_MINUTES` to reduce wake frequency
- Disable `DEBUG_ENABLED` (serial debug consumes power)
- Check WiFi for failed reconnection attempts in logs

## Related Documentation

- [firmware/README.md](../firmware/README.md) — Development guide & configuration reference
- [API_REFERENCE.md](./API_REFERENCE.md) — Backend endpoint documentation
- Serial logs: `npm run flash:monitor`
