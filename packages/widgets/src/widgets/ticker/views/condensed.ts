import type { PixelRegion, RenderedWidget, RenderElement } from '@esp32-eink/types';
import { directionOf } from '../direction';
import { displaySymbol, fitText, formatChange, formatClock, formatPercent, formatPrice, priceDecimals } from '../format';
import { arrowElements, arrowSize } from '../sparkline';
import type { TickerRow, TickerWidgetData } from '../types';
import { CELL, condensedLayout } from './layout';

const PAD = 2;
/** Room kept for the symbol before the change group is allowed to take the space. */
const MIN_SYMBOL_PX = 24;

function text(value: string, x: number, y: number, fontSize: number): RenderElement {
  return { kind: 'text', text: value, x, y, fontSize };
}

const rightX = (value: string, right: number, cell: number): number => right - value.length * cell;

function rowElements(row: TickerRow, data: TickerWidgetData, top: number, width: number, twoLine: boolean, primary: number): RenderElement[] {
  const right = width - PAD;
  const symbol = displaySymbol(row.symbol);
  if (!row.quote) {
    const label = 'n/a';
    const labelX = rightX(label, right, CELL);
    return [text(fitText(symbol, labelX - PAD * 2, primary), PAD, top, primary), text(label, labelX, top + (primary - CELL), CELL)];
  }

  const { quote } = row;
  const direction = directionOf(quote.changePercent);
  const price = formatPrice(quote.price, quote.currency, data.locale);
  const percent = formatPercent(quote.changePercent, direction, data.locale);
  const arrow = arrowSize();
  const elements: RenderElement[] = [];
  const priceX = Math.max(PAD, rightX(price, right, primary));

  // Change group, widest first. Whatever does not fit is dropped, never drawn off-region.
  const arrowGap = arrow.width + 3;
  const fits = (start: number): boolean => start >= PAD + MIN_SYMBOL_PX;
  let leftEdge = priceX;

  if (twoLine) {
    const full = `${formatChange(quote.change, direction, data.locale, priceDecimals(quote.price))} (${percent})`;
    const y = top + primary + 2;
    const candidate = [full, percent].find((value) => fits(rightX(value, right, CELL) - arrowGap)) ?? '';
    const changeX = rightX(candidate, right, CELL);
    if (candidate) elements.push(text(candidate, changeX, y, CELL));
    const arrowX = candidate ? changeX - arrowGap : right - arrow.width;
    elements.push(...arrowElements(direction, arrowX, y + 1));
    // The symbol shares line one with the price only.
  } else {
    const y = top + (primary - CELL);
    const pctX = priceX - 6 - percent.length * CELL;
    if (fits(pctX - arrowGap)) {
      elements.push(text(percent, pctX, y, CELL), ...arrowElements(direction, pctX - arrowGap, y + 1));
      leftEdge = pctX - arrowGap;
    } else if (fits(priceX - 4 - arrow.width)) {
      leftEdge = priceX - 4 - arrow.width;
      elements.push(...arrowElements(direction, leftEdge, y + 1));
    }
  }

  elements.unshift(text(fitText(symbol, leftEdge - PAD * 2, primary), PAD, top, primary), text(price, priceX, top, primary));
  return elements;
}

export function renderCondensed(data: TickerWidgetData, region: PixelRegion): RenderedWidget {
  const layout = condensedLayout(region);
  const { widthPx: width, heightPx: height } = region;
  const elements: RenderElement[] = [];

  if (layout.chrome) {
    const status = data.marketStatus;
    elements.push(text(fitText(data.title.toUpperCase(), width - (status.length + 2) * CELL, CELL), PAD, 1, CELL));
    elements.push(text(status, rightX(status, width - PAD, CELL), 1, CELL));
    elements.push({ kind: 'hline', x: 0, y: layout.headerHeight - 1, width });
  }

  const rows = data.rows.slice(0, layout.rows);
  rows.forEach((row, index) => {
    const top = layout.headerHeight + 1 + index * layout.rowHeight;
    elements.push(...rowElements(row, data, top, width, layout.twoLine, layout.primary));
  });

  if (layout.chrome) {
    const y = height - layout.footerHeight;
    elements.push({ kind: 'hline', x: 0, y, width });
    const word = data.locale === 'da' ? 'Side' : 'Page';
    const pager = `${word} ${data.page}/${data.pageCount}`;
    elements.push(text(formatClock(data.fetchedAt, data.timeZone), PAD, y + 3, CELL));
    if (data.pageCount > 1) elements.push(text(pager, rightX(pager, width - PAD, CELL), y + 3, CELL));
  }
  return { region, elements };
}
