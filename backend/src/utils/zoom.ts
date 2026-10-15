// Zoom: an enlargement of everything a widget draws (text, lines, bars, cells).
// A widget is laid out on a smaller logical canvas and each logical pixel becomes a
// zoom x zoom block, so one renderer serves every panel size. A layout's zoom is a whole
// factor; a widget's may be any multiple of 0.2, drawn with block edges rounded to the
// nearest pixel. Mirrored in frontend/src/lib/zoom.ts.

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/** The smallest logical canvas auto zoom leaves: roughly the 250 x 122 panel the widgets were designed on. */
const AUTO_MIN_WIDTH = 200;
const AUTO_MIN_HEIGHT = 100;

/** A logical widget must keep room for one line of text (8 px glyph and padding) and a few characters. */
const MIN_LOGICAL_HEIGHT = 10;
const MIN_LOGICAL_WIDTH = 32;

/** A widget's own zoom moves in finer steps than a layout's, so text can be sized between the whole factors. */
export const WIDGET_ZOOM_STEP = 0.2;
const STEPS_PER_UNIT = Math.round(1 / WIDGET_ZOOM_STEP);

/** A layout's zoom: a whole factor. */
export function isZoom(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_ZOOM && value <= MAX_ZOOM;
}

/** A widget's zoom: a multiple of 0.2 from 1 to 4, so every whole factor is also allowed. */
export function isWidgetZoom(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < MIN_ZOOM || value > MAX_ZOOM) return false;
  return Math.abs(value * STEPS_PER_UNIT - Math.round(value * STEPS_PER_UNIT)) < 1e-6;
}

/**
 * Zoom for a panel that has none chosen: the largest whole factor that still leaves a logical
 * canvas of about 200 x 100. 250 x 122 stays 1, 400 x 300 gives 2 and 800 x 480 gives 4.
 */
export function autoZoom(width: number, height: number): number {
  const factor = Math.floor(Math.min(width / AUTO_MIN_WIDTH, height / AUTO_MIN_HEIGHT));
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number.isFinite(factor) ? factor : MIN_ZOOM));
}

/** The widget's own zoom, else the layout's, else the panel's automatic one. */
export function chooseZoom(widgetZoom: number | undefined, layoutZoom: number | undefined, panel: { width: number; height: number }): number {
  return widgetZoom ?? layoutZoom ?? autoZoom(panel.width, panel.height);
}

/**
 * Lowers `zoom` until a line of text fits in the widget. A clipped half line of text is never
 * wanted, so a zoom too large for a small widget gives way rather than drawing garbage.
 */
export function fitZoom(zoom: number, width: number, height: number): number {
  // A whole zoom gives way in whole steps, a fine one in fine steps.
  const step = Number.isInteger(zoom) ? 1 : WIDGET_ZOOM_STEP;
  let fitted = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(zoom * STEPS_PER_UNIT) / STEPS_PER_UNIT));
  if (step === 1) fitted = Math.floor(fitted);
  while (fitted > MIN_ZOOM && (Math.floor(height / fitted) < MIN_LOGICAL_HEIGHT || Math.floor(width / fitted) < MIN_LOGICAL_WIDTH)) {
    fitted = Math.max(MIN_ZOOM, Math.round((fitted - step) * STEPS_PER_UNIT) / STEPS_PER_UNIT);
  }
  return fitted;
}
