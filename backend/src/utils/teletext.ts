// Tekst TV: a layout style that dresses every widget like a teletext page. It is applied where the
// widgets are put together, so no widget has to know about it: each gets a bar with its title and
// a page number, and the status bar becomes the page header (name, page, date and time).
//
// A teletext page is colourful; this display has two colours. Coloured bars become black bars with
// white text, which is also what reads as teletext on the panel. Choose inverted colours as well
// for the closest look: white bars on a black page. See docs/TELETEXT.md.

import type { DisplayData, DisplayLayout } from '../types/index';
import type { DisplayLanguage } from './displayLanguage';
import { displayStrings, zonedDate, type DisplayStrings } from './displayStrings';
import { compactBatteryWidth, drawCompactBattery } from './batteryRenderer';
import { calendarIdFromWidget } from './calendarWidgets';
import { newsFeedIdFromWidget } from './newsFeeds';
import { fitOneLine } from './newsRenderer';
import { tickerIdFromWidget } from './tickerWidgets';
import { isWeatherWidget } from './weatherWidgets';
import type { Bounds, DrawingCanvas } from './zoomCanvas';

export type TeletextKind = keyof DisplayStrings['teletext']['widgets'];

/** The header's page, like teletext's index page. Widgets are numbered from the next one. */
export const INDEX_PAGE = 100;

const GLYPH = 8;
/** The glyph with a pixel of air above it. */
export const TITLE_BAR_HEIGHT = GLYPH + 1;
/** A bar is only drawn when a line of the widget's own content still fits below it. */
const MIN_CONTENT_HEIGHT = 11;
/** The narrowest bar that holds a few characters of title. */
const MIN_BAR_WIDTH = 6 * GLYPH;
/** The status bar is as tall as its widget up to this, so a two-row bar is not a slab. */
const HEADER_MAX_HEIGHT = TITLE_BAR_HEIGHT + 3;

const DIRECT_KINDS: Readonly<Record<string, TeletextKind>> = {
  energy: 'energy', monta: 'monta', zaptec: 'zaptec', notion: 'notion', battery: 'battery',
  'custom-text': 'text', 'custom-webhook': 'webhook', 'week-number': 'week', 'ai-usage': 'aiUsage',
};

/**
 * Which title a widget gets, or null for one that has no bar: a photo is placed by pixel and must
 * not be covered, and the status bar is the page header instead.
 */
export function teletextKind(widgetId: string): TeletextKind | null {
  if (widgetId === 'news' || newsFeedIdFromWidget(widgetId)) return 'news';
  if (isWeatherWidget(widgetId)) return 'weather';
  if (widgetId === 'calendar' || calendarIdFromWidget(widgetId)) return 'calendar';
  if (tickerIdFromWidget(widgetId)) return 'stocks';
  return DIRECT_KINDS[widgetId] ?? null;
}

/**
 * A page number for every widget that gets a bar, counting up from 101 in reading order (top to
 * bottom, then left to right). They are decoration: nothing is reachable at these numbers.
 */
export function teletextPages(layout: Pick<DisplayLayout, 'widgets'>): Map<string, number> {
  const ordered = layout.widgets.filter((widget) => teletextKind(widget.i) !== null)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return new Map(ordered.map((widget, index) => [widget.i, INDEX_PAGE + 1 + index]));
}

/**
 * Draws the widget's title bar across the top of `bounds` and returns the bounds left for the
 * widget. Too small a widget keeps all of its room and gets no bar. The title shortens to fit,
 * and the page number goes first when there is no room for both.
 */
export function drawTeletextTitleBar(canvas: DrawingCanvas, bounds: Bounds, title: string, page: number): Bounds {
  if (bounds.height < TITLE_BAR_HEIGHT + MIN_CONTENT_HEIGHT || bounds.width < MIN_BAR_WIDTH) return bounds;
  const { x, y, width } = bounds;
  canvas.fillRect(x, y, width, TITLE_BAR_HEIGHT);
  const number = String(page);
  const characters = Math.floor((width - 4) / GLYPH);
  if (characters >= title.length + 1 + number.length) {
    canvas.drawText(title, x + 2, y + 1, width - 4, 1, false);
    canvas.drawText(number, x + width - 2 - number.length * GLYPH, y + 1, number.length * GLYPH, 1, false);
  } else {
    canvas.drawText(fitOneLine(title, characters), x + 2, y + 1, width - 4, 1, false);
  }
  return { x, y: y + TITLE_BAR_HEIGHT, width, height: bounds.height - TITLE_BAR_HEIGHT };
}

/** The title a widget's bar shows in the display language, or null when it has no bar. */
export function teletextTitle(widgetId: string, language: DisplayLanguage): string | null {
  const kind = teletextKind(widgetId);
  return kind ? displayStrings(language).teletext.widgets[kind] : null;
}

/** The header's pieces in the display time zone: "ons 15 okt" and "12:03". Names come from the catalog. */
export function teletextClock(now: Date, timeZone: string, language: DisplayLanguage): { date: string; time: string } {
  const strings = displayStrings(language);
  const { day, month, weekday } = zonedDate(now, timeZone);
  // "tirs." and "15. okt." become the three-letter "tir" and "15 okt" teletext uses.
  const name = strings.dates.weekdays[weekday].replace(/\./gu, '').slice(0, 3);
  const dayMonth = strings.dates.dayMonth({ day, month }).replace(/\./gu, '');
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  return { date: `${name} ${dayMonth}`, time };
}

export interface TeletextHeaderOptions {
  now: Date;
  timeZone: string;
  language: DisplayLanguage;
  battery?: DisplayData['battery'];
  /** The status bar's "time only" view, for a bar made narrow. */
  condensed?: boolean;
}

/**
 * The page header in place of the status bar: a bar with the page and date on the left and the time
 * on the right, as "TEKST TV  S100  ons 15 okt        12:03". It keeps the most that fits. The battery,
 * which cannot be drawn white, sits to the right of the bar on the white page.
 */
export function renderTeletextHeader(canvas: DrawingCanvas, bounds: Bounds, options: TeletextHeaderOptions): void {
  const { x, width } = bounds;
  const strings = displayStrings(options.language).teletext;
  const { date, time } = teletextClock(options.now, options.timeZone, options.language);
  const batteryWidth = compactBatteryWidth(options.battery);
  const showBattery = batteryWidth > 0 && width - batteryWidth - 6 >= time.length * GLYPH + 4;
  const barWidth = showBattery ? width - batteryWidth - 6 : width;
  const barHeight = Math.min(bounds.height, HEADER_MAX_HEIGHT);
  const barY = bounds.y + bounds.height - barHeight;
  const textY = barY + Math.ceil((barHeight - GLYPH) / 2);

  const page = `${strings.page}${INDEX_PAGE}`;
  const candidates = options.condensed ? [''] : [`${strings.title}  ${page}  ${date}`, `${page}  ${date}`, date, ''];
  const room = Math.floor((barWidth - 4) / GLYPH);
  const left = candidates.find((text) => text.length + (text ? 2 : 0) + time.length <= room) ?? '';

  canvas.fillRect(x, barY, barWidth, barHeight);
  if (left) canvas.drawText(left, x + 2, textY, barWidth - 4, 1, false);
  canvas.drawText(time, x + barWidth - 2 - time.length * GLYPH, textY, time.length * GLYPH, 1, false);
  if (showBattery) drawCompactBattery(canvas, x + width - 2, textY, options.battery);
}
