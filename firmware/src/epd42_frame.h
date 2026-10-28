#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include "bitmap.h"

// Frame memory for the Elecrow CrowPanel 4.2" (400 x 300), shared by both
// controller revisions: row-major, 50 bytes per row, most significant bit =
// leftmost pixel, 1 = white, 0 = black. This is also the byte order both
// controllers accept in their RAM write commands, so no packing happens on
// the way out. Pure logic, no hardware access: covered by tests/epd42_frame_test.cpp.
class Epd42Frame {
public:
  static constexpr uint16_t WIDTH = 400;
  static constexpr uint16_t HEIGHT = 300;
  static constexpr size_t ROW_BYTES = WIDTH / 8u;
  static constexpr size_t BYTES = ROW_BYTES * HEIGHT;

  uint8_t bytes[BYTES];

  Epd42Frame() { clear(); }
  void clear() { memset(bytes, 0xFF, BYTES); }

  void setBlack(uint16_t x, uint16_t y, bool black) {
    if (x >= WIDTH || y >= HEIGHT) return;
    uint8_t& value = bytes[size_t(y) * ROW_BYTES + x / 8u];
    const uint8_t mask = uint8_t(0x80u >> (x % 8u));
    value = black ? uint8_t(value & ~mask) : uint8_t(value | mask);
  }
  bool blackAt(uint16_t x, uint16_t y) const {
    return x < WIDTH && y < HEIGHT && !(bytes[size_t(y) * ROW_BYTES + x / 8u] & (0x80u >> (x % 8u)));
  }

  // Copies a validated server BMP of exactly WIDTH x HEIGHT.
  void load(const MonochromeBitmap& bitmap) {
    for (uint16_t y = 0; y < HEIGHT; ++y)
      for (uint16_t x = 0; x < WIDTH; ++x) setBlack(x, y, bitmap.blackAt(x, y));
  }

  // Adafruit GFXcanvas1 stores the same geometry with set bit = drawn (black),
  // so a status screen drawn on a canvas is the bitwise inverse of this frame.
  void loadInverted(const uint8_t* canvasBits) {
    for (size_t i = 0; i < BYTES; ++i) bytes[i] = uint8_t(~canvasBits[i]);
  }
};
