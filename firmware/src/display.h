#pragma once
#include "config.h"
#include "board_profile.h"

#if defined(WAVESHARE_RLCD_42)
// Waveshare ESP32-S3-RLCD-4.2: ST7305 reflective LCD, Adafruit GFX canvas for text
#include <Adafruit_GFX.h>
#include "st7305_panel.h"
#elif defined(ELECROW_EPAPER_213)
// Elecrow CrowPanel ESP32 2.13" — uses bundled EPD library
// Source: firmware/lib/EPD/ (bundled, no extra driver download required)
#include "EPD.h"
#include "GUI_Paint.h"
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
  bool showBitmap(const uint8_t* bmpData, size_t len);
  void sleep();

  // Clear display
  void clear();
  
  // Native panel width and height
  uint16_t getWidth() { return kBoard.width; }
  uint16_t getHeight() { return kBoard.height; }

private:
#if defined(WAVESHARE_RLCD_42)
  St7305Panel panel;
  GFXcanvas1 canvas{kBoard.width, kBoard.height};
  bool flushCanvas();
  void drawCenteredLines(const char* text, int16_t top, const GFXfont* font);
#elif defined(ELECROW_EPAPER_213)
  bool elecrowFlush();
  void drawText(uint16_t x, uint16_t y, const char* text, sFONT* font);
  void drawCenteredText(uint16_t y, const char* text, sFONT* font);
  void drawLine(uint16_t x0, uint16_t y0, uint16_t x1, uint16_t y1);
  void layoutEnergyPrices(const DisplayData& data);
  void layoutStatusBar(const DisplayData& data);
#else
  GxEPD2_BW<GxEPD2_213_B73, GxEPD2_213_B73::HEIGHT>* display;

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
