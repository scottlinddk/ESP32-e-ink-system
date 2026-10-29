import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WidgetOptionsPanel } from '../../components/layout/WidgetOptionsPanel';
import { updateWidgetOptions } from '../widgetOptions';
import { WIDGET_ALIGNMENTS, alignLabel, updateLayoutOutline } from '../widgetFrame';
import type { DisplayLayout, WidgetLayout } from '../../types';

const layout: DisplayLayout = { version: 1, cols: 10, rows: 6, widgets: [{ i: 'news', x: 0, y: 0, w: 10, h: 3 }] };
const panel = (widget: WidgetLayout, lang: 'da' | 'en' = 'en', layoutOutline?: DisplayLayout['outline']) => renderToStaticMarkup(
  <WidgetOptionsPanel widget={widget} label="Widget" lang={lang} layoutOutline={layoutOutline} onChange={vi.fn()} onClose={vi.fn()} />);

describe('layout outline', () => {
  it('stores an outline and drops none', () => {
    expect(updateLayoutOutline(layout, 'rounded').outline).toBe('rounded');
    expect('outline' in updateLayoutOutline({ ...layout, outline: 'thin' }, 'none')).toBe(false);
    expect('outline' in updateLayoutOutline({ ...layout, outline: 'thin' }, undefined)).toBe(false);
  });
});

describe('widget position and outline options', () => {
  it('stores a position and an outline on the placement, and removes them again', () => {
    const set = updateWidgetOptions(layout, 'news', { align: 'bottom-right', outline: 'none' });
    expect(set.widgets[0].options).toEqual({ align: 'bottom-right', outline: 'none' });
    expect(updateWidgetOptions(set, 'news', { align: undefined, outline: undefined }).widgets[0]).not.toHaveProperty('options');
  });

  it('shows a 3 × 3 position picker with top left chosen by default', () => {
    const html = panel(layout.widgets[0]);
    expect(html.match(/aria-pressed=/g)).toHaveLength(WIDGET_ALIGNMENTS.length);
    expect(html).toMatch(/aria-pressed="true" aria-label="Top left"/);
    expect(panel({ ...layout.widgets[0], options: { align: 'middle-right' } })).toMatch(/aria-pressed="true" aria-label="Right"/);
  });

  it('names the layout outline the widget follows', () => {
    expect(panel(layout.widgets[0], 'en', 'dashed')).toContain('Follow layout (dashed line)');
    expect(panel(layout.widgets[0], 'en')).toContain('Follow layout (none)');
    expect(panel({ ...layout.widgets[0], options: { outline: 'thick' } })).toMatch(/<option value="thick" selected="">Thick line<\/option>/);
  });

  it('speaks Danish', () => {
    const html = panel(layout.widgets[0], 'da');
    expect(html).toContain('Placering af indhold');
    expect(html).toContain(alignLabel('bottom-center', 'da'));
  });
});
