import type { EnergyPrice, EnergyPriceHour } from '../types';
import type { EnergyView } from './widgetOptions';

// Hourly price bar chart for the 1-bit panel. Without colour, the current hour is drawn
// as an outlined bar among filled ones, and the day's average as a dotted line.

export interface ChartCanvas {
  setPixel(x: number, y: number, black: boolean): void;
  drawHLine(x: number, y: number, w: number): void;
  fillRect(x: number, y: number, w: number, h: number, black?: boolean): void;
  drawText(text: string, x: number, y: number, maxWidth?: number): void;
}

export interface ChartBounds { x: number; y: number; width: number; height: number }

export interface ChartBars {
  bars: EnergyPriceHour[];
  /** Index of the hour containing `now`, or -1 when no shown hour contains it. */
  current: number;
}

const HOUR_MS = 3_600_000;
const GLYPH = 8;
const HEADER_H = 11;
const LABEL_H = 9;
/** Below this the chart has no room for bars, so only the header line is drawn. */
export const MIN_CHART_HEIGHT = HEADER_H + LABEL_H + 8;

/** The hours a view shows: the whole Danish day, or the current hour to the end of the day. */
export function selectEnergyBars(hours: readonly EnergyPriceHour[], view: Exclude<EnergyView, 'summary'>, now: number): ChartBars {
  const containsNow = (hour: EnergyPriceHour) => {
    const start = Date.parse(hour.start);
    return start <= now && now < start + HOUR_MS;
  };
  const current = hours.findIndex(containsNow);
  if (view === 'day' || current < 0) return { bars: [...hours], current };
  return { bars: hours.slice(current), current: 0 };
}

const twoDigits = (hour: number) => String(hour).padStart(2, '0');

const AXIS_GAP = 4;
/** The axis may take at most this share of the width, so narrow widgets keep their bars. */
const AXIS_MAX_SHARE = 0.25;
/** Minimum pixel distance between two axis labels (two glyph heights). */
const AXIS_MIN_SPACING = 2 * GLYPH;
/** Tick steps in DKK/kWh; prices are in øre. */
const AXIS_STEPS_DKK = [0.25, 0.5, 1, 2, 5, 10, 20, 50];

/** Axis tick values in øre, from the smallest step whose labels do not touch. */
export function axisTicks(low: number, high: number, chartH: number): number[] {
  const span = high - low || 1;
  const stepDkk = AXIS_STEPS_DKK.find((step) => (step * 100 / span) * (chartH - 1) >= AXIS_MIN_SPACING);
  if (stepDkk === undefined) return [];
  const step = stepDkk * 100;
  const ticks: number[] = [];
  for (let tick = Math.ceil(low / step) * step; tick <= high + 1e-9; tick += step) ticks.push(tick);
  return ticks;
}

/** An øre value as whole DKK without trailing zeros: 200 -> "2", 50 -> "0.5". */
const formatKr = (ore: number) => String(Number((ore / 100).toFixed(2)));

