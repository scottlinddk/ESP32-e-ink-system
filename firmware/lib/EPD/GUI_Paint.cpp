#include "GUI_Paint.h"
#include <string.h>
#include <stdlib.h>

// ── Canvas state ──────────────────────────────────────────────────────────────
static struct {
    uint8_t *image;
    UWORD    width;
    UWORD    height;
    UWORD    widthBytes;
    UWORD    rotate;
    UWORD    color;
} s_canvas;

void Paint_NewImage(uint8_t *image, UWORD width, UWORD height,
                    UWORD rotate, UWORD color) {
    s_canvas.image      = image;
    s_canvas.width      = width;
    s_canvas.height     = height;
    s_canvas.widthBytes = (width + 7) / 8;
    s_canvas.rotate     = rotate;
    s_canvas.color      = color;
    Paint_Clear(color);
}

void Paint_Clear(UWORD color) {
    uint8_t fill = (color == BLACK) ? 0x00 : 0xFF;
    memset(s_canvas.image, fill, s_canvas.widthBytes * s_canvas.height);
}

// ── Fix for error 4: Paint_DrawPixel must NOT be static ──────────────────────
// The original Elecrow/AVR code declared it 'static' in the .cpp while the
// header declared it 'extern'.  That mismatch causes:
//   error: 'void Paint_DrawPixel(...)' declared 'extern' and later 'static'
// Solution: no 'static' qualifier here — the function has external linkage as
// declared in GUI_Paint.h.

void Paint_DrawPixel(UWORD x, UWORD y, UWORD color) {
    if (x >= s_canvas.width || y >= s_canvas.height) return;

    UWORD byteIdx = y * s_canvas.widthBytes + x / 8;
    UBYTE bitMask = 0x80 >> (x % 8);

    if (color == BLACK) {
        s_canvas.image[byteIdx] &= ~bitMask; // clear bit = black
    } else {
        s_canvas.image[byteIdx] |=  bitMask; // set bit = white
    }
}

void Paint_SetPixel(UWORD x, UWORD y, UWORD color) {
    Paint_DrawPixel(x, y, color);
}

// ── Line (Bresenham) ─────────────────────────────────────────────────────────
void Paint_DrawLine(UWORD x0, UWORD y0, UWORD x1, UWORD y1,
                    UWORD color, LINE_STYLE style, DOT_PIXEL dotPixel) {
    (void)dotPixel; // single-pixel lines only in this build
    int dx  =  abs((int)x1 - (int)x0);
    int dy  = -abs((int)y1 - (int)y0);
    int sx  = (x0 < x1) ? 1 : -1;
    int sy  = (y0 < y1) ? 1 : -1;
    int err = dx + dy;
    int step = 0;

    while (true) {
        if (style == LINE_STYLE_DOTTED) {
            if (step % 3 == 0) Paint_DrawPixel(x0, y0, color);
        } else {
            Paint_DrawPixel(x0, y0, color);
        }
        if (x0 == x1 && y0 == y1) break;
        int e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
        step++;
    }
}

// ── Rectangle ────────────────────────────────────────────────────────────────
void Paint_DrawRectangle(UWORD x0, UWORD y0, UWORD x1, UWORD y1,
                         UWORD color, DRAW_FILL filled, DOT_PIXEL dotPixel) {
    if (filled == DRAW_FILL_FULL) {
        for (UWORD y = y0; y <= y1; y++) {
            Paint_DrawLine(x0, y, x1, y, color, LINE_STYLE_SOLID, dotPixel);
        }
    } else {
        Paint_DrawLine(x0, y0, x1, y0, color, LINE_STYLE_SOLID, dotPixel);
        Paint_DrawLine(x0, y1, x1, y1, color, LINE_STYLE_SOLID, dotPixel);
        Paint_DrawLine(x0, y0, x0, y1, color, LINE_STYLE_SOLID, dotPixel);
        Paint_DrawLine(x1, y0, x1, y1, color, LINE_STYLE_SOLID, dotPixel);
    }
}

// ── Circle (midpoint) ────────────────────────────────────────────────────────
void Paint_DrawCircle(UWORD cx, UWORD cy, UWORD r,
                      UWORD color, DRAW_FILL filled, DOT_PIXEL dotPixel) {
    int x = 0, y = (int)r, p = 1 - (int)r;

    while (x <= y) {
        if (filled == DRAW_FILL_FULL) {
            Paint_DrawLine(cx - x, cy + y, cx + x, cy + y, color, LINE_STYLE_SOLID, dotPixel);
            Paint_DrawLine(cx - x, cy - y, cx + x, cy - y, color, LINE_STYLE_SOLID, dotPixel);
            Paint_DrawLine(cx - y, cy + x, cx + y, cy + x, color, LINE_STYLE_SOLID, dotPixel);
            Paint_DrawLine(cx - y, cy - x, cx + y, cy - x, color, LINE_STYLE_SOLID, dotPixel);
        } else {
            Paint_DrawPixel(cx + x, cy + y, color);
            Paint_DrawPixel(cx - x, cy + y, color);
            Paint_DrawPixel(cx + x, cy - y, color);
            Paint_DrawPixel(cx - x, cy - y, color);
            Paint_DrawPixel(cx + y, cy + x, color);
            Paint_DrawPixel(cx - y, cy + x, color);
            Paint_DrawPixel(cx + y, cy - x, color);
            Paint_DrawPixel(cx - y, cy - x, color);
        }
        if (p < 0) { p += 2 * ++x + 1; }
        else        { p += 2 * (++x - --y) + 1; }
    }
}

// ── Character / string rendering ─────────────────────────────────────────────
// Font table format (Waveshare/Elecrow row-major):
//   bytes_per_row = Width/8 + (Width%8 ? 1 : 0)
//   bytes_per_char = Height * bytes_per_row
//   bit 7 of each byte = leftmost pixel of that row segment
void Paint_DrawChar(UWORD x, UWORD y, const char ch,
                    sFONT *font, UWORD colorFg, UWORD colorBg) {
    if (!font) return;
    uint8_t c = (uint8_t)ch;
    if (c < ' ' || c > '~') c = '?';

    UWORD bpr   = font->Width / 8 + (font->Width % 8 ? 1 : 0); // bytes per row
    UWORD offset = (UWORD)(c - ' ') * font->Height * bpr;
    const uint8_t *ptr = &font->table[offset];

    for (UWORD row = 0; row < font->Height; row++) {
        for (UWORD col = 0; col < font->Width; col++) {
            uint8_t byte = ptr[col / 8];
            bool on = (byte & (0x80u >> (col % 8))) != 0;
            Paint_DrawPixel(x + col, y + row, on ? colorFg : colorBg);
        }
        ptr += bpr;
    }
}

void Paint_DrawString_EN(UWORD x, UWORD y, const char *text,
                         sFONT *font, UWORD colorFg, UWORD colorBg) {
    if (!text || !font) return;
    UWORD cursor = x;
    while (*text) {
        if (cursor + font->Width > s_canvas.width) break;
        Paint_DrawChar(cursor, y, *text, font, colorFg, colorBg);
        cursor += font->Width;
        text++;
    }
}
