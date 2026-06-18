#pragma once

#ifdef ELECROW_EPAPER_213
// Elecrow CrowPanel ESP32 2.13" — uses bundled C-style EPD library
// Source: firmware/lib/EPD/ (copy from Elecrow GitHub repo factory_sourcecode)
extern "C" {
  #include "EPD.h"       // EPD_GPIOInit, EPD_Init, EPD_Display, EPD_Update, etc.
  #include "GUI_Paint.h" // Paint_NewImage, Paint_Clear, Paint_DrawString_EN, Font8/12/16/20/24, etc.
}
#else
// Waveshare 2.13" e-Paper HAT V2 — uses GxEPD2 (Arduino library)
#include <GxEPD2_BW.h>
#include <Fonts/FreeMonoBold9pt7b.h>
#include <Fonts/FreeSerif9pt7b.h>
#endif

struct DisplayData {
  // Energy prices
  struct {
    float price;
    const char* unit;
    float priceMin;
    float priceMax;
  } energy;
  
  // Weather
  struct {
    float temp;
    float feelsLike;
    const char* description;
    float humidity;
    float windSpeed;
  } weather;
  
  // News
  struct {
    const char* headline;
    const char* source;
  } news;
  
  // System status
  struct {
    int batteryPercent;
    int signalStrength;  // RSSI in dBm
    uint32_t lastUpdate; // Unix timestamp
  } status;
};

class DisplayManager {
public:
  DisplayManager();
  
  // Initialize display (call once on startup)
  void begin();
  
  // Display error message
  void showError(const char* title, const char* message);
  
  // Display loading screen
  void showLoading(const char* message);
  
  // Display data (energy, weather, news)
  void showData(const DisplayData& data);
  
  // Display test pattern (for debugging)
  void showTestPattern();

  // Display a server-rendered 1-bit BMP from memory buffer
  void showBitmap(const uint8_t* bmpData, size_t len);

  // Clear display
  void clear();
  
  // Get display width and height
  uint16_t getWidth() { return 250; }
  uint16_t getHeight() { return 122; }

private:
#ifdef ELECROW_EPAPER_213
  // 250 wide × 122 tall, 1 bpp: ceil(250/8)=32 bytes/row × 122 rows
  static const int EPD_BUF_SIZE = 32 * 122;
  uint8_t _imgBuf[EPD_BUF_SIZE];

  void elecrowFlush();
  void drawText(uint16_t x, uint16_t y, const char* text, sFONT* font);
  void drawCenteredText(uint16_t y, const char* text, sFONT* font);
  void drawLine(uint16_t x0, uint16_t y0, uint16_t x1, uint16_t y1);
  void layoutEnergyPrices(const DisplayData& data);
  void layoutStatusBar(const DisplayData& data);
#else
  GxEPD2_BW<GxEPD2_213_BN, GxEPD2_213_BN::HEIGHT>* display;

  void drawCenteredText(const char* text, int16_t y, const GFXfont* font = nullptr);
  void drawLeftText(const char* text, int16_t x, int16_t y, const GFXfont* font = nullptr);
  void drawRightText(const char* text, int16_t x, int16_t y, const GFXfont* font = nullptr);
  void drawBox(int16_t x, int16_t y, int16_t w, int16_t h);
  void drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1);
  void layoutEnergyPrices(const DisplayData& data);
  void layoutWeather(const DisplayData& data);
  void layoutNews(const DisplayData& data);
  void layoutStatusBar(const DisplayData& data);
#endif
};
