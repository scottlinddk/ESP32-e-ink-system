import type { CalendarData, CalendarEvent, WidgetOptions } from '../types';
import type { Bounds, DrawingCanvas } from './zoomCanvas';
import { wrapBitmapText } from './bitmapText';
import { CALENDAR_ERROR_LABELS, type CalendarProblem } from './calendarErrors';
import { dayOfMonth, monthGrid, monthName, monthShort, shiftDay, weekdayName } from './calendarDays';
import { calendarView, MAX_CALENDAR_DAYS, MIN_CALENDAR_DAYS } from './widgetOptions';

// The four calendar views, drawn with the 8 x 8 font on a canvas that is already zoomed to
// the widget. Every view degrades to the list when the widget is too small to draw it.

const GLYPH = 8;
const LINE = 10;
const GUTTER = 2 * GLYPH + 4;
const MIN_HOUR_PX = 12;
const MIN_BLOCK_PX = 9;
const MIN_TIMELINE_COLUMN = 5 * GLYPH;
const MIN_LANE = 5 * GLYPH;
const MAX_STRIP_LINES = 2;
const MIN_HOURS = 4;
const AUTO_DAY_COLUMN = 10 * GLYPH;
const MAX_DOTS = 3;

export interface CalendarSource { data?: CalendarData; error?: CalendarProblem }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const chars = (pixels: number) => Math.max(0, Math.floor(pixels / GLYPH));
const pad2 = (value: number) => String(value).padStart(2, '0');

/** The first candidate that fits `pixels` wide, else the last one. */
function fitLabel(candidates: string[], pixels: number): string {
  return candidates.find((label) => label.length * GLYPH <= pixels) ?? candidates[candidates.length - 1];
}

/** A white label on a black bar. */
function drawBar(canvas: DrawingCanvas, x: number, y: number, width: number, text: string): void {
  canvas.fillRect(x, y, width, GLYPH + 1);
  canvas.drawText(text, x + 1, y + 1, width - 2, 1, false);
}

export function renderCalendarWidget(canvas: DrawingCanvas, bounds: Bounds, source: CalendarSource, options?: WidgetOptions): void {
  const { x, y, width } = bounds;
  if (y > 0) canvas.drawHLine(x, y, width);
  const { data, error } = source;
  if (!data) {
    canvas.drawWrappedText(error ? `Calendar: ${CALENDAR_ERROR_LABELS[error.code]}` : 'Calendar: unavailable', x + 2, y + 2, width - 4, LINE);
    return;
  }
  const view = calendarView(options);
  if (view === 'month' && drawMonth(canvas, bounds, data)) return;
  if (view === 'day' && drawTimeline(canvas, bounds, data, 1)) return;
  if (view === 'days') {
    const columns = options?.days ?? clamp(Math.floor((width - GUTTER) / AUTO_DAY_COLUMN), MIN_CALENDAR_DAYS, MAX_CALENDAR_DAYS);
    if (drawTimeline(canvas, bounds, data, columns)) return;
  }
  drawList(canvas, bounds, data, options?.items);
}

// ── List ─────────────────────────────────────────────────────────────────────

/** Events still to come within the configured horizon, the earliest first. */
function upcoming(data: CalendarData, limit: number): CalendarEvent[] {
  const last = shiftDay(data.today, data.days - 1);
  return data.events.filter((event) => event.endDay >= data.today && event.day <= last
    && !(event.endDay === data.today && event.endMinute !== null && event.endMinute <= data.nowMinute)).slice(0, limit);
}

function groupLabel(day: string, today: string, pixels: number): string {
  const date = `${weekdayName(day)} ${dayOfMonth(day)} ${monthShort(day)}`;
  const short = `${weekdayName(day)} ${dayOfMonth(day)}`;
  if (day === today) return fitLabel([`Today, ${date}`, `Today ${dayOfMonth(day)} ${monthShort(day)}`, 'Today'], pixels);
  if (day === shiftDay(today, 1)) return fitLabel([`Tomorrow, ${date}`, `Tomorrow ${dayOfMonth(day)} ${monthShort(day)}`, 'Tomorrow'], pixels);
  return fitLabel([date, short, `${dayOfMonth(day)} ${monthShort(day)}`], pixels);
}

