import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GridEditor, layoutFromGrid } from '../../components/layout/GridEditor';
import { WidgetOptionsPanel } from '../../components/layout/WidgetOptionsPanel';
import { updateWidgetOptions, widgetAcceptsZoom, widgetOptionKind } from '../widgetOptions';
import { isWeatherWidget, WEATHER_WIDGET_IDS, weatherWidgetLabel } from '../weatherWidgets';
import { autoZoom, inheritedZoom, snapWidgetZoom, updateLayoutZoom, zoomLabel } from '../zoom';
import type { DisplayLayout, TickerWidgetSetting, WidgetLayout } from '../../types';

const layout: DisplayLayout = { version: 1, cols: 10, rows: 6, widgets: [
  { i: 'energy', x: 0, y: 0, w: 10, h: 3, options: { view: 'day' } },
  { i: 'news', x: 0, y: 3, w: 10, h: 2 },
  { i: 'status', x: 0, y: 5, w: 10, h: 1, static: true },
] };
const ticker: TickerWidgetSetting = { id: 't1', name: '', symbols: ['NOVO-B.CO'], view: 'condensed', per_page: 4, dwell_minutes: 15, locale: 'da' };

const panel = (widget: WidgetLayout, lang: 'da' | 'en' = 'en', tickerSetting?: TickerWidgetSetting) => renderToStaticMarkup(
  <WidgetOptionsPanel widget={widget} label="Widget" lang={lang} ticker={tickerSetting} onChange={vi.fn()} onClose={vi.fn()} />);

describe('widget option kinds', () => {
  it('matches the backend', () => {
    expect(['energy', 'news', 'news:abc', 'calendar', 'calendar:abc', 'ticker:t1', 'status', 'weather', 'weather:3', 'weather:5', 'week-number'].map(widgetOptionKind))
      .toEqual(['energy', 'list', 'list', 'calendar', 'calendar', 'ticker', 'status', 'weather', 'weather', null, null]);
  });
});

describe('updating widget options', () => {
  it('sets, merges and removes fields on one widget only', () => {
    const rest = updateWidgetOptions(layout, 'energy', { view: 'rest' });
    expect(rest.widgets[0].options).toEqual({ view: 'rest' });
    expect(rest.widgets[1]).toBe(layout.widgets[1]);
    const news = updateWidgetOptions(layout, 'news', { items: 3 });
    expect(news.widgets[1].options).toEqual({ items: 3 });
  });

  it('drops the options property when nothing is left, so the saved layout stays minimal', () => {
    const cleared = updateWidgetOptions(layout, 'energy', { view: undefined });
    expect('options' in cleared.widgets[0]).toBe(false);
  });
});

describe('moving and resizing', () => {
  it('keeps display options and the static flag', () => {
    const moved = layoutFromGrid(layout, layout.widgets.map((widget) => ({ ...widget, y: widget.y, h: widget.i === 'energy' ? 2 : widget.h })));
    expect(moved.widgets[0]).toEqual({ i: 'energy', x: 0, y: 0, w: 10, h: 2, static: undefined, options: { view: 'day' } });
    expect(moved.widgets[2].static).toBe(true);
  });
});

describe('selecting a widget', () => {
  const grid = (selectedId: string | null) => renderToStaticMarkup(<GridEditor layout={layout} onLayoutChange={vi.fn()} onRemoveWidget={vi.fn()}
    widgetMeta={{ energy: { id: 'energy', label: 'Energy price', icon: 'bolt' } }} selectedId={selectedId} onSelectWidget={vi.fn()} />);

  it('marks only the selected widget as pressed', () => {
    const html = grid('energy');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain('Energy price: selected');
    expect(grid(null)).not.toContain('aria-pressed="true"');
  });
});

