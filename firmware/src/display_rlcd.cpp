// ============================================================================
// WAVESHARE ESP32-S3-RLCD-4.2 path: ST7305 reflective LCD, 400 x 300.
// Status screens are drawn with Adafruit GFX; server frames go straight into
// the controller's 2 x 4 block layout (st7305_frame.h).
// ============================================================================
#ifdef WAVESHARE_RLCD_42
#include "display.h"
#include "config.h"
#include "bitmap.h"
#include <Fonts/FreeSans9pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <esp_sleep.h>

#if DEBUG_ENABLED
#define LOG_D(fmt, ...) Serial.printf("[Display] " fmt "\n", ##__VA_ARGS__)
#else
#define LOG_D(fmt, ...)
#endif

static_assert(kBoard.width == 400 && kBoard.height == 300, "ST7305 frame layout is 400 x 300");

namespace {
St7305Frame frame;
// Set after a full init; RTC memory survives deep sleep but not power-on or EN reset.
RTC_DATA_ATTR bool panelInitialized = false;
}

DisplayManager::DisplayManager() {}

void DisplayManager::begin() {
  // A timer or button wake must not reset the controller: its RAM holds the
  // frame the device is about to compare against (304 Not Modified).
  if (panelInitialized && esp_sleep_get_wakeup_cause() != ESP_SLEEP_WAKEUP_UNDEFINED) {
    panel.resume();
    LOG_D("ST7305 resumed after deep sleep; previous image retained");
    return;
  }
  panel.begin();
  frame.clear();
  panel.write(frame);
  panelInitialized = true;
  LOG_D("ST7305 RLCD initialized: %u x %u", unsigned(kBoard.width), unsigned(kBoard.height));
}

void DisplayManager::sleep() { panel.idle(); }

void DisplayManager::clear() {
  frame.clear();
  panel.write(frame);
  LOG_D("Display cleared");
}

bool DisplayManager::flushCanvas() {
  if (!canvas.getBuffer()) {
    LOG_D("Text canvas allocation failed");
    return false;
  }
  for (uint16_t y = 0; y < kBoard.height; ++y)
    for (uint16_t x = 0; x < kBoard.width; ++x)
      frame.setBlack(x, y, canvas.getPixel(x, y));
  panel.write(frame);
  return true;
}

// Centers each '\n'-separated line, wrapping words that exceed the width.
void DisplayManager::drawCenteredLines(const char* text, int16_t top, const GFXfont* font) {
  if (!text) return;
  canvas.setFont(font);
  canvas.setTextColor(1);
  canvas.setTextWrap(false);
  const int16_t lineHeight = font->yAdvance;
  const int16_t maxWidth = kBoard.width - 24;
  int16_t baseline = top + lineHeight;
  char line[96];
  size_t length = 0;
  auto widthOf = [&](const char* value) {
    int16_t x1, y1;
    uint16_t w, h;
    canvas.getTextBounds(value, 0, 0, &x1, &y1, &w, &h);
    return int16_t(w);
  };
  auto emit = [&]() {
    line[length] = '\0';
    if (baseline <= kBoard.height) {
      canvas.setCursor((kBoard.width - widthOf(line)) / 2, baseline);
      canvas.print(line);
    }
    baseline += lineHeight;
    length = 0;
  };
  while (*text) {
    if (*text == '\n') { emit(); ++text; continue; }
    // Next word plus its leading space, if the line already has content.
    const char* end = text;
    while (*end && *end != ' ' && *end != '\n') ++end;
    const size_t word = size_t(end - text);
    char candidate[sizeof(line)];
    const size_t prefix = length ? length + 1 : 0;
    if (prefix + word < sizeof(candidate)) {
      memcpy(candidate, line, length);
      if (length) candidate[length] = ' ';
      memcpy(candidate + prefix, text, word);
      candidate[prefix + word] = '\0';
      if (length && widthOf(candidate) > maxWidth) {
        emit();
        continue;  // Retry the word on a fresh line.
      }
      memcpy(line, candidate, prefix + word + 1);
      length = prefix + word;
    } else if (length) {
      emit();
      continue;
    } else {
      // A single overlong word: truncate it to the line buffer.
      length = sizeof(line) - 1;
      memcpy(line, text, length);
    }
    text = end;
    while (*text == ' ') ++text;
  }
  if (length) emit();
}

void DisplayManager::showLoading(const char* message) {
  canvas.fillScreen(0);
  drawCenteredLines("Loading...", 70, &FreeSansBold12pt7b);
  drawCenteredLines(message, 120, &FreeSans9pt7b);
  const bool shown = flushCanvas();
  LOG_D("Loading screen %s: %s", shown ? "written" : "failed", message ? message : "");
}

void DisplayManager::showError(const char* title, const char* message) {
  canvas.fillScreen(0);
  drawCenteredLines(title, 60, &FreeSansBold12pt7b);
  drawCenteredLines(message, 110, &FreeSans9pt7b);
  const bool shown = flushCanvas();
  LOG_D("Error screen %s: %s - %s", shown ? "written" : "failed", title ? title : "", message ? message : "");
}

void DisplayManager::showData(const DisplayData& data) {
  canvas.fillScreen(0);
  char text[96];
  drawCenteredLines("Current Price", 30, &FreeSansBold12pt7b);
  snprintf(text, sizeof(text), "%.2f %s", data.energy.price, data.energy.unit ? data.energy.unit : "");
  drawCenteredLines(text, 80, &FreeSansBold12pt7b);
  snprintf(text, sizeof(text), "Min %.2f  Max %.2f", data.energy.priceMin, data.energy.priceMax);
  drawCenteredLines(text, 130, &FreeSans9pt7b);
  snprintf(text, sizeof(text), "%.1f C %s", data.weather.temp, data.weather.description ? data.weather.description : "");
  drawCenteredLines(text, 160, &FreeSans9pt7b);
  canvas.drawFastHLine(0, kBoard.height - 30, kBoard.width, 1);
  snprintf(text, sizeof(text), "Battery %d%%   %d dBm", data.status.batteryPercent, data.status.signalStrength);
  drawCenteredLines(text, kBoard.height - 30, &FreeSans9pt7b);
  flushCanvas();
}

void DisplayManager::showTestPattern() {
  canvas.fillScreen(0);
  canvas.drawRect(0, 0, kBoard.width, kBoard.height, 1);
  for (int16_t x = 0; x < 64; x += 8) canvas.fillRect(16 + x, 16, 4, 4, 1);  // pixel alignment
  drawCenteredLines("ESP32 Display\nTest Pattern\n400x300 ST7305 RLCD\nStatus: OK", 60, &FreeSansBold12pt7b);
  flushCanvas();
}

bool DisplayManager::showBitmap(const uint8_t* bmpData, size_t len) {
  MonochromeBitmap bitmap;
  if (!bitmap.parse(bmpData, len, kBoard.width, kBoard.height)) {
    LOG_D("Invalid BMP: expected uncompressed %ux%u 1-bit image", unsigned(kBoard.width), unsigned(kBoard.height));
    return false;
  }
  for (uint16_t y = 0; y < bitmap.height; ++y)
    for (uint16_t x = 0; x < bitmap.width; ++x)
      frame.setBlack(x, y, bitmap.blackAt(x, y));
  panel.write(frame);
  return true;
}

#endif // WAVESHARE_RLCD_42
