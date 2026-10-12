// Battery widget: the device's last reported charge as "17%" beside an outlined cell
// with a terminal nub, filled left to right. A device that has not reported a reading
// shows "--%" and an empty cell with "?", never a made-up level.

export interface BatteryCanvas {
  drawHLine(x: number, y: number, w: number): void;
  fillRect(x: number, y: number, w: number, h: number, black?: boolean): void;
  drawText(text: string, x: number, y: number, maxWidth?: number, scale?: number, black?: boolean): void;
}

export interface BatteryBounds { x: number; y: number; width: number; height: number }

/** `percent` is the device's own report, 0-100. */
export interface BatteryData { percent: number }

const GLYPH = 8;
const PAD = 3;
const GAP = 4;
const MAX_TEXT_SCALE = 3;
const MIN_CELL_WIDTH = 16;
const MIN_CELL_HEIGHT = 8;

/** Whole percent, or null when there is no usable reading. */
export function batteryPercent(battery: BatteryData | undefined): number | null {
  const value = battery?.percent;
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null;
}

/** Filled interior width in pixels. A non-empty battery always shows at least one pixel. */
export function fillWidth(percent: number, interiorWidth: number): number {
  if (percent <= 0 || interiorWidth <= 0) return 0;
  return Math.min(interiorWidth, Math.max(1, Math.round(interiorWidth * percent / 100)));
}

/**
 * Outline with clipped corners, a nub on the right and a filled interior.
 * `width` includes the nub. `percent` null draws an empty cell with a "?".
 */
export function drawCell(canvas: BatteryCanvas, x: number, y: number, width: number, height: number, percent: number | null): void {
  const nubW = Math.max(2, Math.min(4, Math.floor(width / 10)));
  const nubH = Math.max(3, Math.floor(height / 3));
  const bodyW = width - nubW;
  // Outline: four 1px edges, leaving the corner pixels white for a rounded look.
  canvas.fillRect(x + 1, y, bodyW - 2, 1);
  canvas.fillRect(x + 1, y + height - 1, bodyW - 2, 1);
  canvas.fillRect(x, y + 1, 1, height - 2);
  canvas.fillRect(x + bodyW - 1, y + 1, 1, height - 2);
  canvas.fillRect(x + bodyW, y + Math.floor((height - nubH) / 2), nubW, nubH);

  // One pixel of white between the outline and the fill keeps a full cell distinguishable from a thick border.
  const interiorX = x + 2;
  const interiorY = y + 2;
  const interiorW = bodyW - 4;
  const interiorH = height - 4;
  if (interiorW <= 0 || interiorH <= 0) return;
  if (percent === null) {
    if (interiorH >= GLYPH && interiorW >= GLYPH) {
      canvas.drawText('?', interiorX + Math.floor((interiorW - GLYPH) / 2), interiorY + Math.floor((interiorH - GLYPH) / 2), GLYPH);
    }
    return;
  }
  canvas.fillRect(interiorX, interiorY, fillWidth(percent, interiorW), interiorH);
}

/** Largest text scale (at most 3) whose height fits and whose label leaves room for a minimum cell. */
function pickScale(label: string, width: number, height: number): number {
  for (let scale = Math.min(MAX_TEXT_SCALE, Math.floor(height / GLYPH)); scale >= 1; scale--) {
    if (label.length * GLYPH * scale + GAP + MIN_CELL_WIDTH <= width) return scale;
  }
  return 0;
}

export function renderBatteryWidget(canvas: BatteryCanvas, bounds: BatteryBounds, battery: BatteryData | undefined): void {
  const { x, width } = bounds;
  if (bounds.y > 0) canvas.drawHLine(x, bounds.y, width);
  const y = bounds.y > 0 ? bounds.y + 1 : bounds.y;
  const height = bounds.y > 0 ? bounds.height - 1 : bounds.height;
  const innerW = width - 2 * PAD;
  const innerH = height - 2 * PAD;
  if (innerW < MIN_CELL_WIDTH || innerH < MIN_CELL_HEIGHT) return;

  const percent = batteryPercent(battery);
  const label = percent === null ? '--%' : `${percent}%`;
  const scale = pickScale(label, innerW, innerH);

  // Too narrow for text and a cell side by side: the cell alone, which still reads at a glance.
  if (scale === 0) {
    const cellH = Math.min(innerH, Math.max(MIN_CELL_HEIGHT, Math.floor(innerW / 2)));
    drawCell(canvas, x + PAD, y + PAD + Math.floor((innerH - cellH) / 2), innerW, cellH, percent);
    return;
  }

  const textW = label.length * GLYPH * scale;
  // The cell grows with the text but never past the space left, so the pair centres as a group.
  const cellH = Math.min(innerH, GLYPH * scale + 8);
  const cellW = Math.min(innerW - textW - GAP, Math.round(cellH * 2.6));
  const groupW = textW + GAP + cellW;
  const left = x + PAD + Math.floor((innerW - groupW) / 2);
  canvas.drawText(label, left, y + PAD + Math.floor((innerH - GLYPH * scale) / 2), textW, scale);
  drawCell(canvas, left + textW + GAP, y + PAD + Math.floor((innerH - cellH) / 2), cellW, cellH, percent);
}

const COMPACT_CELL_W = 16;
const COMPACT_CELL_H = 8;

/** Width of the one-line "17% [cell]" form, or 0 when there is no reading (a status bar has no room for "--%"). */
export function compactBatteryWidth(battery: BatteryData | undefined): number {
  const percent = batteryPercent(battery);
  return percent === null ? 0 : `${percent}%`.length * GLYPH + GAP + COMPACT_CELL_W;
}

/** Draws the compact form with its right edge at `right` and its top at `y` (one 8px text line). */
export function drawCompactBattery(canvas: BatteryCanvas, right: number, y: number, battery: BatteryData | undefined): void {
  const percent = batteryPercent(battery);
  if (percent === null) return;
  const label = `${percent}%`;
  const left = right - compactBatteryWidth(battery);
  canvas.drawText(label, left, y, label.length * GLYPH);
  drawCell(canvas, left + label.length * GLYPH + GAP, y, COMPACT_CELL_W, COMPACT_CELL_H, percent);
}
