import { DisplayData, DisplayLayout, WidgetLayout } from '../types/index';

// Public domain 8x8 bitmap font (CP437 subset, chars 32–127)
// Each entry = 8 bytes, one byte per row, MSB = leftmost pixel
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
const ROW_STRIDE = Math.ceil(DISPLAY_WIDTH / 32) * 4; // = 32 bytes

export class BmpCanvas {
  private pixels: Uint8Array;

  constructor() {
    // 1 bit per pixel; initialise to all white (0xFF = all bits set = white)
    this.pixels = new Uint8Array(ROW_STRIDE * DISPLAY_HEIGHT).fill(0xff);
  }

  setPixel(x: number, y: number, black: boolean): void {
    if (x < 0 || x >= DISPLAY_WIDTH || y < 0 || y >= DISPLAY_HEIGHT) return;
    const byteIdx = y * ROW_STRIDE + Math.floor(x / 8);
    const bitMask = 0x80 >> (x % 8);
    if (black) {
      this.pixels[byteIdx] &= ~bitMask;
    } else {
      this.pixels[byteIdx] |= bitMask;
    }
  }

  drawHLine(x: number, y: number, w: number): void {
    for (let i = 0; i < w; i++) this.setPixel(x + i, y, true);
  }

  fillRect(x: number, y: number, w: number, h: number, black = true): void {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        this.setPixel(col, row, black);
      }
    }
  }

  drawChar(ch: number, x: number, y: number): void {
    if (ch < 32 || ch > 127) ch = 63; // '?' for unknown
    const glyph = FONT8X8[ch - 32];
    for (let row = 0; row < 8; row++) {
      const byte = glyph[row];
      for (let col = 0; col < 8; col++) {
        if (byte & (0x80 >> col)) this.setPixel(x + col, y + row, true);
      }
    }
  }

  drawText(text: string, x: number, y: number, maxWidth = DISPLAY_WIDTH): void {
    let cx = x;
    for (const ch of text) {
      if (cx + 8 > x + maxWidth || cx + 8 > DISPLAY_WIDTH) break;
      const code = ch.charCodeAt(0);
      // Replace non-ASCII with '?'
      this.drawChar(code >= 32 && code <= 127 ? code : 63, cx, y);
      cx += 8;
    }
  }

  // Word-wrap text within a box; returns the y position after the last line
  drawWrappedText(text: string, x: number, y: number, w: number, lineH = 10): number {
    const maxChars = Math.floor(w / 8);
    const words = text.split(' ');
    let line = '';
    let cy = y;

    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= maxChars) {
        line = candidate;
      } else {
        if (line) {
          this.drawText(line, x, cy, w);
          cy += lineH;
          if (cy + 8 > DISPLAY_HEIGHT) break;
        }
        // word longer than line — truncate
        line = word.length > maxChars ? word.slice(0, maxChars) : word;
      }
    }
    if (line && cy + 8 <= DISPLAY_HEIGHT) {
      this.drawText(line, x, cy, w);
      cy += lineH;
    }
    return cy;
  }

  toBmp(): Buffer {
    const pixelDataSize = ROW_STRIDE * DISPLAY_HEIGHT;
    const fileSize = 14 + 40 + 8 + pixelDataSize;
    const buf = Buffer.alloc(fileSize, 0);

    // --- BITMAPFILEHEADER (14 bytes) ---
    buf.write('BM', 0, 'ascii');
    buf.writeUInt32LE(fileSize, 2);
    // reserved bytes 6–9 = 0
    buf.writeUInt32LE(62, 10); // pixel data offset = 14 + 40 + 8

    // --- BITMAPINFOHEADER (40 bytes) ---
    buf.writeUInt32LE(40, 14);
    buf.writeInt32LE(DISPLAY_WIDTH, 18);
    buf.writeInt32LE(-DISPLAY_HEIGHT, 22); // negative = top-down storage
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
    buf.set(this.pixels, 62);

    return buf;
  }
}

// ── Grid constants ───────────────────────────────────────────────────────────

export const GRID_COLS = 10;
export const GRID_ROWS = 6;
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

interface WidgetBounds { x: number; y: number; width: number; height: number; }

function getWidgetBounds(w: WidgetLayout): WidgetBounds {
  return {
    x: w.x * COL_PX,
    y: w.y * ROW_PX,
    width: w.w * COL_PX,
    height: w.h * ROW_PX,
  };
}

function trendArrow(trend?: 'up' | 'down' | 'stable'): string {
  if (trend === 'up') return '^';
  if (trend === 'down') return 'v';
  return '-';
}

// ── Per-widget renderers ──────────────────────────────────────────────────────

function renderEnergyWidget(
  canvas: BmpCanvas,
  bounds: WidgetBounds,
  price?: DisplayData['price']
): void {
  const { x, y, width, height } = bounds;
  if (y > 0) canvas.drawHLine(0, y, DISPLAY_WIDTH);
  const textY = y + 2;
  const maxW = width - 4;
  if (price) {
    const { now, average, trend } = price;
    const arrow = trendArrow(trend);
    canvas.drawText(`Energy: ${(now / 100).toFixed(2)} DKK/kWh ${arrow}`, x + 2, textY, maxW);
    if (height >= 20) {
      canvas.drawText(`Avg: ${(average / 100).toFixed(2)}  Now: ${(now / 100).toFixed(2)}`, x + 2, textY + 11, maxW);
    }
  } else {
    canvas.drawText('Energy: unavailable', x + 2, textY, maxW);
  }
}

