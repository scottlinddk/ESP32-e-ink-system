import type { AiCostEstimate, AiLimitView, AiProviderView, AiUsageData } from '../aiUsage/types';

// AI usage widget, modelled on Claude's own usage panel. A view that does
// not fit the widget's height falls back to the next one down, so a small widget degrades instead of clipping:
//
// detailed (view "full")            stacked (view "condensed")
//   CLAUDE        2.1M ~$4.80         CLAUDE        2.1M ~$4.80
//   Session  Resets in 58m 15%        Session  Resets in 58m 15%
//   [####-----------------]           [####-----------------]
//   Weekly  Resets Thu 20:00 68%      Weekly  Resets Thu 20:00 68%
//   [##############--------]          [##############--------]
//   Input        6  Output    795     API month $45.20
//   Cache read 234k Cache write 49k
//   Cache hit 83%  API month $45.20
//
// inline: one row per window, label, bar, percent and reset time on a single line.
// line:   one line per provider.
// Rows that do not fit are dropped from the bottom; columns, from the right.

export interface AiUsageCanvas {
  drawText(text: string, x: number, y: number, maxWidth?: number, scale?: number, black?: boolean): void;
  drawHLine(x: number, y: number, w: number): void;
  fillRect(x: number, y: number, w: number, h: number, black?: boolean): void;
}
export interface AiUsageBounds { x: number; y: number; width: number; height: number }
export type AiUsageView = 'full' | 'condensed';
type Level = 'detailed' | 'stacked' | 'inline' | 'line';
const LEVELS: readonly Level[] = ['detailed', 'stacked', 'inline', 'line'];

const GLYPH = 8;
const LINE = 10;
const PAD = 2;
/** Quota reports older than this are marked with their age. */
const STALE_MS = 60 * 60_000;

