#include "display.h"
#include "config.h"

#if DEBUG_ENABLED
#define LOG_D(fmt, ...) Serial.printf("[Display] " fmt "\n", ##__VA_ARGS__)
#else
#define LOG_D(fmt, ...)
#endif

// ============================================================================
// ELECROW CrowPanel ESP32 2.13" E-Paper path
// Uses bundled C-style EPD library in firmware/lib/EPD/
// Install: copy EPD/ folder from Elecrow GitHub factory_sourcecode into firmware/lib/
// ============================================================================
#ifdef ELECROW_EPAPER_213

// Fallback dimension constants in case the library version omits them
#ifndef EPD_W
#  define EPD_W 250
#endif
#ifndef EPD_H
#  define EPD_H 122
#endif
#ifndef ROTATE_0
#  define ROTATE_0 0
#endif

DisplayManager::DisplayManager() {}

void DisplayManager::begin() {
  EPD_7IN5_Init();
  Paint_NewImage(0, EPD_W, EPD_H, ROTATE_0, WHITE);
  Paint_Clear(WHITE);
  EPD_7IN5_Display();
  LOG_D("Elecrow EPD initialized: %d x %d", EPD_W, EPD_H);
}

void DisplayManager::clear() {
  Paint_Clear(WHITE);
  EPD_7IN5_Display();
  LOG_D("Display cleared");
}

// Flush internal image buffer to display
void DisplayManager::elecrowFlush() {
  EPD_7IN5_Display();
}

void DisplayManager::drawText(uint16_t x, uint16_t y, const char* text, sFONT* font) {
  Paint_DrawString_EN(x, y, text, font, BLACK, WHITE);
}

void DisplayManager::drawCenteredText(uint16_t y, const char* text, sFONT* font) {
  uint16_t textWidth = strlen(text) * font->Width;
  uint16_t x = (EPD_W > textWidth) ? (EPD_W - textWidth) / 2 : 0;
  Paint_DrawString_EN(x, y, text, font, BLACK, WHITE);
}

void DisplayManager::drawLine(uint16_t x0, uint16_t y0, uint16_t x1, uint16_t y1) {
  Paint_DrawLine(x0, y0, x1, y1, BLACK, LINE_STYLE_SOLID, DOT_PIXEL_1X1);
}

void DisplayManager::showLoading(const char* message) {
  Paint_Clear(WHITE);
  drawCenteredText(30, "Loading...", &Font16);
  if (message) {
    drawCenteredText(55, message, &Font12);
  }
  elecrowFlush();
  LOG_D("Loading screen: %s", message ? message : "");
}

void DisplayManager::showError(const char* title, const char* message) {
  Paint_Clear(WHITE);
  drawCenteredText(20, title, &Font16);
  if (message) {
    drawCenteredText(50, message, &Font12);
  }
  elecrowFlush();
  LOG_D("Error: %s - %s", title, message ? message : "");
}

void DisplayManager::showData(const DisplayData& data) {
  Paint_Clear(WHITE);
  layoutEnergyPrices(data);
  layoutStatusBar(data);
  elecrowFlush();
  LOG_D("Data displayed - Energy: %.2f, Temp: %.1f", data.energy.price, data.weather.temp);
}

void DisplayManager::showTestPattern() {
  Paint_Clear(WHITE);
  drawCenteredText(5,  "ESP32 E-Ink Display", &Font12);
  drawCenteredText(22, "Test Pattern", &Font12);
  drawCenteredText(38, "250x122 (Elecrow 2.13\")", &Font8);
  drawCenteredText(52, "Status: OK", &Font12);
  drawLine(0, 70, EPD_W, 70);
  drawCenteredText(76, "Press reset to continue", &Font8);
  elecrowFlush();
  LOG_D("Test pattern displayed");
}

