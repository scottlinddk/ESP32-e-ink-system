import type { AirQuality, WeatherData, WeatherForecastSlot, WeatherProblem, WidgetOptions } from '../types';
import type { Bounds, DrawingCanvas } from './zoomCanvas';
import { localDay, weekdayIndex } from './calendarDays';
import { DEFAULT_DISPLAY_LANGUAGE, formatDecimal, type DisplayLanguage } from './displayLanguage';
import { displayStrings } from './displayStrings';
import { drawWeatherIcon, iconFamily } from './weatherIcons';
import { weatherView } from './widgetOptions';
import { widgetLabel, WIDGET_LINE, WIDGET_PAD } from './widgetStyle';

// The weather widget's views, drawn with the 8 x 8 font on a canvas already zoomed to the widget.
// `summary` is the original two-line reading. The others follow e-paper weather dashboards: a large
// temperature with the readings beside it (`current`), the next 3-hour steps as columns (`hours`),
// the days ahead (`daily`) and a list of readings (`details`). Each adapts to the widget's size,
// and a missing reading is left out rather than drawn as a placeholder.

const GLYPH = 8;
const LINE = WIDGET_LINE;
/** A row set off by a dotted rule: the glyph with two pixels of air above and below. */
const SEPARATED_ROW = 12;
const PAD = WIDGET_PAD;
const STEP_SECONDS = 3 * 3600;
const MIN_ICON = 12;
const MAX_ICON = 48;
const MIN_HOURS_COLUMN = 4.5 * GLYPH;
const MIN_DAY_COLUMN = 5.5 * GLYPH;
const MAX_DAYS = 5;
const MIN_DAY_ROW = LINE + 1;
const MAX_DAY_ROW = 22;
const MAX_HOURS = 8;
const SIDE_MIN = 12 * GLYPH;
const MIN_DETAIL_COLUMN = 14 * GLYPH;
const NOON = 13;

export interface WeatherSource {
  data?: WeatherData;
  error?: WeatherProblem;
  forecast?: WeatherForecastSlot[];
  forecastError?: WeatherProblem;
  airQuality?: AirQuality;
}
export interface WeatherContext {
  timeZone: string;
  language?: DisplayLanguage;
  /** The moment the display is drawn for. Defaults to now. */
  now?: Date;
}

type Strings = ReturnType<typeof displayStrings>['weather'];
interface Area { x: number; y: number; width: number; height: number }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const textWidth = (text: string, scale = 1) => Array.from(text).length * GLYPH * scale;
const pad2 = (value: number) => String(value).padStart(2, '0');
const degrees = (value: number) => `${Math.round(value)}°`;
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** The first candidate that fits `pixels` wide, else the last (and shortest). */
const fit = (candidates: string[], pixels: number) => candidates.find((text) => textWidth(text) <= pixels) ?? candidates[candidates.length - 1];

/** Text centred on `centre`, kept between `left` and `right` and cut off at `right` when it is wider. */
function centered(canvas: DrawingCanvas, text: string, centre: number, y: number, left: number, right: number, scale = 1): void {
  const x = clamp(Math.round(centre - textWidth(text, scale) / 2), left, Math.max(left, right - textWidth(text, scale)));
  canvas.drawText(text, x, y, right - x, scale);
}
/** Text ending at `right`, kept right of `left` and cut off there when it is wider. */
function rightAligned(canvas: DrawingCanvas, text: string, left: number, right: number, y: number, scale = 1): void {
  const x = Math.max(left, right - textWidth(text, scale));
  canvas.drawText(text, x, y, right - x, scale);
}

/** A dotted rule, the separator between metrics. Every other pixel, so it stays light on a 1-bit panel. */
function dotted(canvas: DrawingCanvas, x: number, y: number, length: number, vertical = false): void {
  for (let offset = 0; offset < length; offset += 2) canvas.setPixel(vertical ? x : x + offset, vertical ? y + offset : y, true);
}

