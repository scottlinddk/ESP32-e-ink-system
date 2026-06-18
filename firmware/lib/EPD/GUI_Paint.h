#pragma once
#include <Arduino.h>
#include <stdint.h>
#include "Fonts/fonts.h"

typedef uint32_t UDOUBLE;
typedef uint16_t UWORD;
typedef uint8_t  UBYTE;

// Line/dot style enumerations
typedef enum {
    LINE_STYLE_SOLID = 0,
    LINE_STYLE_DOTTED,
} LINE_STYLE;

typedef enum {
    DOT_PIXEL_1X1 = 1,
    DOT_PIXEL_2X2,
    DOT_PIXEL_3X3,
} DOT_PIXEL;

typedef enum {
    DRAW_FILL_EMPTY = 0,
    DRAW_FILL_FULL,
} DRAW_FILL;

// ── Paint API ─────────────────────────────────────────────────────────────────
// Note: Paint_DrawPixel is NOT static — it is called from display.cpp via the
// public API.  The original AVR library declared it static in the .cpp which
// caused an "extern … later 'static'" conflict; that is fixed here.

void Paint_NewImage(uint8_t *image, UWORD width, UWORD height,
                    UWORD rotate, UWORD color);
void Paint_Clear(UWORD color);
void Paint_SetPixel(UWORD x, UWORD y, UWORD color);
void Paint_DrawPixel(UWORD x, UWORD y, UWORD color);

void Paint_DrawLine(UWORD x0, UWORD y0, UWORD x1, UWORD y1,
                    UWORD color, LINE_STYLE style, DOT_PIXEL dotPixel);

void Paint_DrawRectangle(UWORD x0, UWORD y0, UWORD x1, UWORD y1,
                         UWORD color, DRAW_FILL filled, DOT_PIXEL dotPixel);

void Paint_DrawCircle(UWORD x, UWORD y, UWORD r,
                      UWORD color, DRAW_FILL filled, DOT_PIXEL dotPixel);

void Paint_DrawChar(UWORD x, UWORD y, const char ch,
                    sFONT *font, UWORD colorFg, UWORD colorBg);

void Paint_DrawString_EN(UWORD x, UWORD y, const char *text,
                         sFONT *font, UWORD colorFg, UWORD colorBg);
