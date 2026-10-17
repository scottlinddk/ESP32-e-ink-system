import type { FamilyMealsData, FamilyMealsDay } from '../types';
import { DEFAULT_DISPLAY_LANGUAGE, type DisplayLanguage } from './displayLanguage';
import { displayStrings } from './displayStrings';

// Family Meals widget: the week's dinners from the Family Meals app. Two views, chosen per placement.
//
// week (view "full")                 tonight (view "condensed")
//   Meals Week 42                      Tonight 18:00
//   Mon Pasta bolognese                Pasta bolognese
//   Tue Fish and chips
//  [Wed Chicken curry      ]  <- today
//   Thu Leftovers: Curry
//   Fri No dinner
//   Sat -
//   Sun Burgers
//
// A week that does not fit the widget's height drops the header, then shows the days from today
// onward rather than the days that have passed.

export interface FamilyMealsCanvas {
  drawText(text: string, x: number, y: number, maxWidth?: number, scale?: number, black?: boolean): void;
  drawWrappedText(text: string, x: number, y: number, w: number, lineH?: number, scale?: number): number;
  drawHLine(x: number, y: number, w: number): void;
  fillRect(x: number, y: number, w: number, h: number, black?: boolean): void;
}
export interface FamilyMealsBounds { x: number; y: number; width: number; height: number }
export type FamilyMealsView = 'full' | 'condensed';

const GLYPH = 8;
const LINE = 10;
const PAD = 2;

/** What a day shows after its weekday: the dish, or why there is none. */
export function dayText(day: FamilyMealsDay, language: DisplayLanguage): string {
  const t = displayStrings(language).familyMeals;
  switch (day.kind) {
    case 'dinner': return day.title ?? '-';
    case 'leftover': return day.title ? `${t.leftovers}: ${day.title}` : t.leftovers;
    case 'empty': return day.note ?? t.nothingPlanned;
    case 'unplanned': return '-';
  }
}

/** Which days of the week are drawn when only `capacity` rows fit: from today on, never past Sunday. */
export function visibleDays(days: FamilyMealsDay[], today: string, capacity: number): FamilyMealsDay[] {
  if (capacity >= days.length) return days;
  if (capacity < 1) return [];
  const todayIndex = days.findIndex((day) => day.date === today);
  const start = Math.min(Math.max(todayIndex, 0), days.length - capacity);
  return days.slice(start, start + capacity);
}

function drawMessage(canvas: FamilyMealsCanvas, bounds: FamilyMealsBounds, message: string): void {
  canvas.drawWrappedText(message, bounds.x + PAD, bounds.y + PAD, bounds.width - 2 * PAD);
}

function drawWeek(canvas: FamilyMealsCanvas, bounds: FamilyMealsBounds, data: FamilyMealsData, language: DisplayLanguage): void {
  const strings = displayStrings(language);
  const t = strings.familyMeals;
  const x = bounds.x + PAD;
  const width = bounds.width - 2 * PAD;
  // A row is a glyph tall with a pixel of air either side, the highlighted one included.
  const capacity = Math.floor((bounds.height - PAD + (LINE - GLYPH)) / LINE);
  let y = bounds.y + PAD;
  let rows = capacity;
  if (capacity > data.days.length) {
    canvas.drawText(`${t.title} ${strings.week.label} ${data.isoWeek}`, x, y, width);
    y += LINE;
    rows = capacity - 1;
  }
  const labels = strings.dates.weekdays;
  const labelChars = Math.max(...labels.map((label) => label.length));
  const textX = x + (labelChars + 1) * GLYPH;
  for (const day of visibleDays(data.days, data.today, rows)) {
    const isToday = day.date === data.today;
    // Today is white on a bar, so it reads at a glance without a symbol that costs a column.
    if (isToday) canvas.fillRect(bounds.x, y - 1, bounds.width, LINE);
    canvas.drawText(labels[(day.weekday + 1) % 7], x, y, width, 1, !isToday);
    canvas.drawText(dayText(day, language), textX, y, bounds.x + bounds.width - PAD - textX, 1, !isToday);
    y += LINE;
  }
}

function drawTonight(canvas: FamilyMealsCanvas, bounds: FamilyMealsBounds, data: FamilyMealsData, language: DisplayLanguage): void {
  const t = displayStrings(language).familyMeals;
  const today = data.days.find((day) => day.date === data.today);
  if (!today || today.kind === 'unplanned') { drawMessage(canvas, bounds, t.noPlan); return; }
  const x = bounds.x + PAD;
  const width = bounds.width - 2 * PAD;
  const y = bounds.y + PAD;
  canvas.drawText(`${t.tonight}${today.dinnerTime ? ` ${today.dinnerTime}` : ''}`, x, y, width);
  // Double-size glyphs when there is room for a couple of lines of them.
  const scale = width >= 20 * GLYPH && bounds.height >= LINE + 2 * (2 * GLYPH + 2) + PAD ? 2 : 1;
  canvas.drawWrappedText(dayText(today, language), x, y + LINE + 2, width, GLYPH * scale + 2, scale);
}

export function renderFamilyMealsWidget(
  canvas: FamilyMealsCanvas,
  bounds: FamilyMealsBounds,
  data: FamilyMealsData | undefined,
  problem: { code: string } | undefined,
  options: { view: FamilyMealsView; language?: DisplayLanguage },
): void {
  const language = options.language ?? DEFAULT_DISPLAY_LANGUAGE;
  const t = displayStrings(language).familyMeals;
  if (bounds.y > 0) canvas.drawHLine(bounds.x, bounds.y, bounds.width);
  if (!data) {
    const labels: Record<string, string | undefined> = t.errors;
    drawMessage(canvas, bounds, labels[problem?.code ?? ''] ?? t.unavailable);
    return;
  }
  if (!data.planned) { drawMessage(canvas, bounds, t.noPlan); return; }
  if (options.view === 'condensed') drawTonight(canvas, bounds, data, language);
  else drawWeek(canvas, bounds, data, language);
}
