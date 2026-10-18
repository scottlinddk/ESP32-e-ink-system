import type { FamilyMealsData, FamilyMealsDay } from '../types';
import { DEFAULT_DISPLAY_LANGUAGE, type DisplayLanguage } from './displayLanguage';
import { displayStrings } from './displayStrings';
import { wrapBitmapText } from './bitmapText';
import type { FamilyMealsView } from './widgetOptions';

// Family Meals widget: the week's dinners from the Family Meals app. Five views, chosen per placement.
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
// upcoming (view "upcoming")         planner (view "planner")           recipe (view "recipe")
//   Today        Wed 14 | Coming days   +--------+ +--------+            Chicken curry
//   DINNER              | Thu 15 Curry |Mon 12  | |Tue 13  |            [18:00] [45 min] [vegetarian]
//   Chicken curry       | Fri 16 Fish  |Pasta   | |Fish    |            Ingredients (when sent)
//   18:00 - 45 min      | Sat 17 -     +--------+ +--------+            chicken      500 g
//                                      [Wed 14 ...  ] <- today
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
export type { FamilyMealsView };

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

/** The day of the month, which the week's ISO date carries after its second dash. */
function dayOfMonth(day: FamilyMealsDay): number {
  return Number(day.date.slice(8, 10));
}

function dayLabel(day: FamilyMealsDay, labels: readonly string[]): string {
  return `${labels[(day.weekday + 1) % 7]} ${dayOfMonth(day)}`;
}

/** At most `maxLines` wrapped lines; a longer text ends its last line in "...". */
function clampLines(text: string, maxChars: number, maxLines: number): string[] {
  const lines = [...wrapBitmapText(text, maxChars)];
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1]!;
  kept[maxLines - 1] = `${last.slice(0, Math.max(0, maxChars - 3))}...`;
  return kept;
}

/** Double size only when the longest word still fits a line, so a heading is never split mid-word. */
function headingScale(text: string, width: number): 1 | 2 {
  const longest = Math.max(0, ...text.split(/\s+/u).map((word) => word.length));
  return longest * 2 * GLYPH <= width ? 2 : 1;
}

function drawOutline(canvas: FamilyMealsCanvas, x: number, y: number, w: number, h: number): void {
  canvas.drawHLine(x, y, w);
  canvas.drawHLine(x, y + h - 1, w);
  canvas.fillRect(x, y, 1, h);
  canvas.fillRect(x + w - 1, y, 1, h);
}

/** A rule of every other pixel, for a quieter divider than a solid line. */
function drawDotted(canvas: FamilyMealsCanvas, x: number, y: number, w: number): void {
  for (let i = 0; i < w; i += 2) canvas.fillRect(x + i, y, 1, 1);
}

