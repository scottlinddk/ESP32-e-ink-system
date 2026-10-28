#include <cassert>
#include <cstdio>
#include <vector>
#include "epd42_frame.h"

static void put32(std::vector<uint8_t>& b, size_t at, uint32_t value) {
  for (int i = 0; i < 4; ++i) b[at + i] = uint8_t(value >> (8 * i));
}

// Bottom-up 400 x 300 BMP as the backend renders it: black palette entry first.
static std::vector<uint8_t> serverBmp() {
  std::vector<uint8_t> b(62 + 52 * 300, 0);
  b[0] = 'B'; b[1] = 'M';
  put32(b, 2, uint32_t(b.size())); put32(b, 10, 62); put32(b, 14, 40);
  put32(b, 18, 400); put32(b, 22, 300);
  b[26] = 1; b[28] = 1;
  for (int i = 54; i < 58; ++i) b[i] = 0;
  for (int i = 58; i < 62; ++i) b[i] = 255;
  for (size_t i = 62; i < b.size(); ++i) b[i] = 0xFF;  // all white
  return b;
}

int main() {
  static_assert(Epd42Frame::BYTES == 15000 && Epd42Frame::ROW_BYTES == 50, "400x300 at one bit per pixel");
  static Epd42Frame frame;
  for (size_t i = 0; i < Epd42Frame::BYTES; ++i) assert(frame.bytes[i] == 0xFF);  // all white

  // MSB is the leftmost pixel; rows are 50 bytes apart.
  frame.setBlack(0, 0, true);
  assert(frame.bytes[0] == 0x7F && frame.blackAt(0, 0) && !frame.blackAt(1, 0));
  frame.setBlack(7, 0, true);
  assert(frame.bytes[0] == 0x7E);
  frame.setBlack(8, 0, true);
  assert(frame.bytes[1] == 0x7F);
  frame.setBlack(0, 1, true);
  assert(frame.bytes[50] == 0x7F);
  frame.setBlack(399, 299, true);
  assert(frame.bytes[14999] == 0xFE && frame.blackAt(399, 299));
  frame.setBlack(0, 0, false);
  assert(frame.bytes[0] == 0xFF - 1 && !frame.blackAt(0, 0));

  // Out-of-range writes must neither wrap nor corrupt neighbours.
  frame.clear();
  frame.setBlack(400, 0, true);
  frame.setBlack(0, 300, true);
  frame.setBlack(65535, 65535, true);
  for (size_t i = 0; i < Epd42Frame::BYTES; ++i) assert(frame.bytes[i] == 0xFF);
  assert(!frame.blackAt(400, 0) && !frame.blackAt(0, 300));

  // A GFXcanvas1 buffer has set bits where it drew, the inverse of this frame.
  std::vector<uint8_t> canvas(Epd42Frame::BYTES, 0);
  canvas[0] = 0x80;
  canvas[14999] = 0x01;
  frame.loadInverted(canvas.data());
  assert(frame.blackAt(0, 0) && frame.blackAt(399, 299) && !frame.blackAt(1, 0));
  assert(frame.bytes[1] == 0xFF);

  // Server BMP: bottom-up, so the last stored row is the top visible row.
  auto bmp = serverBmp();
  bmp[62 + 299 * 52] = 0x7F;      // top-left pixel black
  bmp[62 + 0 * 52 + 49] = 0xFE;   // bottom-right pixel black
  MonochromeBitmap parsed;
  assert(parsed.parse(bmp.data(), bmp.size(), 400, 300));
  frame.load(parsed);
  assert(frame.bytes[0] == 0x7F && frame.bytes[14999] == 0xFE);
  size_t black = 0;
  for (uint16_t y = 0; y < 300; ++y) for (uint16_t x = 0; x < 400; ++x) black += frame.blackAt(x, y);
  assert(black == 2);
  puts("Epd42Frame bit order, bounds, canvas inversion and BMP loading checks passed");
}