void DisplayManager::showBitmap(const uint8_t* bmpData, size_t len) {
  if (!bmpData || len < 62) {
    showError("Bitmap Error", "Invalid BMP data");
    return;
  }

  uint32_t pixelOffset = (uint32_t)bmpData[10]
                       | ((uint32_t)bmpData[11] << 8)
                       | ((uint32_t)bmpData[12] << 16)
                       | ((uint32_t)bmpData[13] << 24);

  int32_t bmpWidth  = (int32_t)bmpData[18] | ((int32_t)bmpData[19] << 8)
                    | ((int32_t)bmpData[20] << 16) | ((int32_t)bmpData[21] << 24);
  int32_t bmpHeight = (int32_t)bmpData[22] | ((int32_t)bmpData[23] << 8)
                    | ((int32_t)bmpData[24] << 16) | ((int32_t)bmpData[25] << 24);
  uint16_t bitCount = (uint16_t)bmpData[28] | ((uint16_t)bmpData[29] << 8);

  if (bitCount != 1) {
    showError("Bitmap Error", "Only 1-bit BMP");
    return;
  }

  bool topDown = (bmpHeight < 0);
  int32_t rows = topDown ? -bmpHeight : bmpHeight;
  int32_t cols = bmpWidth;
  int32_t rowStride = ((cols + 31) / 32) * 4;

  if (pixelOffset + (size_t)(rowStride * rows) > len) {
    showError("Bitmap Error", "BMP truncated");
    return;
  }

  int32_t drawW = (cols < EPD_W) ? cols : EPD_W;
  int32_t drawH = (rows < EPD_H) ? rows : EPD_H;

  Paint_Clear(WHITE);
  for (int32_t row = 0; row < drawH; row++) {
    int32_t srcRow = topDown ? row : (rows - 1 - row);
    const uint8_t* rowPtr = bmpData + pixelOffset + srcRow * rowStride;
    for (int32_t col = 0; col < drawW; col++) {
      bool isBlack = !((rowPtr[col / 8] >> (7 - (col % 8))) & 1);
      if (isBlack) Paint_DrawPixel(col, row, BLACK);
    }
  }
  elecrowFlush();
  LOG_D("Bitmap displayed: %dx%d", (int)drawW, (int)drawH);
}

void DisplayManager::layoutEnergyPrices(const DisplayData& data) {
  drawCenteredText(2, "Current Price", &Font16);

  char priceStr[32];
  snprintf(priceStr, sizeof(priceStr), "%.2f %s", data.energy.price, data.energy.unit);
  drawCenteredText(24, priceStr, &Font16);

  char rangeStr[48];
  snprintf(rangeStr, sizeof(rangeStr), "Min:%.2f Max:%.2f", data.energy.priceMin, data.energy.priceMax);
  drawCenteredText(46, rangeStr, &Font12);

  char weatherStr[48];
  snprintf(weatherStr, sizeof(weatherStr), "%.1fC %s", data.weather.temp, data.weather.description);
  drawCenteredText(62, weatherStr, &Font12);
}

void DisplayManager::layoutStatusBar(const DisplayData& data) {
  drawLine(0, 104, EPD_W, 104);

  char batStr[16];
  snprintf(batStr, sizeof(batStr), "Bat:%d%%", data.status.batteryPercent);
  Paint_DrawString_EN(4, 108, batStr, &Font8, BLACK, WHITE);

  char sigStr[16];
  snprintf(sigStr, sizeof(sigStr), "%ddBm", data.status.signalStrength);
  Paint_DrawString_EN(EPD_W - 52, 108, sigStr, &Font8, BLACK, WHITE);
}

#else

// ============================================================================
// WAVESHARE 2.13" e-Paper HAT V2 path — uses GxEPD2 (Arduino library)
// ============================================================================

DisplayManager::DisplayManager() {
  display = new GxEPD2_BW<GxEPD2_213_BN, GxEPD2_213_BN::HEIGHT>(
    GxEPD2_213_BN(PIN_CS, PIN_DC, PIN_RST, PIN_BUSY)
  );
}

void DisplayManager::begin() {
  display->init(115200);
  LOG_D("Display initialized: %d x %d", display->width(), display->height());
}

void DisplayManager::clear() {
  display->clearScreen();
  LOG_D("Display cleared");
}