// ── Time ────────────────────────────────────────────────────────────────────

const clocks = new Map<string, Intl.DateTimeFormat>();
function clockParts(seconds: number, timeZone: string): { hour: number; minute: number } {
  let formatter = clocks.get(timeZone);
  if (!formatter) {
    try { formatter = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }
    catch { formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }
    clocks.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(seconds * 1000);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { hour: value('hour'), minute: value('minute') };
}
const dayOf = (seconds: number, timeZone: string): string => {
  try { return localDay(new Date(seconds * 1000), timeZone); } catch { return localDay(new Date(seconds * 1000), 'UTC'); }
};
const clock = (seconds: number, timeZone: string): string => {
  const { hour, minute } = clockParts(seconds, timeZone);
  return `${pad2(hour)}:${pad2(minute)}`;
};

// ── Days ────────────────────────────────────────────────────────────────────

export interface DaySummary {
  /** Local day, `2026-10-15`. */
  day: string;
  min: number;
  max: number;
  /** The highest chance of precipitation of the day's steps, percent. */
  pop: number;
  condition: string;
  /** A day icon: the worst weather of the day, else the one around midday. */
  icon: string;
  precipitation: number;
}

/** Thunder, then snow, then rain outranks anything calmer when choosing the day's icon. */
const SEVERITY: Record<string, number> = { '11': 4, '13': 3, '10': 2, '09': 2 };

/**
 * Folds the 3-hour steps into local days, from today on. A day's range comes from its steps, so it
 * is a little narrower than the true extremes, and today's covers what is left of it (with the
 * current temperature added). A last day with fewer than 4 steps is dropped: it would mislead.
 */
export function dailyForecast(slots: readonly WeatherForecastSlot[], timeZone: string, now = new Date(), currentTemp?: number): DaySummary[] {
  const today = dayOf(now.getTime() / 1000, timeZone);
  const byDay = new Map<string, WeatherForecastSlot[]>();
  for (const slot of slots) {
    const day = dayOf(slot.time, timeZone);
    if (day < today) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), slot]);
  }
  const days: DaySummary[] = [];
  for (const [day, steps] of [...byDay].sort(([a], [b]) => a < b ? -1 : 1)) {
    if (day !== today && steps.length < 4) continue;
    const temps = [...steps.map((step) => step.temp), ...(day === today && currentTemp !== undefined ? [currentTemp] : [])];
    const severity = (step: WeatherForecastSlot) => SEVERITY[iconFamily(step.icon).family] ?? 0;
    const hourDistance = (step: WeatherForecastSlot) => Math.abs(clockParts(step.time, timeZone).hour - NOON);
    const chosen = steps.reduce((best, step) => severity(step) > severity(best) || (severity(step) === severity(best) && severity(best) === 0 && hourDistance(step) < hourDistance(best)) ? step : best);
    days.push({
      day, min: Math.min(...temps), max: Math.max(...temps), pop: Math.max(...steps.map((step) => step.pop)),
      condition: chosen.condition, icon: `${chosen.icon.slice(0, 2)}d`,
      precipitation: Math.round(steps.reduce((total, step) => total + step.precipitation, 0) * 10) / 10,
    });
  }
  return days;
}

// ── Shared pieces ───────────────────────────────────────────────────────────

function problemLabel(t: Strings, problem?: WeatherProblem): string {
  return problem ? t.errors[problem.code] : t.unavailable;
}

function drawMessage(canvas: DrawingCanvas, area: Area, text: string): void {
  canvas.drawWrappedText(text, area.x, area.y, area.width, LINE);
}

function conditionName(t: Strings, condition: string): string {
  return capital(t.conditions[condition] ?? condition);
}

function windText(data: WeatherData, t: Strings, language: DisplayLanguage, direction = true): string {
  const compass = direction && data.windDeg !== undefined ? ` ${t.compass[Math.round(data.windDeg / 45) % 8]}` : '';
  return `${formatDecimal(data.windSpeed, 0, language)} m/s${compass}`;
}

