import { parseDisplayProfile, DisplayProfile } from './displayProfile';
import { DisplayData, DisplayLayout, TickerWidgetSetting, UserPreferences, WidgetLayout } from '../types/index';
import { bitmapGlyph, normalizeBitmapText, wrapBitmapText } from './bitmapText';
import { drawCustomImage } from './customContent';
import { renderWebhookWidget } from './webhookRenderer';
import { DEFAULT_DISPLAY_TIMEZONE } from './displayTimezone';
import { DEFAULT_DISPLAY_LANGUAGE, displayLanguageOrDefault, formatDecimal, type DisplayLanguage } from './displayLanguage';
import { displayStrings } from './displayStrings';
import { newsFeedIdFromWidget } from './newsFeeds';
import { renderNewsWidget } from './newsRenderer';
import { calendarIdFromWidget } from './calendarWidgets';
import { renderCalendarWidget } from './calendarRenderer';
import { renderWeatherWidget } from './weatherRenderer';
import { isWeatherWidget } from './weatherWidgets';
import { storedTickerWidgets, tickerIdFromWidget } from './tickerWidgets';
import { renderTicker, renderTickerUnavailable, type TickerResult } from '../ticker';
import type { RenderedWidget } from '../ticker/render';
import { renderEnergyChart } from './energyChart';
import { energyView, familyMealsView } from './widgetOptions';
import { renderWeekNumberWidget } from './weekNumber';
import { renderBatteryWidget, compactBatteryWidth, drawCompactBattery } from './batteryRenderer';
import { renderAiUsageWidget } from './aiUsageRenderer';
import { renderFamilyMealsWidget } from './familyMealsRenderer';
import { chooseZoom, fitZoom } from './zoom';
import { drawWidgetRows, widgetLabel, WidgetCanvas, WIDGET_PAD, WIDGET_LINE } from './widgetStyle';
import { BASE_GRID_COLS, BASE_GRID_ROWS } from './layoutGrid';
import { isDarkAt } from './sunTimes';
import { drawTeletextTitleBar, renderTeletextHeader, teletextPages, teletextTitle } from './teletext';
import { ZoomCanvas, logicalBounds, type Bounds, type DrawingCanvas } from './zoomCanvas';
import { alignArea, alignOffset, chooseOutline, DEFAULT_ALIGN, drawWidgetOutlines, outlineBoxes, type WidgetAlign, type WidgetFrame } from './widgetFrame';

