import type { DrawingCanvas } from './zoomCanvas';

// Weather icons for a 1-bit panel, drawn from pixels so they scale with the widget: a sun with
// rays, a moon, outlined clouds, rain, snow, a lightning bolt and mist. They follow the
// OpenWeatherMap icon codes (`01d`, `10n`, ...), whose digits name the weather and whose letter
// says day or night. Below about 14 pixels clouds are solid, because an outline would fill in.

type Pen = Pick<DrawingCanvas, 'setPixel' | 'fillRect'>;

const round = Math.round;

function disc(pen: Pen, cx: number, cy: number, radius: number, black = true): void {
  if (radius <= 0) return;
  const reach = Math.ceil(radius);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (Math.hypot(dx, dy) <= radius + 0.2) pen.setPixel(round(cx) + dx, round(cy) + dy, black);
    }
  }
}

/** A line with a square pen `thickness` wide. */
function line(pen: Pen, x0: number, y0: number, x1: number, y1: number, thickness = 1, black = true): void {
  let x = round(x0), y = round(y0);
  const endX = round(x1), endY = round(y1);
  const dx = Math.abs(endX - x), dy = -Math.abs(endY - y);
  const sx = x < endX ? 1 : -1, sy = y < endY ? 1 : -1;
  let error = dx + dy;
  const half = Math.floor((thickness - 1) / 2);
  for (;;) {
    pen.fillRect(x - half, y - half, thickness, thickness, black);
    if (x === endX && y === endY) break;
    const doubled = 2 * error;
    if (doubled >= dy) { error += dy; x += sx; }
    if (doubled <= dx) { error += dx; y += sy; }
  }
}

/**
 * A cloud filling a w x h box: three round tops on a flat base. A positive `inset` shrinks it
 * (to paint its inside white), a negative one grows it (to clear what is behind it).
 */
function cloudShape(pen: Pen, x: number, y: number, w: number, h: number, black: boolean, inset: number): void {
  const left = { cx: x + w * 0.25, cy: y + h * 0.66, r: h * 0.27 - inset };
  const top = { cx: x + w * 0.45, cy: y + h * 0.44, r: h * 0.4 - inset };
  const right = { cx: x + w * 0.73, cy: y + h * 0.6, r: h * 0.33 - inset };
  for (const part of [left, top, right]) disc(pen, part.cx, part.cy, part.r, black);
  const baseTop = round(y + h * 0.66), baseBottom = round(y + h * 0.93 - inset);
  const baseLeft = round(left.cx), baseRight = round(right.cx);
  pen.fillRect(baseLeft, baseTop, baseRight - baseLeft + 1, baseBottom - baseTop + 1, black);
}

function cloud(pen: Pen, x: number, y: number, w: number, h: number, size: number, halo = false): void {
  if (halo) cloudShape(pen, x, y, w, h, false, -Math.max(1, round(size / 16)));
  cloudShape(pen, x, y, w, h, true, 0);
  if (size >= 14) cloudShape(pen, x, y, w, h, false, size >= 36 ? 2.2 : 1.4);
}

function sun(pen: Pen, x: number, y: number, size: number): void {
  const cx = x + (size - 1) / 2, cy = y + (size - 1) / 2;
  const heavy = size >= 32 ? 2 : 1;
  const core = Math.max(2, size * 0.22);
  if (size >= 18) {
    disc(pen, cx, cy, core + heavy * 0.6);
    disc(pen, cx, cy, core + heavy * 0.6 - heavy - 0.2, false);
  } else disc(pen, cx, cy, core);
  const inner = core + Math.max(2.5, size * 0.12) + (size >= 18 ? heavy * 0.6 : 0);
  const outer = (size - 1) / 2;
  for (let ray = 0; ray < 8; ray++) {
    const angle = (ray * Math.PI) / 4;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    line(pen, cx + cos * inner, cy + sin * inner, cx + cos * outer, cy + sin * outer, heavy);
  }
}

function moon(pen: Pen, x: number, y: number, size: number): void {
  const cx = x + (size - 1) / 2, cy = y + (size - 1) / 2;
  const radius = size * 0.4;
  disc(pen, cx, cy, radius);
  disc(pen, cx + radius * 0.68, cy - radius * 0.55, radius * 0.95, false);
}

function rain(pen: Pen, x: number, y: number, w: number, h: number, size: number): void {
  const thickness = size >= 36 ? 2 : 1;
  const slant = Math.max(1, round(h * 0.25));
  for (const at of [0.22, 0.5, 0.78]) {
    const top = x + w * at;
    line(pen, top, y, top - slant, y + h, thickness);
  }
}

