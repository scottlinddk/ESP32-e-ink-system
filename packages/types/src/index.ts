// Shared TypeScript interfaces for the ESP32 e-ink system.
// This package has no runtime dependencies — types only.

// ── Display hardware abstraction ─────────────────────────────────────────────

export interface ScreenProfile {
  id: string;
  slug: string;
  widthPx: number;
  heightPx: number;
  physicalWidthMm: number;
  physicalHeightMm: number;
  colorMode: 'bw' | 'bwr' | 'gray4';
  partialRefresh: boolean;
  orientation: 'landscape' | 'portrait';
  dpiApprox: number;
}

export interface PixelRegion {
  widthPx: number;
  heightPx: number;
}

export interface TypographyScale {
  xs: number;   // minimum readable, labels only
  sm: number;   // secondary data
  base: number; // primary data
  lg: number;   // hero stat
  xl: number;   // single large value (clock, price)
}

// ── Layout ───────────────────────────────────────────────────────────────────

export type LayoutId = 'full' | 'half-horizontal' | 'half-vertical' | 'quarter';

export interface LayoutRegion {
  xRatio: number; // 0.0–1.0
  yRatio: number;
  wRatio: number;
  hRatio: number;
}

export interface LayoutDefinition {
  id: LayoutId;
  regions: LayoutRegion[];
  minWidthPx?: number;
  minHeightPx?: number;
}

// ── Widget rendering output ───────────────────────────────────────────────────

export type RenderElement =
  | { kind: 'text'; text: string; x: number; y: number; fontSize: number }
  | { kind: 'hline'; x: number; y: number; width: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; fill: boolean }
  | { kind: 'bar-chart'; x: number; y: number; width: number; height: number; values: number[] };

export interface RenderedWidget {
  region: PixelRegion;
  elements: RenderElement[];
}

// ── Widget interface ──────────────────────────────────────────────────────────

export type WidgetCategory = 'energy' | 'weather' | 'ev' | 'utility' | 'general';

export interface WidgetMeta {
  id: string;              // kebab-case, stable, used as DB FK — never rename after deploy
  name: string;
  description: string;
  category: WidgetCategory;
  requiresOauth?: 'zaptec' | 'monta';
}

// Structural interface compatible with Zod schemas (avoids a zod dependency in this package)
export interface Schema<T> {
  parse(input: unknown): T;
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown };
}

export type WidgetResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface Widget<TConfig, TData> {
  meta: WidgetMeta;
  configSchema: Schema<TConfig>;
  fetch(config: TConfig, region: PixelRegion): Promise<WidgetResult<TData>>;
  render(data: TData, region: PixelRegion, typography: TypographyScale): RenderedWidget;
}

// ── Playlist ──────────────────────────────────────────────────────────────────

export interface PlaylistEntry {
  id: string;
  playlistId: string;
  widgetId: string;
  position: number;
  durationSeconds: number;
  layoutId: LayoutId;
  widgetConfig: unknown;
}