// ── Summary (the original look) ─────────────────────────────────────────────

function drawSummary(canvas: DrawingCanvas, bounds: Bounds, source: WeatherSource, t: Strings, language: DisplayLanguage): void {
  const { x, y, width, height } = bounds;
  const textY = y + 2;
  const maxW = width - 4;
  if (source.data) {
    const { temp, condition, windSpeed } = source.data;
    const temperature = `${Math.round(temp)}C`;
    canvas.drawText(widgetLabel([`${t.conditions[condition] ?? condition}  ${temperature}`, temperature], maxW), x + PAD, textY, maxW);
    if (height >= 20) {
      const wind = `${formatDecimal(windSpeed, 1, language)} m/s`;
      canvas.drawText(widgetLabel([`${t.wind}: ${wind}`, wind], maxW), x + PAD, textY + LINE, maxW);
    }
  } else {
    const errorLabel = problemLabel(t, source.error);
    canvas.drawText(height < 21 ? errorLabel : t.title, x + 2, textY, maxW);
    if (height >= 21) {
      canvas.drawText(errorLabel, x + PAD, textY + LINE, maxW);
    }
  }
}

// ── Current ─────────────────────────────────────────────────────────────────

/** The readings that sit beside or under the big temperature, most useful first. */
function currentLines(data: WeatherData, t: Strings, language: DisplayLanguage, timeZone: string, width: number): string[] {
  const lines: string[] = [];
  if (data.feelsLike !== undefined) {
    const value = degrees(data.feelsLike);
    lines.push(fit([`${t.labels.feelsLike} ${value}`, `${t.labels.feelsShort} ${value}`, value], width));
  }
  if (data.humidity !== undefined) lines.push(fit([`${t.labels.humidity} ${data.humidity}%`, `${data.humidity}%`], width));
  lines.push(fit([`${t.wind} ${windText(data, t, language)}`, windText(data, t, language), windText(data, t, language, false)], width));
  if (data.sunrise !== undefined) lines.push(fit([`${t.labels.sunrise} ${clock(data.sunrise, timeZone)}`, clock(data.sunrise, timeZone)], width));
  if (data.sunset !== undefined) lines.push(fit([`${t.labels.sunset} ${clock(data.sunset, timeZone)}`, clock(data.sunset, timeZone)], width));
  return lines;
}

function drawCurrent(canvas: DrawingCanvas, area: Area, data: WeatherData, t: Strings, context: Required<WeatherContext>): void {
  const label = degrees(data.temp);
  const condition = conditionName(t, data.condition);
  let scale = 1;
  for (const candidate of [4, 3, 2]) {
    if (GLYPH * candidate + LINE <= area.height && textWidth(label, candidate) <= area.width * 0.62) { scale = candidate; break; }
  }
  const withCondition = area.height >= GLYPH * scale + LINE - 2;
  const blockH = GLYPH * scale + (withCondition ? LINE : 0);
  // The icon takes the block's height and as much of the width as is left beside the temperature,
  // and is dropped when it would be tiny.
  let icon = Math.min(blockH, area.height, MAX_ICON, area.width - textWidth(label, scale) - 6);
  if (icon < MIN_ICON) icon = 0;
  const textX = area.x + (icon ? icon + 5 : 0);
  // A condition too long to sit under the temperature goes under the icon row instead.
  const beside = textWidth(condition) <= area.x + area.width - textX;
  const textW = Math.max(textWidth(label, scale), withCondition && beside ? textWidth(condition) : 0);
  const blockW = textX - area.x + textW;
  const rowH = Math.max(GLYPH * scale + (withCondition && beside ? LINE : 0), icon);
  if (icon) drawWeatherIcon(canvas, data.icon, area.x, area.y + Math.floor((rowH - icon) / 2), icon);
  canvas.drawText(label, textX, area.y, area.x + area.width - textX, scale);
  let below = area.y + rowH + 3;
  if (withCondition && beside) canvas.drawText(condition, textX, area.y + GLYPH * scale + 2, area.x + area.width - textX);
  else if (withCondition && area.y + area.height - below >= GLYPH) { canvas.drawText(condition, area.x, below, area.width); below += LINE; }
  // The readings go beside the block when there is room, else under it, each row set off by a dotted rule.
  const sideW = area.width - blockW - 8;
  if (sideW >= SIDE_MIN) {
    const x = area.x + area.width - sideW;
    dotted(canvas, x - 5, area.y, area.height, true);
    drawRows(canvas, currentLines(data, t, context.language, context.timeZone, sideW), x, area.y, sideW, area.height);
    return;
  }
  drawRows(canvas, currentLines(data, t, context.language, context.timeZone, area.width), area.x, below, area.width, area.y + area.height - below);
}