describe('widget options panel', () => {
  it('offers the summary and both chart views for the electricity price', () => {
    const html = panel(layout.widgets[0]);
    expect(html).toContain('Price now and average');
    expect(html).toContain('Whole day, hour by hour');
    expect(html).toContain('From now to the end of the day');
    expect(html).toMatch(/<option value="day" selected="">/);
  });

  it('warns when a chart view has no room for bars', () => {
    expect(panel({ ...layout.widgets[0], h: 1 })).toContain('at least 2 rows tall');
    expect(panel(layout.widgets[0])).not.toContain('rows tall');
  });

  it('offers a count for news and calendar', () => {
    expect(panel(layout.widgets[1])).toContain('Number of headlines');
    expect(panel({ i: 'calendar', x: 0, y: 0, w: 5, h: 2, options: { items: 2 } }, 'da')).toContain('Antal begivenheder');
  });

  it('offers one to four columns for news, one by default', () => {
    const html = panel(layout.widgets[1]);
    expect(html).toContain('Number of columns');
    expect(html).toMatch(/<option value="1" selected="">/);
    expect(html).toContain('<option value="4">4</option>');
    expect(panel({ ...layout.widgets[1], options: { columns: 3 } })).toMatch(/<option value="3" selected="">/);
    expect(panel({ i: 'calendar', x: 0, y: 0, w: 5, h: 2 })).not.toContain('Number of columns');
  });

  it('names the ticker defaults and shows stocks per page only for the list view', () => {
    const condensed = panel({ i: 'ticker:t1', x: 0, y: 0, w: 5, h: 3 }, 'en', ticker);
    expect(condensed).toContain('Widget default (List)');
    expect(condensed).toContain('Widget default (4)');
    expect(panel({ i: 'ticker:t1', x: 0, y: 0, w: 5, h: 3, options: { view: 'full' } }, 'en', ticker)).not.toContain('Stocks per page');
  });

  it('says when a widget has nothing to set', () => {
    expect(panel({ i: 'custom-image', x: 0, y: 0, w: 5, h: 2 })).toContain('no display options');
    expect(panel({ i: 'custom-image', x: 0, y: 0, w: 5, h: 2 })).not.toContain('Text size');
  });

  it('offers a text size to every widget that draws text, naming what it follows', () => {
    const html = (widget: WidgetLayout) => renderToStaticMarkup(
      <WidgetOptionsPanel widget={widget} label="Widget" lang="en" inheritedZoom={2} onChange={vi.fn()} onClose={vi.fn()} />);
    for (const id of ['status', 'weather', 'energy', 'news', 'ticker:t1']) {
      const markup = html({ i: id, x: 0, y: 0, w: 5, h: 2 });
      expect(markup).toContain('Text size');
      expect(markup).toContain('Follow layout (2×)');
      // A slider in steps of 0.2, resting on what the widget follows.
      expect(markup).toMatch(/type="range"/);
      expect(markup).toMatch(/min="1"/);
      expect(markup).toMatch(/max="4"/);
      expect(markup).toMatch(/step="0.2"/);
      expect(markup).toMatch(/value="2"/);
    }
    const own = html({ i: 'status', x: 0, y: 0, w: 5, h: 2, options: { zoom: 2.6 } });
    expect(own).toMatch(/value="2.6"/);
    expect(own).toContain('2.6×');
    expect(panel({ i: 'weather', x: 0, y: 0, w: 5, h: 2 }, 'da')).toContain('Tekststørrelse');
  });
});

describe('widget zoom steps', () => {
  it('snaps slider values to 0.2 without floating point residue', () => {
    expect([1, 1.2, 1.4000000000000001, 2.6, 2.61, 3.99, 4, 0, 9].map(snapWidgetZoom)).toEqual([1, 1.2, 1.4, 2.6, 2.6, 4, 4, 1, 4]);
    expect(zoomLabel(snapWidgetZoom(1.4000000000000001))).toBe('1.4×');
  });
});

describe('zoom', () => {
  it('matches the backend rule for the automatic zoom', () => {
    const profile = (width: number, height: number, rotation: 0 | 90 | 180 | 270 = 0) => ({ width, height, rotation });
    expect([profile(250, 122), profile(296, 128), profile(400, 300), profile(800, 480), profile(1600, 1200)].map(autoZoom))
      .toEqual([1, 1, 2, 4, 4]);
    expect(autoZoom(profile(300, 400))).toBe(1);
    expect(autoZoom(profile(300, 400, 90))).toBe(2); // rotation swaps the logical canvas
  });

  it('follows the layout, else the panel', () => {
    const rlcd = { width: 400, height: 300, rotation: 0 as const };
    expect(inheritedZoom({}, rlcd)).toBe(2);
    expect(inheritedZoom({ zoom: 3 }, rlcd)).toBe(3);
  });

  it('sets and clears the layout zoom without touching widgets', () => {
    const zoomed = updateLayoutZoom(layout, 3);
    expect(zoomed.zoom).toBe(3);
    expect(zoomed.widgets).toBe(layout.widgets);
    expect('zoom' in updateLayoutZoom(zoomed, undefined)).toBe(false);
  });

  it('is kept by moving and resizing', () => {
    const moved = layoutFromGrid({ ...layout, zoom: 2 }, layout.widgets);
    expect(moved.zoom).toBe(2);
  });

  it('stores a widget zoom with its other options and removes it again', () => {
    const both = updateWidgetOptions(layout, 'energy', { zoom: 2 });
    expect(both.widgets[0].options).toEqual({ view: 'day', zoom: 2 });
    expect('options' in updateWidgetOptions(updateWidgetOptions(layout, 'news', { zoom: 2 }), 'news', { zoom: undefined }).widgets[1]).toBe(false);
    expect(['custom-image', 'status', 'weather'].map(widgetAcceptsZoom)).toEqual([false, true, true]);
  });
});

