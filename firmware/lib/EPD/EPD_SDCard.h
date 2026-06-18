#pragma once
// SD card support for the Elecrow EPD library, ported to ESP32.
// display.cpp does not use SD card functionality; this file exists for
// completeness and compiles cleanly on ESP32 (no AVR or deprecated SD classes).

#include <Arduino.h>

#ifndef SD_CS_PIN
#define SD_CS_PIN 4   // Override in config.h if needed
#endif

bool  SDCard_Init(void);
bool  SDCard_Read_RGB_7Color(const char *path, uint8_t *buf, uint32_t len);