/** Rows of text with a dotted rule between them: 12 px a row when that fits three, else tight at 10 with no rules. */
function drawRows(canvas: DrawingCanvas, lines: string[], x: number, y: number, width: number, height: number): void {
  const separated = Math.floor(height / SEPARATED_ROW) >= 3;
  const pitch = separated ? SEPARATED_ROW : LINE;
  const shown = lines.slice(0, Math.max(0, Math.floor(height / pitch)));
  shown.forEach((line, index) => {
    const top = y + index * pitch;
    canvas.drawText(line, x, top + (separated ? 2 : 0), width);
    if (separated && index < shown.length - 1) dotted(canvas, x, top + pitch - 1, width);
  });
}

// ── Hours ───────────────────────────────────────────────────────────────────

function drawHours(canvas: DrawingCanvas, area: Area, source: WeatherSource, t: Strings, context: Required<WeatherContext>, options?: WidgetOptions): void {
  const now = context.now.getTime() / 1000;
  const steps = (source.forecast ?? []).filter((slot) => slot.time + STEP_SECONDS > now);
  if (steps.length === 0) { drawMessage(canvas, area, source.forecastError ? t.errors[source.forecastError.code] : t.noForecast); return; }
  const columns = Math.min(steps.length, options?.items ?? MAX_HOURS, clamp(Math.floor(area.width / MIN_HOURS_COLUMN), 1, MAX_HOURS));
  const columnW = Math.floor(area.width / columns);
  const tempScale = columnW >= 7 * GLYPH && area.height >= 64 ? 2 : 1;
  // Too short for the time and the temperature: the temperature alone.
  const withTime = area.height >= 2 * GLYPH + 3;
  // The chance of rain comes with the icon, never before it: 45 is the least that fits both.
  const withPop = area.height >= 4 * LINE + 5;
  const fixed = (withTime ? GLYPH + 3 : 0) + GLYPH * tempScale + (withPop ? 3 + GLYPH : 0);
  let icon = Math.min(columnW - 4, area.height - fixed - 3, 32);
  if (icon < MIN_ICON) icon = 0;
  const content = fixed + (icon ? icon + 3 : 0);
  let y = area.y + Math.max(0, Math.floor((area.height - content) / 2));
  const timeY = y;
  if (withTime) y += GLYPH + 3;
  const iconY = y;
  if (icon) y += icon + 3;
  const tempY = y;
  const popY = tempY + GLYPH * tempScale + 3;
  steps.slice(0, columns).forEach((step, index) => {
    const left = area.x + index * columnW, right = left + columnW, centre = left + columnW / 2;
    if (index > 0 && area.height >= 2 * GLYPH + 3) dotted(canvas, left, area.y, area.height, true);
    const { hour, minute } = clockParts(step.time, context.timeZone);
    if (withTime) centered(canvas, columnW >= 6 * GLYPH ? `${pad2(hour)}:${pad2(minute)}` : pad2(hour), centre, timeY, left, right);
    if (icon) drawWeatherIcon(canvas, step.icon, Math.round(centre - icon / 2), iconY, icon);
    centered(canvas, degrees(step.temp), centre, tempY, left, right, tempScale);
    if (withPop) centered(canvas, `${step.pop}%`, centre, popY, left, right);
  });
}

