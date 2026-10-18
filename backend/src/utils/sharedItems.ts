import { randomBytes } from 'node:crypto';
import type { DisplayLayout, DisplaySchedule, UserPreferences, WidgetLayout } from '../types';
import { DISPLAY_WIDGET_IDS, parseDisplayLayout } from './layoutValidation';
import { gridScale } from './layoutGrid';

/** What a sender may offer. Only presentation travels: never credentials, URLs or tokens. */
export const SHARED_ITEM_KINDS = ['layout', 'widget', 'dashboard'] as const;
export type SharedItemKind = typeof SHARED_ITEM_KINDS[number];
export const SHARED_PAYLOAD_MAX_BYTES = 32768;
export const MAX_SCHEDULE_PAGES = 12;
const DEFAULT_PAGE_SECONDS = 300;

export interface LayoutPayload { layout: DisplayLayout }
export interface WidgetPayload { layout_cols: number; layout_rows: number; widget: WidgetLayout }
export interface DashboardPayload { layout: DisplayLayout | null; enabled: boolean; pages: Array<{ name: string; duration_seconds: number; layout: DisplayLayout }> }
export type SharedPayload = LayoutPayload | WidgetPayload | DashboardPayload;

export class SharedItemError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); this.name = 'SharedItemError'; }
}

const portableIds = new Set<string>(DISPLAY_WIDGET_IDS);

/**
 * Additional news feeds, stock tickers and calendars are configured per account
 * (`news:<id>`, `ticker:<id>`, `calendar:<id>`), so they would point at nothing for
 * the recipient. Only the built-in widgets travel; the number left behind is reported.
 */
export function portableLayout(layout: DisplayLayout): { layout: DisplayLayout; dropped: number } {
  const widgets = layout.widgets.filter((widget) => portableIds.has(widget.i));
  return { layout: parseDisplayLayout({ ...layout, widgets }), dropped: layout.widgets.length - widgets.length };
}

export function portableWidget(layout: DisplayLayout, widgetId: string): WidgetPayload {
  const widget = layout.widgets.find((entry) => entry.i === widgetId);
  if (!widget) throw new SharedItemError('That widget is not in the selected layout.', 404);
  if (!portableIds.has(widget.i)) {
    throw new SharedItemError('Additional news feeds, stock widgets and calendars use your own sources and cannot be shared.');
  }
  const { static: _static, ...rest } = widget;
  return { layout_cols: layout.cols, layout_rows: layout.rows, widget: rest };
}

/** Defensive: a stored payload is untrusted again when it is applied. */
export function parsePayload(kind: SharedItemKind, value: unknown): SharedPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SharedItemError('The shared item is damaged.');
  const payload = value as Record<string, unknown>;
  try {
    if (kind === 'layout') return { layout: portableLayout(parseDisplayLayout(payload.layout)).layout };
    if (kind === 'widget') {
      const widget = payload.widget as WidgetLayout;
      const cols = payload.layout_cols;
      const rows = payload.layout_rows;
      if (gridScale(cols, rows) === null || !widget || typeof widget !== 'object') throw new SharedItemError('The shared item is damaged.');
      // Validate the widget on its own grid by wrapping it in a layout.
      const [checked] = portableLayout(parseDisplayLayout({ version: 1, cols, rows, widgets: [widget] })).layout.widgets;
      if (!checked) throw new SharedItemError('The shared item is damaged.');
      return { layout_cols: cols as number, layout_rows: rows as number, widget: checked };
    }
    if (!Array.isArray(payload.pages) || payload.pages.length > MAX_SCHEDULE_PAGES) throw new SharedItemError('The shared item is damaged.');
    return {
      layout: payload.layout == null ? null : portableLayout(parseDisplayLayout(payload.layout)).layout,
      enabled: payload.enabled === true,
      pages: payload.pages.map((page: Record<string, unknown>) => ({
        name: String(page?.name ?? '').trim().slice(0, 80) || 'Shared layout',
        duration_seconds: Number.isInteger(page?.duration_seconds) ? Math.min(86400, Math.max(60, page.duration_seconds as number)) : DEFAULT_PAGE_SECONDS,
        layout: portableLayout(parseDisplayLayout(page?.layout)).layout,
      })),
    };
  } catch (error) {
    if (error instanceof SharedItemError) throw error;
    throw new SharedItemError(error instanceof Error ? error.message : 'The shared item is damaged.');
  }
}