// Public domain 8x8 bitmap font (CP437 subset, chars 32–127)
// Each entry = 8 bytes, one byte per row, LSB = leftmost glyph pixel.
// Output pixels remain MSB-first, as required by BMP and the display protocol.
const FONT8X8: readonly number[][] = [
  [0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00], // 32 space
  [0x18,0x3C,0x3C,0x18,0x18,0x00,0x18,0x00], // 33 !
  [0x36,0x36,0x00,0x00,0x00,0x00,0x00,0x00], // 34 "
  [0x36,0x36,0x7F,0x36,0x7F,0x36,0x36,0x00], // 35 #
  [0x0C,0x3E,0x03,0x1E,0x30,0x1F,0x0C,0x00], // 36 $
  [0x00,0x63,0x33,0x18,0x0C,0x66,0x63,0x00], // 37 %
  [0x1C,0x36,0x1C,0x6E,0x3B,0x33,0x6E,0x00], // 38 &
  [0x06,0x06,0x03,0x00,0x00,0x00,0x00,0x00], // 39 '
  [0x18,0x0C,0x06,0x06,0x06,0x0C,0x18,0x00], // 40 (
  [0x06,0x0C,0x18,0x18,0x18,0x0C,0x06,0x00], // 41 )
  [0x00,0x66,0x3C,0xFF,0x3C,0x66,0x00,0x00], // 42 *
  [0x00,0x0C,0x0C,0x3F,0x0C,0x0C,0x00,0x00], // 43 +
  [0x00,0x00,0x00,0x00,0x00,0x0C,0x0C,0x06], // 44 ,
  [0x00,0x00,0x00,0x3F,0x00,0x00,0x00,0x00], // 45 -
  [0x00,0x00,0x00,0x00,0x00,0x0C,0x0C,0x00], // 46 .
  [0x60,0x30,0x18,0x0C,0x06,0x03,0x01,0x00], // 47 /
  [0x3E,0x63,0x73,0x7B,0x6F,0x67,0x3E,0x00], // 48 0
  [0x0C,0x0E,0x0C,0x0C,0x0C,0x0C,0x3F,0x00], // 49 1
  [0x1E,0x33,0x30,0x1C,0x06,0x33,0x3F,0x00], // 50 2
  [0x1E,0x33,0x30,0x1C,0x30,0x33,0x1E,0x00], // 51 3
  [0x38,0x3C,0x36,0x33,0x7F,0x30,0x78,0x00], // 52 4
  [0x3F,0x03,0x1F,0x30,0x30,0x33,0x1E,0x00], // 53 5
  [0x1C,0x06,0x03,0x1F,0x33,0x33,0x1E,0x00], // 54 6
  [0x3F,0x33,0x30,0x18,0x0C,0x0C,0x0C,0x00], // 55 7
  [0x1E,0x33,0x33,0x1E,0x33,0x33,0x1E,0x00], // 56 8
  [0x1E,0x33,0x33,0x3E,0x30,0x18,0x0E,0x00], // 57 9
  [0x00,0x0C,0x0C,0x00,0x00,0x0C,0x0C,0x00], // 58 :
  [0x00,0x0C,0x0C,0x00,0x00,0x0C,0x0C,0x06], // 59 ;
  [0x18,0x0C,0x06,0x03,0x06,0x0C,0x18,0x00], // 60 <
  [0x00,0x00,0x3F,0x00,0x00,0x3F,0x00,0x00], // 61 =
  [0x06,0x0C,0x18,0x30,0x18,0x0C,0x06,0x00], // 62 >
  [0x1E,0x33,0x30,0x18,0x0C,0x00,0x0C,0x00], // 63 ?
  [0x3E,0x63,0x7B,0x7B,0x7B,0x03,0x1E,0x00], // 64 @
  [0x0C,0x1E,0x33,0x33,0x3F,0x33,0x33,0x00], // 65 A
  [0x3F,0x66,0x66,0x3E,0x66,0x66,0x3F,0x00], // 66 B
  [0x3C,0x66,0x03,0x03,0x03,0x66,0x3C,0x00], // 67 C
  [0x1F,0x36,0x66,0x66,0x66,0x36,0x1F,0x00], // 68 D
  [0x7F,0x46,0x16,0x1E,0x16,0x46,0x7F,0x00], // 69 E
  [0x7F,0x46,0x16,0x1E,0x16,0x06,0x0F,0x00], // 70 F
  [0x3C,0x66,0x03,0x03,0x73,0x66,0x7C,0x00], // 71 G
  [0x33,0x33,0x33,0x3F,0x33,0x33,0x33,0x00], // 72 H
  [0x1E,0x0C,0x0C,0x0C,0x0C,0x0C,0x1E,0x00], // 73 I
  [0x78,0x30,0x30,0x30,0x33,0x33,0x1E,0x00], // 74 J
  [0x67,0x66,0x36,0x1E,0x36,0x66,0x67,0x00], // 75 K
  [0x0F,0x06,0x06,0x06,0x46,0x66,0x7F,0x00], // 76 L
  [0x63,0x77,0x7F,0x7F,0x6B,0x63,0x63,0x00], // 77 M
  [0x63,0x67,0x6F,0x7B,0x73,0x63,0x63,0x00], // 78 N
  [0x1C,0x36,0x63,0x63,0x63,0x36,0x1C,0x00], // 79 O
  [0x3F,0x66,0x66,0x3E,0x06,0x06,0x0F,0x00], // 80 P
  [0x1E,0x33,0x33,0x33,0x3B,0x1E,0x38,0x00], // 81 Q
  [0x3F,0x66,0x66,0x3E,0x36,0x66,0x67,0x00], // 82 R
  [0x1E,0x33,0x07,0x0E,0x38,0x33,0x1E,0x00], // 83 S
  [0x3F,0x2D,0x0C,0x0C,0x0C,0x0C,0x1E,0x00], // 84 T
  [0x33,0x33,0x33,0x33,0x33,0x33,0x3F,0x00], // 85 U
  [0x33,0x33,0x33,0x33,0x33,0x1E,0x0C,0x00], // 86 V
  [0x63,0x63,0x63,0x6B,0x7F,0x77,0x63,0x00], // 87 W
  [0x63,0x63,0x36,0x1C,0x1C,0x36,0x63,0x00], // 88 X
  [0x33,0x33,0x33,0x1E,0x0C,0x0C,0x1E,0x00], // 89 Y
  [0x7F,0x63,0x31,0x18,0x4C,0x66,0x7F,0x00], // 90 Z
  [0x1E,0x06,0x06,0x06,0x06,0x06,0x1E,0x00], // 91 [
  [0x03,0x06,0x0C,0x18,0x30,0x60,0x40,0x00], // 92 backslash
  [0x1E,0x18,0x18,0x18,0x18,0x18,0x1E,0x00], // 93 ]
  [0x08,0x1C,0x36,0x63,0x00,0x00,0x00,0x00], // 94 ^
  [0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xFF], // 95 _
  [0x0C,0x0C,0x18,0x00,0x00,0x00,0x00,0x00], // 96 `
  [0x00,0x00,0x1E,0x30,0x3E,0x33,0x6E,0x00], // 97 a
  [0x07,0x06,0x06,0x3E,0x66,0x66,0x3B,0x00], // 98 b
  [0x00,0x00,0x1E,0x33,0x03,0x33,0x1E,0x00], // 99 c
  [0x38,0x30,0x30,0x3e,0x33,0x33,0x6E,0x00], // 100 d
  [0x00,0x00,0x1E,0x33,0x3f,0x03,0x1E,0x00], // 101 e
  [0x1C,0x36,0x06,0x0f,0x06,0x06,0x0F,0x00], // 102 f
  [0x00,0x00,0x6E,0x33,0x33,0x3E,0x30,0x1F], // 103 g
  [0x07,0x06,0x36,0x6E,0x66,0x66,0x67,0x00], // 104 h
  [0x0C,0x00,0x0E,0x0C,0x0C,0x0C,0x1E,0x00], // 105 i
  [0x30,0x00,0x30,0x30,0x30,0x33,0x33,0x1E], // 106 j
  [0x07,0x06,0x66,0x36,0x1E,0x36,0x67,0x00], // 107 k
  [0x0E,0x0C,0x0C,0x0C,0x0C,0x0C,0x1E,0x00], // 108 l
  [0x00,0x00,0x33,0x7F,0x7F,0x6B,0x63,0x00], // 109 m
  [0x00,0x00,0x1F,0x33,0x33,0x33,0x33,0x00], // 110 n
  [0x00,0x00,0x1E,0x33,0x33,0x33,0x1E,0x00], // 111 o
  [0x00,0x00,0x3B,0x66,0x66,0x3E,0x06,0x0F], // 112 p
  [0x00,0x00,0x6E,0x33,0x33,0x3E,0x30,0x78], // 113 q
  [0x00,0x00,0x3B,0x6E,0x66,0x06,0x0F,0x00], // 114 r
  [0x00,0x00,0x3E,0x03,0x1E,0x30,0x1F,0x00], // 115 s
  [0x08,0x0C,0x3E,0x0C,0x0C,0x2C,0x18,0x00], // 116 t
  [0x00,0x00,0x33,0x33,0x33,0x33,0x6E,0x00], // 117 u
  [0x00,0x00,0x33,0x33,0x33,0x1E,0x0C,0x00], // 118 v
  [0x00,0x00,0x63,0x6B,0x7F,0x7F,0x36,0x00], // 119 w
  [0x00,0x00,0x63,0x36,0x1C,0x36,0x63,0x00], // 120 x
  [0x00,0x00,0x33,0x33,0x33,0x3E,0x30,0x1F], // 121 y
  [0x00,0x00,0x3F,0x19,0x0C,0x26,0x3F,0x00], // 122 z
  [0x38,0x0C,0x0C,0x07,0x0C,0x0C,0x38,0x00], // 123 {
  [0x18,0x18,0x18,0x00,0x18,0x18,0x18,0x00], // 124 |
  [0x07,0x0C,0x0C,0x38,0x0C,0x0C,0x07,0x00], // 125 }
  [0x6E,0x3B,0x00,0x00,0x00,0x00,0x00,0x00], // 126 ~
  [0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF], // 127 DEL (filled box)
];