function renderWeatherWidget(
  canvas: BmpCanvas,
  bounds: WidgetBounds,
  weather?: DisplayData['weather']
): void {
  const { x, y, width, height } = bounds;
  if (y > 0) canvas.drawHLine(0, y, DISPLAY_WIDTH);
  const textY = y + 2;
  const maxW = width - 4;
  if (weather) {
    const { temp, condition, windSpeed } = weather;
    canvas.drawText(`${condition}  ${Math.round(temp)}C`, x + 2, textY, maxW);
    if (height >= 20) {
      canvas.drawText(`Wind: ${windSpeed.toFixed(1)} m/s`, x + 2, textY + 11, maxW);
    }
  } else {
    canvas.drawText('Weather: unavailable', x + 2, textY, maxW);
  }
}

function renderNewsWidget(
  canvas: BmpCanvas,
  bounds: WidgetBounds,
  news?: DisplayData['news']
): void {
  const { x, y, width, height } = bounds;
  if (y > 0) canvas.drawHLine(0, y, DISPLAY_WIDTH);
  const textY = y + 2;
  const maxW = width - 4;
  if (news && news.length > 0) {
    canvas.drawWrappedText(news[0].title, x + 2, textY, maxW, 10);
  } else {
    canvas.drawText('No news available', x + 2, textY, maxW);
  }
}

function renderMontaWidget(
  canvas: BmpCanvas,
  bounds: WidgetBounds,
  data?: DisplayData['monta'],
  fields: string[] = ['charger_status', 'active_session']
): void {
  const { x, y, width, height } = bounds;
  if (y > 0) canvas.drawHLine(0, y, DISPLAY_WIDTH);
  const maxW = width - 4;
  let textY = y + 2;

  if (!data) {
    canvas.drawText('Monta: unavailable', x + 2, textY, maxW);
    return;
  }

  canvas.drawText('Monta', x + 2, textY, maxW);
  textY += 10;

  if (fields.includes('charger_status') && data.chargePoints.length > 0) {
    const available = data.chargePoints.filter((cp) => cp.state === 'available').length;
    const charging = data.chargePoints.filter((cp) => cp.state === 'charging').length;
    canvas.drawText(`${available} avail  ${charging} charging`, x + 2, textY, maxW);
    textY += 10;
  }

  if (fields.includes('active_session')) {
    if (data.activeSessions.length > 0) {
      const s = data.activeSessions[0];
      canvas.drawText(
        `${s.energyDeliveredKwh.toFixed(1)}kWh  ${s.durationMin}min`,
        x + 2,
        textY,
        maxW
      );
      textY += 10;
    }
  }

  if (fields.includes('today_stats') && data.todayKwh !== null && textY < y + height - 8) {
    canvas.drawText(`Today: ${data.todayKwh.toFixed(1)} kWh`, x + 2, textY, maxW);
  }
}

function renderZaptecWidget(
  canvas: BmpCanvas,
  bounds: WidgetBounds,
  data?: DisplayData['zaptec'],
  fields: string[] = ['charger_status', 'active_session']
): void {
  const { x, y, width, height } = bounds;
  if (y > 0) canvas.drawHLine(0, y, DISPLAY_WIDTH);
  const maxW = width - 4;
  let textY = y + 2;

  if (!data) {
    canvas.drawText('Zaptec: unavailable', x + 2, textY, maxW);
    return;
  }

  const title = data.installationName ? `Zaptec - ${data.installationName}` : 'Zaptec';
  canvas.drawText(title, x + 2, textY, maxW);
  textY += 10;

  if (fields.includes('charger_status') && data.chargers.length > 0) {
    const available = data.chargers.filter((c) => c.operatingMode === 2 || c.operatingMode === 3).length;
    const charging = data.chargers.filter((c) => c.operatingMode === 5).length;
    canvas.drawText(`${available} avail  ${charging} charging`, x + 2, textY, maxW);
    textY += 10;
  }

  if (fields.includes('active_session') && data.activeSession && textY < y + height - 8) {
    const s = data.activeSession;
    canvas.drawText(
      `${s.energyDeliveredKwh.toFixed(1)}kWh  ${s.chargerName}`,
      x + 2,
      textY,
      maxW
    );
  }
}

function renderStatusWidget(
  canvas: BmpCanvas,
  bounds: WidgetBounds,
  nextRefresh: number
): void {
  const { x, y, width } = bounds;
  canvas.drawHLine(0, y, DISPLAY_WIDTH);
  const statusY = y + 2;
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const refreshMin = Math.round(nextRefresh / 60000);
  canvas.drawText(`Refresh: ${refreshMin}min  ${timeStr}`, x + 2, statusY, width - 4);
}

// ── Main render entry point ───────────────────────────────────────────────────

export function renderDisplayData(data: DisplayData, layout?: DisplayLayout | null): Buffer {
  const canvas = new BmpCanvas();
  const effectiveLayout = layout ?? DEFAULT_LAYOUT;

  for (const widget of effectiveLayout.widgets) {
    const bounds = getWidgetBounds(widget);
    switch (widget.i) {
      case 'energy':
        renderEnergyWidget(canvas, bounds, data.price);
        break;
      case 'weather':
        renderWeatherWidget(canvas, bounds, data.weather);
        break;
      case 'news':
        renderNewsWidget(canvas, bounds, data.news);
        break;
      case 'monta':
        renderMontaWidget(canvas, bounds, data.monta);
        break;
      case 'zaptec':
        renderZaptecWidget(canvas, bounds, data.zaptec);
        break;
      case 'status':
        renderStatusWidget(canvas, bounds, data.nextRefresh);
        break;
    }
  }

  return canvas.toBmp();
}
