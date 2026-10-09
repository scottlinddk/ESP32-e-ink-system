#ifdef WAVESHARE_RLCD_42
#include "st7305_panel.h"
#include "config.h"
#include <SPI.h>
#include <driver/gpio.h>

namespace {
// Waveshare's ESP-IDF BSP clocks this panel at 10 MHz; 15 kB then takes ~12 ms.
const SPISettings kSettings(10000000, MSBFIRST, SPI_MODE0);
SPIClass panelSpi(HSPI);

// Window covering the whole panel, as Waveshare's RLCD_Display() sets it.
const uint8_t kColumns[] = {0x12, 0x2A};
const uint8_t kRows[] = {0x00, 0xC7};
}

void St7305Panel::command(uint8_t value) { commandData(value, nullptr, 0); }

void St7305Panel::commandData(uint8_t value, const uint8_t* data, size_t length) {
  panelSpi.beginTransaction(kSettings);
  digitalWrite(PIN_DC, LOW);
  digitalWrite(PIN_CS, LOW);
  panelSpi.transfer(value);
  if (length) {
    digitalWrite(PIN_DC, HIGH);
    panelSpi.writeBytes(data, length);
  }
  digitalWrite(PIN_CS, HIGH);
  panelSpi.endTransaction();
}

void St7305Panel::releasePins() {
  // Deep sleep latched these high; a held pad ignores writes until released.
  gpio_hold_dis(static_cast<gpio_num_t>(PIN_RST));
  gpio_hold_dis(static_cast<gpio_num_t>(PIN_CS));
  gpio_deep_sleep_hold_dis();
  pinMode(PIN_CS, OUTPUT);
  pinMode(PIN_DC, OUTPUT);
  pinMode(PIN_RST, OUTPUT);
  digitalWrite(PIN_CS, HIGH);
  digitalWrite(PIN_DC, HIGH);
  digitalWrite(PIN_RST, HIGH);
  panelSpi.begin(PIN_CLK, PIN_MISO, PIN_MOSI, -1);
}

void St7305Panel::resume() {
  releasePins();
  // Idle mode persisted through sleep; the next write restores high power.
  idling = true;
}

void St7305Panel::begin() {
  releasePins();
  digitalWrite(PIN_RST, HIGH);
  delay(50);
  digitalWrite(PIN_RST, LOW);
  delay(20);
  digitalWrite(PIN_RST, HIGH);
  delay(50);

  static const uint8_t d6[] = {0x17, 0x02};                 // NVM load control
  static const uint8_t d1[] = {0x01};                       // Booster enable
  static const uint8_t c0[] = {0x11, 0x04};                 // Gate voltage
  static const uint8_t c1[] = {0x69, 0x69, 0x69, 0x69};     // VSHP
  static const uint8_t c2[] = {0x19, 0x19, 0x19, 0x19};     // VSLP
  static const uint8_t c4[] = {0x4B, 0x4B, 0x4B, 0x4B};     // VSHN
  static const uint8_t c5[] = {0x19, 0x19, 0x19, 0x19};     // VSLN
  static const uint8_t d8[] = {0x80, 0xE9};                 // OSC
  static const uint8_t b2[] = {0x02};                       // Frame rate
  static const uint8_t b3[] = {0xE5, 0xF6, 0x05, 0x46, 0x77, 0x77, 0x77, 0x77, 0x76, 0x45};
  static const uint8_t b4[] = {0x05, 0x46, 0x77, 0x77, 0x77, 0x77, 0x76, 0x45};
  static const uint8_t g62[] = {0x32, 0x03, 0x1F};          // Gate timing
  static const uint8_t b7[] = {0x13};                       // Source EQ
  static const uint8_t b0[] = {0x64};                       // Gate line setting
  static const uint8_t c9[] = {0x00};                       // Source voltage select
  static const uint8_t m36[] = {0x48};                      // Memory access control
  static const uint8_t m3a[] = {0x11};                      // Data format
  static const uint8_t b9[] = {0x20};                       // Gamma mode: mono
  static const uint8_t b8[] = {0x29};                       // Panel setting
  static const uint8_t m35[] = {0x00};                      // Tearing effect line
  static const uint8_t d0[] = {0xFF};                       // Auto power down

  commandData(0xD6, d6, sizeof(d6));
  commandData(0xD1, d1, sizeof(d1));
  commandData(0xC0, c0, sizeof(c0));
  commandData(0xC1, c1, sizeof(c1));
  commandData(0xC2, c2, sizeof(c2));
  commandData(0xC4, c4, sizeof(c4));
  commandData(0xC5, c5, sizeof(c5));
  commandData(0xD8, d8, sizeof(d8));
  commandData(0xB2, b2, sizeof(b2));
  commandData(0xB3, b3, sizeof(b3));
  commandData(0xB4, b4, sizeof(b4));
  commandData(0x62, g62, sizeof(g62));
  commandData(0xB7, b7, sizeof(b7));
  commandData(0xB0, b0, sizeof(b0));
  command(0x11);  // Sleep out
  delay(200);
  commandData(0xC9, c9, sizeof(c9));
  commandData(0x36, m36, sizeof(m36));
  commandData(0x3A, m3a, sizeof(m3a));
  commandData(0xB9, b9, sizeof(b9));
  commandData(0xB8, b8, sizeof(b8));
  command(0x21);  // Display inversion on, as in the vendor sequence
  commandData(0x2A, kColumns, sizeof(kColumns));
  commandData(0x2B, kRows, sizeof(kRows));
  commandData(0x35, m35, sizeof(m35));
  commandData(0xD0, d0, sizeof(d0));
  command(0x38);  // High power mode
  command(0x29);  // Display on
  idling = false;
}

void St7305Panel::wake() {
  if (!idling) return;
  releasePins();
  command(0x38);  // High power mode: full scan rate for the new image
  idling = false;
}

void St7305Panel::write(const St7305Frame& frame) {
  wake();
  commandData(0x2A, kColumns, sizeof(kColumns));
  commandData(0x2B, kRows, sizeof(kRows));
  commandData(0x2C, frame.bytes, St7305Frame::BYTES);
}

void St7305Panel::idle() {
  if (!idling) {
#if RLCD_LOW_POWER_IDLE
    command(0x39);  // Low power mode: slower scan, image retained
#endif
    idling = true;
  }
  // Keep RESET and CS high through deep sleep: a floating RESET would blank
  // the panel, and the timer wake must find the previous frame intact.
  digitalWrite(PIN_RST, HIGH);
  digitalWrite(PIN_CS, HIGH);
  gpio_hold_en(static_cast<gpio_num_t>(PIN_RST));
  gpio_hold_en(static_cast<gpio_num_t>(PIN_CS));
  gpio_deep_sleep_hold_en();
}
#endif