void DisplayManager::showLoading(const char* message) {
  display->setFullWindow();
  display->firstPage();
  do {
    display->fillScreen(GxEPD_WHITE);
    display->setTextColor(GxEPD_BLACK);
    display->setFont(&FreeSerif9pt7b);
    drawCenteredText("Loading...", 30);
    if (message) {
      display->setFont();
      drawCenteredText(message, 60);
    }
  } while (display->nextPage());
  LOG_D("Loading screen displayed: %s", message ? message : "");
}

void DisplayManager::showError(const char* title, const char* message) {
  display->setFullWindow();
  display->firstPage();
  do {
    display->fillScreen(GxEPD_WHITE);
    display->setTextColor(GxEPD_BLACK);
    display->setFont(&FreeMonoBold9pt7b);
    drawCenteredText(title, 20);
    display->setFont();
    drawCenteredText(message, 55);
  } while (display->nextPage());
  LOG_D("Error screen displayed: %s - %s", title, message);
}

void DisplayManager::showData(const DisplayData& data) {
  display->setFullWindow();
  display->firstPage();
  do {
    display->fillScreen(GxEPD_WHITE);
    display->setTextColor(GxEPD_BLACK);
    layoutEnergyPrices(data);
    layoutStatusBar(data);
  } while (display->nextPage());
  LOG_D("Data displayed - Energy: %.2f %s, Temp: %.1f°C",
        data.energy.price, data.energy.unit, data.weather.temp);
}

void DisplayManager::showTestPattern() {
  display->setFullWindow();
  display->firstPage();
  do {
    display->fillScreen(GxEPD_WHITE);
    display->setTextColor(GxEPD_BLACK);
    display->setFont(&FreeMonoBold9pt7b);
    drawCenteredText("ESP32 E-Ink Display", 15);

    display->setFont();
    drawCenteredText("Test Pattern", 40);
    drawCenteredText("Display: 250x122 (Waveshare 2.13\")", 55);
    drawCenteredText("Status: OK", 70);
    drawCenteredText("Press reset to continue", 100);
  } while (display->nextPage());
  LOG_D("Test pattern displayed");
}

void DisplayManager::showBitmap(const uint8_t* bmpData, size_t len) {
  if (!bmpData || len < 62) {
    showError("Bitmap Error", "Invalid BMP data");
    return;
  }

  uint32_t pixelOffset = (uint32_t)bmpData[10]
                       | ((uint32_t)bmpData[11] << 8)
                       | ((uint32_t)bmpData[12] << 16)
                       | ((uint32_t)bmpData[13] << 24);

  int32_t bmpWidth  = (int32_t)bmpData[18] | ((int32_t)bmpData[19] << 8)
                    | ((int32_t)bmpData[20] << 16) | ((int32_t)bmpData[21] << 24);
  int32_t bmpHeight = (int32_t)bmpData[22] | ((int32_t)bmpData[23] << 8)
                    | ((int32_t)bmpData[24] << 16) | ((int32_t)bmpData[25] << 24);
  uint16_t bitCount = (uint16_t)bmpData[28] | ((uint16_t)bmpData[29] << 8);

  if (bitCount != 1) {
    showError("Bitmap Error", "Only 1-bit BMP supported");
    return;
  }

  bool topDown = (bmpHeight < 0);
  int32_t rows = topDown ? -bmpHeight : bmpHeight;
  int32_t cols = bmpWidth;
  int32_t rowStride = ((cols + 31) / 32) * 4;

  if (pixelOffset + (size_t)(rowStride * rows) > len) {
    showError("Bitmap Error", "BMP data truncated");
    return;
  }

  uint16_t dispW = display->width();
  uint16_t dispH = display->height();
  int32_t drawW  = cols < dispW ? cols : dispW;
  int32_t drawH  = rows < dispH ? rows : dispH;

  display->setFullWindow();
  display->firstPage();
  do {
    display->fillScreen(GxEPD_WHITE);
    for (int32_t row = 0; row < drawH; row++) {
      int32_t srcRow = topDown ? row : (rows - 1 - row);
      const uint8_t* rowPtr = bmpData + pixelOffset + srcRow * rowStride;
      for (int32_t col = 0; col < drawW; col++) {
        bool isBlack = !((rowPtr[col / 8] >> (7 - (col % 8))) & 1);
        if (isBlack) display->drawPixel(col, row, GxEPD_BLACK);
      }
    }
  } while (display->nextPage());

  LOG_D("Bitmap displayed: %dx%d (1-bit BMP)", (int)drawW, (int)drawH);
}

