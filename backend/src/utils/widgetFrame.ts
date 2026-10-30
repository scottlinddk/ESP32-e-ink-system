import type { Bounds } from './zoomCanvas';

// Where a widget's content sits inside its area, and the outline drawn around it.
// Both are per-placement options; the outline can also be set for the whole layout.
// Mirrored in frontend/src/lib/widgetFrame.ts.

/** `vertical-horizontal`. `top-left` is where every widget draws on its own, so it is the default and is not stored. */
export const WIDGET_ALIGNMENTS = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
] as const;
export type WidgetAlign = typeof WIDGET_ALIGNMENTS[number];
export const DEFAULT_ALIGN: WidgetAlign = 'top-left';

/**
 * `thin` is a 1 px box, `thick` a 2 px one, `rounded` a 1 px box with cut corners and `dashed`
 * a broken 1 px line. `none` is the default; a widget stores it only to opt out of the layout's outline.
 */
export const WIDGET_OUTLINES = ['none', 'thin', 'thick', 'rounded', 'dashed'] as const;
export type WidgetOutline = typeof WIDGET_OUTLINES[number];
export type LayoutOutline = Exclude<WidgetOutline, 'none'>;

export function isWidgetAlign(value: unknown): value is WidgetAlign {
  return typeof value === 'string' && (WIDGET_ALIGNMENTS as readonly string[]).includes(value);
}

export function isWidgetOutline(value: unknown): value is WidgetOutline {
  return typeof value === 'string' && (WIDGET_OUTLINES as readonly string[]).includes(value);
}

/** The widget's own outline, else the layout's, else none. */
export function chooseOutline(widget: WidgetOutline | undefined, layout: LayoutOutline | undefined): WidgetOutline {
  return widget ?? layout ?? 'none';
}

/** Line thickness in units of the frame scale. */
const LINE: Record<LayoutOutline, number> = { thin: 1, thick: 2, rounded: 1, dashed: 1 };

/**
 * The outline's box and what is left inside it. A white gap of `scale` pixels separates the
 * line from the cell edge, so two outlined neighbours never merge into one thick line.
 * `scale` is the layout's whole zoom, so outlines grow with the panel like everything else.
 */
export function outlineBoxes(cell: Bounds, outline: LayoutOutline, scale: number): { frame: Bounds; inner: Bounds } {
  const gap = scale;
  // The same again inside the line, as some widgets draw right up to their left edge.
  const inset = gap + LINE[outline] * scale + scale;
  const frame = { x: cell.x + gap, y: cell.y + gap, width: cell.width - 2 * gap, height: cell.height - 2 * gap };
  const inner = { x: cell.x + inset, y: cell.y + inset, width: cell.width - 2 * inset, height: cell.height - 2 * inset };
  return { frame, inner };
}

export interface FrameCanvas {
  fillRect(x: number, y: number, w: number, h: number, black?: boolean): void;
}

export interface WidgetFrame {
  cell: Bounds;
  frame: Bounds;
  outline: LayoutOutline;
  scale: number;
}

/**
 * Keep the chosen style on exposed edges, but replace both inset edges of touching
 * frames with one physical pixel. Work from the visible frames only, so hidden or
 * too-small widgets cannot leave phantom dividers. Draw after content and before inversion.
 */
export function drawWidgetOutlines(canvas: FrameCanvas, frames: WidgetFrame[]): void {
  const hidden = frames.map(() => [] as Bounds[]);
  const dividers: Bounds[] = [];
  for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) {
    const a = frames[i], b = frames[j];
    for (const vertical of [true, false]) {
      const start = vertical ? 'x' : 'y';
      const size = vertical ? 'width' : 'height';
      const cross = vertical ? 'y' : 'x';
      const span = vertical ? 'height' : 'width';
      const [lo, hi, li, hiIndex]: [WidgetFrame, WidgetFrame, number, number] =
        a.cell[start] < b.cell[start] ? [a, b, i, j] : [b, a, j, i];
      const boundary = hi.cell[start];
      if (lo.cell[start] + lo.cell[size] !== boundary) continue;
      const from = Math.max(lo.cell[cross], hi.cell[cross]);
      const to = Math.min(lo.cell[cross] + lo.cell[span], hi.cell[cross] + hi.cell[span]);
      if (from >= to) continue;
      const rect = (at: number, width: number): Bounds => vertical
        ? { x: at, y: from, width, height: to - from }
        : { x: from, y: at, width: to - from, height: width };
      const loEdge = lo.frame[start] + lo.frame[size] - LINE[lo.outline] * lo.scale;
      const hiEdge = hi.frame[start] + LINE[hi.outline] * hi.scale;
      hidden[li].push(rect(loEdge, boundary - loEdge));
      hidden[hiIndex].push(rect(boundary, hiEdge - boundary));
      dividers.push(rect(boundary, 1));
    }
  }
  frames.forEach(({ frame, outline, scale }, i) => {
    if (!hidden[i].length) { drawOutline(canvas, frame, outline, scale); return; }
    drawOutline({
      fillRect(x, y, width, height) {
        for (let py = y; py < y + height; py++) {
          let run = x;
          for (let px = x; px <= x + width; px++) {
            const skip = px === x + width || hidden[i].some(r =>
              px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height);
            if (skip) {
              if (px > run) canvas.fillRect(run, py, px - run, 1);
              run = px + 1;
            }
          }
        }
      },
    }, frame, outline, scale);
  });
  for (const r of dividers) canvas.fillRect(r.x, r.y, r.width, r.height);
}

