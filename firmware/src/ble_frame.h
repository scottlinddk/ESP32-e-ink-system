#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

// Manual BLE protocol v1: 250x122, MSB-first, white=1, 32 bytes per row.
// A complete frame becomes a top-down BMP for the existing validated renderer.
class BleFrame {
public:
  static constexpr size_t PIXEL_BYTES = 32 * 122;
  static constexpr size_t BMP_BYTES = 62 + PIXEL_BYTES;
  uint8_t bitmap[BMP_BYTES] = {};
  bool ready = false;

  BleFrame() {
    bitmap[0] = 'B'; bitmap[1] = 'M';
    put32(2, BMP_BYTES); put32(10, 62); put32(14, 40);
    put32(18, 250); put32(22, uint32_t(-122));
    bitmap[26] = 1; bitmap[28] = 1;
    bitmap[58] = bitmap[59] = bitmap[60] = 255;
  }
  void reset() { active = false; ready = false; received = 0; }
  void expire(uint32_t now) {
    if (active && uint32_t(now - lastWrite) >= 30000) reset();
  }
  bool accept(const uint8_t* frame, size_t length, uint32_t now) {
    expire(now);
    if (!frame || length < 2 || length > 20 || frame[0] != 0 || ready) return reject();
    const uint8_t command = frame[1];
    if (command == 0x70 && length == 2) {
      reset(); active = true; lastWrite = now; return true;
    }
    if (!active) return reject();
    if (command == 0x71 && length > 2 && length - 2 <= PIXEL_BYTES - received) {
      memcpy(bitmap + 62 + received, frame + 2, length - 2);
      received += length - 2; lastWrite = now; return true;
    }
    if (command == 0x72 && length == 3 && frame[2] == 0 && received == PIXEL_BYTES) {
      ready = true; active = false; return true;
    }
    return reject();
  }
private:
  size_t received = 0;
  uint32_t lastWrite = 0;
  bool active = false;
  bool reject() { reset(); return false; }
  void put32(size_t at, uint32_t value) {
    for (unsigned i = 0; i < 4; ++i) bitmap[at + i] = uint8_t(value >> (8 * i));
  }
};