function drawList(canvas: DrawingCanvas, bounds: Bounds, data: CalendarData, items?: number): void {
  const { x, y, width, height } = bounds;
  const bottom = y + height;
  const events = upcoming(data, Math.min(items ?? data.limit, data.limit));
  let textY = y + 2;
  if (events.length === 0) {
    canvas.drawText('No upcoming events', x + 2, textY, width - 4);
    return;
  }
  // One or two lines of space is for events alone: a day heading would take half of it.
  if (height < 3 * LINE) {
    for (const event of events) {
      if (textY + GLYPH > bottom) break;
      textY = canvas.drawWrappedText(`${event.dateLabel} ${event.timeLabel}: ${event.title}`, x + 2, textY, width - 4, LINE) + 2;
    }
    return;
  }
  let currentDay = '';
  for (const event of events) {
    // An event that began earlier but is still on belongs under today.
    const day = event.day < data.today ? data.today : event.day;
    if (day !== currentDay) {
      // A heading with no room for an event under it is left out.
      if (textY + (GLYPH + 1) + LINE > bottom + 2) break;
      drawBar(canvas, x + 1, textY, width - 2, groupLabel(day, data.today, width - 4));
      textY += LINE + 1;
      currentDay = day;
    }
    if (textY + GLYPH > bottom) break;
    const prefix = event.allDay ? '• ' : `${event.timeLabel} `;
    const lines = [...wrapBitmapText(event.title, Math.max(1, chars(width - 4) - prefix.length))].slice(0, 2);
    lines.forEach((line, index) => {
      if (textY + GLYPH > bottom) return;
      // The first line carries the time; the next one hangs under the title.
      if (index === 0) canvas.drawText(`${prefix}${line}`, x + 2, textY, width - 4);
      else canvas.drawText(line, x + 2 + prefix.length * GLYPH, textY, width - 4 - prefix.length * GLYPH);
      textY += LINE;
    });
    textY += 1;
  }
}

// ── Day and days ─────────────────────────────────────────────────────────────

interface Segment { event: CalendarEvent; start: number; end: number; shownEnd: number; lane: number; lanes: number }

