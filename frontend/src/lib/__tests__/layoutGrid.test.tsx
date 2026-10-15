import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GridEditor, layoutFromGrid } from '../../components/layout/GridEditor';
import { WidgetOptionsPanel } from '../../components/layout/WidgetOptionsPanel';
import { changeGrid, gridLabel, layoutInvertMode, layoutScale, updateLayoutInvert, updateLayoutTeletext } from '../layoutGrid';
import { layoutProblem } from '../layoutPlacement';
import type { DisplayLayout } from '../../types';

const base: DisplayLayout = { version: 1, cols: 10, rows: 6, zoom: 2, widgets: [
  { i: 'energy', x: 0, y: 0, w: 10, h: 2, options: { view: 'day' } },
  { i: 'weather', x: 0, y: 2, w: 5, h: 3 },
  { i: 'status', x: 0, y: 5, w: 10, h: 1, static: true },
] };

describe('layout grid scale', () => {
  it('names the supported grids', () => {
    expect(layoutScale(base)).toBe(1);
    expect(layoutScale({ cols: 20, rows: 12 })).toBe(2);
    expect(layoutScale({ cols: 40, rows: 24 })).toBe(4);
    expect(layoutScale({ cols: 20, rows: 6 })).toBeNull();
    expect([1, 2, 4].map((scale) => gridLabel(scale as 1))).toEqual(['10 × 6', '20 × 12', '40 × 24']);
  });

  it('refines the grid without moving anything and keeps every other field', () => {
    const fine = changeGrid(base, 2)!;
    expect(fine.cols).toBe(20);
    expect(fine.rows).toBe(12);
    expect(fine.zoom).toBe(2);
    expect(fine.widgets).toEqual([
      { i: 'energy', x: 0, y: 0, w: 20, h: 4, options: { view: 'day' } },
      { i: 'weather', x: 0, y: 4, w: 10, h: 6 },
      { i: 'status', x: 0, y: 10, w: 20, h: 2, static: true },
    ]);
    expect(layoutProblem(fine)).toBeNull();
    expect(layoutScale(changeGrid(base, 4)!)).toBe(4);
    expect(changeGrid(base, 4)!.widgets[2]).toMatchObject({ y: 20, w: 40, h: 4 });
  });

  it('returns to the base grid when every widget sits on whole cells, and refuses otherwise', () => {
    expect(changeGrid(changeGrid(base, 2)!, 1)).toEqual(base);
    expect(changeGrid(changeGrid(base, 4)!, 1)).toEqual(base);
    const small = changeGrid(base, 2)!;
    // A status bar one fine row tall has no equivalent on the coarse grid.
    const shrunk = { ...small, widgets: small.widgets.map((w) => w.i === 'status' ? { ...w, y: 11, h: 1 } : w) };
    expect(changeGrid(shrunk, 1)).toBeNull();
    expect(changeGrid({ ...small, widgets: small.widgets.map((w) => w.i === 'weather' ? { ...w, x: 1 } : w) }, 1)).toBeNull();
    expect(changeGrid(base, 1)).toBe(base);
    expect(changeGrid({ ...base, cols: 7 }, 2)).toBeNull();
  });

  it('sets the sunset-to-sunrise mode and reads each mode back', () => {
    const sun = updateLayoutInvert(base, 'sun');
    expect(sun.invert).toBe('sun');
    expect(layoutInvertMode(sun)).toBe('sun');
    expect(layoutInvertMode(updateLayoutInvert(sun, 'always'))).toBe('always');
    expect('invert' in updateLayoutInvert(sun, 'off')).toBe(false);
    expect(layoutInvertMode(base)).toBe('off');
  });

  it('sets and clears the invert flag without leaving false behind', () => {
    const inverted = updateLayoutInvert(base, true);
    expect(inverted.invert).toBe(true);
    expect('invert' in updateLayoutInvert(inverted, false)).toBe(false);
    expect(updateLayoutInvert(base, false)).toEqual(base);
  });

  it('sets and clears Tekst TV without leaving false behind, and keeps the colours', () => {
    const teletext = updateLayoutTeletext(updateLayoutInvert(base, 'sun'), true);
    expect(teletext.teletext).toBe(true);
    expect(teletext.invert).toBe('sun');
    const cleared = updateLayoutTeletext(teletext, false);
    expect('teletext' in cleared).toBe(false);
    expect(cleared.invert).toBe('sun');
    expect(updateLayoutTeletext(base, false)).toEqual(base);
  });
});

describe('editing on a finer grid', () => {
  const fine = changeGrid(base, 2)!;
  const meta = { energy: { id: 'energy', label: 'Energy', icon: 'bolt' }, weather: { id: 'weather', label: 'Weather', icon: 'cloud' }, status: { id: 'status', label: 'Status', icon: 'schedule' } };
  const render = (layout: DisplayLayout) => renderToStaticMarkup(<GridEditor layout={layout} widgetMeta={meta} onLayoutChange={vi.fn()} onRemoveWidget={vi.fn()} />);

  it('sizes the gridlines for the layout, so the canvas stays 750 × 360 px', () => {
    expect(render(base)).toContain('--grid-col:75px');
    expect(render(base)).toContain('--grid-row:60px');
    expect(render(fine)).toContain('--grid-col:37.5px');
    expect(render(fine)).toContain('--grid-row:30px');
    expect(render(fine)).toContain('grid-editor-canvas--fine');
    expect(render(base)).not.toContain('grid-editor-canvas--fine');
  });

  it('shows widget sizes in the layout\'s own cells', () => {
    expect(render(fine)).toContain('20×4');
    expect(render(fine)).toContain('20×2');
  });

  it('clamps to the layout grid, so a finer grid can place a widget the base grid could not', () => {
    const moved = layoutFromGrid(fine, [{ i: 'status', x: 0, y: 11, w: 20, h: 1 }] as never);
    expect(moved.widgets[0]).toMatchObject({ y: 11, h: 1 });
    expect(moved.cols).toBe(20);
    expect(layoutFromGrid(fine, [{ i: 'status', x: 15, y: 15, w: 30, h: 9 }] as never).widgets[0]).toMatchObject({ x: 0, y: 3, w: 20, h: 9 });
    expect(layoutFromGrid(updateLayoutInvert(fine, true), [] as never).invert).toBe(true);
    expect(layoutFromGrid(updateLayoutTeletext(fine, true), [] as never).teletext).toBe(true);
  });
});

describe('status widget options', () => {
  const panel = (lang: 'da' | 'en') => renderToStaticMarkup(
    <WidgetOptionsPanel widget={{ i: 'status', x: 0, y: 0, w: 4, h: 1 }} label="Status" lang={lang} onChange={vi.fn()} onClose={vi.fn()} />);

  it('offers a compact view next to text size', () => {
    expect(panel('en')).toContain('Compact: time only');
    expect(panel('da')).toContain('Kompakt: kun klokkeslæt');
    expect(panel('en')).toContain('Text size');
    expect(panel('en')).not.toContain('no display options');
  });
});
