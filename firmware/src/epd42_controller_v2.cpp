// Elecrow CrowPanel 4.2" with the green circular sticker on the back. The
// vendor changed the display driver: this is a different command set from the
// SSD1683 board (same family as the 2.13" V1.2 panel). Sequence follows the
// vendor's arduino_A_green_circular_sticker_on_the_back Example7_Global_Refresh.
#if defined(ELECROW_EPAPER_42) && defined(ELECROW_PANEL_42_V2)
#include <Arduino.h>
#include "epd42_panel.h"
#include "epd42_bus.h"

namespace epd42 {
namespace {
constexpr size_t LUT_BYTES = 42;

// Vendor "GC" (global clear) waveform, registers 0x20..0x24. Only the first
// seven bytes of each table are non-zero.
constexpr uint8_t LUT_HEAD[5][7] = {
  {0x01, 0x14, 0x0A, 0x14, 0x00, 0x01, 0x01},
  {0x01, 0x54, 0x0A, 0x94, 0x00, 0x01, 0x01},
  {0x01, 0x54, 0x0A, 0x94, 0x00, 0x01, 0x01},
  {0x01, 0x94, 0x0A, 0x54, 0x00, 0x01, 0x01},
  {0x01, 0x94, 0x0A, 0x54, 0x00, 0x01, 0x01},
};

void writeLut() {
  for (uint8_t table = 0; table < 5; ++table) {
    command(0x20 + table);
    dataBlock(LUT_HEAD[table], sizeof(LUT_HEAD[table]));
    dataFill(0x00, LUT_BYTES - sizeof(LUT_HEAD[table]));
  }
}
}  // namespace

bool configure() {
  hardwareReset(10, 100, 100);
  reg(0x00, {0x3F, 0x4D});                    // Panel setting
  reg(0x01, {0x03, 0x10, 0x3F, 0x3F, 0x03});  // Power setting
  reg(0x06, {0x96, 0x96, 0x29});              // Booster soft start
  reg(0x30, {0x09});                          // PLL
  reg(0x61, {Epd42Frame::WIDTH >> 8, Epd42Frame::WIDTH & 0xFF,
             Epd42Frame::HEIGHT >> 8, Epd42Frame::HEIGHT & 0xFF});
  reg(0x82, {0x05});                          // VCOM DC
  reg(0x50, {0x97});                          // VCOM and data interval
  reg(0x60, {0x22});                          // TCON
  reg(0xE3, {0x88});                          // Power saving
  // The vendor clears the previous-image RAM before any refresh.
  command(0x10);
  dataFill(0xFF, Epd42Frame::BYTES);
  return waitIdle("configuration");
}

bool refresh(const Epd42Frame& frame) {
  reg(0x50, {0xD7});
  command(0x13);
  dataBlock(frame.bytes, Epd42Frame::BYTES);
  writeLut();
  if (!waitIdle("before refresh")) return false;
  reg(0x17, {0xA5});  // Auto power on, refresh, power off
  return waitRefreshCycle();
}

void powerDown() {
  reg(0x07, {0xA5});  // Deep sleep
  delay(50);
}

}  // namespace epd42
#endif
