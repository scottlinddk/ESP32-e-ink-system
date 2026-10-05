#include <assert.h>
#include <stdio.h>
#include <vector>
#include "ble_frame.h"
#include "bitmap.h"

// Larger panels: client rows are ceil(width/8) bytes, BMP rows are padded to 4.
template <uint16_t W, uint16_t H>
void checkPaddedFrame() {
  using Frame = BleFrameT<W, H>;
  static_assert(Frame::ROW_BYTES == (W + 7) / 8, "client row size");
  static_assert(Frame::STRIDE % 4 == 0 && Frame::STRIDE >= Frame::ROW_BYTES, "BMP stride");
  Frame frame;
  const uint8_t start[] = {0, 0x70}, end[] = {0, 0x72, 0};
  assert(frame.accept(start, sizeof(start), 0));
  std::vector<uint8_t> pixels(Frame::PIXEL_BYTES, 255);
  pixels[0] = 0x7f;                                        // (0, 0)
  pixels[Frame::ROW_BYTES - 1] &= uint8_t(~(0x80 >> ((W - 1) % 8)));  // (W-1, 0)
  pixels[Frame::ROW_BYTES] = 0x7f;                         // (0, 1): the row after padding
  pixels[(H - 1) * Frame::ROW_BYTES + (W - 1) / 8] &= uint8_t(~(0x80 >> ((W - 1) % 8)));  // (W-1, H-1)
  for (size_t offset = 0; offset < pixels.size(); offset += 18) {
    const size_t size = pixels.size() - offset < 18 ? pixels.size() - offset : 18;
    std::vector<uint8_t> chunk{0, 0x71};
    chunk.insert(chunk.end(), pixels.begin() + offset, pixels.begin() + offset + size);
    assert(frame.accept(chunk.data(), chunk.size(), 1));
  }
  assert(frame.accept(end, sizeof(end), 2) && frame.ready);
  MonochromeBitmap bmp;
  assert(bmp.parse(frame.bitmap, sizeof(frame.bitmap), W, H));
  assert(bmp.blackAt(0, 0) && !bmp.blackAt(1, 0) && bmp.blackAt(W - 1, 0) && !bmp.blackAt(W - 2, 0));
  assert(bmp.blackAt(0, 1) && !bmp.blackAt(1, 1) && !bmp.blackAt(0, 2));
  assert(bmp.blackAt(W - 1, H - 1) && !bmp.blackAt(W - 2, H - 1));
}

int main() {
  static_assert(BleFrame::PIXEL_BYTES == 32 * 122 && BleFrame::BMP_BYTES == 62 + 32 * 122,
                "2.13-inch BLE frame size is unchanged");
  checkPaddedFrame<400, 300>();
  checkPaddedFrame<792, 272>();
  BleFrame frame;
  const uint8_t start[] = {0, 0x70}, end[] = {0, 0x72, 0}, data[] = {0, 0x71, 255};
  assert(!frame.accept(data, sizeof(data), 0));
  assert(frame.accept(start, sizeof(start), 0));
  assert(!frame.accept(end, sizeof(end), 0)); // incomplete frame never refreshes
  assert(frame.accept(start, sizeof(start), 0));
  assert(!frame.accept(data, sizeof(data), 30000)); // expiry, including exact bound
  assert(frame.accept(start, sizeof(start), UINT32_MAX - 10));
  assert(frame.accept(data, sizeof(data), 10)); // millis wrap remains safe
  frame.reset(); // disconnect cancels a partial frame
  assert(!frame.accept(data, sizeof(data), 11));
  assert(frame.accept(start, sizeof(start), 0));
  std::vector<uint8_t> pixels(BleFrame::PIXEL_BYTES, 255);
  pixels[0] = 0x7f; pixels[121 * 32 + 31] = 0xbf; // two corners, plus row padding
  size_t offset = 0;
  while (offset < pixels.size()) {
    size_t size = pixels.size() - offset; if (size > 18) size = 18;
    std::vector<uint8_t> chunk{0, 0x71};
    chunk.insert(chunk.end(), pixels.begin() + offset, pixels.begin() + offset + size);
    assert(frame.accept(chunk.data(), chunk.size(), uint32_t(offset)));
    assert(!frame.ready); offset += size;
  }
  assert(frame.accept(end, sizeof(end), 4000) && frame.ready);
  MonochromeBitmap bmp;
  assert(bmp.parse(frame.bitmap, sizeof(frame.bitmap), 250, 122));
  assert(bmp.topDown && bmp.blackAt(0, 0) && !bmp.blackAt(1, 0));
  assert(bmp.blackAt(249, 121) && !bmp.blackAt(248, 121));
  assert(!frame.accept(data, sizeof(data), 4001) && !frame.ready);
  assert(frame.accept(start, sizeof(start), 0));
  for (size_t i = 0; i < pixels.size(); ++i) assert(frame.accept(data, sizeof(data), 1));
  assert(!frame.accept(data, sizeof(data), 2)); // overflow invalidates upload
  assert(!frame.accept(end, sizeof(end), 3));
  uint8_t oversized[21] = {0, 0x71};
  assert(frame.accept(start, sizeof(start), 0));
  assert(!frame.accept(oversized, sizeof(oversized), 0));
  assert(!frame.accept(nullptr, 0, 0));
  puts("Manual BLE complete frame, orientation, chunk bounds, disconnect and deadline checks passed");
}