// ── Daily ───────────────────────────────────────────────────────────────────

function weekdayName(day: string, language: DisplayLanguage): string {
  return displayStrings(language).dates.weekdays[(weekdayIndex(day) + 1) % 7];
}
/** 'Today' for the first day when it is today and there is room, else the weekday. */
function dayLabel(day: string, index: number, today: string, t: Strings, language: DisplayLanguage, room = Infinity): string {
  return index === 0 && day === today && textWidth(t.today) <= room ? t.today : weekdayName(day, language);
}

function drawDailyRows(canvas: DrawingCanvas, area: Area, days: DaySummary[], t: Strings, context: Required<WeatherContext>, today: string): void {
  const count = Math.max(1, Math.min(days.length, Math.floor(area.height / MIN_DAY_ROW)));
  const shown = days.slice(0, count);
  const rowH = Math.min(MAX_DAY_ROW, Math.floor(area.height / count));
  const ranges = shown.map((day) => `${degrees(day.max)}/${degrees(day.min)}`);
  const rangeW = Math.max(...ranges.map((range) => textWidth(range)));
  const highW = Math.max(...shown.map((day) => textWidth(degrees(day.max))));
  // The label never runs into the temperature: it falls back to the weekday, which is then cut.
  const labels = shown.map((day, index) => dayLabel(day.day, index, today, t, context.language, area.width - highW - 4));
  const labelW = Math.max(0, Math.min(6 * GLYPH, area.width - highW - 4, Math.max(...labels.map((label) => textWidth(label)))));
  // Detail is dropped in order as the width runs out: the chance of rain, the icon, then the low.
  const free = area.width - labelW - 4;
  const withRange = free >= rangeW;
  const iconSize = rowH >= MIN_ICON + 2 ? Math.min(rowH - 2, 20) : 0;
  const withIcon = iconSize > 0 && free - (withRange ? rangeW : highW) >= iconSize + 4;
  const withPop = withIcon && withRange && free - rangeW >= iconSize + 4 + 4 * GLYPH + 4;
  shown.forEach((day, index) => {
    const top = area.y + index * rowH;
    const textY = top + Math.floor((rowH - GLYPH) / 2);
    if (index > 0 && rowH >= 13) dotted(canvas, area.x, top, area.width);
    canvas.drawText(labels[index], area.x, textY, labelW);
    let x = area.x + labelW + 4;
    if (withIcon) { drawWeatherIcon(canvas, day.icon, x, top + Math.floor((rowH - iconSize) / 2), iconSize); x += iconSize + 4; }
    if (withPop) canvas.drawText(`${day.pop}%`, x, textY, 4 * GLYPH);
    rightAligned(canvas, withRange ? ranges[index] : degrees(day.max), area.x + labelW + 4, area.x + area.width, textY);
  });
}

