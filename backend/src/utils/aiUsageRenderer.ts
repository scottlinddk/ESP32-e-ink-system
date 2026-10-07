import type { AiCostEstimate, AiLimitView, AiProviderView, AiUsageData } from '../aiUsage/types';

// AI usage widget. Full view, per provider:
//   CLAUDE            2.1M ~$4.80     today's tokens, estimated at API prices
//   5h [######    ] 58% 14:20         quota window, used share, local reset time
//   7d [###       ] 31% Mon
//   API month $45.20                  billed this month (Admin API)
// Condensed view: one line per provider. Lines that do not fit are dropped from the
// bottom; columns that do not fit are dropped from the right.

export interface AiUsageCanvas {
  drawText(text: string, x: number, y: number, maxWidth?: number, scale?: number, black?: boolean): void;
  drawHLine(x: number, y: number, w: number): void;
  fillRect(x: number, y: number, w: number, h: number, black?: boolean): void;
}
export interface AiUsageBounds { x: number; y: number; width: number; height: number }
export type AiUsageView = 'full' | 'condensed';

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
  // A widget too short for the full view falls back to one line per provider.
  const fullHeight = data.providers.reduce((sum, provider) => sum + LINE * (1 + Math.min(1, provider.limits.length)), 0);
  if (options.view === 'condensed' || bounds.height < fullHeight) drawCondensed(canvas, bounds, data, now);
  else drawFull(canvas, bounds, data, now, options.timeZone);
}
