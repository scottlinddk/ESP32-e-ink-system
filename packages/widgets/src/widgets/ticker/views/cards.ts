import type { PixelRegion, RenderedWidget, RenderElement } from '@esp32-eink/types';
import { directionOf } from '../direction';
import { displaySymbol, fitText, formatPercent, formatPrice } from '../format';
import { arrowElements, arrowSize, sparklineElements } from '../sparkline';
import type { TickerRow, TickerWidgetData } from '../types';
import { CELL } from './layout';

const GAP = 6;
const INSET = 7;

/** The reference's two cards become outlined black-and-white cards on e-ink. */
export function cardsPerPage(region: PixelRegion): number {
  return region.widthPx >= 240 && region.heightPx >= 80 ? 2 : 1;
}

function border(x: number, y: number, width: number, height: number): RenderElement[] {
  // A two-pixel cut on each corner reads as a soft corner at e-ink resolution.
  return [
    { kind: 'hline', x: x + 2, y, width: width - 4 },
    { kind: 'hline', x: x + 2, y: y + height - 1, width: width - 4 },
    { kind: 'rect', x, y: y + 2, width: 1, height: height - 4, fill: true },
    { kind: 'rect', x: x + width - 1, y: y + 2, width: 1, height: height - 4, fill: true },
  ];
}

function card(row: TickerRow, data: TickerWidgetData, x: number, width: number, height: number): RenderElement[] {
  const elements = border(x, 0, width, height);
  const inner = width - INSET * 2;
  if (height < 80) {
    elements.push({ kind: 'text', text: fitText(displaySymbol(row.symbol), inner, CELL), x: x + INSET, y: INSET, fontSize: CELL });
    if (height >= 2 * CELL + 2 * INSET + 2) {
      const value = row.quote ? formatPrice(row.quote.price, row.quote.currency, data.locale) : 'n/a';
      elements.push({ kind: 'text', text: fitText(value, inner, CELL), x: x + INSET, y: height - CELL - INSET, fontSize: CELL });
    }
    return elements;
  }
  const titleSize = inner >= 128 && height >= 120 ? CELL * 2 : CELL;
  const name = row.quote?.name?.trim() || displaySymbol(row.symbol);
  const label = fitText(name, inner, titleSize);
  const symbol = fitText(displaySymbol(row.symbol), inner, CELL);
  elements.push({ kind: 'text', text: label, x: x + INSET, y: INSET, fontSize: titleSize });
  if (height >= INSET + titleSize + CELL + 8) {
    elements.push({ kind: 'text', text: symbol, x: x + INSET, y: INSET + titleSize + 3, fontSize: CELL });
  }
  if (!row.quote) {
    if (height >= 3 * CELL + 2) elements.push({ kind: 'text', text: 'n/a', x: x + INSET, y: height - CELL - INSET, fontSize: CELL });
    return elements;
  }

  const direction = directionOf(row.quote.changePercent);
  const price = fitText(formatPrice(row.quote.price, row.quote.currency, data.locale), inner, CELL);
  const percent = formatPercent(row.quote.changePercent, direction, data.locale);
  const arrow = arrowSize();
  const percentWidth = arrow.width + 3 + percent.length * CELL;
  const sameLine = price.length * CELL + percentWidth + 5 <= inner;
  const footerY = height - INSET - CELL;
  const priceY = sameLine ? footerY : footerY - CELL - 2;
  if (priceY >= INSET + titleSize + 3) {
    elements.push({ kind: 'text', text: price, x: x + INSET, y: priceY, fontSize: CELL });
  }
  if (percentWidth <= inner && footerY >= priceY) {
    const percentX = sameLine ? x + width - INSET - percentWidth : x + INSET;
    elements.push(...arrowElements(direction, percentX, footerY + 1));
    elements.push({ kind: 'text', text: percent, x: percentX + arrow.width + 3, y: footerY, fontSize: CELL });
  }

  const chartY = INSET + titleSize + CELL + 9;
  const chartHeight = priceY - chartY - 5;
  if (chartHeight >= 12) {
    // A monochrome line and dotted previous close preserve the chart's meaning.
    elements.push(...sparklineElements(row.quote.series, { x: x + INSET, y: chartY, width: inner, height: chartHeight }, row.quote.previousClose));
  }
  return elements;
}

export function renderCards(data: TickerWidgetData, region: PixelRegion): RenderedWidget {
  const { widthPx: width, heightPx: height } = region;
  if (!data.rows.length) return { region, elements: [] };
  if (width < 20 || height < 20) return { region, elements: [{ kind: 'text', text: fitText(displaySymbol(data.rows[0].symbol), width, CELL), x: 0, y: 0, fontSize: CELL }] };
  const count = Math.min(cardsPerPage(region), data.rows.length);
  const cardWidth = Math.floor((width - GAP * (count - 1)) / count);
  const elements = data.rows.slice(0, count).flatMap((row, index) =>
    card(row, data, index * (cardWidth + GAP), cardWidth, height));
  return { region, elements };
}