function drawDailyStrip(canvas: DrawingCanvas, area: Area, days: DaySummary[], t: Strings, context: Required<WeatherContext>, today: string): void {
  const columns = Math.min(days.length, clamp(Math.floor(area.width / MIN_DAY_COLUMN), 1, MAX_DAYS));
  const columnW = Math.floor(area.width / columns);
  // The high shows first, then the day's label, the low, and the icon with whatever height is left.
  const withLabel = area.height >= 2 * GLYPH + 2;
  let left = area.height - (withLabel ? GLYPH + 2 : 0) - GLYPH;
  const withLow = withLabel && left >= LINE;
  if (withLow) left -= LINE;
  let icon = withLabel ? Math.min(columnW - 6, left - 3, 32) : 0;
  if (icon < MIN_ICON) icon = 0;
  const content = (withLabel ? GLYPH + 2 : 0) + (icon ? icon + 3 : 0) + GLYPH + (withLow ? LINE : 0);
  let y = area.y + Math.max(0, Math.floor((area.height - content) / 2));
  const labelY = y;
  if (withLabel) y += GLYPH + 2;
  const iconY = y;
  if (icon) y += icon + 3;
  days.slice(0, columns).forEach((day, index) => {
    const left = area.x + index * columnW, right = left + columnW, centre = left + columnW / 2;
    if (index > 0 && withLabel) dotted(canvas, left, area.y, area.height, true);
    if (withLabel) centered(canvas, dayLabel(day.day, index, today, t, context.language, columnW), centre, labelY, left, right);
    if (icon) drawWeatherIcon(canvas, day.icon, Math.round(centre - icon / 2), iconY, icon);
    centered(canvas, degrees(day.max), centre, y, left, right);
    if (withLow) centered(canvas, degrees(day.min), centre, y + LINE, left, right);
  });
}

function drawDaily(canvas: DrawingCanvas, area: Area, source: WeatherSource, t: Strings, context: Required<WeatherContext>, options?: WidgetOptions): void {
  const days = dailyForecast(source.forecast ?? [], context.timeZone, context.now, source.data?.temp).slice(0, options?.items ?? MAX_DAYS);
  if (days.length === 0) { drawMessage(canvas, area, source.forecastError ? t.errors[source.forecastError.code] : t.noForecast); return; }
  const today = dayOf(context.now.getTime() / 1000, context.timeZone);
  // A wide, short widget lays the days side by side; a taller one stacks them.
  if (area.width >= 2.2 * area.height) drawDailyStrip(canvas, area, days, t, context, today);
  else drawDailyRows(canvas, area, days, t, context, today);
}

// ── Details ─────────────────────────────────────────────────────────────────

interface Reading { label: string; short: string; value: string; /** The value without its unit, for a very narrow column. */ bare: string }

function readings(source: WeatherSource, data: WeatherData, t: Strings, context: Required<WeatherContext>): Reading[] {
  const { language, timeZone } = context;
  const list: Reading[] = [];
  const add = (key: keyof Strings['labels'], value: string | undefined) => {
    if (value !== undefined) list.push({ label: t.labels[key], short: t.short[key], value, bare: value.replace(/ (m\/s|hPa|km|mm|m)$/, '') });
  };
  add('feelsLike', data.feelsLike === undefined ? undefined : degrees(data.feelsLike));
  add('humidity', data.humidity === undefined ? undefined : `${data.humidity}%`);
  add('windSpeed', `${formatDecimal(data.windSpeed, 0, language)} m/s`);
  add('windDirection', data.windDeg === undefined ? undefined : t.compass[Math.round(data.windDeg / 45) % 8]);
  add('gusts', data.windGust === undefined ? undefined : `${formatDecimal(data.windGust, 0, language)} m/s`);
  add('pressure', data.pressure === undefined ? undefined : `${data.pressure} hPa`);
  add('clouds', data.cloudiness === undefined ? undefined : `${data.cloudiness}%`);
  add('visibility', data.visibility === undefined ? undefined
    : data.visibility >= 1000 ? `${formatDecimal(data.visibility / 1000, data.visibility >= 10_000 ? 0 : 1, language)} km` : `${data.visibility} m`);
  add('rain', data.precipitation === undefined ? undefined : `${formatDecimal(data.precipitation, 1, language)} mm`);
  add('sunrise', data.sunrise === undefined ? undefined : clock(data.sunrise, timeZone));
  add('sunset', data.sunset === undefined ? undefined : clock(data.sunset, timeZone));
  add('aqi', source.airQuality ? t.airQuality[source.airQuality.aqi - 1] : undefined);
  add('pm25', source.airQuality?.pm25 === undefined ? undefined : formatDecimal(source.airQuality.pm25, 1, language));
  add('pm10', source.airQuality?.pm10 === undefined ? undefined : formatDecimal(source.airQuality.pm10, 1, language));
  return list;
}

