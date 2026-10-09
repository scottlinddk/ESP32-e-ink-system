#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>

// ST7305 reflective-LCD frame memory for the Waveshare ESP32-S3-RLCD-4.2,
// addressed in its 400 x 300 landscape orientation. Each controller byte
// covers a 2-column x 4-row block; one bit is one pixel, 1 = white.
// Layout follows Waveshare's display_bsp.cpp (InitLandscapeLUT):
//   index = (x / 2) * (H / 4) + (H - 1 - y) / 4
//   bit   = 7 - (((H - 1 - y) % 4) * 2 + x % 2)
// Pure logic, no hardware access: covered by tests/st7305_frame_test.cpp.
template <uint16_t Width, uint16_t Height>
class St7305FrameT {
  static_assert(Width % 2 == 0 && Height % 4 == 0, "ST7305 blocks are 2 x 4 pixels");

public:
  static constexpr size_t BYTES = size_t(Width) * Height / 8u;
  uint8_t bytes[BYTES];

  St7305FrameT() { clear(); }
  void clear() { memset(bytes, 0xFF, BYTES); }

  static size_t indexOf(uint16_t x, uint16_t y) {
    return size_t(x / 2u) * (Height / 4u) + (Height - 1u - y) / 4u;
  }
  static uint8_t maskOf(uint16_t x, uint16_t y) {
    const unsigned row = (Height - 1u - y) % 4u;
    return uint8_t(1u << (7u - (row * 2u + x % 2u)));
  }
  void setBlack(uint16_t x, uint16_t y, bool black) {
    if (x >= Width || y >= Height) return;
    uint8_t& value = bytes[indexOf(x, y)];
    const uint8_t mask = maskOf(x, y);
    value = black ? uint8_t(value & ~mask) : uint8_t(value | mask);
  }
  bool blackAt(uint16_t x, uint16_t y) const {
    return x < Width && y < Height && !(bytes[indexOf(x, y)] & maskOf(x, y));
  }
};

using St7305Frame = St7305FrameT<400, 300>;
