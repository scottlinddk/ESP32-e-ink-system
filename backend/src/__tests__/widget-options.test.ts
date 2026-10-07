import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DisplayLayout, EnergyPrice, WidgetLayout } from '../types/index';
import { parseDisplayLayout, LayoutValidationError } from '../utils/layoutValidation';
import { parseWidgetOptions, widgetOptionKind } from '../utils/widgetOptions';
import { renderEnergyChart, selectEnergyBars, type ChartCanvas } from '../utils/energyChart';
import { BmpCanvas, renderDisplayDataRaw } from '../utils/bmpGenerator';

const DAY_START = Date.parse('2026-10-06T22:00:00Z'); // 00:00 in Copenhagen
const hours = Array.from({ length: 24 }, (_, hour) => ({
  start: new Date(DAY_START + hour * 3_600_000).toISOString(), hour, price: 100 + hour * 10,
}));
const price: EnergyPrice = { now: 314, average: 215, trend: 'up', hours };
const at = (danishHour: number, minute = 30) => DAY_START + danishHour * 3_600_000 + minute * 60_000;

function layout(...widgets: WidgetLayout[]): DisplayLayout {
  return { version: 1, cols: 10, rows: 6, widgets };
}

describe('widget options validation', () => {
  it('knows which widgets accept options', () => {
    expect(widgetOptionKind('energy')).toBe('energy');
    expect(widgetOptionKind('news')).toBe('list');
    expect(widgetOptionKind('news:abc')).toBe('list');
    expect(widgetOptionKind('calendar')).toBe('list');
    expect(widgetOptionKind('ticker:abc')).toBe('ticker');
    expect(widgetOptionKind('status')).toBeNull();
  });

  it('keeps valid options and drops an empty object', () => {
    const parsed = parseDisplayLayout(layout(
      { i: 'energy', x: 0, y: 0, w: 10, h: 3, options: { view: 'rest' } },
      { i: 'news', x: 0, y: 3, w: 10, h: 1, options: { items: 2 } },
      { i: 'ticker:abc', x: 0, y: 4, w: 10, h: 1, options: { view: 'condensed', items: 3 } },
      { i: 'status', x: 0, y: 5, w: 10, h: 1, options: {} as never },
    ));
    expect(parsed.widgets.map((widget) => widget.options)).toEqual([
      { view: 'rest' }, { items: 2 }, { view: 'condensed', items: 3 }, undefined,
    ]);
    expect('options' in parsed.widgets[3]).toBe(false);
  });

  it.each([
    ['energy', { view: 'condensed' }],
    ['energy', { items: 3 }],
    ['news', { view: 'day' }],
    ['news', { items: 0 }],
    ['news', { items: 11 }],
    ['calendar', { items: 2.5 }],
    ['ticker:abc', { view: 'rest' }],
    ['status', { view: 'day' }],
    ['energy', { view: 'day', extra: true }],
    ['energy', 'day'],
  ])('rejects %s options %j', (id, options) => {
    expect(() => parseWidgetOptions(id, options)).toThrow();
    expect(() => parseDisplayLayout(layout({ i: id, x: 0, y: 0, w: 10, h: 2, options } as WidgetLayout)))
      .toThrow(LayoutValidationError);
  });
});

describe('energy chart hours', () => {
  it('shows the whole day with the current hour marked', () => {
    const { bars, current } = selectEnergyBars(hours, 'day', at(7));
    expect(bars).toHaveLength(24);
    expect(bars[current].hour).toBe(7);
  });

  it('starts the rest-of-day view at the current hour', () => {
    const { bars, current } = selectEnergyBars(hours, 'rest', at(7, 59));
    expect(bars.map((bar) => bar.hour)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
    expect(current).toBe(0);
  });

  it('shows the whole day when no hour contains now, rather than an empty chart', () => {
    expect(selectEnergyBars(hours, 'rest', DAY_START - 1)).toEqual({ bars: hours, current: -1 });
  });
});

function recordingCanvas() {
  const texts: string[] = [];
  const black = new Set<string>();
  const canvas: ChartCanvas = {
    setPixel: (x, y, on) => { if (on) black.add(`${x},${y}`); },
    drawHLine: (x, y, w) => { for (let i = 0; i < w; i++) black.add(`${x + i},${y}`); },
    fillRect: (x, y, w, h) => { for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) black.add(`${c},${r}`); },
    drawText: (text) => { texts.push(text); },
  };
  return { canvas, texts, black };
}

