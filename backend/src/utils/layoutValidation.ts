import type { DisplayLayout, WidgetLayout } from '../types';

export const DISPLAY_WIDGET_IDS = ['energy', 'weather', 'news', 'monta', 'zaptec', 'notion', 'custom-text', 'custom-image', 'custom-webhook', 'status'] as const;

export class LayoutValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LayoutValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Validate untrusted layouts before any provider requests or pixel rendering. */
export function parseDisplayLayout(value: unknown): DisplayLayout {
  if (!isRecord(value) || value.version !== 1 || value.cols !== 10 || value.rows !== 6) {
    throw new LayoutValidationError('Layout must use version 1 and a 10 × 6 grid.');
  }
  if (!Array.isArray(value.widgets) || value.widgets.length > DISPLAY_WIDGET_IDS.length) {
    throw new LayoutValidationError('Layout widgets must be an array with at most one of each supported widget.');
  }

  const seen = new Set<string>();
  const widgets: WidgetLayout[] = [];
  for (const input of value.widgets) {
    if (!isRecord(input) || typeof input.i !== 'string'
      || !DISPLAY_WIDGET_IDS.some((id) => id === input.i) || seen.has(input.i)) {
      throw new LayoutValidationError('Every widget must have a supported, unique ID.');
    }
    if (![input.x, input.y, input.w, input.h].every((n) => typeof n === 'number' && Number.isInteger(n))) {
      throw new LayoutValidationError('Widget positions and sizes must be whole numbers.');
    }
    const { x, y, w, h } = input as unknown as WidgetLayout;
    if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > 10 || y + h > 6) {
      throw new LayoutValidationError('Widgets must fit inside the 10 × 6 grid.');
    }
    if (input.static !== undefined && typeof input.static !== 'boolean') {
      throw new LayoutValidationError('The widget static flag must be a boolean.');
    }
    if (widgets.some((other) => x < other.x + other.w && x + w > other.x
      && y < other.y + other.h && y + h > other.y)) {
      throw new LayoutValidationError('Widgets must not overlap.');
    }
    seen.add(input.i);
    widgets.push({ i: input.i, x, y, w, h, ...(input.static === undefined ? {} : { static: input.static }) });
  }
  return { version: 1, cols: 10, rows: 6, widgets };
}
