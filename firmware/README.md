# ESP32 E-Ink Display Firmware

Arduino firmware for the ESP32 + Waveshare 2.13" e-Paper display. Fetches energy prices, weather, and news from the backend API and displays them on an e-ink display with optimized power consumption.

## Hardware

| Component | Model | Notes |
|-----------|-------|-------|
| Microcontroller | ESP32 (WROOM-32 recommended) | 3.3V, 240MHz dual-core |
| Display | Waveshare 2.13" e-Paper HAT V2 | 250×122px monochrome |
| Connection | SPI | 4-wire + control pins |

## Wiring

| e-Paper Pin | ESP32 GPIO | Description |
|-------------|-----------|-------------|
| VCC | 3.3V | Power |
| GND | GND | Ground |
| DIN (MOSI) | GPIO 23 | SPI Data In |
| CLK (SCK) | GPIO 18 | SPI Clock |
| CS | GPIO 5 | Chip Select |
| DC | GPIO 17 | Data/Command |
| RST | GPIO 16 | Reset |
| BUSY | GPIO 4 | Busy indicator |
| *Optional: Battery* | GPIO 35 (ADC1_7) | Battery voltage monitoring |

## Quick Start

### 1. Install PlatformIO

```bash
# Via VS Code extension (recommended) or CLI:
pip install platformio
```

### 2. Configure Firmware

```bash
cd firmware
cp config.h.example config.h
```

Edit `config.h` and fill in:
- WiFi SSID and password
- Backend API URL (e.g., `https://api.yourdomain.com`)
- User ID and license key (from dashboard)

### 3. Build & Flash

```bash
# From workspace root:
npm run flash
```

Or manually with PlatformIO:

```bash
cd firmware
pio run --target upload     # Build and upload
pio device monitor          # View serial output
```

## Development

### Directory Structure

```
firmware/
├── src/
│   ├── main.ino              # Entry point, main loop
│   ├── wifi.h/cpp            # WiFi connection management
│   ├── display.h/cpp         # Waveshare e-ink rendering
│   ├── api.h/cpp             # Backend HTTP client
│   ├── battery.h/cpp         # Battery ADC & monitoring
│   └── ota.h/cpp             # OTA firmware updates
├── platformio.ini            # Build configuration
├── config.h.example          # Configuration template
└── scripts/
    └── flash.sh              # CLI flashing script
```

### Building

```bash
cd firmware

# Build only (no upload)
pio run

# Build for specific environment
pio run -e esp32dev

# Clean build
pio run --target clean
```

### Debugging

Uncomment `#define DEBUG_ENABLED 1` in `config.h` to enable serial logging:

```bash
pio device monitor --baud 115200
```

Log output is prefixed by module: `[WiFi]`, `[API]`, `[Display]`, `[Battery]`, `[OTA]`, `[Main]`

### Testing on Hardware

1. **Serial Monitor**: View connection logs, API calls, errors
2. **Test Pattern**: The firmware displays a test pattern on first boot (or manually by compiling with a test mode flag)
3. **Soft Reset**: Press the EN (Enable) button on the ESP32 to soft-reset without losing WiFi state
4. **Hard Reset**: Press RST button to perform a full restart

### Power Consumption

With deep sleep enabled, the device draws ~10-50 µA during sleep and ~80-150 mA during WiFi/display updates.

| Phase | Current | Notes |
|-------|---------|-------|
| Deep Sleep | ~10 µA | RTC running |
| WiFi Connection | ~100 mA | Active transmission |
| Display Update | ~80 mA | SPI communication |
| Display Idle | ~0 µA | E-ink is passive |

### Configuration Options

Key settings in `config.h`:

| Option | Default | Description |
|--------|---------|-------------|
| `REFRESH_MINUTES` | 30 | Display update interval |
| `DEEP_SLEEP_ENABLED` | 1 | Enable power-saving deep sleep |
| `WIFI_CONNECT_TIMEOUT_SEC` | 20 | WiFi connection timeout |
| `API_REQUEST_TIMEOUT_MS` | 15000 | API call timeout |
| `FEATURE_OTA_UPDATES` | 1 | Enable Over-The-Air updates |
| `FEATURE_BATTERY_REPORTING` | 1 | Report battery to backend |
| `DEBUG_ENABLED` | 1 | Enable serial debug output |

## API Integration

The firmware calls the following backend endpoints:

- **`GET /api/display-data/{userId}`** — Fetch energy/weather/news data
  - Headers: `X-License-Key: {licenseKey}`
  - Response: `{ energy, weather, news, status }`

- **`POST /api/devices/{userId}/status`** — Report battery & signal strength
  - Headers: `X-License-Key: {licenseKey}`
  - Body: `{ batteryPercent, signalStrength }`

- **`GET /api/devices/{userId}/firmware/latest`** — Check for updates (OTA)
  - Response: `{ version, url, checksum }`

See [API Reference](../docs/API_REFERENCE.md) for full endpoint documentation.

## Troubleshooting

### Won't Connect to WiFi

- ✅ Check SSID/password in `config.h`
- ✅ Ensure WiFi is 2.4GHz (ESP32 doesn't support 5GHz)
- ✅ Check serial logs for authentication errors
- ✅ Try scanning networks with `pio run --target scan`

### Display Won't Update

- ✅ Verify SPI wiring (CS, DC, CLK, MOSI, RST, BUSY)
- ✅ Check API URL and license key
- ✅ View serial logs to see API response codes
- ✅ Test with `pio device monitor`

### High Power Consumption

- ✅ Ensure `DEEP_SLEEP_ENABLED` is set to `1` in `config.h`
- ✅ Increase `REFRESH_MINUTES` to reduce update frequency
- ✅ Disable `LOG_API_RESPONSES` if logging full responses

### USB Not Recognized

- ✅ Install CH340 drivers (common on ESP32 boards): https://dlldownload.com/ch340-drivers/
- ✅ Try a different USB cable
- ✅ Check device manager for unknown/COM ports
- ✅ Run `pio device list` to see detected ports

## Performance Metrics

- **Boot Time**: ~5-10 seconds (WiFi + API)
- **Display Render**: ~2 seconds (SPI update)
- **API Response**: ~1-3 seconds (typical)
- **Sleep Wake**: <1 second (RTC timer)

## Libraries Used

- **GxEPD2** (v1.5.3+) — Waveshare e-ink display driver
- **ArduinoJson** (v7.0.0+) — JSON parsing
- **ESP32 Arduino Core** — Hardware abstraction

## License

This project is part of the ESP32 Display SaaS system.

## Next Steps

1. ✅ Flash firmware to ESP32
2. ✅ Configure WiFi and API credentials
3. ✅ Verify data displays on e-ink
4. 🔜 Set up OTA updates (see Phase 3 plan)
5. 🔜 Monitor battery via dashboard
