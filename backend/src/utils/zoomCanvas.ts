import { MAX_ZOOM, MIN_ZOOM } from './zoom';

export interface Bounds { x: number; y: number; width: number; height: number }

/** What widget renderers draw with. BmpCanvas draws 1:1; ZoomCanvas draws each logical pixel as a block. */
export interface DrawingCanvas {
  readonly width: number;
  readonly height: number;
  setPixel(x: number, y: number, black: boolean): void;
  withClip(bounds: Bounds, draw: () => void): void;
  drawHLine(x: number, y: number, w: number): void;
  fillRect(x: number, y: number, w: number, h: number, black?: boolean): void;
  drawText(text: string, x: number, y: number, maxWidth?: number, scale?: number, black?: boolean): void;
  drawWrappedText(text: string, x: number, y: number, w: number, lineH?: number, scale?: number): number;
}

/**
 * Widget bounds in logical pixels for a zoom. The start rounds up and the end down, so the
 * logical box always lies inside the physical one, and a widget below the top edge keeps y > 0.
 */
export function logicalBounds(bounds: Bounds, zoom: number): Bounds {
  const x = Math.ceil(bounds.x / zoom);
  const y = Math.ceil(bounds.y / zoom);
  return {
    x, y,
    width: Math.max(0, Math.floor((bounds.x + bounds.width) / zoom) - x),
    height: Math.max(0, Math.floor((bounds.y + bounds.height) / zoom) - y),
  };
}

/** Draws on `target` as if it were `zoom` times smaller. All coordinates, sizes and font scales are logical. */
export class ZoomCanvas implements DrawingCanvas {
  readonly width: number;
  readonly height: number;

  constructor(private readonly target: DrawingCanvas, readonly zoom: number) {
    if (!Number.isInteger(zoom) || zoom < MIN_ZOOM || zoom > MAX_ZOOM) throw new RangeError(`Zoom must be a whole number from ${MIN_ZOOM} to ${MAX_ZOOM}.`);
    this.width = Math.floor(target.width / zoom);
    this.height = Math.floor(target.height / zoom);
  }

  setPixel(x: number, y: number, black: boolean): void {
    if (!Number.isInteger(x) || !Number.isInteger(y)) return;
    this.target.fillRect(x * this.zoom, y * this.zoom, this.zoom, this.zoom, black);
  }

  withClip(bounds: Bounds, draw: () => void): void {
    const z = this.zoom;
    this.target.withClip({ x: bounds.x * z, y: bounds.y * z, width: bounds.width * z, height: bounds.height * z }, draw);
  }

  drawHLine(x: number, y: number, w: number): void {
    this.target.fillRect(x * this.zoom, y * this.zoom, w * this.zoom, this.zoom);
  }

  fillRect(x: number, y: number, w: number, h: number, black = true): void {
    const z = this.zoom;
    this.target.fillRect(x * z, y * z, w * z, h * z, black);
  }

  drawText(text: string, x: number, y: number, maxWidth = this.width, scale = 1, black = true): void {
    const z = this.zoom;
    this.target.drawText(text, x * z, y * z, maxWidth * z, scale * z, black);
  }

  /** Returns the logical y after the last line. */
  drawWrappedText(text: string, x: number, y: number, w: number, lineH = 10, scale = 1): number {
    const z = this.zoom;
    return this.target.drawWrappedText(text, x * z, y * z, w * z, lineH * z, scale * z) / z;
  }
}
