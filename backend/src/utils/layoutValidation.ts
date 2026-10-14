import type { DisplayLayout, WidgetLayout } from '../types';
import { MAX_NEWS_FEEDS, newsFeedIdFromWidget } from './newsFeeds';
import { MAX_TICKER_WIDGETS, tickerIdFromWidget } from './tickerWidgets';
import { parseWidgetOptions } from './widgetOptions';
import { isZoom, MAX_ZOOM, MIN_ZOOM } from './zoom';
import { BASE_GRID_COLS, BASE_GRID_ROWS, GRID_SCALES, gridScale } from './layoutGrid';

export const DISPLAY_WIDGET_IDS = ['energy', 'weather', 'news', 'monta', 'zaptec', 'notion', 'custom-text', 'custom-image', 'custom-webhook', 'calendar', 'week-number', 'battery', 'ai-usage', 'status'] as const;

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
  if (!isRecord(value) || value.version !== 1 || gridScale(value.cols, value.rows) === null) {
    const sizes = GRID_SCALES.map((scale) => `${BASE_GRID_COLS * scale} × ${BASE_GRID_ROWS * scale}`).join(', ');
    throw new LayoutValidationError(`Layout must use version 1 and a ${sizes} grid.`);
  }
  if (Object.keys(value).some((key) => !['version', 'cols', 'rows', 'zoom', 'invert', 'widgets'].includes(key))) {
    throw new LayoutValidationError('Layout contains unsupported fields.');
  }
  if (value.invert !== undefined && typeof value.invert !== 'boolean') {
    throw new LayoutValidationError('Layout invert must be true or false.');
  }
  const cols = value.cols as number;
  const rows = value.rows as number;
  if (value.zoom !== undefined && !isZoom(value.zoom)) {
    throw new LayoutValidationError(`Layout zoom must be a whole number from ${MIN_ZOOM} to ${MAX_ZOOM}.`);
  }
  if (!Array.isArray(value.widgets) || value.widgets.length > DISPLAY_WIDGET_IDS.length + MAX_NEWS_FEEDS + MAX_TICKER_WIDGETS) {
    throw new LayoutValidationError('Layout widgets must be an array with at most one of each supported widget, news feed and stock widget.');
  }

  const seen = new Set<string>();
  const widgets: WidgetLayout[] = [];
  for (const input of value.widgets) {
    if (!isRecord(input) || typeof input.i !== 'string'
      || !(DISPLAY_WIDGET_IDS.some((id) => id === input.i) || newsFeedIdFromWidget(input.i) || tickerIdFromWidget(input.i)) || seen.has(input.i)) {
      throw new LayoutValidationError('Every widget must have a supported, unique ID.');
    }
    if (Object.keys(input).some((key) => !['i', 'x', 'y', 'w', 'h', 'static', 'options'].includes(key))) {
      throw new LayoutValidationError('Widget contains unsupported fields.');
    }
    if (![input.x, input.y, input.w, input.h].every((n) => typeof n === 'number' && Number.isInteger(n))) {
      throw new LayoutValidationError('Widget positions and sizes must be whole numbers.');
    }
    const { x, y, w, h } = input as unknown as WidgetLayout;
    if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > cols || y + h > rows) {
      throw new LayoutValidationError(`Widgets must fit inside the ${cols} × ${rows} grid.`);
    }
    if (input.static !== undefined && typeof input.static !== 'boolean') {
      throw new LayoutValidationError('The widget static flag must be a boolean.');
    }
    if (widgets.some((other) => x < other.x + other.w && x + w > other.x
      && y < other.y + other.h && y + h > other.y)) {
      throw new LayoutValidationError('Widgets must not overlap.');
    }
    let options;
    try { options = parseWidgetOptions(input.i, input.options); }
    catch (error) { throw new LayoutValidationError(error instanceof Error ? error.message : 'Widget options are invalid.'); }
    seen.add(input.i);
    widgets.push({ i: input.i, x, y, w, h, ...(input.static === undefined ? {} : { static: input.static }), ...(options ? { options } : {}) });
  }
  // A false flag is the default, so it is not stored.
  return { version: 1, cols, rows, ...(value.zoom === undefined ? {} : { zoom: value.zoom }), ...(value.invert === true ? { invert: true } : {}), widgets };
}
