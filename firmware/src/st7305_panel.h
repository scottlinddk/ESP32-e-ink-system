#pragma once
#ifdef WAVESHARE_RLCD_42
#include <Arduino.h>
#include "st7305_frame.h"

// SPI driver for the Sitronix ST7305 on the Waveshare ESP32-S3-RLCD-4.2.
// The register sequence is Waveshare's own (02_Example/Arduino/08_LVGL_V8_Test
// display_bsp.cpp in waveshareteam/ESP32-S3-RLCD-4.2). A reflective LCD is not
// bistable: the controller keeps refreshing its RAM while it stays powered,
// so the image survives ESP32 deep sleep only if RESET is never pulled low.
class St7305Panel {
public:
  // Full init with a hardware reset; clears the controller RAM.
  void begin();
  // Reattach after deep sleep without a reset, keeping the visible image.
  void resume();
  // Writes the whole frame; the controller shows it on its next scan.
  void write(const St7305Frame& frame);
  // Low-power scan and latched control pins, for deep sleep or idle setup.
  void idle();

private:
  bool idling = false;
  void wake();
  void command(uint8_t value);
  void commandData(uint8_t value, const uint8_t* data, size_t length);
  void releasePins();
};
#endif
