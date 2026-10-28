// Original Elecrow CrowPanel 4.2" (no sticker on the back): SSD1683, 400 x 300.
// Sequence follows the vendor's arduino/Examples/4.2_GPIO EPD.cpp.
#if defined(ELECROW_EPAPER_42) && !defined(ELECROW_PANEL_42_V2)
#include <Arduino.h>
#include "epd42_panel.h"
#include "epd42_bus.h"

namespace epd42 {

bool configure() {
  hardwareReset(100, 10, 10);
  if (!waitIdle("hardware reset")) return false;
  command(0x12);  // Software reset
  delay(10);      // BUSY may assert slightly after the command.
  if (!waitIdle("software reset")) return false;
  reg(0x21, {0x40, 0x00});  // Display update control: bypass RED RAM as 0
  reg(0x3C, {0x05});        // Border waveform
  reg(0x11, {0x03});        // Data entry: X and Y increment, X first
  reg(0x44, {0x00, (Epd42Frame::WIDTH - 1) >> 3});
  reg(0x45, {0x00, 0x00, (Epd42Frame::HEIGHT - 1) & 0xFF, (Epd42Frame::HEIGHT - 1) >> 8});
  reg(0x4E, {0x00});
  reg(0x4F, {0x00, 0x00});
  return waitIdle("configuration");
}

bool refresh(const Epd42Frame& frame) {
  reg(0x4E, {0x00});
  reg(0x4F, {0x00, 0x00});
  command(0x24);
  dataBlock(frame.bytes, Epd42Frame::BYTES);
  if (!waitIdle("before refresh")) return false;
  reg(0x22, {0xF7});  // Full update: load temperature and LUT, display, power down
  command(0x20);
  return waitRefreshCycle();
}

void powerDown() {
  reg(0x10, {0x01});  // Deep sleep mode 1: RAM retained
  delay(50);
}

}  // namespace epd42
#endif