/** Draws the outline inside `frame`, in physical pixels. */
export function drawOutline(canvas: FrameCanvas, frame: Bounds, outline: LayoutOutline, scale: number): void {
  const { x, y, width, height } = frame;
  const t = LINE[outline] * scale;
  if (width < 2 * t || height < 2 * t) return;
  if (outline === 'dashed') {
    // Dashes of about 3 with gaps of about 2 (times the scale), spread so every side starts and ends on a dash and the corners stay closed.
    const dash = 3 * scale;
    const run = (length: number, draw: (offset: number, size: number) => void) => {
      const count = Math.max(2, Math.round((length + 2 * scale) / (5 * scale)));
      if (length <= dash * count) { draw(0, length); return; }
      const pitch = (length - dash) / (count - 1);
      for (let i = 0; i < count; i++) draw(Math.round(i * pitch), dash);
    };
    run(width, (o, s) => { canvas.fillRect(x + o, y, s, t); canvas.fillRect(x + o, y + height - t, s, t); });
    run(height, (o, s) => { canvas.fillRect(x, y + o, t, s); canvas.fillRect(x + width - t, y + o, t, s); });
    return;
  }
  // A rounded box leaves its corners out and joins the sides with a diagonal step.
  const cut = outline === 'rounded' ? 2 * scale : 0;
  canvas.fillRect(x + cut, y, width - 2 * cut, t);
  canvas.fillRect(x + cut, y + height - t, width - 2 * cut, t);
  canvas.fillRect(x, y + cut, t, height - 2 * cut);
  canvas.fillRect(x + width - t, y + cut, t, height - 2 * cut);
  if (cut) {
    for (const [cx, cy] of [[x + scale, y + scale], [x + width - 2 * scale, y + scale], [x + scale, y + height - 2 * scale], [x + width - 2 * scale, y + height - 2 * scale]]) {
      canvas.fillRect(cx, cy, scale, scale);
    }
  }
}

function splitAlign(align: WidgetAlign): { vertical: 'top' | 'middle' | 'bottom'; horizontal: 'left' | 'center' | 'right' } {
  const [vertical, horizontal] = align.split('-') as ['top' | 'middle' | 'bottom', 'left' | 'center' | 'right'];
  return { vertical, horizontal };
}

/** Moves `[start, end)` within `[min, max)`: `start` stays put, `center` centres it, `end` leaves `pad` before `max`. */
function shift(position: 'start' | 'center' | 'end', start: number, end: number, min: number, max: number, pad: number): number {
  const lowest = min - start;
  const highest = max - end;
  // Content wider than the box cannot move anywhere useful.
  if (highest < lowest) return 0;
  let offset = 0;
  if (position === 'center') offset = Math.round((min + max - start - end) / 2);
  // `end` never moves content back past where the widget drew it.
  else if (position === 'end') offset = Math.max(0, max - pad - end);
  return Math.min(highest, Math.max(lowest, offset));
}

/**
 * How far to move drawn content (`ink`) inside `box` for an alignment. Left and top keep the
 * widget's own position; right and bottom mirror its 2 px margin (`pad`, already zoomed).
 */
export function alignOffset(box: Bounds, ink: Bounds, align: WidgetAlign, pad: number): { dx: number; dy: number } {
  const { vertical, horizontal } = splitAlign(align);
  const h = horizontal === 'left' ? 'start' : horizontal === 'center' ? 'center' : 'end';
  const v = vertical === 'top' ? 'start' : vertical === 'middle' ? 'center' : 'end';
  return {
    dx: shift(h, ink.x, ink.x + ink.width, box.x, box.x + box.width, pad),
    dy: shift(v, ink.y, ink.y + ink.height, box.y, box.y + box.height, pad),
  };
}

/** A `width` × `height` area placed inside `box` by an alignment, for content that is sized up front (a photo). */
export function alignArea(box: Bounds, width: number, height: number, align: WidgetAlign): Bounds {
  const { vertical, horizontal } = splitAlign(align);
  const free = { x: Math.max(0, box.width - width), y: Math.max(0, box.height - height) };
  const along = (position: string, room: number) => (position === 'left' || position === 'top' ? 0
    : position === 'center' || position === 'middle' ? Math.floor(room / 2) : room);
  return { x: box.x + along(horizontal, free.x), y: box.y + along(vertical, free.y), width: Math.min(width, box.width), height: Math.min(height, box.height) };
}

