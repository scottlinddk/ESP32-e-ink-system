#pragma once
#include <Arduino.h>
#include <SPI.h>

// ── Elecrow CrowPanel 2.13" E-Paper — SSD1680/JD79661 driver ─────────────────
// Default pins match the Elecrow CrowPanel 2.13" board.  Override any of these
// by defining them before including this header (e.g. in config.h or via
// PlatformIO build_flags: -D PIN_CS=14).

#ifndef PIN_CS
#define PIN_CS   14
#endif
#ifndef PIN_DC
#define PIN_DC   13
#endif
#ifndef PIN_RST
#define PIN_RST  10
#endif
#ifndef PIN_BUSY
#define PIN_BUSY  9
#endif
#ifndef PIN_MOSI
#define PIN_MOSI 11
#endif
#ifndef PIN_CLK
#define PIN_CLK  12
#endif
#ifndef PIN_MISO
#define PIN_MISO -1
#endif

#ifndef EPD_W
#define EPD_W 250
#endif
#ifndef EPD_H
#define EPD_H 122
#endif

#define ROTATE_0   0
#define ROTATE_90  1
#define ROTATE_180 2
#define ROTATE_270 3

// Color constants are defined in GUI_Paint.h; include it to get WHITE/BLACK.
#include "GUI_Paint.h"

void EPD_7IN5_Init(void);
void EPD_7IN5_Display(void);
void EPD_7IN5_Clear(void);
void EPD_7IN5_Sleep(void);