export const DISPLAY_WIDTH = 250;
export const DISPLAY_HEIGHT = 122;

// Row stride must be a multiple of 4 bytes (BMP requirement)


export class BmpCanvas implements DrawingCanvas {
  private pixels: Uint8Array;
  private clip: { left: number; top: number; right: number; bottom: number };
  readonly profile: DisplayProfile;
  readonly width: number;
  readonly height: number;
  private readonly rowBytes: number;

  constructor(profile?: DisplayProfile | null) {
    this.profile = parseDisplayProfile(profile);
    const turned = this.profile.rotation === 90 || this.profile.rotation === 270;
    this.width = turned ? this.profile.height : this.profile.width;
    this.height = turned ? this.profile.width : this.profile.height;
    this.rowBytes = Math.ceil(this.profile.width / 8);
    this.clip = { left: 0, top: 0, right: this.width, bottom: this.height };
    this.pixels = new Uint8Array(this.rowBytes * this.profile.height).fill(0xff);
  }

  /** Byte and bit of a logical pixel in the stored (unrotated) bitmap. */
  private locate(x: number, y: number): { byteIdx: number; bitMask: number } {
    let px = x, py = y;
    switch (this.profile.rotation) {
      case 90: px = this.profile.width - 1 - y; py = x; break;
      case 180: px = this.profile.width - 1 - x; py = this.profile.height - 1 - y; break;
      case 270: px = y; py = this.profile.height - 1 - x; break;
    }
    return { byteIdx: py * this.rowBytes + Math.floor(px / 8), bitMask: 0x80 >> (px % 8) };
  }

  setPixel(x: number, y: number, black: boolean): void {
    if (x < this.clip.left || x >= this.clip.right || y < this.clip.top || y >= this.clip.bottom) return;
    if (!Number.isInteger(x) || !Number.isInteger(y)) return;
    const { byteIdx, bitMask } = this.locate(x, y);
    if (black) {
      this.pixels[byteIdx] &= ~bitMask;
    } else {
      this.pixels[byteIdx] |= bitMask;
    }
  }

