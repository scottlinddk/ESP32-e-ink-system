# Elecrow CrowPanel 2.13" — Arduino IDE Setup & Flashing Guide

This guide walks you from a brand-new Elecrow CrowPanel ESP32 2.13" E-Paper display to a fully flashed and provisioned device using **Arduino IDE 2.x only**. No PlatformIO required.

---

## Before You Start — Hardware Checklist

- **Elecrow CrowPanel ESP32 2.13" E-Paper** (ESP32-S3, 8 MB Flash, 8 MB OPI PSRAM)
- **USB-C data cable** — not a charge-only cable. Many USB-C cables carry power only and have no data lines. Use the cable that came in the box, or one you know works for file transfer. A charge-only cable means the board will never appear as a serial port, regardless of which driver you install.
- **PC running macOS 12+, Windows 10/11, or Linux**

---

## Step 1 — Install the USB Driver

The Elecrow board uses a **WCH CH340 / CH343** USB-to-serial chip. macOS and Windows require a driver; Linux typically does not.

### macOS

1. Download the macOS WCH driver: https://www.wch-ic.com/downloads/CH34XSER_MAC_ZIP.html
2. Extract the ZIP to find the `.pkg` installer.
3. **Do not double-click the `.pkg`.** macOS Gatekeeper will block it. Instead: **right-click (Control-click)** the `.pkg` → choose **Open** → click **Open** in the prompt.
4. Follow the installer and enter your Mac password when asked.

**macOS 13 Ventura / 14 Sonoma / 15 Sequoia — approve the kernel extension:**

After the installer finishes, macOS silently blocks the driver unless you approve it manually.

1. Open **System Settings** → **Privacy & Security**.
2. Scroll to the **Security** section near the bottom.
3. Click **Allow** next to _"System software from 'Qinheng Microelectronics' was blocked."_
4. Enter your Mac password.

> **macOS 12 Monterey or earlier:** Open **System Preferences → Security & Privacy → General**. Look for the Allow button and click it if present.

**Restart, then verify:**

1. **Restart your Mac** — the kernel extension requires a full reboot.
2. Connect the Elecrow board with a USB-C data cable.
3. Run:
   ```bash
   ls /dev/cu.*
   ```
   You should see something like `/dev/cu.usbserial-1410` or `/dev/cu.wchusbserial14120`.

**Port doesn't appear after restart?**
1. Try a different USB-C cable — charge-only cables are the most common cause.
2. Check that you completed the Privacy & Security approval above. The Allow button may still be waiting.
3. Unplug and replug the board.
4. Open **Apple menu → About This Mac → System Report → USB** to confirm the board appears in the USB tree. If it doesn't, the problem is the cable or board.

---

### Windows

1. Plug the Elecrow board into your PC via USB-C.
2. Open **Device Manager** (`Win + X` → Device Manager).
3. Look under **Ports (COM & LPT)** or **Other devices** for an unknown device.
4. Download the WCH CH340/CH343 driver: https://www.wch-ic.com/downloads/CH341SER_EXE.html
5. Run the `.exe` installer and click **Install**.
6. Unplug and replug the board.
7. In Device Manager, confirm a COM port now appears (e.g., **COM3** or **COM4**).

> **Still "Unknown device"?** Try a different USB-C cable.
>
> **Installer blocked?** Right-click → **Run as administrator**.

---

### Linux

Most Linux distributions include CH340 support in the kernel. Connect the board and check:
```bash
ls /dev/ttyUSB* /dev/ttyACM*
```
You should see `/dev/ttyUSB0` or similar. If nothing appears, your distribution may need `brltty` removed (it conflicts with CH340 on some distros):
```bash
sudo apt remove brltty
```

---

## Step 2 — Install Arduino IDE 2.x

Download **Arduino IDE 2.x** from https://www.arduino.cc/en/software and install it for your OS.

- **macOS:** Open the `.dmg` and drag to Applications.
- **Windows:** Run the `.exe` installer.
- **Linux:** Use the AppImage or `.tar.xz` package from the downloads page.

---

## Step 3 — Add ESP32 Board Support

The Elecrow CrowPanel uses an **ESP32-S3**, which requires Espressif's ESP32 board package.

1. Open Arduino IDE.
2. Go to **File → Preferences** (macOS: **Arduino IDE → Preferences**).
3. In the **Additional boards manager URLs** field, paste:
   ```
   https://espressif.github.io/arduino-esp32/package_esp32_index.json
   ```
4. Click **OK**.
5. Open **Tools → Board → Boards Manager**.
6. Search for **esp32**.
7. Find **esp32 by Espressif Systems** — click the version dropdown and select **2.0.15** — then click **Install**.