/** Timed events on `day`, clipped to it, with side-by-side lanes for those that overlap. */
function layoutSegments(events: CalendarEvent[], day: string, minMinutes: number): Segment[] {
  const segments: Segment[] = events.filter((event) => !event.allDay && event.day <= day && event.endDay >= day)
    .map((event) => {
      const start = event.day === day ? event.startMinute ?? 0 : 0;
      const end = event.endDay === day ? event.endMinute ?? start : 1440;
      return { event, start, end: Math.max(start, end), shownEnd: Math.max(end, start + minMinutes), lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.start - b.start || b.shownEnd - a.shownEnd);
  let cluster: Segment[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = 0;
  const close = () => { for (const segment of cluster) segment.lanes = laneEnds.length; cluster = []; laneEnds = []; clusterEnd = 0; };
  for (const segment of segments) {
    if (segment.start >= clusterEnd) close();
    let lane = laneEnds.findIndex((end) => end <= segment.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = segment.shownEnd;
    segment.lane = lane;
    clusterEnd = Math.max(clusterEnd, segment.shownEnd);
    cluster.push(segment);
  }
  close();
  return segments;
}

function dayHeading(day: string, single: boolean, pixels: number): string {
  const full = `${weekdayName(day)} ${dayOfMonth(day)} ${monthShort(day)}`;
  const short = `${weekdayName(day)} ${dayOfMonth(day)}`;
  return fitLabel(single ? [full, short, `${dayOfMonth(day)}`] : [short, `${weekdayName(day).slice(0, 2)} ${dayOfMonth(day)}`, `${dayOfMonth(day)}`], pixels);
}

/** The hour grid for one or more days. Returns false, drawing nothing, when it does not fit. */
function drawTimeline(canvas: DrawingCanvas, bounds: Bounds, data: CalendarData, dayCount: number): boolean {
  const { x, y, width, height } = bounds;
  const bottom = y + height;
  const columnWidth = Math.floor((width - GUTTER - 1) / dayCount);
  if (columnWidth < MIN_TIMELINE_COLUMN) return false;
  const days = Array.from({ length: dayCount }, (_, index) => shiftDay(data.today, index));
  const allDay = days.map((day) => data.events.filter((event) => event.allDay && event.day <= day && event.endDay >= day));

  // Heading, then the all-day strip. The strip gives way before the hours do.
  const headingTop = y + 1;
  let gridTop = headingTop + LINE;
  const spare = Math.floor((bottom - gridTop - MIN_HOURS * MIN_HOUR_PX) / LINE);
  const stripLines = clamp(Math.max(...allDay.map((list) => list.length)), 0, Math.min(MAX_STRIP_LINES, Math.max(0, spare)));
  const stripTop = gridTop;
  gridTop += stripLines ? stripLines * LINE + 1 : 0;
  const available = bottom - gridTop - 1;
  // A grid of fewer than a few hours says too little to be worth drawing.
  if (available < MIN_HOURS * MIN_HOUR_PX) return false;

  const hours = Math.min(24, Math.floor(available / MIN_HOUR_PX));
  const hourPx = Math.floor(available / hours);
  // Start an hour before now, so what just happened and what is next are both in view.
  const firstHour = hours >= 24 ? 0 : clamp(Math.floor(data.nowMinute / 60) - 1, 0, 24 - hours);
  const windowStart = firstHour * 60;
  const windowEnd = (firstHour + hours) * 60;
  const gridX = x + GUTTER;
  const yOf = (minute: number) => gridTop + Math.round((minute - windowStart) * hourPx / 60);

  // Hour lines are dotted, so events drawn over them stay readable.
  for (let hour = 0; hour < hours; hour++) {
    const lineY = gridTop + hour * hourPx;
    canvas.drawText(pad2(firstHour + hour), x + 1, lineY + 1, GUTTER - 2);
    for (let px = gridX; px < x + width; px += 2) canvas.setPixel(px, lineY, true);
  }
  canvas.fillRect(gridX, headingTop, 1, bottom - headingTop);

  const minMinutes = Math.ceil(MIN_BLOCK_PX * 60 / hourPx);
  days.forEach((day, index) => {
    const left = gridX + index * columnWidth;
    if (index > 0) canvas.fillRect(left, headingTop, 1, bottom - headingTop);
    const heading = dayHeading(day, dayCount === 1, columnWidth - 3);
    if (day === data.today) drawBar(canvas, left + 1, headingTop, columnWidth - 1, heading);
    else canvas.drawText(heading, left + 2, headingTop + 1, columnWidth - 3);

    const list = allDay[index];
    for (let line = 0; line < Math.min(stripLines, list.length); line++) {
      const more = list.length > stripLines && line === stripLines - 1;
      drawBar(canvas, left + 1, stripTop + line * LINE, columnWidth - 1, more ? `+${list.length - line} more` : list[line].title);
    }

    // Where the day stands now. Drawn first, so an event under it stays readable.
    if (day === data.today && data.nowMinute >= windowStart && data.nowMinute < windowEnd) {
      const nowY = yOf(data.nowMinute);
      canvas.fillRect(left + 1, nowY, columnWidth - 1, 1);
      canvas.fillRect(left - 3, nowY - 1, 3, 3);
    }

    canvas.withClip({ x: left + 1, y: gridTop, width: columnWidth - 1, height: bottom - gridTop }, () => {
      for (const segment of layoutSegments(data.events, day, minMinutes)) {
        if (segment.start >= windowEnd || Math.max(segment.end, segment.start + 1) <= windowStart) continue;
        // A lane too narrow to read is not made: events beyond it share the last lane, later on top.
        const lanes = Math.min(segment.lanes, Math.max(1, Math.floor((columnWidth - 2) / MIN_LANE)));
        const laneWidth = Math.floor((columnWidth - 2) / lanes);
        const blockX = left + 1 + Math.min(segment.lane, lanes - 1) * laneWidth;
        const blockW = laneWidth - 1;
        const blockY = yOf(Math.max(segment.start, windowStart));
        const blockH = Math.max(MIN_BLOCK_PX, yOf(Math.min(segment.shownEnd, windowEnd)) - blockY) - 1;
        // The block hides the hour lines behind it; the bar at its left edge marks it.
        canvas.fillRect(blockX, blockY, blockW, blockH, false);
        canvas.fillRect(blockX, blockY, 2, blockH);
        // The time goes first only when it leaves the title whole: a short block has one line.
        const columns = Math.max(1, chars(blockW - 4));
        const capacity = Math.floor((blockH - GLYPH) / LINE) + 1;
        const timed = `${segment.event.timeLabel} ${segment.event.title}`;
        const text = [...wrapBitmapText(timed, columns)].length <= capacity ? timed : segment.event.title;
        canvas.withClip({ x: blockX + 3, y: blockY, width: blockW - 3, height: blockH }, () => {
          let lineY = blockY + 1;
          for (const line of wrapBitmapText(text, columns)) {
            if (lineY + GLYPH > blockY + blockH + 1) break;
            canvas.drawText(line, blockX + 4, lineY, blockW - 4);
            lineY += LINE;
          }
        });
      }
    });
  });
  return true;
}

// ── Month ────────────────────────────────────────────────────────────────────

/** How many events touch each day of the grid. */
function eventsPerDay(events: CalendarEvent[], first: string, last: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) {
    const from = event.day < first ? first : event.day;
    const to = event.endDay > last ? last : event.endDay;
    for (let day = from, guard = 0; day <= to && guard < 42; day = shiftDay(day, 1), guard++) counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return counts;
}

/** The month of today as a grid of weeks, with a dot for each event up to three. Returns false when it does not fit. */
function drawMonth(canvas: DrawingCanvas, bounds: Bounds, data: CalendarData): boolean {
  const { x, y, width, height } = bounds;
  const bottom = y + height;
  const grid = monthGrid(data.today);
  const cellW = Math.floor((width - 2) / 7);
  if (cellW < 2 * GLYPH + 1) return false;
  const top = y + 1;
  // Title, then weekday letters; each is dropped while the cells would be shorter than a text line.
  let headerH = 2 * LINE;
  const cellHeight = () => Math.floor((bottom - top - headerH - 1) / grid.weeks);
  if (cellHeight() < LINE - 1) headerH = LINE;
  if (cellHeight() < LINE - 1) headerH = 0;
  const cellH = cellHeight();
  if (cellH < LINE - 1) return false;

  const gridX = x + 1 + Math.floor((width - 2 - 7 * cellW) / 2);
  if (headerH >= 2 * LINE) {
    canvas.drawText(`${monthName(data.today)} ${data.today.slice(0, 4)}`, gridX, top + 1, width - 2);
  }
  if (headerH >= LINE) {
    const weekdaysY = top + headerH - LINE;
    for (let column = 0; column < 7; column++) {
      const name = weekdayName(shiftDay(grid.start, column));
      const label = cellW >= 3 * GLYPH + 2 ? name : name[0];
      canvas.drawText(label, gridX + column * cellW + Math.floor((cellW - label.length * GLYPH) / 2), weekdaysY + 1, cellW);
    }
    canvas.drawHLine(gridX, weekdaysY + LINE - 1, 7 * cellW);
  }

  const counts = eventsPerDay(data.events, grid.first, grid.last);
  const cellsTop = top + headerH;
  for (let row = 0; row < grid.weeks; row++) {
    for (let column = 0; column < 7; column++) {
      const day = shiftDay(grid.start, row * 7 + column);
      if (day < grid.first || day > grid.last) continue;
      const cellX = gridX + column * cellW;
      const cellY = cellsTop + row * cellH;
      const number = String(dayOfMonth(day));
      const numberW = number.length * GLYPH;
      if (day === data.today) drawBar(canvas, cellX, cellY, numberW + 2, number);
      else canvas.drawText(number, cellX + 1, cellY + 1, cellW - 1);
      const dots = Math.min(counts.get(day) ?? 0, MAX_DOTS);
      if (!dots) continue;
      if (cellH >= 2 * LINE - 1) {
        // Room under the number.
        for (let dot = 0; dot < dots; dot++) canvas.fillRect(cellX + 1 + dot * 5, cellY + LINE + 2, 3, 3);
      } else {
        // Beside the number, as many as fit.
        const room = Math.floor((cellW - numberW - 4) / 4);
        for (let dot = 0; dot < Math.min(dots, room); dot++) canvas.fillRect(cellX + numberW + 4 + dot * 4, cellY + 3, 2, 3);
      }
    }
  }
  return true;
}