  /** Whether a pixel is black. Pixels outside the canvas read as white. */
  isBlack(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || !Number.isInteger(x) || !Number.isInteger(y)) return false;
    const { byteIdx, bitMask } = this.locate(x, y);
    return (this.pixels[byteIdx] & bitMask) === 0;
  }

  /** Swaps black and white inside `bounds`, ignoring the clip. Row padding bits are never touched. */
  invertArea(bounds: WidgetBounds): void {
    const left = Math.max(0, Math.floor(bounds.x));
    const top = Math.max(0, Math.floor(bounds.y));
    const right = Math.min(this.width, Math.ceil(bounds.x + bounds.width));
    const bottom = Math.min(this.height, Math.ceil(bounds.y + bounds.height));
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const { byteIdx, bitMask } = this.locate(x, y);
        this.pixels[byteIdx] ^= bitMask;
      }
    }
  }

  // Every drawing primitive uses setPixel, so a widget cannot paint over its neighbours.
  withClip(bounds: WidgetBounds, draw: () => void): void {
    const previous = this.clip;
    this.clip = {
      left: Math.max(previous.left, bounds.x),
      top: Math.max(previous.top, bounds.y),
      right: Math.min(previous.right, bounds.x + bounds.width),
      bottom: Math.min(previous.bottom, bounds.y + bounds.height),
    };
    try {
      if (this.clip.left < this.clip.right && this.clip.top < this.clip.bottom) draw();
    } finally {
      this.clip = previous;
    }
  }

  drawHLine(x: number, y: number, w: number): void {
    for (let i = 0; i < w; i++) this.setPixel(x + i, y, true);
  }

  // Edges are rounded to whole pixels, so a fractional rectangle stays gap-free next to its neighbours.
  fillRect(x: number, y: number, w: number, h: number, black = true): void {
    const left = Math.round(x), top = Math.round(y);
    const right = Math.round(x + w), bottom = Math.round(y + h);
    for (let row = top; row < bottom; row++) {
      for (let col = left; col < right; col++) {
        this.setPixel(col, row, black);
      }
    }
  }

  // `scale` enlarges the 8x8 font, by a whole number or a fraction of one (at least 1);
  // `maxWidth` is in output pixels. `black = false` draws white glyphs, for text on a filled area.
  // `light` skips the glyph pixels where row + column is odd, leaving a checkerboard.
  drawChar(ch: number, x: number, y: number, scale = 1, black = true, light = false): void {
    const glyph = bitmapGlyph(ch, FONT8X8);
    for (let row = 0; row < 8; row++) {
      const byte = glyph[row];
      for (let col = 0; col < 8; col++) {
        if (!(byte & (1 << col))) continue;
        if (light && (row + col) % 2 === 1) continue;
        if (scale === 1) this.setPixel(x + col, y + row, black);
        else this.fillRect(x + col * scale, y + row * scale, scale, scale, black);
      }
    }
  }

  drawText(text: string, x: number, y: number, maxWidth = this.width, scale = 1, black = true, light = false): void {
    const step = 8 * scale;
    let index = 0;
    for (const ch of normalizeBitmapText(text)) {
      const cx = x + index * step;
      if (cx + step > x + maxWidth || cx + step > this.width) break;
      this.drawChar(ch.codePointAt(0)!, cx, y, scale, black, light);
      index++;
    }
  }

  // Word-wrap text within a box; returns the y position after the last line.
  // `scale` enlarges the glyphs, so a line holds fewer characters and is `8 * scale` tall.
  drawWrappedText(text: string, x: number, y: number, w: number, lineH = 10, scale = 1): number {
    const glyph = 8 * scale;
    const maxChars = Math.floor(w / glyph);
    if (maxChars < 1 || y + glyph > this.clip.bottom || !Number.isFinite(lineH) || lineH < 1) return y;
    let cy = y;
    for (const line of wrapBitmapText(text, maxChars)) {
      if (cy + glyph > this.clip.bottom) break;
      this.drawText(line, x, cy, w, scale);
      cy += lineH;
    }
    return cy;
  }

  toBmp(): Buffer {
    const bmpStride = Math.ceil(this.profile.width / 32) * 4;
    const pixelDataSize = bmpStride * this.profile.height;
    const fileSize = 14 + 40 + 8 + pixelDataSize;
    const buf = Buffer.alloc(fileSize, 0);

    // --- BITMAPFILEHEADER (14 bytes) ---
    buf.write('BM', 0, 'ascii');
    buf.writeUInt32LE(fileSize, 2);
    // reserved bytes 6–9 = 0
    buf.writeUInt32LE(62, 10); // pixel data offset = 14 + 40 + 8

    // --- BITMAPINFOHEADER (40 bytes) ---
    buf.writeUInt32LE(40, 14);
    buf.writeInt32LE(this.profile.width, 18);
    buf.writeInt32LE(-this.profile.height, 22); // negative = top-down storage
    buf.writeUInt16LE(1, 26);   // planes
    buf.writeUInt16LE(1, 28);   // biBitCount = 1
    buf.writeUInt32LE(0, 30);   // compression = BI_RGB
    buf.writeUInt32LE(0, 34);   // biSizeImage (0 is valid for BI_RGB)
    buf.writeInt32LE(2835, 38); // X pixels/metre (~72 DPI)
    buf.writeInt32LE(2835, 42); // Y pixels/metre
    buf.writeUInt32LE(2, 46);   // biClrUsed
    buf.writeUInt32LE(2, 50);   // biClrImportant

    // --- Color table (8 bytes) ---
    // Index 0 = black
    buf[54] = 0x00; buf[55] = 0x00; buf[56] = 0x00; buf[57] = 0x00;
    // Index 1 = white
    buf[58] = 0xFF; buf[59] = 0xFF; buf[60] = 0xFF; buf[61] = 0x00;

    // --- Pixel data ---
    for (let y = 0; y < this.profile.height; y++) {
      buf.fill(0xff, 62 + y * bmpStride, 62 + (y + 1) * bmpStride);
      buf.set(this.pixels.subarray(y * this.rowBytes, (y + 1) * this.rowBytes), 62 + y * bmpStride);
    }

    return buf;
  }

  // Raw 1-bit pixel bytes without BMP header, for OpenDisplay BLE direct write.
  // Format: MSB-first, 32 bytes/row × 122 rows = 3,904 bytes.
  // Bit convention: 1=white, 0=black (matches SSD1680 and BMP convention).
  toRawPixels(): Buffer {
    return Buffer.from(this.pixels);
  }
}

// ── Grid constants ───────────────────────────────────────────────────────────

// The base grid; a layout may use a finer one (see layoutGrid.ts), so cells are sized from the layout.
export const GRID_COLS = BASE_GRID_COLS;
export const GRID_ROWS = BASE_GRID_ROWS;
export const COL_PX = 25;  // DISPLAY_WIDTH / GRID_COLS
export const ROW_PX = 20;  // ~DISPLAY_HEIGHT / GRID_ROWS

export const DEFAULT_LAYOUT: DisplayLayout = {
  version: 1,
  cols: 10,
  rows: 6,
  widgets: [
    { i: 'energy',  x: 0, y: 0, w: 10, h: 2 },
    { i: 'weather', x: 0, y: 2, w: 10, h: 2 },
    { i: 'news',    x: 0, y: 4, w: 10, h: 1 },
    { i: 'status',  x: 0, y: 5, w: 10, h: 1, static: true },
  ],
};

export type WidgetBounds = Bounds;

function getWidgetBounds(w: WidgetLayout, canvas: BmpCanvas, layout: Pick<DisplayLayout, 'cols' | 'rows'>): WidgetBounds {
  const colPx = canvas.width / layout.cols;
  const rowPx = Math.floor(canvas.height / layout.rows);
  return {
    x: Math.floor(w.x * colPx),
    y: w.y * rowPx,
    width: Math.floor((w.x + w.w) * colPx) - Math.floor(w.x * colPx),
    height: w.h * rowPx,
  };
}

function trendArrow(trend?: 'up' | 'down' | 'stable'): string {
  if (trend === 'up') return '^';
  if (trend === 'down') return 'v';
  return '-';
}

// ── Per-widget renderers ──────────────────────────────────────────────────────

