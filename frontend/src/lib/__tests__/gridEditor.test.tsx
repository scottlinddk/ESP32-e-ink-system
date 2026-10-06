import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GridEditor, layoutCompactor } from '../../components/layout/GridEditor';
import type { DisplayLayout } from '../../types';

const layout: DisplayLayout = { version: 1, cols: 10, rows: 6, widgets: [
  { i: 'custom-image', x: 0, y: 0, w: 5, h: 2 },
  { i: 'ticker:t1', x: 5, y: 0, w: 5, h: 3 },
  { i: 'status', x: 0, y: 5, w: 10, h: 1, static: true },
] };
const widgetMeta = {
  'custom-image': { id: 'custom-image', label: 'My image', icon: 'image' },
  'ticker:t1': { id: 'ticker:t1', label: 'Stocks: NOVO-B', icon: 'show_chart' },
  status: { id: 'status', label: 'Status', icon: 'info' },
};
const render = () => renderToStaticMarkup(<GridEditor layout={layout} widgetMeta={widgetMeta} onLayoutChange={vi.fn()} onRemoveWidget={vi.fn()} />);

describe('layout editor resizing', () => {
  it('refuses to move or resize a widget onto another one, and does not rearrange widgets', () => {
    // The backend rejects overlapping layouts, so the editor must never produce one.
    expect(layoutCompactor.allowOverlap).toBe(false);
    expect(layoutCompactor.preventCollision).toBe(true);
    expect(layoutCompactor.type).toBeNull();
  });
  it('shows a size readout on every widget, including the status bar', () => {
    // The resize handle itself is added by the library in the browser, so it is not in this markup.
    const html = render();
    expect(html).toContain('5×2');
    expect(html).toContain('5×3');
    expect(html).toContain('10×1');
  });
  it('treats the status bar like any other widget, except that it cannot be removed', () => {
    const html = render();
    expect(html).not.toContain('lock</');          // no lock icon: it is movable and resizable
    expect(html).toContain('Remove My image');
    expect(html).toContain('Remove Stocks: NOVO-B');
    expect(html).not.toContain('Remove Status');
  });
});
