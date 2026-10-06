import type { PixelRegion, RenderedWidget, RenderElement } from '@esp32-eink/types';
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
  const change = `${formatChange(quote.change, direction, data.locale, priceDecimals(quote.price))} (${formatPercent(quote.changePercent, direction, data.locale)})`;
  elements.push(...arrowElements(direction, PAD, y, big === CELL ? 7 : 11));
  elements.push(text(fitText(change, width - arrowBox.width - PAD * 3, CELL), PAD + arrowBox.width + 4, y + Math.max(0, Math.floor((arrowBox.height - CELL) / 2)), CELL));
  y += Math.max(arrowBox.height, CELL) + 4;

  const footerY = height - CELL - 2;
  const chartHeight = footerY - 2 - y;
  if (chartHeight >= 12) {
    elements.push(...sparklineElements(quote.series, { x: PAD, y, width: width - PAD * 2, height: chartHeight }, quote.previousClose));
  }

  if (height >= 60) {
    const status = data.marketStatus;
    elements.push(text(`${status} ${formatClock(data.fetchedAt, data.timeZone)}`, PAD, footerY, CELL));
    if (data.pageCount > 1) {
      const pager = `${data.page}/${data.pageCount}`;
      elements.push(text(pager, width - PAD - pager.length * CELL, footerY, CELL));
    }
  }
  return { region, elements };
}
