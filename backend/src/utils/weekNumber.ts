// Week number widget: the ISO 8601 week (Monday start, week 1 contains the year's first
// Thursday) of the display's local date, drawn large over a background that fills from
// left to right as the ISO week-year passes. Text over the filled part is drawn white.

export interface WeekCanvas {
  drawHLine(x: number, y: number, w: number): void;
  fillRect(x: number, y: number, w: number, h: number, black?: boolean): void;
  drawText(text: string, x: number, y: number, maxWidth?: number, scale?: number, black?: boolean): void;
  withClip(bounds: WeekBounds, draw: () => void): void;
}

export interface WeekBounds { x: number; y: number; width: number; height: number }

export interface IsoWeekInfo {
  /** 1–53. */
  week: number;
  /** The ISO week-year, which differs from the calendar year around New Year. */
  year: number;
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** Monday and Sunday of the week, as UTC midnights of the local dates. */
  weekStart: Date;
  weekEnd: Date;
  weeksInYear: 52 | 53;
  /** Share of the ISO week-year's days up to and including today, 0–1. */
  progress: number;
}

const DAY_MS = 86_400_000;
const GLYPH = 8;
const PAD = 3;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The local calendar date in `timeZone`, as a UTC midnight, so date arithmetic ignores DST. */
function localDate(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
}

function isoWeekOf(date: Date): { week: number; year: number; weekday: number } {
  const weekday = ((date.getUTCDay() + 6) % 7) + 1;
  // The Thursday of this week decides the year, and its ordinal day the week.
  const thursday = new Date(date.getTime() + (4 - weekday) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1;
  return { week, year, weekday };
}

export function isoWeekInfo(now: Date, timeZone: string): IsoWeekInfo {
  const today = localDate(now, timeZone);
  const { week, year, weekday } = isoWeekOf(today);
  // 28 December is always in the year's last ISO week.
  const weeksInYear = isoWeekOf(new Date(Date.UTC(year, 11, 28))).week as 52 | 53;
  const weekStart = new Date(today.getTime() - (weekday - 1) * DAY_MS);
  return {
    week, year, weekday, weekStart, weeksInYear,
    weekEnd: new Date(weekStart.getTime() + 6 * DAY_MS),
    progress: ((week - 1) * 7 + weekday) / (weeksInYear * 7),
  };
}

/** "Oct 5-11", or "Sep 29-Oct 5" when the week spans two months. */
export function formatWeekRange(start: Date, end: Date): string {
  const startMonth = MONTHS[start.getUTCMonth()];
  const endMonth = MONTHS[end.getUTCMonth()];
  return startMonth === endMonth
    ? `${startMonth} ${start.getUTCDate()}-${end.getUTCDate()}`
    : `${startMonth} ${start.getUTCDate()}-${endMonth} ${end.getUTCDate()}`;
}

/** The largest whole font scale at which `text` fits in the box, at least 1. */
function fitScale(text: string, width: number, height: number): number {
  return Math.max(1, Math.min(Math.floor(width / (text.length * GLYPH)), Math.floor(height / GLYPH)));
}

export function renderWeekNumberWidget(canvas: WeekCanvas, bounds: WeekBounds, now: Date, timeZone: string): void {
  const { x, width } = bounds;
  if (bounds.y > 0) canvas.drawHLine(x, bounds.y, width);
  const y = bounds.y > 0 ? bounds.y + 1 : bounds.y;
  const height = bounds.y > 0 ? bounds.height - 1 : bounds.height;
  const info = isoWeekInfo(now, timeZone);
  const fillW = Math.round(width * info.progress);
  canvas.fillRect(x, y, fillW, height);

  // Draws text black on the empty part and white on the filled part, split at the fill edge.
  const text = (value: string, tx: number, ty: number, scale = 1) => {
    canvas.withClip({ x: x + fillW, y, width: width - fillW, height }, () => canvas.drawText(value, tx, ty, width, scale));
    canvas.withClip({ x, y, width: fillW, height }, () => canvas.drawText(value, tx, ty, width, scale, false));
  };
  const centered = (value: string, top: number, boxH: number, scale: number) => {
    const textW = value.length * GLYPH * scale;
    text(value, x + Math.floor((width - textW) / 2), top + Math.floor((boxH - GLYPH * scale) / 2), scale);
  };

  const number = String(info.week);
  const innerW = width - 2 * PAD;
  // Too small for a header: one line, with the longest label that fits.
  if (height < 28 || width < 40) {
    const label = [`Week ${number}`, `W${number}`, number].find((item) => item.length * GLYPH <= width - 2) ?? number;
    centered(label, y, height, fitScale(label, width - 2, height - 2));
    return;
  }

  const year = String(info.year);
  text('WEEK', x + PAD, y + PAD);
  if (innerW >= ('WEEK'.length + 1 + year.length) * GLYPH) text(year, x + width - PAD - year.length * GLYPH, y + PAD);
  let bottom = y + height;
  const range = formatWeekRange(info.weekStart, info.weekEnd);
  if (height >= 56 && range.length * GLYPH <= innerW) {
    bottom -= PAD + GLYPH;
    text(range, x + PAD, bottom);
    const percent = `${Math.floor(info.progress * 100)}%`;
    if ((range.length + 1 + percent.length) * GLYPH <= innerW) text(percent, x + width - PAD - percent.length * GLYPH, bottom);
    bottom -= 2;
  }
  const top = y + PAD + GLYPH + 2;
  centered(number, top, bottom - top, fitScale(number, innerW, bottom - top));
}
