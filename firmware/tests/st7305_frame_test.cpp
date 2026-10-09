#include <cassert>
#include <cstdio>
#include <set>
#include "bitmap.h"
#include "ble_frame.h"
#include "st7305_frame.h"

// Reference: Waveshare display_bsp.cpp RLCD_SetLandscapePixel (non-LUT path).
static void reference(uint16_t x, uint16_t y, size_t& index, uint8_t& mask) {
  const uint16_t invY = 300 - 1 - y;
  index = size_t(x / 2) * (300 / 4) + invY / 4;
  mask = uint8_t(1u << (7 - ((invY % 4) * 2 + x % 2)));
}

int main() {
  static_assert(St7305Frame::BYTES == 15000, "400x300 at one bit per pixel");
  static St7305Frame frame;
  for (size_t i = 0; i < St7305Frame::BYTES; ++i) assert(frame.bytes[i] == 0xFF);  // all white

  // Every pixel maps to a distinct bit that matches the vendor formula.
  std::set<std::pair<size_t, uint8_t>> seen;
  for (uint16_t y = 0; y < 300; ++y) {
    for (uint16_t x = 0; x < 400; ++x) {
      size_t index; uint8_t mask;
      reference(x, y, index, mask);
      assert(St7305Frame::indexOf(x, y) == index && St7305Frame::maskOf(x, y) == mask);
      assert(index < St7305Frame::BYTES);
      assert(seen.insert({index, mask}).second);
    }
  }
  assert(seen.size() == 400u * 300u);

  // Known corners: top-left is the last block of column pair 0, bottom-left the first.
  assert(St7305Frame::indexOf(0, 0) == 74 && St7305Frame::maskOf(0, 0) == 0x02);
  assert(St7305Frame::indexOf(0, 299) == 0 && St7305Frame::maskOf(0, 299) == 0x80);
  assert(St7305Frame::indexOf(399, 0) == 199 * 75 + 74 && St7305Frame::maskOf(399, 0) == 0x01);

  frame.setBlack(10, 20, true);
  assert(frame.blackAt(10, 20) && !frame.blackAt(11, 20));
  frame.setBlack(10, 20, false);
  assert(!frame.blackAt(10, 20));
  frame.setBlack(400, 0, true);  // out of range is ignored
  frame.setBlack(0, 300, true);
  for (size_t i = 0; i < St7305Frame::BYTES; ++i) assert(frame.bytes[i] == 0xFF);

  // A server-shaped BMP round-trips into the controller layout pixel for pixel.
  static BleFrameT<400, 300> source;
  const uint8_t start[] = {0, 0x70};
  assert(source.accept(start, sizeof(start), 0));
  for (size_t sent = 0; sent < source.PIXEL_BYTES;) {
    uint8_t packet[20] = {0, 0x71};
    size_t count = 0;
    for (; count < 18 && sent < source.PIXEL_BYTES; ++count, ++sent) {
      const size_t row = sent / source.ROW_BYTES;
      packet[2 + count] = uint8_t((row * 31 + sent * 7) & 0xFF);  // deterministic pattern
    }
    assert(source.accept(packet, 2 + count, 0));
  }
  const uint8_t end[] = {0, 0x72, 0};
  assert(source.accept(end, sizeof(end), 0) && source.ready);
  MonochromeBitmap bitmap;
  assert(bitmap.parse(source.bitmap, source.BMP_BYTES, 400, 300));
  unsigned black = 0;
  for (uint16_t y = 0; y < 300; ++y)
    for (uint16_t x = 0; x < 400; ++x) {
      frame.setBlack(x, y, bitmap.blackAt(x, y));
      black += bitmap.blackAt(x, y);
    }
  assert(black > 0 && black < 400u * 300u);
  for (uint16_t y = 0; y < 300; ++y)
    for (uint16_t x = 0; x < 400; ++x) assert(frame.blackAt(x, y) == bitmap.blackAt(x, y));

  printf("ST7305 frame layout: 400x300 -> %u bytes\n", unsigned(St7305Frame::BYTES));
}
