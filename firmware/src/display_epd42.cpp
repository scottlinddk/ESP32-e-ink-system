// ============================================================================
// ELECROW CrowPanel ESP32 4.2" path: 400 x 300 e-paper, full refresh only.
// Status screens are drawn with Adafruit GFX; server frames go straight into
// the controller frame buffer. The controller revision is chosen by the
// PlatformIO environment (see epd42_panel.h).
// ============================================================================
#ifdef ELECROW_EPAPER_42
#include "display.h"
#include "config.h"
#include "bitmap.h"
#include "gfx_text.h"
#include <Fonts/FreeSans9pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>

#if DEBUG_ENABLED
#define LOG_D(fmt, ...) Serial.printf("[Display] " fmt "\n", ##__VA_ARGS__)
#else
#define LOG_D(fmt, ...)
#endif

static_assert(kBoard.width == Epd42Frame::WIDTH && kBoard.height == Epd42Frame::HEIGHT,
              "Epd42Frame must match the selected board profile");

namespace {
Epd42Frame frame;
constexpr int16_t kTextMargin = 24;
}

DisplayManager::DisplayManager() {}

void DisplayManager::begin() {
  // The controller is configured without a refresh, so the retained image
  // stays on the panel until the next frame replaces it.
  const bool ready = panel.begin();
  LOG_D("CrowPanel 4.2\" %s: %u x %u; panel refresh not yet verified",
    ready ? "controller configured" : "controller unavailable", unsigned(kBoard.width), unsigned(kBoard.height));
}

void DisplayManager::sleep() { panel.sleep(); }

void DisplayManager::clear() {
  frame.clear();
  const bool refreshed = panel.write(frame);
  LOG_D("Clear screen %s", refreshed ? "controller cycle completed" : "refresh failed");
}

bool DisplayManager::flushCanvas() {
  if (!canvas.getBuffer()) {
    LOG_D("Text canvas allocation failed");
    return false;
  }
  frame.loadInverted(canvas.getBuffer());
  const bool refreshed = panel.write(frame);
  LOG_D("Screen %s", refreshed ? "controller cycle completed" : "refresh failed");
  return refreshed;
}

void DisplayManager::drawCenteredLines(const char* text, int16_t top, const GFXfont* font) {
  ::drawCenteredLines(canvas, text, top, font, kBoard.width - kTextMargin);
}

void DisplayManager::showLoading(const char* message) {
  canvas.fillScreen(0);
  drawCenteredLines("Loading...", 70, &FreeSansBold12pt7b);
  drawCenteredLines(message, 120, &FreeSans9pt7b);
  flushCanvas();
}

void DisplayManager::showError(const char* title, const char* message) {
  canvas.fillScreen(0);
  drawCenteredLines(title, 60, &FreeSansBold12pt7b);
  drawCenteredLines(message, 110, &FreeSans9pt7b);
  flushCanvas();
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
  drawCenteredLines("ESP32 Display\nTest Pattern\n400x300 CrowPanel e-paper\nStatus: OK", 60, &FreeSansBold12pt7b);
  flushCanvas();
}

bool DisplayManager::showBitmap(const uint8_t* bmpData, size_t len) {
  MonochromeBitmap bitmap;
  if (!bitmap.parse(bmpData, len, kBoard.width, kBoard.height)) {
    LOG_D("Invalid BMP: expected uncompressed %ux%u 1-bit image", unsigned(kBoard.width), unsigned(kBoard.height));
    return false;
  }
  frame.load(bitmap);
  return panel.write(frame);
}

#endif // ELECROW_EPAPER_42