/** Text on a black tag; returns the x after it. */
function drawChip(canvas: FamilyMealsCanvas, label: string, x: number, y: number, maxRight: number): number {
  const width = Math.min(label.length * GLYPH + 2 * PAD, maxRight - x);
  canvas.fillRect(x, y, width, LINE);
  canvas.drawText(label, x + PAD, y + 1, width - 2 * PAD, 1, false);
  return x + width;
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

/** Today's day when it has something to show; undefined for a day outside the week or without a plan. */
function planned(data: FamilyMealsData): FamilyMealsDay | undefined {
  const today = data.days.find((day) => day.date === data.today);
  return today && today.kind !== 'unplanned' ? today : undefined;
}

/** Today's dinner beside the days still to come, like a day card next to an agenda. */
function drawUpcoming(canvas: FamilyMealsCanvas, bounds: FamilyMealsBounds, data: FamilyMealsData, language: DisplayLanguage): void {
  // Two columns need room; a narrow widget is better served by tonight alone.
  if (bounds.width < 20 * GLYPH) { drawTonight(canvas, bounds, data, language); return; }
  const strings = displayStrings(language);
  const t = strings.familyMeals;
  const labels = strings.dates.weekdays;
  const leftW = Math.floor(bounds.width * 0.45) - PAD;
  const leftX = bounds.x + PAD;
  const rightX = bounds.x + leftW + 3 * PAD + 3;
  const rightW = bounds.x + bounds.width - PAD - rightX;
  const bottom = bounds.y + bounds.height;
  const top = bounds.y + PAD;

  canvas.drawText(t.today, leftX, top, leftW);
  canvas.drawHLine(leftX, top + GLYPH + 1, leftW);
  canvas.drawText(t.comingDays, rightX, top, rightW);
  canvas.drawHLine(rightX, top + GLYPH + 1, rightW);
  for (let y = top; y < bottom - PAD; y += 2) canvas.fillRect(rightX - PAD - 2, y, 1, 1);

  const today = planned(data);
  const bodyY = top + LINE + 3;
  if (!today) {
    canvas.drawWrappedText(t.noPlan, leftX, bodyY, leftW);
  } else {
    const todayDay = data.days.find((day) => day.date === data.today)!;
    const date = dayLabel(todayDay, labels);
    if ((t.today.length + 1 + date.length) * GLYPH <= leftW) canvas.drawText(date, leftX + leftW - date.length * GLYPH, top, date.length * GLYPH, 1);
    canvas.drawText(t.dinner, leftX, bodyY, leftW);
    const dishY = bodyY + LINE;
    const dish = dayText(today, language);
    const scale = bottom - dishY >= 2 * (2 * GLYPH + 2) ? headingScale(dish, leftW) : 1;
    const afterDish = canvas.drawWrappedText(dish, leftX, dishY, leftW, GLYPH * scale + 2, scale);
    // A no-break space keeps "45 min" together when the facts wrap.
    const facts = [today.dinnerTime, today.totalTimeMinutes ? `${today.totalTimeMinutes}\u00a0${t.minutes}` : null].filter(Boolean).join(', ');
    if (facts) canvas.drawWrappedText(facts, leftX, afterDish + 2, leftW);
  }

  const later = data.days.filter((day) => day.date > data.today);
  if (later.length === 0) { canvas.drawWrappedText(t.noMoreDays, rightX, bodyY, rightW); return; }
  // The widest date label plus a space, so the dish never touches it.
  const labelChars = Math.max(...later.map((day) => dayLabel(day, labels).length)) + 1;
  const textX = rightX + labelChars * GLYPH;
  const inlineChars = Math.floor((bounds.x + bounds.width - PAD - textX) / GLYPH);
  // Beside the date a dish gets too few characters to read on a narrow widget, so the date goes above it.
  const stacked = inlineChars < 12;
  const maxChars = stacked ? Math.floor(rightW / GLYPH) : inlineChars;
  let y = bodyY;
  for (const day of later) {
    const lines = clampLines(dayText(day, language), maxChars, stacked ? 1 : 2);
    const rowH = (stacked ? 1 : 0) * LINE + lines.length * LINE;
    if (y + rowH > bottom - PAD) break;
    canvas.drawText(dayLabel(day, labels), rightX, y, labelChars * GLYPH);
    const lineX = stacked ? rightX : textX;
    const lineY = stacked ? y + LINE : y;
    lines.forEach((line, index) => canvas.drawText(line, lineX, lineY + index * LINE, maxChars * GLYPH));
    y += rowH + 1;
    drawDotted(canvas, rightX, y, rightW);
    y += 3;
  }
}

const CARD_H = 25;
const CARD_GAP = 3;

/** A bordered card per day, two to a row when the widget is wide. Today is white on black. */
function drawPlanner(canvas: FamilyMealsCanvas, bounds: FamilyMealsBounds, data: FamilyMealsData, language: DisplayLanguage): void {
  const strings = displayStrings(language);
  const t = strings.familyMeals;
  const labels = strings.dates.weekdays;
  const columns = bounds.width >= 20 * GLYPH ? 2 : 1;
  const rowsFit = Math.floor((bounds.height + CARD_GAP) / (CARD_H + CARD_GAP));
  if (rowsFit < 1) { drawTonight(canvas, bounds, data, language); return; }
  const cardW = Math.floor((bounds.width - CARD_GAP * (columns - 1)) / columns);
  const shown = visibleDays(data.days, data.today, rowsFit * columns);
  const rows = Math.ceil(shown.length / columns);
  shown.forEach((day, index) => {
    const x = bounds.x + (index % columns) * (cardW + CARD_GAP);
    const y = bounds.y + Math.floor(index / columns) * (CARD_H + CARD_GAP);
    const isToday = day.date === data.today;
    if (isToday) canvas.fillRect(x, y, cardW, CARD_H); else drawOutline(canvas, x, y, cardW, CARD_H);
    const inner = cardW - 2 * (PAD + 1);
    const label = dayLabel(day, labels);
    canvas.drawText(label, x + PAD + 1, y + PAD, inner, 1, !isToday);
    // The dinner time sits at the card's right edge when the weekday leaves room for it.
    if (day.dinnerTime && inner >= (label.length + 6) * GLYPH) {
      canvas.drawText(day.dinnerTime, x + cardW - PAD - 1 - day.dinnerTime.length * GLYPH, y + PAD, inner, 1, !isToday);
    }
    // The rule is white on the inverted card, so it shows on either.
    for (let i = 0; i < inner; i++) canvas.fillRect(x + PAD + 1 + i, y + PAD + GLYPH + 1, 1, 1, !isToday);
    canvas.drawText(dayText(day, language), x + PAD + 1, y + PAD + LINE + 3, inner, 1, !isToday);
  });
  const usedH = rows * (CARD_H + CARD_GAP) - CARD_GAP;
  if (bounds.height - usedH >= CARD_GAP + GLYPH) {
    canvas.drawText(`${t.title} ${strings.week.label} ${data.isoWeek}`, bounds.x + PAD, bounds.y + usedH + CARD_GAP, bounds.width - 2 * PAD);
  }
}

/** Tonight's recipe: the dish with tags for its times, and its ingredients beside it when Family Meals sends them. */
function drawRecipe(canvas: FamilyMealsCanvas, bounds: FamilyMealsBounds, data: FamilyMealsData, language: DisplayLanguage): void {
  const t = displayStrings(language).familyMeals;
  const today = planned(data);
  if (!today) { drawMessage(canvas, bounds, t.noPlan); return; }
  if (today.kind === 'empty') { drawMessage(canvas, bounds, dayText(today, language)); return; }
  const ingredients = today.ingredients ?? [];
  const sideBySide = ingredients.length > 0 && bounds.width >= 24 * GLYPH;
  const leftW = (sideBySide ? Math.floor(bounds.width * 0.5) - 2 * PAD : bounds.width - 2 * PAD);
  const x = bounds.x + PAD;
  const bottom = bounds.y + bounds.height;

  const dish = dayText(today, language);
  const scale = bounds.height >= 2 * (2 * GLYPH + 2) + 2 * LINE + PAD ? headingScale(dish, leftW) : 1;
  let y = canvas.drawWrappedText(dish, x, bounds.y + PAD, leftW, GLYPH * scale + 2, scale) + 2;
  const tags = [
    today.dinnerTime, today.totalTimeMinutes ? `${today.totalTimeMinutes} ${t.minutes}` : null,
    today.kind === 'leftover' ? t.leftovers : null, ...(today.tags ?? []),
  ].filter((tag): tag is string => !!tag);
  let cx = x;
  for (const tag of tags) {
    const width = Math.min(tag.length * GLYPH + 2 * PAD, leftW);
    if (cx > x && cx + width > x + leftW) { cx = x; y += LINE + 3; }
    if (y + LINE > bottom) break;
    cx = drawChip(canvas, tag, cx, y, x + leftW) + 3;
  }
  if (!sideBySide) return;

  const rightX = bounds.x + Math.floor(bounds.width * 0.5) + PAD;
  const rightW = bounds.x + bounds.width - PAD - rightX;
  canvas.drawText(t.ingredients, rightX, bounds.y + PAD, rightW);
  canvas.drawHLine(rightX, bounds.y + PAD + GLYPH + 1, rightW);
  let iy = bounds.y + PAD + LINE + 3;
  for (const line of ingredients) {
    if (iy + GLYPH > bottom) break;
    canvas.drawText(line, rightX, iy, rightW);
    drawDotted(canvas, rightX, iy + GLYPH + 1, rightW);
    iy += LINE + 1;
  }
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
  switch (options.view) {
    case 'condensed': drawTonight(canvas, bounds, data, language); break;
    case 'upcoming': drawUpcoming(canvas, bounds, data, language); break;
    case 'planner': drawPlanner(canvas, bounds, data, language); break;
    case 'recipe': drawRecipe(canvas, bounds, data, language); break;
    default: drawWeek(canvas, bounds, data, language);
  }
}