function renderEnergyWidget(
  canvas: DrawingCanvas,
  bounds: WidgetBounds,
  price?: DisplayData['price'],
  problem?: DisplayData['priceError'],
  options?: WidgetLayout['options'],
  language: DisplayLanguage = DEFAULT_DISPLAY_LANGUAGE,
): void {
  const { x, y, width, height } = bounds;
  const t = displayStrings(language).energy;
  if (y > 0) canvas.drawHLine(x, y, width);
  const view = energyView(options);
  // Without hourly prices a chart view falls back to the summary rather than an empty chart.
  if (view !== 'summary' && price?.hours?.length) {
    renderEnergyChart(canvas, { x, y: y > 0 ? y + 1 : y, width, height: y > 0 ? height - 1 : height },
      { ...price, hours: price.hours }, view, Date.now(), language);
    return;
  }
  const textY = y + WIDGET_PAD;
  const maxW = width - 2 * WIDGET_PAD;
  if (price) {
    const { now, average, trend } = price;
    const value = formatDecimal(now / 100, 2, language);
    const arrow = trendArrow(trend);
    const consumer = price.basis === 'consumer';
    const label = consumer ? t.estimate : t.spot;
    const basis = consumer ? t.inclVat : t.exclTax;
    // A tall summary uses the same heading / primary reading / detail hierarchy as other cards.
    if (height >= 44 && maxW >= 80) {
      canvas.drawText(widgetLabel([`${label}  ${t.unit}`, t.unit], maxW), x + WIDGET_PAD, textY, maxW);
      canvas.drawHLine(x + WIDGET_PAD, textY + WIDGET_LINE, maxW);
      const scale = maxW >= (value.length + 2) * 16 ? 2 : 1;
      canvas.drawText(`${value} ${arrow}`, x + WIDGET_PAD, textY + 14, maxW, scale);
      const detailY = textY + 14 + 8 * scale + 3;
      if (detailY + 8 <= y + height) canvas.drawText(basis, x + WIDGET_PAD, detailY, maxW);
      if (detailY + WIDGET_LINE + 8 <= y + height) {
        canvas.drawText(`${t.average}: ${formatDecimal(average / 100, 2, language)} ${t.unit}`, x + WIDGET_PAD, detailY + WIDGET_LINE, maxW);
      }
    } else {
      const reading = widgetLabel([
        `${label}: ${value} ${t.unit} ${arrow}`, `${label}: ${value} ${t.unit}`,
        `${label} ${value}`, `${value} ${t.unit}`, value,
      ], maxW);
      canvas.drawText(reading, x + WIDGET_PAD, textY, maxW);
      // A very narrow card puts the unit on its own line before any secondary detail.
      const detail = reading.includes(t.unit) ? basis : t.unit;
      if (height >= 20) canvas.drawText(detail, x + WIDGET_PAD, textY + WIDGET_LINE, maxW);
      if (height >= 30) canvas.drawText(reading.includes(t.unit)
        ? `${t.average}: ${formatDecimal(average / 100, 2, language)}`
        : widgetLabel([basis, consumer ? t.inclVatShort : t.exclTaxShort], maxW), x + WIDGET_PAD, textY + 2 * WIDGET_LINE, maxW);
    }
  } else {
    const bottom = canvas.drawWrappedText(problem ? t.errors[problem.code] : t.unavailable, x + WIDGET_PAD, textY, maxW);
    if (problem?.missingCodes?.length && bottom + 8 <= y + height) {
      const codes = problem.missingCodes.join(', ');
      canvas.drawText(widgetLabel([`${t.missing}: ${codes}`, codes], maxW), x + WIDGET_PAD, bottom, maxW);
    }
  }
}

function renderMontaWidget(
  canvas: DrawingCanvas,
  bounds: WidgetBounds,
  data?: DisplayData['monta'],
  fields: string[] = ['charger_status', 'active_session'],
  language: DisplayLanguage = DEFAULT_DISPLAY_LANGUAGE,
): void {
  const { x, y, width } = bounds;
  const t = displayStrings(language).chargers;
  if (y > 0) canvas.drawHLine(x, y, width);
  const rows: string[] = [];
  if (!data) { drawWidgetRows(canvas, bounds, t.unavailable('Monta'), rows); return; }
  if (fields.includes('charger_status') && data.chargePoints.length > 0) {
    const available = data.chargePoints.filter(cp => cp.state === 'available').length;
    const charging = data.chargePoints.filter(cp => cp.state === 'charging').length;
    rows.push(widgetLabel([t.status(available, charging), t.compactStatus(charging)], width - 4));
  }
  if (fields.includes('active_session') && data.activeSessions.length > 0) {
    const session = data.activeSessions[0];
    rows.push(`${session.energyDeliveredKwh === null ? '?' : formatDecimal(session.energyDeliveredKwh, 1, language)}kWh  ${session.durationMin ?? '?'}min`);
  }
  if (fields.includes('today_stats') && data.todayKwh !== null) rows.push(`${t.createdToday}: ${formatDecimal(data.todayKwh, 1, language)} kWh`);
  drawWidgetRows(canvas, bounds, 'Monta', rows);
}

function renderZaptecWidget(
  canvas: DrawingCanvas,
  bounds: WidgetBounds,
  data?: DisplayData['zaptec'],
  fields: string[] = ['charger_status', 'active_session', 'installation_info'],
  language: DisplayLanguage = DEFAULT_DISPLAY_LANGUAGE,
): void {
  const { x, y, width } = bounds;
  const t = displayStrings(language).chargers;
  if (y > 0) canvas.drawHLine(x, y, width);
  const rows: string[] = [];
  if (!data) { drawWidgetRows(canvas, bounds, t.unavailable('Zaptec'), rows); return; }
  const title = fields.includes('installation_info') && data.installationName ? `Zaptec - ${data.installationName}` : 'Zaptec';
  if (fields.includes('charger_status') && data.chargers.length > 0) {
    const available = data.chargers.filter(c => c.operatingMode === 1).length;
    const charging = data.chargers.filter(c => c.operatingMode === 3).length;
    rows.push(widgetLabel([t.status(available, charging), t.compactStatus(charging)], width - 4));
  }
  if (fields.includes('active_session') && data.activeSession) {
    const session = data.activeSession;
    rows.push(`${session.energyDeliveredKwh === null ? '?' : formatDecimal(session.energyDeliveredKwh, 1, language)}kWh  ${session.chargerName}`);
  }
  drawWidgetRows(canvas, bounds, title, rows);
}