function drawDetails(canvas: DrawingCanvas, area: Area, source: WeatherSource, data: WeatherData, t: Strings, context: Required<WeatherContext>): void {
  const list = readings(source, data, t, context);
  // Rows are 12 px with a dotted rule between them when that leaves at least three; else tight.
  const separated = Math.floor(area.height / SEPARATED_ROW) >= 3;
  const pitch = separated ? SEPARATED_ROW : LINE;
  const capacity = Math.max(1, Math.floor(area.height / pitch));
  // One column with the full labels, unless the list is longer than the height allows.
  const columns = list.length > capacity && area.width >= 2 * MIN_DETAIL_COLUMN + 8 ? 2 : 1;
  const columnW = Math.floor((area.width - (columns - 1) * 8) / columns);
  // A short list gets looser rows, so it fills the widget instead of crowding its top.
  const perColumn = Math.min(capacity, Math.ceil(list.length / columns));
  const rowH = clamp(Math.floor(area.height / Math.max(1, perColumn)), pitch, 16);
  if (columns === 2) dotted(canvas, area.x + columnW + 3, area.y, Math.min(area.height, perColumn * rowH), true);
  list.slice(0, capacity * columns).forEach((reading, index) => {
    const column = Math.floor(index / Math.max(1, perColumn));
    if (column >= columns) return;
    const x = area.x + column * (columnW + 8);
    const y = area.y + (index % Math.max(1, perColumn)) * rowH + Math.floor((rowH - GLYPH) / 2);
    // The full label; else the short one; else the short one beside the value without its unit,
    // cut to what is left.
    const roomFor = (value: string) => Math.floor((columnW - textWidth(value)) / GLYPH) - 1;
    const [label, value] = Array.from(reading.label).length <= roomFor(reading.value) ? [reading.label, reading.value]
      : Array.from(reading.short).length <= roomFor(reading.value) ? [reading.short, reading.value]
      : [Array.from(reading.short).slice(0, Math.max(0, roomFor(reading.bare))).join(''), reading.bare];
    canvas.drawText(label, x, y, columnW);
    rightAligned(canvas, value, x, x + columnW, y);
    const row = index % Math.max(1, perColumn);
    if (separated && row < perColumn - 1 && index < list.length - 1) dotted(canvas, x, area.y + (row + 1) * rowH - 1, columnW);
  });
}

// ── Entry point ─────────────────────────────────────────────────────────────

export function renderWeatherWidget(
  canvas: DrawingCanvas,
  bounds: Bounds,
  source: WeatherSource,
  options: WidgetOptions | undefined,
  context: WeatherContext,
): void {
  const { x, y, width, height } = bounds;
  const language = context.language ?? DEFAULT_DISPLAY_LANGUAGE;
  const t = displayStrings(language).weather;
  if (y > 0) canvas.drawHLine(x, y, width);
  const view = weatherView(options);
  const { data } = source;
  if (view === 'summary' || !data) { drawSummary(canvas, bounds, source, t, language); return; }
  const area: Area = { x: x + PAD, y: y + PAD, width: width - 2 * PAD, height: height - PAD - 1 };
  if (area.width < 2 * GLYPH || area.height < GLYPH) return;
  const resolved = { language, timeZone: context.timeZone, now: context.now ?? new Date() };
  switch (view) {
    case 'current': drawCurrent(canvas, area, data, t, resolved); break;
    case 'hours': drawHours(canvas, area, source, t, resolved, options); break;
    case 'daily': drawDaily(canvas, area, source, t, resolved, options); break;
    case 'details': drawDetails(canvas, area, source, data, t, resolved); break;
  }
}
