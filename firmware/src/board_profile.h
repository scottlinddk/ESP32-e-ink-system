#pragma once
#include <stddef.h>
#include <stdint.h>

// Compile-time description of the board this image drives. The PlatformIO
// environment selects exactly one profile; every size the protocol, BLE
// receiver and frame buffer use derives from it, never from literals.
// C++11-compatible: the Arduino ESP32 core does not compile as C++17.
struct BoardProfile {
  // Release slug; package_web_firmware.py BOARDS uses the same names.
  const char* id;
  const char* name;
  // Native panel pixels. Content rotation happens on the server, so frames
  // always arrive in this orientation whatever rotation the owner chose.
  uint16_t width;
  uint16_t height;
  int setupButton;
  // GPIO0 on classic ESP32 is a boot strap: it can only be read after reset,
  // and must not wake the device from deep sleep.
  bool setupButtonIsBootStrap;

  // Server encoding (X-Display-Row-Bytes) and BLE rows: whole bytes, unpadded.
  constexpr size_t rowBytes() const { return (width + 7u) / 8u; }
  // Windows BMP rows are padded to four bytes.
  constexpr size_t bmpStride() const { return ((width + 31u) / 32u) * 4u; }
  // Header, two-entry palette and pixels, as the backend renders it.
  constexpr size_t bmpBytes() const { return 62u + bmpStride() * height; }
};

#if defined(WAVESHARE_RLCD_42)
// Landscape 400 x 300 is the vendor's normal orientation; KEY (GPIO18) is setup.
constexpr BoardProfile kBoard = {"waveshare-esp32-s3-rlcd-42", "Waveshare ESP32-S3-RLCD-4.2 (ST7305)", 400, 300, 18, false};
#elif defined(ELECROW_EPAPER_213) && defined(ELECROW_PANEL_JD79661)
constexpr BoardProfile kBoard = {"elecrow-crowpanel-213-v12", "Elecrow CrowPanel 2.13\" V1.2 (JD79661)", 250, 122, 2, false};
#elif defined(ELECROW_EPAPER_213)
constexpr BoardProfile kBoard = {"elecrow-crowpanel-213", "Elecrow CrowPanel 2.13\" (SSD1680)", 250, 122, 2, false};
#else
constexpr BoardProfile kBoard = {"waveshare-esp32-213-v2", "Waveshare 2.13\" HAT V2", 250, 122, 0, true};
#endif