export function summarize(kind: SharedItemKind, payload: SharedPayload): { widgets: string[]; pages: number } {
  if (kind === 'widget') return { widgets: [(payload as WidgetPayload).widget.i], pages: 0 };
  if (kind === 'layout') return { widgets: (payload as LayoutPayload).layout.widgets.map((widget) => widget.i), pages: 1 };
  const dashboard = payload as DashboardPayload;
  const layouts = [...(dashboard.layout ? [dashboard.layout] : []), ...dashboard.pages.map((page) => page.layout)];
  return { widgets: [...new Set(layouts.flatMap((layout) => layout.widgets.map((widget) => widget.i)))], pages: dashboard.pages.length };
}

const newPageId = () => `shr${randomBytes(5).toString('hex')}`;

function baseSchedule(current: UserPreferences): DisplaySchedule {
  return current.display_schedule ?? {
    enabled: false, timezone: current.display_timezone ?? 'Europe/Copenhagen', pages: [],
    quiet_hours: { enabled: false, start: '22:00', end: '06:00' },
  };
}

function scaleWidget(payload: WidgetPayload, target: DisplayLayout): WidgetLayout {
  const from = gridScale(payload.layout_cols, payload.layout_rows)!;
  const to = gridScale(target.cols, target.rows)!;
  const ratio = to / from;
  const size = (cells: number) => Math.max(1, ratio >= 1 ? cells * ratio : Math.ceil(cells * ratio));
  return { ...payload.widget, w: Math.min(size(payload.widget.w), target.cols), h: Math.min(size(payload.widget.h), target.rows) };
}

/** First free spot, reading order. The recipient's own widgets never move. */
function placeWidget(target: DisplayLayout, widget: WidgetLayout): DisplayLayout {
  if (target.widgets.some((entry) => entry.i === widget.i)) {
    throw new SharedItemError(`That layout already has a ${widget.i} widget. Remove it first.`, 409);
  }
  for (let y = 0; y + widget.h <= target.rows; y += 1) {
    for (let x = 0; x + widget.w <= target.cols; x += 1) {
      const free = target.widgets.every((other) => x >= other.x + other.w || x + widget.w <= other.x || y >= other.y + other.h || y + widget.h <= other.y);
      if (free) return parseDisplayLayout({ ...target, widgets: [...target.widgets, { ...widget, x, y }] });
    }
  }
  throw new SharedItemError('There is no free space for that widget in the layout. Make room or choose another layout.', 409);
}

export type AcceptTarget = { page_id?: string | null; name?: string };

/**
 * The device-presentation update that applying an item means, given the recipient's current
 * settings. Pure: the caller stores it through the normal, validated device-display save.
 */
export function buildAcceptUpdates(kind: SharedItemKind, payloadValue: unknown, current: UserPreferences, target: AcceptTarget = {}): Partial<UserPreferences> {
  const payload = parsePayload(kind, payloadValue);
  const schedule = baseSchedule(current);

  if (kind === 'layout') {
    if (schedule.pages.length >= MAX_SCHEDULE_PAGES) {
      throw new SharedItemError(`A device holds at most ${MAX_SCHEDULE_PAGES} saved layouts. Remove one first.`, 409);
    }
    const ids = new Set(schedule.pages.map((page) => page.id));
    let id = newPageId();
    while (ids.has(id)) id = newPageId();
    return { display_schedule: { ...schedule, pages: [...schedule.pages, { id, name: target.name?.trim().slice(0, 80) || 'Shared layout', duration_seconds: DEFAULT_PAGE_SECONDS, layout: (payload as LayoutPayload).layout }] } };
  }

  if (kind === 'widget') {
    const widget = payload as WidgetPayload;
    if (target.page_id) {
      const page = schedule.pages.find((entry) => entry.id === target.page_id);
      if (!page) throw new SharedItemError('Saved layout not found. Reload the device.', 404);
      const layout = placeWidget(page.layout, scaleWidget(widget, page.layout));
      return { display_schedule: { ...schedule, pages: schedule.pages.map((entry) => (entry === page ? { ...entry, layout } : entry)) } };
    }
    if (!current.layout) throw new SharedItemError('This device has no base layout yet. Create one in the layout editor first.', 409);
    return { layout: placeWidget(current.layout, scaleWidget(widget, current.layout)) };
  }

  const dashboard = payload as DashboardPayload;
  // Pages get new IDs, so the recipient's timed layouts would point at layouts that are gone.
  const { timed_layouts: _dropped, ...withoutTimed } = schedule;
  const ids = new Set<string>();
  const pages = dashboard.pages.map((page) => {
    let id = newPageId();
    while (ids.has(id)) id = newPageId();
    ids.add(id);
    return { id, ...page };
  });
  // The recipient keeps their own time zone, quiet hours, panel profile and language.
  return {
    ...(dashboard.layout ? { layout: dashboard.layout } : {}),
    display_schedule: { ...withoutTimed, enabled: dashboard.enabled && pages.length > 0, pages },
    active_layout_id: null,
  };
}