describe('energy chart drawing', () => {
  it('labels the current hour, the average and the six-hour ticks', () => {
    const { canvas, texts } = recordingCanvas();
    renderEnergyChart(canvas, { x: 0, y: 0, width: 250, height: 100 }, { ...price, basis: 'consumer', hours }, 'day', at(7));
    expect(texts).toEqual(['Est 07: 3.14 DKK/kWh', 'Avg 2.15', '00', '06', '12', '18']);
  });

  it('leaves out the average when it does not fit beside the price', () => {
    const { canvas, texts } = recordingCanvas();
    renderEnergyChart(canvas, { x: 0, y: 0, width: 250, height: 100 }, { ...price, hours }, 'day', at(7));
    expect(texts).toEqual(['Spot 07: 3.14 DKK/kWh', '00', '06', '12', '18']);
  });

  it('labels the first hour of the rest-of-day view', () => {
    const { canvas, texts } = recordingCanvas();
    renderEnergyChart(canvas, { x: 0, y: 0, width: 250, height: 100 }, { ...price, basis: 'consumer', hours }, 'rest', at(9));
    expect(texts).toEqual(['Est 09: 3.14 DKK/kWh', 'Avg 2.15', '09', '12', '18']);
  });

  it('shortens the header to fit a narrow widget instead of cutting the unit', () => {
    const { canvas, texts } = recordingCanvas();
    renderEnergyChart(canvas, { x: 0, y: 0, width: 100, height: 60 }, { ...price, hours }, 'day', at(7));
    expect(texts[0]).toBe('07: 3.14 kr');
  });

  it('draws the current hour as an outline and the others filled', () => {
    const { canvas, black } = recordingCanvas();
    renderEnergyChart(canvas, { x: 0, y: 0, width: 250, height: 100 }, { ...price, hours }, 'day', at(7));
    // Slots are 246/24 px wide starting at x=2; sample a pixel inside each bar, above the baseline.
    const inside = (index: number) => `${2 + Math.floor(index * 246 / 24) + 3},88`;
    expect(black.has(inside(6))).toBe(true);
    expect(black.has(inside(7))).toBe(false);
    expect(black.has(inside(8))).toBe(true);
  });

  it('keeps negative prices below a zero baseline', () => {
    const { canvas, black } = recordingCanvas();
    const negative = hours.map((hour) => ({ ...hour, price: hour.hour === 3 ? -50 : 50 }));
    renderEnergyChart(canvas, { x: 0, y: 0, width: 250, height: 100 }, { ...price, average: 40, hours: negative }, 'day', at(7));
    const x3 = 2 + Math.floor(3 * 246 / 24) + 3;
    expect(black.has(`${x3},88`)).toBe(true); // the negative bar reaches down
    expect(black.has(`${x3},30`)).toBe(false); // nothing above zero
  });

  it('draws only the header when the widget is a single row', () => {
    const { canvas, texts, black } = recordingCanvas();
    renderEnergyChart(canvas, { x: 0, y: 0, width: 250, height: 20 }, { ...price, basis: 'consumer', hours }, 'day', at(7));
    expect(texts).toEqual(['Est 07: 3.14 DKK/kWh', 'Avg 2.15']);
    expect(black.size).toBe(0);
  });
});

describe('rendering with layout options', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('draws the chart for a chart view and the summary without options', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at(7));
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    renderDisplayDataRaw({ nextRefresh: 1000, price }, layout({ i: 'energy', x: 0, y: 0, w: 10, h: 5, options: { view: 'day' } }));
    expect(draw.mock.calls.map(([text]) => text)).toContain('Spot 07: 3.14 DKK/kWh');
    draw.mockClear();
    renderDisplayDataRaw({ nextRefresh: 1000, price }, layout({ i: 'energy', x: 0, y: 0, w: 10, h: 5 }));
    expect(draw.mock.calls[0][0]).toBe('Spot: 3.14 DKK/kWh ^');
  });

  it('falls back to the summary when hourly prices are missing', () => {
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    const { hours: _omitted, ...withoutHours } = price;
    renderDisplayDataRaw({ nextRefresh: 1000, price: withoutHours }, layout({ i: 'energy', x: 0, y: 0, w: 10, h: 5, options: { view: 'rest' } }));
    expect(draw.mock.calls[0][0]).toBe('Spot: 3.14 DKK/kWh ^');
  });

  it('caps news and calendar rows at the chosen count', () => {
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    const news = ['One', 'Two', 'Three', 'Four'].map((title) => ({ title, url: 'https://example.com' }));
    const events = ['A', 'B', 'C'].map((title) => ({ title, start: '2026-10-07', end: '2026-10-08', allDay: true, dateLabel: 'Wed', timeLabel: 'All day' }));
    renderDisplayDataRaw({ nextRefresh: 1000, news, calendar: { timezone: 'Europe/Copenhagen', events } }, layout(
      { i: 'news', x: 0, y: 0, w: 10, h: 3, options: { items: 2 } },
      { i: 'calendar', x: 0, y: 3, w: 10, h: 3, options: { items: 1 } },
    ));
    const texts = draw.mock.calls.map(([text]) => text);
    expect(texts).toEqual(['One', 'Two', 'Wed All day: A']);
  });
});
