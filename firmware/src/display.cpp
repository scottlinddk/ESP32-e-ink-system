#include "display.h"
#include "config.h"

#if DEBUG_ENABLED
#define LOG_D(fmt, ...) Serial.printf("[Display] " fmt "\n", ##__VA_ARGS__)
#else
#define LOG_D(fmt, ...)
#endif

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
      display->setFont();  // default font
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
    
    // Main content (switch based on display mode or data priority)
    layoutEnergyPrices(data);
    
    // Status bar at bottom
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

// ============================================================================
// Helper Functions
// ============================================================================

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

// ============================================================================
// Layout Functions
// ============================================================================

void DisplayManager::layoutEnergyPrices(const DisplayData& data) {
  // Title
  display->setFont(&FreeMonoBold9pt7b);
  drawCenteredText("Current Price", 15);
  
  // Main price (large)
  display->setFont(&FreeSerif9pt7b);
  char priceStr[32];
  snprintf(priceStr, sizeof(priceStr), "%.2f %s", data.energy.price, data.energy.unit);
  drawCenteredText(priceStr, 40);
  
  // Range
  display->setFont();
  char rangeStr[64];
  snprintf(rangeStr, sizeof(rangeStr), "Min: %.2f Max: %.2f", data.energy.priceMin, data.energy.priceMax);
  drawCenteredText(rangeStr, 55);
  
  // Weather info (secondary)
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
  // Simple text wrapping (simplified - in production use better text wrapping)
  drawCenteredText(data.news.headline, 40);
  drawCenteredText(data.news.source, 60);
}

void DisplayManager::layoutStatusBar(const DisplayData& data) {
  // Draw separator line
  drawLine(0, 110, 250, 110);
  
  display->setFont();
  
  // Battery
  char batteryStr[16];
  snprintf(batteryStr, sizeof(batteryStr), "🔋 %d%%", data.status.batteryPercent);
  drawLeftText(batteryStr, 5, 120);
  
  // Signal
  char signalStr[16];
  snprintf(signalStr, sizeof(signalStr), "📶 %d dBm", data.status.signalStrength);
  drawCenteredText(signalStr, 120);
  
  // Time (future: add actual time display)
  drawRightText("E-Ink", 245, 120);
}