export function formatTokens(tokens: number): string {
  const units: Array<[number, string]> = [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']];
  for (const [size, unit] of units) {
    if (tokens >= size) {
      const value = tokens / size;
      return `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, '')}${unit}`;
    }
  }
  return String(Math.round(tokens));
}

export function formatUsd(usd: number): string {
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (usd >= 100) return `$${Math.round(usd)}`;
  return `$${usd.toFixed(2)}`;
}

/** "~$4.80", with "+" when some models had no known price. */
export function formatEstimate(estimate: AiCostEstimate): string {
  if (estimate.costUsd === null) return '';
  return `~${formatUsd(estimate.costUsd)}${estimate.partial ? '+' : ''}`;
}

/** Local reset time: "14:20" within a day, otherwise the weekday, e.g. "Mon". */
export function formatReset(resetsAt: string, now: Date, timeZone: string): string {
  const at = new Date(resetsAt);
  if (at.getTime() - now.getTime() < 24 * 3_600_000) {
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  }
  return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' }).format(at);
}

export function formatAge(observedAt: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(observedAt)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

/** Weekday and local time for a reset more than a day away, e.g. "Thu 20:00". */
function weekdayTime(at: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' }).format(at);
  return `${day} ${new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)}`;
}

/** When a window resets, as Claude words it: "in 58m", "14:20" within a day, otherwise "Thu 20:00". */
export function formatResetIn(resetsAt: string, now: Date, timeZone: string): string {
  const at = new Date(resetsAt);
  const ms = at.getTime() - now.getTime();
  if (ms < 60 * 60_000) return `in ${Math.max(1, Math.ceil(ms / 60_000))}m`;
  if (ms < 24 * 3_600_000) return formatReset(resetsAt, now, timeZone);
  return weekdayTime(at, timeZone);
}

/** Claude's names for its two windows; any other window keeps its length ("30m"). */
function limitName(label: string): string {
  return label === '5h' ? 'Session' : label === '7d' ? 'Weekly' : label;
}

function percentText(limit: AiLimitView): string {
  return limit.usedPercent === null ? 'reset' : `${Math.min(100, Math.round(limit.usedPercent))}%`;
}

function isStale(provider: AiProviderView, now: Date): boolean {
  return !!provider.limitsObservedAt && provider.limits.some((limit) => limit.usedPercent !== null)
    && now.getTime() - Date.parse(provider.limitsObservedAt) > STALE_MS;
}

function textWidth(text: string): number { return text.length * GLYPH; }

function rightText(canvas: AiUsageCanvas, text: string, right: number, y: number, minX: number): void {
  const x = right - textWidth(text);
  if (text && x >= minX) canvas.drawText(text, x, y, textWidth(text));
}

function drawBar(canvas: AiUsageCanvas, x: number, y: number, width: number, share: number): void {
  if (width < 6) return;
  canvas.drawHLine(x, y, width);
  canvas.drawHLine(x, y + 7, width);
  canvas.fillRect(x, y, 1, 8);
  canvas.fillRect(x + width - 1, y, 1, 8);
  const fill = Math.round((width - 4) * Math.max(0, Math.min(1, share)));
  if (fill > 0) canvas.fillRect(x + 2, y + 2, fill, 4);
}

// Fixed columns keep the bars of every row the same length: "reset" or "100%", and "14:20" or "Mon".
const LABEL_W = 3 * GLYPH;
const PERCENT_W = 5 * GLYPH;
const RESET_W = 5 * GLYPH;
const GAP = GLYPH / 2;
const MIN_BAR = 3 * GLYPH;

function drawLimit(canvas: AiUsageCanvas, limit: AiLimitView, x: number, y: number, width: number, now: Date, timeZone: string): void {
  const showReset = width >= LABEL_W + MIN_BAR + PERCENT_W + RESET_W + 3 * GAP;
  const right = x + width;
  const resetRight = right;
  const percentRight = showReset ? right - RESET_W - GAP : right;
  canvas.drawText(limit.label, x, y, LABEL_W);
  // Once a window has reset its old reset time means nothing, so it is left out.
  if (showReset && limit.usedPercent !== null) rightText(canvas, formatReset(limit.resetsAt, now, timeZone), resetRight, y, x);
  rightText(canvas, percentText(limit), percentRight, y, x + LABEL_W);
  const barX = x + LABEL_W + GAP;
  drawBar(canvas, barX, y, percentRight - PERCENT_W - GAP - barX, (limit.usedPercent ?? 0) / 100);
}

function drawFull(canvas: AiUsageCanvas, bounds: AiUsageBounds, data: AiUsageData, now: Date, timeZone: string): void {
  const x = bounds.x + PAD;
  const width = bounds.width - 2 * PAD;
  const bottom = bounds.y + bounds.height;
  let y = bounds.y + PAD;
  const fits = () => y + GLYPH <= bottom;
  data.providers.forEach((provider, index) => {
    if (index > 0) {
      if (y + 3 + GLYPH > bottom) return;
      canvas.drawHLine(bounds.x, y, bounds.width);
      y += 3;
    }
    if (!fits()) return;
    const name = provider.label.toUpperCase() + (isStale(provider, now) ? ` ${formatAge(provider.limitsObservedAt!, now)}` : '');
    canvas.drawText(name, x, y, width);
    if (provider.today) {
      const today = [formatTokens(provider.today.tokens), formatEstimate(provider.today)].filter(Boolean).join(' ');
      rightText(canvas, today, x + width, y, x + textWidth(name) + GLYPH);
    }
    y += LINE;
    for (const limit of provider.limits) {
      if (!fits()) return;
      drawLimit(canvas, limit, x, y, width, now, timeZone);
      y += LINE;
    }
    if (provider.adminError && fits()) {
      canvas.drawText(provider.adminError.code === 'invalid_key' || provider.adminError.code === 'forbidden' ? 'API: check key' : 'API: unavailable', x, y, width);
      y += LINE;
    } else if (provider.monthCostUsd !== null && fits()) {
      const month = `API month ${formatUsd(provider.monthCostUsd)}`;
      canvas.drawText(width >= textWidth(month) ? month : `API ${formatUsd(provider.monthCostUsd)}`, x, y, width);
      y += LINE;
    }
  });
}

// Stacked rows: a text line over a full-width bar, as in Claude's usage panel.
const BAR_H = 6;
const STACK_ROW = GLYPH + 1 + BAR_H + 1;
const SEPARATOR = 3;
/** Two lines of token counts, plus one for cache hit rate and the billed month. */
const BREAKDOWN_LINES = 2;

function drawSolidBar(canvas: AiUsageCanvas, x: number, y: number, width: number, share: number): void {
  canvas.drawHLine(x, y, width);
  canvas.drawHLine(x, y + BAR_H - 1, width);
  canvas.fillRect(x, y, 1, BAR_H);
  canvas.fillRect(x + width - 1, y, 1, BAR_H);
  const fill = Math.round((width - 2) * Math.max(0, Math.min(1, share)));
  if (fill > 0) canvas.fillRect(x + 1, y + 1, fill, BAR_H - 2);
}

function drawStackedLimit(canvas: AiUsageCanvas, limit: AiLimitView, x: number, y: number, width: number, now: Date, timeZone: string): void {
  const name = limitName(limit.label);
  const percent = percentText(limit);
  const percentWidth = textWidth(percent);
  canvas.drawText(percent, x + width - percentWidth, y, percentWidth);
  const nameWidth = Math.min(textWidth(name), width - percentWidth - GLYPH);
  if (nameWidth > 0) canvas.drawText(name, x, y, nameWidth);
  // Once a window has reset its old reset time means nothing, so it is left out.
  if (limit.usedPercent !== null) {
    const when = formatResetIn(limit.resetsAt, now, timeZone);
    const room = width - percentWidth - GLYPH - (nameWidth + GLYPH);
    const text = [`Resets ${when}`, when].find((candidate) => textWidth(candidate) <= room);
    if (text) canvas.drawText(text, x + width - percentWidth - GLYPH - textWidth(text), y, textWidth(text));
  }
  if (width >= 6) drawSolidBar(canvas, x, y + GLYPH + 1, width, (limit.usedPercent ?? 0) / 100);
}

/** Share of input-side tokens served from cache, as in Claude's "Cache hit". Null without cache traffic. */
function cacheHit(estimate: AiCostEstimate | null): number | null {
  const tokens = estimate?.breakdown;
  if (!tokens || tokens.cacheRead + tokens.cacheWrite === 0) return null;
  return Math.round(100 * tokens.cacheRead / (tokens.input + tokens.cacheRead + tokens.cacheWrite));
}

/** The billed month, or what is wrong with the Admin API key. */
function apiText(provider: AiProviderView, width: number): string {
  if (provider.adminError) {
    return provider.adminError.code === 'invalid_key' || provider.adminError.code === 'forbidden' ? 'API: check key' : 'API: unavailable';
  }
  if (provider.monthCostUsd === null) return '';
  const month = `API month ${formatUsd(provider.monthCostUsd)}`;
  return width >= textWidth(month) ? month : `API ${formatUsd(provider.monthCostUsd)}`;
}

function hasBreakdown(provider: AiProviderView): boolean {
  return !!provider.today?.breakdown;
}

function summaryLine(provider: AiProviderView, detailed: boolean): boolean {
  return (detailed && cacheHit(provider.today) !== null) || !!provider.adminError || provider.monthCostUsd !== null;
}

function providerHeight(provider: AiProviderView, detailed: boolean): number {
  return LINE + provider.limits.length * STACK_ROW
    + (detailed && hasBreakdown(provider) ? BREAKDOWN_LINES * LINE : 0)
    + (summaryLine(provider, detailed && hasBreakdown(provider)) ? LINE : 0);
}

function stackedHeight(data: AiUsageData, detailed: boolean): number {
  return data.providers.reduce((sum, provider, index) => sum + providerHeight(provider, detailed) + (index > 0 ? SEPARATOR : 0), 0);
}

/** A label with a right-aligned value in a column of `width` pixels. */
function drawCell(canvas: AiUsageCanvas, label: string, value: string, x: number, y: number, width: number): void {
  canvas.drawText(label, x, y, Math.max(0, width - textWidth(value) - GAP));
  rightText(canvas, value, x + width, y, x + textWidth(label) + GAP);
}

// Cache labels come in tiers so both cells of a row use the same wording.
const CACHE_LABELS: ReadonlyArray<readonly [string, string]> = [['Cache read', 'Cache write'], ['Cache rd', 'Cache wr'], ['Rd', 'Wr']];

function drawBreakdown(canvas: AiUsageCanvas, provider: AiProviderView, x: number, y: number, width: number): void {
  const tokens = provider.today!.breakdown!;
  const column = Math.floor((width - GLYPH) / 2);
  const right = x + width - column;
  const read = formatTokens(tokens.cacheRead);
  const write = formatTokens(tokens.cacheWrite);
  const [readLabel, writeLabel] = CACHE_LABELS.find(([r, w]) =>
    textWidth(r) + GAP + textWidth(read) <= column && textWidth(w) + GAP + textWidth(write) <= column) ?? CACHE_LABELS[CACHE_LABELS.length - 1];
  drawCell(canvas, 'Input', formatTokens(tokens.input), x, y, column);
  drawCell(canvas, 'Output', formatTokens(tokens.output), right, y, column);
  drawCell(canvas, readLabel, read, x, y + LINE, column);
  drawCell(canvas, writeLabel, write, right, y + LINE, column);
}

function drawStacked(canvas: AiUsageCanvas, bounds: AiUsageBounds, data: AiUsageData, now: Date, timeZone: string, detailed: boolean): void {
  const x = bounds.x + PAD;
  const width = bounds.width - 2 * PAD;
  let y = bounds.y + PAD;
  data.providers.forEach((provider, index) => {
    if (index > 0) {
      canvas.drawHLine(bounds.x, y, bounds.width);
      y += SEPARATOR;
    }
    const name = provider.label.toUpperCase() + (isStale(provider, now) ? ` ${formatAge(provider.limitsObservedAt!, now)}` : '');
    canvas.drawText(name, x, y, width);
    if (provider.today) {
      const today = [formatTokens(provider.today.tokens), formatEstimate(provider.today)].filter(Boolean).join(' ');
      rightText(canvas, today, x + width, y, x + textWidth(name) + GLYPH);
    }
    y += LINE;
    for (const limit of provider.limits) {
      drawStackedLimit(canvas, limit, x, y, width, now, timeZone);
      y += STACK_ROW;
    }
    const grid = detailed && hasBreakdown(provider);
    if (grid) {
      drawBreakdown(canvas, provider, x, y, width);
      y += BREAKDOWN_LINES * LINE;
    }
    if (summaryLine(provider, grid)) {
      const api = apiText(provider, width);
      const hit = grid ? cacheHit(provider.today) : null;
      const left = hit === null ? '' : `Cache hit ${hit}%`;
      if (left) canvas.drawText(left, x, y, width);
      if (api) {
        // Without room beside the cache hit rate the billed month is dropped, not overlapped.
        if (!left) canvas.drawText(api, x, y, width);
        else rightText(canvas, api, x + width, y, x + textWidth(left) + GLYPH);
      }
      y += LINE;
    }
  });
}

function drawCondensed(canvas: AiUsageCanvas, bounds: AiUsageBounds, data: AiUsageData, now: Date): void {
  const x = bounds.x + PAD;
  const width = bounds.width - 2 * PAD;
  let y = bounds.y + Math.max(1, Math.floor((bounds.height - data.providers.length * LINE) / 2));
  for (const provider of data.providers) {
    if (y + GLYPH > bounds.y + bounds.height) return;
    const stale = isStale(provider, now) ? '*' : '';
    const limits = provider.limits.map((limit) => `${limit.label} ${percentText(limit)}`).join(' ');
    const left = `${provider.label} ${limits}${stale}`.trim();
    canvas.drawText(left, x, y, width);
    const cost = provider.today ? formatEstimate(provider.today)
      : provider.monthCostUsd !== null ? formatUsd(provider.monthCostUsd) : '';
    rightText(canvas, cost, x + width, y, x + textWidth(left) + GLYPH);
    y += LINE;
  }
}

export function renderAiUsageWidget(
  canvas: AiUsageCanvas, bounds: AiUsageBounds, data: AiUsageData | undefined,
  options: { view?: AiUsageView; now?: Date; timeZone: string },
): void {
  if (bounds.height < GLYPH || bounds.width < 4 * GLYPH) return;
  const now = options.now ?? new Date();
  if (!data || !data.providers.length) {
    canvas.drawText(data ? 'AI usage: no source' : 'AI usage: unavailable', bounds.x + PAD, bounds.y + PAD, bounds.width - 2 * PAD);
    return;
  }
  // Each view falls back to the next one down until one fits the widget's height.
  const inlineHeight = data.providers.reduce((sum, provider) => sum + LINE * (1 + Math.min(1, provider.limits.length)), 0);
  const heights: Record<Level, number> = {
    detailed: stackedHeight(data, true), stacked: stackedHeight(data, false), inline: inlineHeight, line: 0,
  };
  const level = LEVELS.slice(LEVELS.indexOf(options.view === 'condensed' ? 'stacked' : 'detailed'))
    .find((candidate) => candidate === 'line' || bounds.height >= heights[candidate] + PAD) ?? 'line';
  if (level === 'detailed' || level === 'stacked') drawStacked(canvas, bounds, data, now, options.timeZone, level === 'detailed');
  else if (level === 'inline') drawFull(canvas, bounds, data, now, options.timeZone);
  else drawCondensed(canvas, bounds, data, now);
}