describe('calendar options panel', () => {
  const calendar = (options?: WidgetLayout['options'], i = 'calendar'): WidgetLayout => ({ i, x: 0, y: 0, w: 10, h: 6, ...(options ? { options } : {}) });

  it('offers the four views, with the list as the default', () => {
    const html = panel(calendar());
    for (const label of ['List', 'Day', 'Several days', 'Month']) expect(html).toContain(`>${label}</option>`);
    expect(html).toMatch(/<option value="list" selected/);
    expect(html).toContain('A widget too small for the view shows the list instead.');
  });
  it.each(['calendar', 'calendar:work'])('shows the number of events for the list view of %s only', (id) => {
    expect(panel(calendar(undefined, id))).toContain('Number of events');
    expect(panel(calendar({ view: 'month' }, id))).not.toContain('Number of events');
    expect(panel(calendar({ view: 'day' }, id))).not.toContain('Number of events');
  });
  it('shows the number of days for the several-days view only', () => {
    expect(panel(calendar({ view: 'days' }))).toContain('Number of days');
    expect(panel(calendar({ view: 'days' }))).toContain('As many as fit');
    expect(panel(calendar({ view: 'list' }))).not.toContain('Number of days');
    const chosen = panel(calendar({ view: 'days', days: 3 }));
    expect(chosen).toMatch(/<option value="3" selected/);
    for (const days of [2, 3, 4, 5, 6, 7]) expect(chosen).toContain(`<option value="${days}"`);
    expect(chosen).not.toContain('<option value="8"');
  });
  it('selects the saved view', () => {
    expect(panel(calendar({ view: 'month' }))).toMatch(/<option value="month" selected/);
    expect(panel(calendar({ view: 'days' }))).toMatch(/<option value="days" selected/);
  });
  it('is translated', () => {
    const html = panel(calendar({ view: 'days' }), 'da');
    for (const text of ['Visning', 'Flere dage', 'Måned', 'Antal dage', 'Så mange som der er plads til', 'Er widgetten for lille, vises listen i stedet.']) expect(html).toContain(text);
  });
  it('still offers the text size', () => {
    expect(panel(calendar({ view: 'month' }))).toContain('Text size');
  });
  it('keeps the headline label for news', () => {
    expect(panel({ i: 'news', x: 0, y: 0, w: 10, h: 2 })).toContain('Number of headlines');
  });
  it('sets a view and drops it again for the default', () => {
    const month = updateWidgetOptions({ ...layout, widgets: [calendar()] }, 'calendar', { view: 'month' });
    expect(month.widgets[0].options).toEqual({ view: 'month' });
    const list = updateWidgetOptions(month, 'calendar', { view: undefined });
    expect('options' in list.widgets[0]).toBe(false);
  });
});

describe('weather views', () => {
  const weather = (options?: WidgetLayout['options'], lang: 'da' | 'en' = 'en') => panel({ i: 'weather', x: 0, y: 0, w: 5, h: 2, options }, lang);

  it('offers every view, with the original summary selected by default', () => {
    const html = weather();
    for (const value of ['summary', 'current', 'hours', 'daily', 'details']) expect(html).toContain(`<option value="${value}"`);
    expect(html).toMatch(/<option value="summary" selected="">/);
    expect(html).toContain('Needs only the current reading');
    expect(weather({ view: 'details' })).toMatch(/<option value="details" selected="">/);
  });

  it('says how to show several views, only once one is chosen, and that the forecast is in 3-hour steps', () => {
    expect(weather()).not.toContain('Weather (2)');
    expect(weather({ view: 'daily' })).toContain('Weather (2) to (4)');
    expect(weather({ view: 'hours' })).toContain('3-hour steps');
  });

  it('asks for a count of steps or days only for the views that list a forecast', () => {
    expect(weather({ view: 'hours' })).toContain('Number of steps');
    expect(weather({ view: 'daily' })).toContain('Number of days');
    for (const view of [undefined, 'current', 'details'] as const) {
      const html = weather(view ? { view } : undefined);
      expect(html).not.toContain('Number of steps');
      expect(html).not.toContain('Number of days');
    }
  });

  it('is translated, and offered to the extra placements too', () => {
    expect(weather({ view: 'hours' }, 'da')).toContain('Antal tidspunkter');
    expect(weather({ view: 'daily' }, 'da')).toContain('Antal dage');
    const extra = panel({ i: 'weather:3', x: 0, y: 0, w: 5, h: 2 });
    expect(extra).toContain('<option value="hours"');
  });

  it('labels the extra placements in the editor palette', () => {
    expect(WEATHER_WIDGET_IDS.map((id) => weatherWidgetLabel(id, 'Weather'))).toEqual(['Weather', 'Weather (2)', 'Weather (3)', 'Weather (4)']);
    expect(isWeatherWidget('weather:4')).toBe(true);
    expect(isWeatherWidget('weather:5')).toBe(false);
    expect(isWeatherWidget('calendar:2')).toBe(false);
  });

  it('keeps the view and the item count of a placement when it is moved', () => {
    const placed: DisplayLayout = { version: 1, cols: 10, rows: 6, widgets: [{ i: 'weather:2', x: 0, y: 0, w: 5, h: 2, options: { view: 'hours', items: 4 } }] };
    expect(layoutFromGrid(placed, [{ ...placed.widgets[0], y: 3 }]).widgets[0]).toMatchObject({ i: 'weather:2', y: 3, options: { view: 'hours', items: 4 } });
    expect(updateWidgetOptions(placed, 'weather:2', { view: undefined, items: undefined }).widgets[0]).not.toHaveProperty('options');
  });
});
