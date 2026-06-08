# Firmware Flashing Guide

This guide covers flashing firmware to the **Elecrow CrowPanel ESP32 2.13" E-Paper** and the **Waveshare 2.13" e-Paper HAT V2**. Jump to your board:

- [Elecrow CrowPanel — macOS](#elecrow-macos)
- [Elecrow CrowPanel — Windows](#elecrow-windows)
- [Waveshare HAT — quick reference](#waveshare-quick-reference)

---

## Hardware Specs

### Elecrow CrowPanel ESP32 2.13" E-Paper

| Property | Value |
|---|---|
| MCU | ESP32-S3 (240 MHz, 8 MB Flash, 8 MB OPI PSRAM) |
| Display | 250 × 122 px, black/white, SSD1680Z / JD79661 |
| Interface | SPI (4-wire) |
| USB | USB-C (data + charge) |
| USB chip | CH340 / CH343 (WCH) |
| Buttons | Boot, Reset, Menu, Back, Dial switch |

**SPI Pin Mapping**

| Signal | GPIO |
|---|---|
| CS (Chip Select) | 14 |
| DC (Data/Command) | 13 |
| RST (Reset) | 10 |
| BUSY | 9 |
| MOSI (DIN) | 11 |
| SCK (Clock) | 12 |

### Waveshare 2.13" e-Paper HAT V2

| Property | Value |
|---|---|
| MCU | ESP32-WROOM-32 (240 MHz) |
| Display | 250 × 122 px, black/white, SSD1680 |
| USB chip | CH340 / CP2102 (varies by vendor) |

---

## Step 0 — Get the Elecrow EPD Library (Required for Elecrow board)

The Elecrow EPD library is **not** in the PlatformIO or Arduino registry — it must be installed manually.

1. Download or clone the Elecrow repo:

   ```
   https://github.com/Elecrow-RD/CrowPanel-ESP32-2.13-E-paper-HMI-Display-with-122-250
   ```

   Either `git clone` it or click **Code → Download ZIP** and extract it.

2. Inside the downloaded folder, find the `EPD` library. It is inside `factory_sourcecode/` — typically at a path like:

   ```
   factory_sourcecode/.../libraries/EPD/
   ```

3. Copy that `EPD` folder into this project at:

   ```
   firmware/lib/EPD/
   ```

   The final structure should look like:

   ```
   firmware/
   └── lib/
       └── EPD/
           ├── EPD.h
           ├── EPD.cpp        (or EPD_2in13.h / EPD_2in13.cpp)
           ├── GUI_Paint.h
           ├── GUI_Paint.cpp
           └── Fonts/
               ├── fonts.h
               ├── Font8.c
               ├── Font12.c
               └── ...
   ```

   PlatformIO picks up `firmware/lib/` automatically — no extra config needed.

> **Note:** The EPD library pins are pre-configured for the Elecrow board (CS=14, DC=13, RST=10, BUSY=9). Do **not** change them unless you also edit `DEV_Config.h` inside the library.

---

## Elecrow — macOS {#elecrow-macos}

> **Before you start — macOS checklist**
>
> - **USB-C data cable** — not a charge-only cable. Many USB-C cables carry power only and have no data lines. If you are unsure, use the cable that came in the box or one you know works for file transfer. A charge-only cable means the board will never appear in `/dev/cu.*`, regardless of driver status.
> - **macOS 10.15 Catalina or later.** Users on macOS 13 Ventura, 14 Sonoma, or 15 Sequoia must complete an extra Privacy & Security approval step after driver install (covered in Step 1b below).
> - **WCH CH34x driver** — download link and install steps are in Step 1.
> - **Python 3.8+** and **PlatformIO** — covered in Step 2.

### 1. Install USB Driver

The Elecrow board uses a **WCH CH340 / CH343** USB-to-serial chip. macOS does not include this driver — it must be installed manually.

#### 1a — Download and run the installer

1. Download the macOS WCH driver from the official source:
   - **WCH CH34x driver for macOS:** https://www.wch-ic.com/downloads/CH34XSER_MAC_ZIP.html
2. Extract the ZIP. Inside you will find a `.pkg` installer file.
3. **Do not double-click the `.pkg`.** macOS Gatekeeper will block it with a _"developer cannot be verified"_ error. Instead: **right-click** (or Control-click) the `.pkg` → choose **Open** → click **Open** in the dialog that appears.
4. Follow the installer prompts and enter your Mac password when asked.

#### 1b — Approve the kernel extension (macOS 13 Ventura / 14 Sonoma / 15 Sequoia)

After the installer finishes, macOS silently blocks the driver's kernel extension. You must approve it manually or the port will never appear — even after a reboot.

1. Open **System Settings** (gear icon in the Dock or Apple menu).
2. Click **Privacy & Security**.
3. Scroll down to the **Security** section near the bottom.
4. You should see: _"System software from 'Qinheng Microelectronics' was blocked from loading."_ Click **Allow**.
5. Enter your Mac password to confirm.

> **macOS 12 Monterey or earlier:** Open **System Preferences → Security & Privacy → General** tab. Look for a similar "Allow" button and click it if present.

> **No "Allow" message?** The extension may already be approved, or the installer did not complete correctly. Continue to the next step and check if the port appears after restarting.

#### 1c — Restart and verify

1. **Restart your Mac** (required — the kernel extension does not load until after a reboot).
2. Connect the Elecrow board using a **USB-C data cable** (see the checklist above).
3. Verify the port appears:

   ```bash
   ls /dev/cu.*
   ```

   You should see something like `/dev/cu.usbserial-1410` or `/dev/cu.wchusbserial14120`.

> **No port after restart?** Work through this checklist in order:
> 1. **Try a different USB-C cable.** Charge-only cables have no data lines — the board will never appear regardless of driver status. This is the most common cause.
> 2. **Confirm you completed Step 1b.** If you skipped or dismissed the Privacy & Security prompt, the driver silently fails to load even after rebooting. Go back and check — the Allow button may still be there.
> 3. Unplug and replug the board.
> 4. Open **Apple menu → About This Mac → System Report → USB** and check if the board appears in the USB device tree. If it does not appear there, the problem is the cable or board, not the driver.

### 2. Install Python and PlatformIO

PlatformIO requires Python 3.8 or newer.

**Check if Python is already installed:**
```bash
python3 --version
```

**Install Python (if needed):**
- Download from https://www.python.org/downloads/macos/ and run the installer, **or**
- Install via Homebrew: `brew install python`

**Install PlatformIO:**
```bash
pip3 install platformio
```

Verify:
```bash
pio --version
```

> **Alternative:** Install the [PlatformIO VS Code extension](https://platformio.org/platformio-ide) — it bundles everything and provides a GUI upload button.

### 3. Clone the Project and Configure

```bash
git clone https://github.com/scottlinddk/esp32-e-ink-system.git
cd esp32-e-ink-system
```

Copy the config template and set your API URL:
```bash
cp firmware/config.h.example firmware/config.h
```

Open `firmware/config.h` in a text editor. The only setting you must change before flashing is:
```cpp
#define PROVISION_DEFAULT_API_URL "https://your-api.vercel.app"
```

Replace `your-api.vercel.app` with your actual backend URL. WiFi credentials are entered at runtime via the captive portal on first boot — you do not need to hardcode them.

### 4. Install the EPD Library

Follow [Step 0](#step-0--get-the-elecrow-epd-library-required-for-elecrow-board) above, then verify:
```bash
ls firmware/lib/EPD/
# Should list: EPD.h  GUI_Paint.h  Fonts/  ...
```

### 5. Flash the Firmware

```bash
npm run flash:elecrow
```

Or directly with PlatformIO:
```bash
cd firmware
pio run -e elecrow_213 --target upload
```

PlatformIO auto-detects the serial port. Watch for:
```
Uploading .pio/build/elecrow_213/firmware.bin
...
Writing at 0x00001000... (100 %)
Hard resetting via RTS pin...
```

> **Upload fails?** Hold the **BOOT** button on the Elecrow board, click Upload, then release BOOT once uploading starts.

### 6. Verify — Serial Monitor

```bash
npm run flash:elecrow:monitor
```

Expected output on first boot:
```
[Main] ========================================
[Main] ESP32 E-Ink Display Firmware v1.0.0
[Main] ========================================
[Main] Hardware initialized
[Main] No credentials found — starting captive portal AP
```

The e-ink display should show "Loading... / Setup required".

Press `Ctrl+C` to exit the monitor.

### 7. First-Boot Setup

After flashing, the device starts a WiFi hotspot:

1. On your phone or laptop, connect to **`ESP32-Display-XXXXXX`** (where XXXXXX is the device's MAC suffix).
2. A setup page opens automatically (or navigate to **192.168.4.1**).
3. Enter your home WiFi SSID, password, and backend API URL, then tap **Save**.
4. The device restarts and connects to your WiFi.
5. In the web dashboard under **Devices**, enter the device ID shown in the portal to link it to your account.

---

## Elecrow — Windows {#elecrow-windows}

### 1. Install USB Driver

> **Important — use a data cable, not a charge-only cable.** Many USB-C cables are designed for charging only and carry no data lines. If you plug in with one of these, Windows will never detect the board regardless of which driver you install. Use the cable that came in the box, or one you know works for data (e.g. it also transfers files to a phone).

1. Plug the Elecrow board into your PC via USB-C.
2. Open **Device Manager** (press `Win + X` → Device Manager).
3. Look under **Ports (COM & LPT)** or **Other devices** for an unknown device.
4. Download the **WCH CH340 / CH343 Windows driver**:
   - https://www.wch-ic.com/downloads/CH341SER_EXE.html
5. Run the `.exe` installer and click **Install**.
6. Unplug and replug the board.
7. In Device Manager, confirm a `COM` port now appears (e.g., **COM3** or **COM4**).

   > **Still "Unknown device"?** Try a different USB-C cable — cables marketed as "charge-only" have no data lines.
   >
   > **Driver blocked by Windows?** Right-click the installer → "Run as administrator".

### 2. Install Python and PlatformIO

1. Download Python 3.10+ from https://www.python.org/downloads/windows/
2. Run the installer — **check "Add Python to PATH"** before clicking Install.
3. Open **PowerShell** or **Command Prompt** and install PlatformIO:

   ```powershell
   pip install platformio
   ```

4. Verify:
   ```powershell
   pio --version
   ```

> **Recommended alternative:** Install the [PlatformIO VS Code extension](https://platformio.org/platformio-ide) — it provides a one-click Upload button and handles everything.

### 3. Clone the Project and Configure

```powershell
git clone https://github.com/scottlinddk/esp32-e-ink-system.git
cd esp32-e-ink-system
```

Copy the config template:
```powershell
copy firmware\config.h.example firmware\config.h
```

Open `firmware\config.h` in Notepad (or VS Code) and update:
```cpp
#define PROVISION_DEFAULT_API_URL "https://your-api.vercel.app"
```

### 4. Install the EPD Library

Follow [Step 0](#step-0--get-the-elecrow-epd-library-required-for-elecrow-board) above. On Windows, copy the EPD folder to:
```
firmware\lib\EPD\
```

Verify:
```powershell
dir firmware\lib\EPD\
```

### 5. Flash the Firmware

Install Node.js from https://nodejs.org/en/download if you don't already have it, then:

```powershell
npm run flash:elecrow
```

Or directly with PlatformIO:
```powershell
cd firmware
pio run -e elecrow_213 --target upload
```

PlatformIO automatically detects your COM port on Windows. If it asks you to select a port, choose the COM port you verified in Device Manager (e.g., COM3).

> **Upload fails?** Hold the **BOOT** button on the Elecrow board while clicking Upload, then release once you see "Uploading..." in the console.
>
> **"Access is denied" on COM port?** Close any other program using the port (Arduino IDE Serial Monitor, PuTTY, etc.).

### 6. Verify — Serial Monitor

```powershell
npm run flash:elecrow:monitor
```

Expected output:
```
[Main] ESP32 E-Ink Display Firmware v1.0.0
[Main] Hardware initialized
[Main] No credentials found — starting captive portal AP
```

Press `Ctrl+C` to exit.

### 7. First-Boot Setup

Same as macOS — connect to the `ESP32-Display-XXXXXX` hotspot and follow the captive portal setup.

---

## Arduino IDE Alternative (macOS + Windows)

Use this if you prefer not to install PlatformIO. Both operating systems follow the same steps.

### 1. Add ESP32-S3 Board Support

1. Open Arduino IDE 2.x (download from https://www.arduino.cc/en/software).
2. Open **File → Preferences** (macOS: **Arduino IDE → Preferences**).
3. In **Additional boards manager URLs**, paste:
   ```
   https://espressif.github.io/arduino-esp32/package_esp32_index.json
   ```
4. Open **Tools → Board → Boards Manager**, search for **esp32**, and install **esp32 by Espressif Systems** — use version **2.0.15** specifically. Versions newer than 2.0.15 changed the default USB upload mode for ESP32-S3, which causes uploads to time out or fail silently on this board. If you already have a newer version, downgrade it using the version dropdown in Boards Manager.

### 2. Install the EPD Library

1. Follow [Step 0](#step-0--get-the-elecrow-epd-library-required-for-elecrow-board) to download the Elecrow repo.
2. Copy the `EPD` folder to your Arduino libraries directory:
   - **macOS:** `~/Documents/Arduino/libraries/EPD/`
   - **Windows:** `C:\Users\<YourName>\Documents\Arduino\libraries\EPD\`
3. Restart Arduino IDE.

### 3. Configure Board Settings

Go to **Tools** and set:

| Setting | Value |
|---|---|
| Board | ESP32 Arduino → **ESP32S3 Dev Module** |
| Partition Scheme | **Huge APP (3MB No OTA/1MB SPIFFS)** |
| PSRAM | **OPI PSRAM** |
| Port | Your COM port (Windows) or `/dev/cu.*` (macOS) |

### 4. Open and Upload

1. Open `firmware/src/main.ino` in Arduino IDE.
2. Make sure `firmware/config.h` exists (copy from `config.h.example`).
3. Click **Upload** (the right-arrow button).
4. If the upload fails, hold the **BOOT** button on the board and try again.

---

## Waveshare Quick Reference

For the original Waveshare 2.13" HAT V2 on an ESP32-WROOM-32:

```bash
# Flash
npm run flash

# Monitor
npm run flash:monitor

# Full workflow
npm run flash:full
```

**Driver:** Install [Silicon Labs CP210x](https://www.silabs.com/developer-tools/usb-to-uart-bridge-vcp-drivers) or [WCH CH340](https://www.wch-ic.com/downloads/CH341SER_EXE.html) depending on your ESP32 board vendor.

**Board in Arduino IDE:** `ESP32 Dev Module` | Partition: `Default 4MB`

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| No COM port / no `/dev/cu.*` | Wrong USB cable (charge-only) — try another |
| macOS: port appears then disappears | Driver not installed or not activated after reboot |
| macOS: port never appears after driver install and reboot | Kernel extension blocked — open System Settings → Privacy & Security → scroll to Security → click Allow next to the Qinheng/WCH message |
| macOS: "developer cannot be verified" when opening .pkg | Right-click (Control-click) the .pkg → Open — do not double-click |
| Windows: driver install fails | Run installer as Administrator |
| Upload error: "connecting..." timeout | Hold BOOT button during upload |
| Upload error: "esptool.py failed" | Lower `upload_speed` to `115200` in `platformio.ini` |
| Display stays blank after flash | Built with wrong env — use `-e elecrow_213`, not `esp32dev` |
| Compile error: "EPD.h not found" | `firmware/lib/EPD/` is missing — see Step 0 |
| Compile error: "EPD_W undeclared" | EPD library header structure differs; check `EPD.h` for the exact constant name |
| Captive portal doesn't appear | Wait 15–20 s; look for `ESP32-Display-XXXXXX` WiFi network |
| Serial monitor shows garbage | Wrong baud rate — set to **115200** |
| High battery drain | Set `DEEP_SLEEP_ENABLED 1` and `DEBUG_ENABLED 0` in `config.h` |

### Holding BOOT to Enter Flash Mode (Elecrow)

The ESP32-S3 sometimes needs manual intervention to enter download mode:

1. Hold the **BOOT** button (also labeled IO0).
2. Press and release **RESET** (or plug in USB while holding BOOT).
3. Release BOOT after 1–2 seconds.
4. Start the upload — the board is now in download mode.

---

## Expected Serial Output (After Setup)

```
[Main] ========================================
[Main] ESP32 E-Ink Display Firmware v1.0.0
[Main] ========================================
[Main] Hardware initialized
[Main] Credentials loaded — SSID: MyWiFi  userId: abc-123
[WiFi] Connecting to MyWiFi...
[WiFi] Connected! IP: 192.168.1.42
[API] Fetching image endpoint...
[Display] Bitmap displayed: 250x122
[Main] Entering deep sleep for 30 minutes
```

---

## Power Consumption

| State | Current |
|---|---|
| Active (WiFi + rendering) | ~150 mA |
| Deep sleep | ~10 µA |
| Average at 30-min refresh | ~0.5 mA |

With a 1000 mAh LiPo: approximately **80+ days** battery life on a 30-minute refresh cycle.

---

## Related Documentation

- [firmware/README.md](../firmware/README.md) — Hardware specs and dev setup
- [API_REFERENCE.md](./API_REFERENCE.md) — Backend endpoint docs
- [Elecrow GitHub repo](https://github.com/Elecrow-RD/CrowPanel-ESP32-2.13-E-paper-HMI-Display-with-122-250) — Official Elecrow source