function renderNotionWidget(
  canvas: DrawingCanvas,
  bounds: WidgetBounds,
  data?: DisplayData['notion'],
  problem?: DisplayData['notionError'],
  language: DisplayLanguage = DEFAULT_DISPLAY_LANGUAGE,
): void {
  const { x, y, width } = bounds;
  const t = displayStrings(language).notion;
  if (y > 0) canvas.drawHLine(x, y, width);
  if (!data) {
    const labels: Record<string, string | undefined> = t.errors;
    canvas.drawWrappedText(labels[problem?.code ?? ''] ?? t.unavailable, x + WIDGET_PAD, y + WIDGET_PAD, width - 2 * WIDGET_PAD);
    return;
  }
  drawWidgetRows(canvas, bounds, data.databaseName ?? 'Notion', data.rows.length
    ? data.rows.map(row => row.subtitle ? `${row.title}  ${row.subtitle}` : row.title)
    : [t.none]);
}

function renderStatusWidget(
  canvas: DrawingCanvas,
  bounds: WidgetBounds,
  nextRefresh: number,
  timezone = DEFAULT_DISPLAY_TIMEZONE,
  battery?: DisplayData['battery'],
  options?: WidgetLayout['options'],
  language: DisplayLanguage = DEFAULT_DISPLAY_LANGUAGE,
): void {
  const { x, y, width } = bounds;
  canvas.drawHLine(x, y, width);
  const statusY = y + 2;
  const now = new Date();
  const timeStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(now);
  const refreshMin = Math.round(nextRefresh / 60000);
  // The condensed view is the time alone, so the bar stays readable at a few columns wide.
  const text = options?.view === 'condensed' ? timeStr : widgetLabel([
    `${displayStrings(language).status.refresh}: ${refreshMin}min  ${timeStr}`,
    `${refreshMin}min  ${timeStr}`, timeStr,
  ], width - 4);
  canvas.drawText(text, x + 2, statusY, width - 4);
  // Right-aligned, and only when it fits beside the text without truncating it.
  const batteryW = compactBatteryWidth(battery);
  if (batteryW > 0 && text.length * 8 + 6 + batteryW <= width - 4) drawCompactBattery(canvas, x + width - 2, statusY, battery);
}

/** Draws a ticker view's elements, offset to the widget. Text sizes are whole multiples of the 8x8 font. */
function drawRenderedWidget(canvas: DrawingCanvas, bounds: WidgetBounds, rendered: RenderedWidget): void {
  for (const element of rendered.elements) {
    const x = bounds.x + element.x;
    const y = bounds.y + element.y;
    if (element.kind === 'text') {
      canvas.drawText(element.text, x, y, bounds.x + bounds.width - x, Math.max(1, Math.round(element.fontSize / 8)));
    } else if (element.kind === 'hline') {
      canvas.drawHLine(x, y, element.width);
    } else if (element.fill) {
      canvas.fillRect(x, y, element.width, element.height);
    }
  }
}

function renderTickerWidget(
  canvas: DrawingCanvas,
  bounds: WidgetBounds,
  setting: TickerWidgetSetting | undefined,
  result: TickerResult | undefined,
  timezone: string
): void {
  const region = { widthPx: bounds.width, heightPx: bounds.height };
  // A removed widget has no setting; it renders as unavailable until it is removed from the layout.
  const rendered = setting && result && 'snapshot' in result
    ? renderTicker(setting, result.snapshot, region, timezone)
    : renderTickerUnavailable(region, result && 'error' in result ? result.error : undefined);
  drawRenderedWidget(canvas, bounds, rendered);
}

// ── Content placement ────────────────────────────────────────────────────────

/** An outline is left out when the widget inside it could not hold a line of text and a few characters. */
const MIN_FRAMED_WIDTH = 32;
const MIN_FRAMED_HEIGHT = 10;

/** Where a custom image goes: its fitted size, placed by the alignment. A cover image fills the area anyway. */
function placeCustomImage(bounds: WidgetBounds, image: NonNullable<DisplayData['customImage']>, align: WidgetAlign): WidgetBounds {
  if (align === DEFAULT_ALIGN || image.fit === 'cover' || image.width < 1 || image.height < 1) return bounds;
  const scale = Math.min(bounds.width / image.width, bounds.height / image.height);
  return alignArea(bounds, Math.round(image.width * scale), Math.round(image.height * scale), align);
}

/**
 * Copies what a widget drew on `scratch` inside `box` to `canvas`, moved by its alignment.
 * Many widgets start with a full-width rule along their top edge to separate them from the
 * widget above. That rule stays where it is (or is dropped inside an outline, which already
 * separates the widget) and the rest is measured by its black pixels and moved.
 */
