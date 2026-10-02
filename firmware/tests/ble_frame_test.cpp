#include <assert.h>
#include <stdio.h>
#include <vector>
#include "ble_frame.h"
#include "bitmap.h"

int main() {
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