// -- Waveshare helpers -------------------------------------------------------

void DisplayManager::drawCenteredText(const char* text, int16_t y, const GFXfont* font) {
  if (font) display->setFont(font);

  int16_t x1, y1;
  uint16_t w, h;
  display->getTextBounds(text, 0, y, &x1, &y1, &w, &h);
  int16_t x = (display->width() - w) / 2;
  display->setCursor(x, y);
  display->println(text);
}

void DisplayManager::drawLeftText(const char* text, int16_t x, int16_t y, const GFXfont* font) {
  if (font) display->setFont(font);
  display->setCursor(x, y);
  display->println(text);
}

void DisplayManager::drawRightText(const char* text, int16_t x, int16_t y, const GFXfont* font) {
  if (font) display->setFont(font);

  int16_t x1, y1;
  uint16_t w, h;
  display->getTextBounds(text, 0, y, &x1, &y1, &w, &h);
  int16_t pos = x - w;
  display->setCursor(pos, y);
  display->println(text);
}

void DisplayManager::drawBox(int16_t x, int16_t y, int16_t w, int16_t h) {
  display->drawRect(x, y, w, h, GxEPD_BLACK);
}

void DisplayManager::drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1) {
  display->drawLine(x0, y0, x1, y1, GxEPD_BLACK);
}

void DisplayManager::layoutEnergyPrices(const DisplayData& data) {
  display->setFont(&FreeMonoBold9pt7b);
  drawCenteredText("Current Price", 15);

  display->setFont(&FreeSerif9pt7b);
  char priceStr[32];
  snprintf(priceStr, sizeof(priceStr), "%.2f %s", data.energy.price, data.energy.unit);
  drawCenteredText(priceStr, 40);

  display->setFont();
  char rangeStr[64];
  snprintf(rangeStr, sizeof(rangeStr), "Min: %.2f Max: %.2f", data.energy.priceMin, data.energy.priceMax);
  drawCenteredText(rangeStr, 55);

  char weatherStr[64];
  snprintf(weatherStr, sizeof(weatherStr), "%.1f°C %s", data.weather.temp, data.weather.description);
  drawCenteredText(weatherStr, 70);
}

void DisplayManager::layoutWeather(const DisplayData& data) {
  display->setFont(&FreeMonoBold9pt7b);
  drawCenteredText("Weather", 15);

  char tempStr[32];
  snprintf(tempStr, sizeof(tempStr), "%.1f°C (feels %.1f°C)", data.weather.temp, data.weather.feelsLike);
  drawCenteredText(tempStr, 40);

  display->setFont();
  drawCenteredText(data.weather.description, 55);

  char detailsStr[64];
  snprintf(detailsStr, sizeof(detailsStr), "Humidity: %.0f%% Wind: %.1f m/s",
           data.weather.humidity, data.weather.windSpeed);
  drawCenteredText(detailsStr, 70);
}

void DisplayManager::layoutNews(const DisplayData& data) {
  display->setFont(&FreeMonoBold9pt7b);
  drawCenteredText("News", 15);

  display->setFont();
  drawCenteredText(data.news.headline, 40);
  drawCenteredText(data.news.source, 60);
}

void DisplayManager::layoutStatusBar(const DisplayData& data) {
  drawLine(0, 110, 250, 110);

  display->setFont();

  char batteryStr[16];
  snprintf(batteryStr, sizeof(batteryStr), "Bat %d%%", data.status.batteryPercent);
  drawLeftText(batteryStr, 5, 120);

  char signalStr[16];
  snprintf(signalStr, sizeof(signalStr), "%d dBm", data.status.signalStrength);
  drawCenteredText(signalStr, 120);

  drawRightText("E-Ink", 245, 120);
}

#endif // ELECROW_EPAPER_213