/** Draws the header, bars, average line and hour labels inside `bounds`. */
export function renderEnergyChart(
  canvas: ChartCanvas,
  bounds: ChartBounds,
  price: EnergyPrice & { hours: EnergyPriceHour[] },
  view: Exclude<EnergyView, 'summary'>,
  now: number,
): void {
  const { x, y, width, height } = bounds;
  const { bars, current } = selectEnergyBars(price.hours, view, now);
  const left = x + 2;
  const innerW = width - 4;

  // Header: the live interval price, which can differ from its hour's mean bar.
  // The longest variant that fits, so a narrow widget never shows a cut-off unit.
  const hourLabel = current >= 0 ? `${twoDigits(bars[current].hour)}: ` : '';
  const basis = price.basis === 'consumer' ? 'Est' : 'Spot';
  const value = (price.now / 100).toFixed(2);
  const variants = [`${basis} ${hourLabel}${value} DKK/kWh`, `${hourLabel}${value} DKK/kWh`, `${hourLabel}${value} kr`, value];
  const header = variants.find((text) => text.length * GLYPH <= innerW) ?? value;
  canvas.drawText(header, left, y + 2, innerW);
  const avgText = `Avg ${(price.average / 100).toFixed(2)}`;
  if ((header.length + 2 + avgText.length) * GLYPH <= innerW) {
    canvas.drawText(avgText, x + width - 2 - avgText.length * GLYPH, y + 2, avgText.length * GLYPH);
  }
  if (height < MIN_CHART_HEIGHT || bars.length === 0) return;

  const top = y + HEADER_H + 1;
  const labelY = y + height - LABEL_H + 1;
  const bottom = labelY - 3; // last pixel row a bar may use
  const chartH = bottom - top + 1;

  // Scale from zero, extended below it when prices are negative.
  const prices = bars.map((bar) => bar.price);
  const low = Math.min(0, ...prices);
  const high = Math.max(0, ...prices, price.average);
  const span = high - low || 1;
  const toY = (value: number) => bottom - Math.round(((value - low) / span) * (chartH - 1));
  const zeroY = toY(0);

  // Y axis on the right in DKK ("2 kr"), shown only when the widget is wide and tall enough.
  const ticks = axisTicks(low, high, chartH);
  const axisLabels = ticks.map((tick) => `${formatKr(tick)} kr`);
  const axisW = Math.max(0, ...axisLabels.map((label) => label.length)) * GLYPH + AXIS_GAP;
  const showAxis = ticks.length >= 2 && axisW <= innerW * AXIS_MAX_SHARE;
  const plotW = showAxis ? innerW - axisW : innerW;

  const slot = plotW / bars.length;
  const gap = slot >= 6 ? 2 : slot >= 3 ? 1 : 0;
  const barX = (index: number) => left + Math.floor(index * slot);
  const centres: number[] = [];

  bars.forEach((bar, index) => {
    const bx = barX(index);
    const bw = Math.max(1, barX(index + 1) - bx - gap);
    centres.push(bx + Math.floor(bw / 2));
    const valueY = toY(bar.price);
    const barTop = Math.min(valueY, zeroY);
    const barH = Math.max(1, Math.abs(zeroY - valueY) + 1);
    if (index !== current) {
      canvas.fillRect(bx, barTop, bw, barH);
    } else if (bw >= 3 && barH >= 3) {
      // Outline only, so the current hour stands out without colour.
      canvas.fillRect(bx, barTop, bw, 1);
      canvas.fillRect(bx, barTop + barH - 1, bw, 1);
      canvas.fillRect(bx, barTop, 1, barH);
      canvas.fillRect(bx + bw - 1, barTop, 1, barH);
    } else {
      for (let row = barTop; row < barTop + barH; row += 2) canvas.fillRect(bx, row, bw, 1);
    }
  });

  // Baseline at zero and a dotted line at the day's average.
  canvas.drawHLine(left, zeroY, plotW);
  const avgY = toY(price.average);
  if (avgY !== zeroY) for (let px = left; px < left + plotW; px += 3) canvas.setPixel(px, avgY, true);

  if (showAxis) {
    const axisX = left + plotW + AXIS_GAP;
    ticks.forEach((tick, index) => {
      const tickY = toY(tick);
      canvas.fillRect(left + plotW + 1, tickY, 2, 1); // tick mark beside the labels
      const textY = Math.min(Math.max(top, tickY - 3), bottom - GLYPH + 1);
      canvas.drawText(axisLabels[index], axisX, textY, axisW - AXIS_GAP);
    });
  }

  // Hour labels at 00, 06, 12 and 18, plus the first hour of the rest-of-day view.
  let lastEnd = -Infinity;
  bars.forEach((bar, index) => {
    if (!(bar.hour % 6 === 0 || (view === 'rest' && index === 0))) return;
    const text = twoDigits(bar.hour);
    const textX = Math.min(Math.max(left, centres[index] - GLYPH + 1), left + plotW - 2 * GLYPH);
    if (textX < lastEnd + 4) return;
    canvas.drawText(text, textX, labelY, 2 * GLYPH);
    lastEnd = textX + 2 * GLYPH;
  });
}