> **Why version 2.0.15 specifically?** Versions newer than 2.0.15 changed the default USB upload mode for ESP32-S3. On the Elecrow board, this causes uploads to time out or fail silently. Version 2.0.15 is the last version that works reliably with this board's USB configuration. If you already have a newer version installed, uninstall it from Boards Manager and install 2.0.15.

---

## Step 4 — Configure Board Settings

Go to the **Tools** menu and set every option below. These settings are specific to the Elecrow CrowPanel's ESP32-S3 and its USB configuration. Wrong settings here are the second most common cause of upload failures.

| Setting | Value |
|---|---|
| Board | ESP32 Arduino → **ESP32S3 Dev Module** |
| Partition Scheme | **Huge APP (3MB No OTA/1MB SPIFFS)** |
| PSRAM | **OPI PSRAM** |
| USB CDC On Boot | **Enabled** |
| Upload Mode | **UART0 / Hardware CDC** |
| Port | your `/dev/cu.*` (macOS/Linux) or `COM` port (Windows) |

> **USB CDC On Boot and Upload Mode** must be set to the values above, or uploads will time out or fail without a clear error message. These are the Arduino IDE equivalents of build flags that PlatformIO sets automatically.

---

## Step 5 — Install Required Libraries

The Elecrow board needs four libraries. Two install via Library Manager, two are ZIP installs from GitHub, and one requires a manual file copy.

### 5a — ArduinoJson (Library Manager)

1. Open **Tools → Manage Libraries** (or **Sketch → Include Library → Manage Libraries**).
2. Search for **ArduinoJson**.
3. Install **ArduinoJson by Benoit Blanchon** — version **7.x**.

### 5b — ESPAsyncWebServer-esphome (ZIP install)

This library powers the captive portal on first boot. The esphome fork is required (not the original AsyncWebServer, which has compile issues on ESP32-S3).

1. Download the ZIP:
   ```
   https://github.com/esphome/ESPAsyncWebServer/archive/refs/heads/master.zip
   ```
2. In Arduino IDE: **Sketch → Include Library → Add .ZIP Library...** → select the downloaded ZIP.

### 5c — AsyncTCP-esphome (ZIP install)

1. Download the ZIP:
   ```
   https://github.com/esphome/AsyncTCP/archive/refs/heads/master.zip
   ```
2. **Sketch → Include Library → Add .ZIP Library...** → select the downloaded ZIP.

### 5d — EPD Library (manual copy — Elecrow-specific)

The Elecrow EPD display driver is not in any library registry. It must be copied manually from the official Elecrow repository.

> **Note:** GxEPD2 is **not** used for the Elecrow board. The EPD library is a complete replacement.

1. Go to the Elecrow GitHub repository:
   ```
   https://github.com/Elecrow-RD/CrowPanel-ESP32-2.13-E-paper-HMI-Display-with-122-250
   ```
2. Click **Code → Download ZIP** and extract the archive.
3. Inside the extracted folder, find the `EPD` library. It is inside `factory_sourcecode/` — typically at a path like:
   ```
   factory_sourcecode/.../libraries/EPD/
   ```
4. Copy the `EPD` folder to your Arduino libraries directory:
   - **macOS:** `~/Documents/Arduino/libraries/EPD/`
   - **Windows:** `C:\Users\<YourName>\Documents\Arduino\libraries\EPD\`
   - **Linux:** `~/Arduino/libraries/EPD/`
5. **Restart Arduino IDE.**
6. Verify the library is present: the folder should contain at minimum `EPD.h`, `GUI_Paint.h`, and a `Fonts/` subdirectory.

> **Pins are pre-configured.** The EPD library has CS=14, DC=13, RST=10, BUSY=9 hard-coded for the Elecrow board. Do not change them unless you also edit `DEV_Config.h` inside the library.

---

## Step 6 — Clone the Project and Configure `config.h`

```bash
git clone https://github.com/scottlinddk/esp32-e-ink-system.git
cd esp32-e-ink-system
```

Copy the configuration template:

```bash
# macOS / Linux
cp firmware/config.h.example firmware/config.h

# Windows (Command Prompt)
copy firmware\config.h.example firmware\config.h
```

Open `firmware/config.h` in a text editor and make two changes:

**1. Set your backend API URL:**
```cpp
#define PROVISION_DEFAULT_API_URL "https://your-api.vercel.app"
```
Replace `your-api.vercel.app` with your actual backend URL. WiFi credentials are entered at runtime via the captive portal on first boot — you do not need to hardcode them here.

**2. Uncomment the Elecrow board define:**
```cpp
#define ELECROW_EPAPER_213   // Elecrow CrowPanel 2.13" (ESP32-S3)
```

Remove the `//` at the start of that line. This is mandatory for Arduino IDE users — PlatformIO sets this flag automatically via build configuration, but Arduino IDE does not. Without it, the firmware will compile with the wrong SPI pin mapping and the display will not work.

