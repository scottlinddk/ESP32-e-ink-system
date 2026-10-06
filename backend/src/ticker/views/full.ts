import type { PixelRegion, RenderedWidget, RenderElement } from '../render';
import { directionOf } from '../direction';
import { displaySymbol, fitText, formatChange, formatClock, formatPercent, formatPrice, priceDecimals } from '../format';
import { arrowElements, arrowSize, sparklineElements } from '../sparkline';
import type { TickerWidgetData } from '../types';
import { CELL } from './layout';

const PAD = 2;

const text = (value: string, x: number, y: number, fontSize: number): RenderElement => ({ kind: 'text', text: value, x, y, fontSize });

export function renderFull(data: TickerWidgetData, region: PixelRegion): RenderedWidget {
  const { widthPx: width, heightPx: height } = region;
  const row = data.rows[0];
  const elements: RenderElement[] = [];
  if (!row) return { region, elements: [text('No symbols', PAD, PAD, CELL)] };

  const big = height >= 90 && width >= 160 ? CELL * 2 : CELL;
  const symbol = fitText(displaySymbol(row.symbol), width - PAD * 2, big);
  elements.push(text(symbol, PAD, PAD, big));
  if (!row.quote) {
    elements.push(text('unavailable', PAD, PAD + big + 4, CELL));
    return { region, elements };
  }

  const { quote } = row;
  const direction = directionOf(quote.changePercent);
  const price = formatPrice(quote.price, quote.currency, data.locale);
  let y = PAD + big + 2;
  elements.push(text(fitText(price, width - PAD * 2, big), PAD, y, big));
  y += big + 3;

  const arrowBox = arrowSize(big === CELL ? 7 : 11);
  const percent = formatPercent(quote.changePercent, direction, data.locale);
  const absolute = `${formatChange(quote.change, direction, data.locale, priceDecimals(quote.price))} (${percent})`;
  const changeRoom = width - arrowBox.width - PAD * 3;
  // Whole pieces only: the percentage alone is better than a cut-off bracket.
  const change = absolute.length * CELL <= changeRoom ? absolute : percent;
  elements.push(...arrowElements(direction, PAD, y, big === CELL ? 7 : 11));
  elements.push(text(fitText(change, changeRoom, CELL), PAD + arrowBox.width + 4, y + Math.max(0, Math.floor((arrowBox.height - CELL) / 2)), CELL));
  y += Math.max(arrowBox.height, CELL) + 4;

  const footerY = height - CELL - 2;
  const chartHeight = footerY - 2 - y;
  if (chartHeight >= 12) {
    elements.push(...sparklineElements(quote.series, { x: PAD, y, width: width - PAD * 2, height: chartHeight }, quote.previousClose));
  }

  if (height >= 60) {
    const clock = formatClock(data.fetchedAt, data.timeZone);
    const pager = data.pageCount > 1 ? `${data.page}/${data.pageCount}` : '';
    // Drop the market status before letting the time and the page number touch.
    const withStatus = `${data.marketStatus} ${clock}`;
    const left = (withStatus.length + pager.length + 1) * CELL <= width - PAD * 2 ? withStatus : clock;
    elements.push(text(left, PAD, footerY, CELL));
    if (pager) elements.push(text(pager, width - PAD - pager.length * CELL, footerY, CELL));
  }
  return { region, elements };
}
