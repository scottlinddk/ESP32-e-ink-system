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

## Software Setup

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
- Check wiring (especially CS, DC, RST, BUSY)
- Verify 3.3V power — do not use 5V directly on display
- Try a lower SPI clock speed: `GxEPD2_BW<...> display(GxEPD2_213_B74(PIN_CS, PIN_DC, PIN_RST, PIN_BUSY));`

### WiFi won't connect
- Ensure you're on 2.4 GHz (ESP32 does not support 5 GHz)
- Check SSID and password (case-sensitive)

### API returns 401
- Verify LICENSE_KEY matches what's in your dashboard
- Verify USER_ID is correct
- Check that the device is registered

### Display updates but shows old data
- The server caches energy prices for 15 minutes and weather/news for 1 hour
- This is intentional to protect API quotas