---

## Step 7 — Open the Sketch and Upload

1. In Arduino IDE: **File → Open** → navigate to `firmware/src/main.ino` and open it.
2. Confirm:
   - `firmware/config.h` exists with your API URL and `ELECROW_EPAPER_213` uncommented (Step 6)
   - Board settings are correct (Step 4)
   - The correct port is selected under **Tools → Port**
3. Click the **Upload** button (→ arrow).

Watch the output panel at the bottom for upload progress:
```
Uploading...
Writing at 0x00001000... (100 %)
Hard resetting via RTS pin...
```

**Upload stalls at "Connecting..."?**

The ESP32-S3 sometimes needs manual intervention to enter download mode:

1. Hold the **BOOT** button on the Elecrow board (also labeled IO0).
2. Click **Upload** in Arduino IDE.
3. Once you see "Uploading..." in the output panel, release the BOOT button.

**Persistent upload failures — full BOOT + RESET sequence:**

1. Hold **BOOT**.
2. Press and release **RESET** (while still holding BOOT).
3. Release **BOOT** after 1–2 seconds.
4. Click **Upload** immediately — the board is now in download mode.

---

## Step 8 — Verify with Serial Monitor

1. Open **Tools → Serial Monitor**.
2. Set the baud rate to **115200** (bottom-right of the Serial Monitor window).
3. Press the **RESET** button on the Elecrow board.

Expected output on first boot:
```
[Main] ========================================
[Main] ESP32 E-Ink Display Firmware v1.0.0
[Main] ========================================
[Main] Hardware initialized
[Main] No credentials found — starting captive portal AP
```

The e-ink display should show "Setup required" or "Loading...".

---

## Step 9 — First-Boot Captive Portal Setup

After flashing, the device starts a WiFi access point so you can enter your credentials.

1. On your phone or laptop, open WiFi settings and connect to **`ESP32-Display-XXXXXX`** (XXXXXX is the device's MAC suffix).
2. A setup page opens automatically. If it doesn't, open a browser and go to **`192.168.4.1`**.
3. Fill in:
   - **WiFi SSID** — your home/office network name (2.4 GHz only — ESP32 does not support 5 GHz)
   - **WiFi Password**
   - **API URL** — your backend URL (e.g., `https://your-api.vercel.app`)
4. Tap **Save**.
5. The device restarts and connects to your WiFi. The display will update within ~30 seconds.
6. In the web dashboard, go to **Devices** and enter the **Device ID** shown in the captive portal (or in the Serial Monitor output) to link the device to your account.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| No COM port / no `/dev/cu.*` | Wrong USB cable (charge-only). Try a different cable |
| macOS: port never appears after driver install and reboot | Kernel extension blocked — System Settings → Privacy & Security → Security → click **Allow** next to the Qinheng/WCH message |
| macOS: "developer cannot be verified" on .pkg | Right-click (Control-click) the .pkg → **Open** — do not double-click |
| Windows: driver install fails | Right-click installer → **Run as administrator** |
| Upload stalls at "Connecting..." | Hold **BOOT** button during upload |
| Upload fails even with BOOT held | Use the full BOOT + RESET sequence in Step 7 |
| Compile error: `EPD.h not found` | EPD library missing from Arduino libraries folder (Step 5d) |
| Compile error: `EPD_W undeclared` or wrong pin constants | EPD library header structure differs from expected — check `EPD.h` for the correct constant names |
| Display stays blank / wrong content after flash | `#define ELECROW_EPAPER_213` is commented out in `config.h` — uncomment it (Step 6) |
| Upload silently fails, no error shown | Board package version is newer than 2.0.15 — downgrade in Boards Manager (Step 3) |
| Garbage characters in Serial Monitor | Baud rate is not set to **115200** |
| Captive portal WiFi network doesn't appear | Wait 15–20 seconds. If still absent, check Serial Monitor — an error message will indicate the cause |
| Device connects to WiFi but display doesn't update | Check the API URL in the captive portal — it must include `https://` and point to your running backend |
| High battery drain | Enable deep sleep: `DEEP_SLEEP_ENABLED 1` and `DEBUG_ENABLED 0` in `config.h` |

---

## Expected Serial Output After Successful Setup

Once WiFi credentials are saved and the device connects:

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

## Related Documentation

- [FIRMWARE_FLASHING.md](./FIRMWARE_FLASHING.md) — Full flashing guide including PlatformIO and Waveshare board
- [API_REFERENCE.md](./API_REFERENCE.md) — Backend endpoint documentation
- [Elecrow GitHub repository](https://github.com/Elecrow-RD/CrowPanel-ESP32-2.13-E-paper-HMI-Display-with-122-250) — Official Elecrow source and EPD library