function placeContent(canvas: BmpCanvas, scratch: BmpCanvas, box: WidgetBounds, placement: {
  align: WidgetAlign; pad: number; separatorRows: number; dropSeparator: boolean;
}): void {
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const fullRow = (y: number) => {
    for (let x = box.x; x < right; x++) if (!scratch.isBlack(x, y)) return false;
    return true;
  };
  let contentTop = box.y;
  for (let y = box.y; y < Math.min(bottom, box.y + placement.separatorRows); y++) {
    if (fullRow(y)) contentTop = y + 1;
  }
  if (!placement.dropSeparator) {
    for (let y = box.y; y < contentTop; y++) for (let x = box.x; x < right; x++) {
      if (scratch.isBlack(x, y)) canvas.setPixel(x, y, true);
    }
  }
  let left = right, top = bottom, inkRight = box.x, inkBottom = contentTop;
  for (let y = contentTop; y < bottom; y++) {
    for (let x = box.x; x < right; x++) {
      if (!scratch.isBlack(x, y)) continue;
      if (x < left) left = x;
      if (x >= inkRight) inkRight = x + 1;
      if (y < top) top = y;
      inkBottom = y + 1;
    }
  }
  if (left >= inkRight) return;
  const area = { x: box.x, y: contentTop, width: box.width, height: bottom - contentTop };
  const { dx, dy } = alignOffset(area, { x: left, y: top, width: inkRight - left, height: inkBottom - top }, placement.align, placement.pad);
  for (let y = top; y < inkBottom; y++) {
    for (let x = left; x < inkRight; x++) if (scratch.isBlack(x, y)) canvas.setPixel(x + dx, y + dy, true);
  }
}

// ── Main render entry point ───────────────────────────────────────────────────

const WIDGET_ENABLED_SETTING = {
  energy: 'show_energy_price', weather: 'show_weather', news: 'show_news',
  monta: 'show_monta', zaptec: 'show_zaptec', notion: 'show_notion', calendar: 'show_calendar',
  'custom-text': 'show_custom_text', 'custom-image': 'show_custom_image', 'custom-webhook': 'show_custom_webhook',
  'ai-usage': 'show_ai_usage',
} as const;
type RenderPreferences = Partial<Pick<UserPreferences,
  'monta_fields' | 'zaptec_fields' | 'display_profile' | 'display_timezone' | 'display_language' | 'ticker_widgets' | 'weather_location'
  | typeof WIDGET_ENABLED_SETTING[keyof typeof WIDGET_ENABLED_SETTING]>>;

