import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GridEditor, layoutFromGrid } from '../../components/layout/GridEditor';
import { WidgetOptionsPanel } from '../../components/layout/WidgetOptionsPanel';
import { updateWidgetOptions, widgetOptionKind } from '../widgetOptions';
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
    expect(['energy', 'news', 'news:abc', 'calendar', 'ticker:t1', 'status', 'weather'].map(widgetOptionKind))
      .toEqual(['energy', 'list', 'list', 'list', 'ticker', null, null]);
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

  it('names the ticker defaults and shows stocks per page only for the list view', () => {
    const condensed = panel({ i: 'ticker:t1', x: 0, y: 0, w: 5, h: 3 }, 'en', ticker);
    expect(condensed).toContain('Widget default (List)');
    expect(condensed).toContain('Widget default (4)');
    expect(panel({ i: 'ticker:t1', x: 0, y: 0, w: 5, h: 3, options: { view: 'full' } }, 'en', ticker)).not.toContain('Stocks per page');
  });

  it('says when a widget has nothing to set', () => {
    expect(panel(layout.widgets[2])).toContain('no display options');
  });
});