function snow(pen: Pen, x: number, y: number, w: number, h: number, size: number): void {
  const arm = size >= 28 ? 2 : size >= 18 ? 1 : 0;
  const spots: Array<[number, number]> = [[0.22, 0.2], [0.55, 0.2], [0.38, 0.75], [0.72, 0.75]];
  for (const [at, down] of spots) {
    const cx = round(x + w * at), cy = round(y + h * down);
    if (arm === 0) { pen.fillRect(cx, cy, 2, 2, true); continue; }
    line(pen, cx - arm, cy, cx + arm, cy);
    line(pen, cx, cy - arm, cx, cy + arm);
  }
}

function bolt(pen: Pen, x: number, y: number, w: number, h: number, size: number): void {
  const thickness = size >= 28 ? 2 : 1;
  const points: Array<[number, number]> = [[0.7, 0], [0.3, 0.55], [0.62, 0.5], [0.34, 1]];
  for (let i = 0; i < points.length - 1; i++) {
    line(pen, x + w * points[i][0], y + h * points[i][1], x + w * points[i + 1][0], y + h * points[i + 1][1], thickness);
  }
}

function mist(pen: Pen, x: number, y: number, size: number): void {
  const thickness = size >= 28 ? 2 : 1;
  const rows = size >= 24 ? 4 : 3;
  const gap = (size * 0.7) / rows;
  for (let row = 0; row < rows; row++) {
    const inset = row % 2 === 0 ? size * 0.08 : size * 0.2;
    pen.fillRect(round(x + inset), round(y + size * 0.15 + row * gap), round(size - inset * 2), thickness, true);
  }
}

/** Which family an OpenWeatherMap icon code belongs to, and whether it is a night icon. */
export function iconFamily(icon: string): { family: string; night: boolean } {
  return { family: icon.slice(0, 2), night: icon.endsWith('n') };
}

/** The pen limited to a box, so rounding at the edge of a shape can never reach outside it. */
function clipped(pen: Pen, x: number, y: number, size: number): Pen {
  const inside = (px: number, py: number) => px >= x && py >= y && px < x + size && py < y + size;
  return {
    setPixel: (px, py, black) => { if (inside(px, py)) pen.setPixel(px, py, black); },
    fillRect: (rx, ry, w, h, black) => {
      const left = Math.max(rx, x), top = Math.max(ry, y);
      const right = Math.min(rx + w, x + size), bottom = Math.min(ry + h, y + size);
      if (right > left && bottom > top) pen.fillRect(left, top, right - left, bottom - top, black);
    },
  };
}

/** Draws the icon in a `size` x `size` box whose top left is (x, y). */
export function drawWeatherIcon(canvas: Pen, icon: string, x: number, y: number, size: number): void {
  if (size < 6) return;
  x = round(x); y = round(y); size = round(size);
  const pen = clipped(canvas, x, y, size);
  const { family, night } = iconFamily(icon);
  const body = night ? moon : sun;
  // A small sun or moon peeking out behind a cloud, in the top right corner.
  const behind = () => { const small = round(size * 0.62); body(pen, x + size - small, y, small); };
  switch (family) {
    case '01': body(pen, x, y, size); break;
    case '02':
      behind();
      cloud(pen, x, y + size * 0.3, size * 0.82, size * 0.62, size, true);
      break;
    case '03': cloud(pen, x + size * 0.04, y + size * 0.22, size * 0.92, size * 0.6, size); break;
    case '04':
      cloud(pen, x + size * 0.32, y + size * 0.08, size * 0.66, size * 0.44, size);
      cloud(pen, x, y + size * 0.3, size * 0.84, size * 0.6, size, true);
      break;
    case '09': case '10': case '11': case '13': {
      const sunny = family === '10' && size >= 16;
      if (sunny) behind();
      const top = sunny ? 0.18 : 0.06;
      cloud(pen, x + size * 0.04, y + size * top, size * 0.92, size * 0.55, size, sunny);
      const belowY = round(y + size * (top + 0.55 + 0.08));
      const belowH = Math.max(3, y + size - 1 - belowY);
      const belowX = x + size * 0.2, belowW = size * 0.6;
      if (family === '13') snow(pen, belowX, belowY, belowW, belowH, size);
      else if (family === '11') bolt(pen, belowX + belowW * 0.1, belowY - size * 0.04, belowW * 0.8, belowH + size * 0.04, size);
      else rain(pen, belowX, belowY, belowW, belowH, size);
      break;
    }
    case '50': mist(pen, x, y, size); break;
    default: cloud(pen, x + size * 0.04, y + size * 0.22, size * 0.92, size * 0.6, size);
  }
}