function populateCanvas(
  canvas: BmpCanvas,
  data: DisplayData,
  layout?: DisplayLayout | null,
  preferences?: RenderPreferences,
  now: Date = new Date()
): void {
  const effectiveLayout = layout ?? DEFAULT_LAYOUT;
  const language = displayLanguageOrDefault(preferences?.display_language);
  // Where a photo was drawn; an inverted layout leaves it as it was.
  const photos: WidgetBounds[] = [];
  const frames: WidgetFrame[] = [];
  const dividersEnabled = effectiveLayout.widgets.some(widget =>
    chooseOutline(widget.options?.outline, effectiveLayout.outline) !== 'none');
  // Tekst TV gives each widget a titled bar with a page number, numbered in reading order.
  const teletextPageOf = effectiveLayout.teletext ? teletextPages(effectiveLayout) : undefined;
  for (const widget of effectiveLayout.widgets) {
    const feedId = newsFeedIdFromWidget(widget.i);
    const setting = feedId ? 'show_news' : isWeatherWidget(widget.i) ? 'show_weather'
      : WIDGET_ENABLED_SETTING[widget.i as keyof typeof WIDGET_ENABLED_SETTING];
    if (setting && preferences?.[setting] === false) continue;
    const physical = getWidgetBounds(widget, canvas, effectiveLayout);
    // An outline is drawn in physical pixels, scaled by the layout's whole zoom so every outline on a panel matches.
    const outline = chooseOutline(widget.options?.outline, effectiveLayout.outline);
    const frameScale = Math.floor(chooseZoom(undefined, effectiveLayout.zoom, canvas));
    const boxes = outline === 'none' ? null : outlineBoxes(physical, outline, frameScale);
    // An outline that would leave no room for a line of text is left out.
    const framed = boxes && boxes.inner.width >= MIN_FRAMED_WIDTH && boxes.inner.height >= MIN_FRAMED_HEIGHT ? boxes : null;
    const area = framed ? framed.inner : physical;
    const align = widget.options?.align ?? DEFAULT_ALIGN;
    // A custom image is raster data placed by pixel, so zooming it would only coarsen it.
    const zoom = widget.i === 'custom-image' ? 1
      : fitZoom(chooseZoom(widget.options?.zoom, effectiveLayout.zoom, canvas), area.width, area.height);
    const placed = zoom === 1 ? area : logicalBounds(area, zoom);
    const tickerId = tickerIdFromWidget(widget.i);
    const calendarId = calendarIdFromWidget(widget.i);
    // Widgets draw on a smaller logical canvas that ZoomCanvas enlarges; zoom 1 draws directly.
    const drawContent = (surface: DrawingCanvas, bounds: WidgetBounds): void => {
      const target = new WidgetCanvas(surface, bounds, dividersEnabled);
      if (calendarId) {
        // A removed calendar has no result; it renders as unavailable until the widget is removed.
        const extra = data.calendars?.[calendarId];
        renderCalendarWidget(target, bounds, { data: extra?.calendar, error: extra?.error }, widget.options, language);
        return;
      }
      if (tickerId) {
        const stored = storedTickerWidgets(preferences?.ticker_widgets).find((item) => item.id === tickerId);
        // Layout options override the ticker's own view and page size for this placement only.
        const setting = stored && {
          ...stored,
          ...(widget.options?.view === 'full' || widget.options?.view === 'condensed' ? { view: widget.options.view } : {}),
          ...(widget.options?.items ? { per_page: widget.options.items } : {}),
        };
        renderTickerWidget(target, bounds, setting, data.tickers?.[tickerId], preferences?.display_timezone ?? DEFAULT_DISPLAY_TIMEZONE);
        return;
      }
      if (feedId) {
        // A removed feed has no result; it renders as unavailable until the widget is removed.
        const feed = data.newsFeeds?.[feedId];
        renderNewsWidget(target, bounds, feed?.items, feed?.error, widget.options?.items, language, widget.options?.columns, widget.options?.weight);
        return;
      }
      if (isWeatherWidget(widget.i)) {
        renderWeatherWidget(target, bounds, {
          data: data.weather, error: data.weatherError, forecast: data.weatherForecast,
          forecastError: data.weatherForecastError, airQuality: data.airQuality,
        }, widget.options, { timeZone: preferences?.display_timezone ?? DEFAULT_DISPLAY_TIMEZONE, language });
        return;
      }
      switch (widget.i) {
        case 'custom-webhook': renderWebhookWidget(target, bounds, data.customWebhook, language); break;
        case 'custom-text':
          if (bounds.y > 0) target.drawHLine(bounds.x, bounds.y, bounds.width);
          if (data.customText) target.drawWrappedText(data.customText, bounds.x + 2, bounds.y + 2, bounds.width - 4);
          break;
        case 'energy':  renderEnergyWidget(target, bounds, data.price, data.priceError, widget.options, language); break;
        case 'news':    renderNewsWidget(target, bounds, data.news, data.newsError, widget.options?.items, language, widget.options?.columns, widget.options?.weight); break;
        case 'monta':   renderMontaWidget(target, bounds, data.monta, preferences?.monta_fields ?? undefined, language); break;
        case 'zaptec':  renderZaptecWidget(target, bounds, data.zaptec, preferences?.zaptec_fields ?? undefined, language); break;
        case 'notion':  renderNotionWidget(target, bounds, data.notion, data.notionError, language); break;
        case 'calendar': renderCalendarWidget(target, bounds, { data: data.calendar }, widget.options, language); break;
        case 'family-meals': renderFamilyMealsWidget(target, bounds, data.familyMeals, data.familyMealsError, {
          view: familyMealsView(widget.options?.view), language,
        }); break;
        case 'week-number': renderWeekNumberWidget(target, bounds, new Date(), preferences?.display_timezone ?? DEFAULT_DISPLAY_TIMEZONE, language); break;
        case 'battery': renderBatteryWidget(target, bounds, data.battery); break;
        case 'ai-usage': renderAiUsageWidget(target, bounds, data.aiUsage, {
          view: widget.options?.view === 'condensed' ? 'condensed' : 'full', timeZone: preferences?.display_timezone ?? DEFAULT_DISPLAY_TIMEZONE, language,
        }); break;
        case 'status':
          if (effectiveLayout.teletext) {
            renderTeletextHeader(target, bounds, {
              now, timeZone: preferences?.display_timezone ?? DEFAULT_DISPLAY_TIMEZONE, language,
              battery: data.battery, condensed: widget.options?.view === 'condensed',
            });
          } else {
            renderStatusWidget(target, bounds, data.nextRefresh, preferences?.display_timezone, data.battery, widget.options, language);
          }
          break;
      }
    };
    canvas.withClip(physical, () => {
      frames.push({ cell: physical, frame: framed?.frame ?? physical, outline, scale: frameScale });
      canvas.withClip(area, () => {
        const direct: DrawingCanvas = zoom === 1 ? canvas : new ZoomCanvas(canvas, zoom);
        // With a title bar the widget draws in what is left below it.
        const page = teletextPageOf?.get(widget.i);
        const title = page === undefined ? null : teletextTitle(widget.i, language);
        const bounds = title && page !== undefined ? drawTeletextTitleBar(direct, placed, title, page) : placed;
        if (widget.i === 'custom-image') {
          if (data.customImage) {
            const photo = placeCustomImage(bounds, data.customImage, align);
            drawCustomImage(canvas, photo, data.customImage, { x: 0, y: 0, width: canvas.width, height: canvas.height });
            photos.push(framed || align !== DEFAULT_ALIGN ? photo : physical);
          }
          return;
        }
        // Drawn as before unless the content moves or sits inside an outline.
        if (align === DEFAULT_ALIGN && !framed && !dividersEnabled) {
          drawContent(direct, bounds);
          return;
        }
        // Below the title bar, in physical pixels.
        const top = Math.round(bounds.y * zoom);
        const box = { x: area.x, y: top, width: area.width, height: area.y + area.height - top };
        const scratch = new BmpCanvas(canvas.profile);
        scratch.withClip(box, () => drawContent(zoom === 1 ? scratch : new ZoomCanvas(scratch, zoom), bounds));
        placeContent(canvas, scratch, box, {
          align, pad: Math.max(1, Math.round(2 * zoom)), separatorRows: Math.ceil(zoom) + 1, dropSeparator: dividersEnabled,
        });
      });
    });
  }
  drawWidgetOutlines(canvas, frames);
  // 'sun' inverts only between sunset and sunrise at the weather location, as of this render.
  if (effectiveLayout.invert === true || (effectiveLayout.invert === 'sun' && isDarkAt(now, preferences?.weather_location))) {
    // Everything, unpainted background included, then the photos back: inverting twice restores them.
    canvas.invertArea({ x: 0, y: 0, width: canvas.width, height: canvas.height });
    for (const photo of photos) canvas.invertArea(photo);
  }
}

export function renderDisplayData(
  data: DisplayData,
  layout?: DisplayLayout | null,
  preferences?: RenderPreferences,
  now?: Date
): Buffer {
  const canvas = new BmpCanvas(preferences?.display_profile);
  populateCanvas(canvas, data, layout, preferences, now);
  return canvas.toBmp();
}

// Returns raw 1-bit pixel bytes (no BMP header) for OpenDisplay BLE direct write.
// 32 bytes/row × 122 rows = 3,904 bytes. Bit convention: 1=white, 0=black.
export function renderDisplayDataRaw(
  data: DisplayData,
  layout?: DisplayLayout | null,
  preferences?: RenderPreferences,
  now?: Date
): Buffer {
  const canvas = new BmpCanvas(preferences?.display_profile);
  populateCanvas(canvas, data, layout, preferences, now);
  return canvas.toRawPixels();
}
