// =========================================================================
// GridEditor.tsx — drag-and-drop resizable layout editor for the e-ink display
// =========================================================================
import React from 'react';
import { GridLayout, getCompactor, Layout, LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { cn } from '@/lib/utils';
import { WidgetLayout, DisplayLayout } from '../../types';
import { Icon } from '../ui/Logo';
import { clampWidgetToGrid } from '../../lib/layoutPlacement';

// The editor renders at 3× scale so grid cells are large enough to interact with. The canvas
// is always 750 × 360 px, whatever the grid: a finer grid has smaller cells, not a larger canvas.
const SCALE = 3;
const GRID_WIDTH = 250 * SCALE;  // 750px total width
const GRID_HEIGHT = 120 * SCALE; // 360px total height
// Below this a cell is too small for the remove button and the 28px resize handle of the base grid.
const FINE_ROW_HEIGHT = 40;

/**
 * Widgets keep exactly where the user puts them (no compaction), and a move or
 * resize that would land on another widget is refused. Without this a widget could
 * be dragged over its neighbour, which the backend rejects on save.
 */
export const layoutCompactor = getCompactor(null, false, true);

export interface WIDGET_META {
  id: string;
  label: string;
  icon: string;
}

interface GridEditorProps {
  layout: DisplayLayout;
  widgetMeta: Record<string, WIDGET_META>;
  onLayoutChange: (layout: DisplayLayout) => void;
  onRemoveWidget: (widgetId: string) => void;
  /** The widget whose options are open, highlighted in the grid. */
  selectedId?: string | null;
  onSelectWidget?: (widgetId: string) => void;
}

/** The layout after a move or resize, keeping each widget's own fields. */
export function layoutFromGrid(layout: DisplayLayout, rglLayout: Layout): DisplayLayout {
  const widgets: WidgetLayout[] = (rglLayout as LayoutItem[]).map((item) => {
    const orig = layout.widgets.find((w) => w.i === item.i);
    // Never emit a widget outside the grid, whatever the library reports.
    return {
      i: item.i,
      ...clampWidgetToGrid({ x: item.x, y: item.y, w: item.w, h: item.h }, layout.cols, layout.rows),
      // The flag is kept in the saved layout; it only means "cannot be removed" here.
      static: orig?.static,
      // Moving or resizing never drops a widget's display options.
      ...(orig?.options ? { options: orig.options } : {}),
    };
  });
  return { ...layout, widgets };
}

export function GridEditor({ layout, widgetMeta, onLayoutChange, onRemoveWidget, selectedId, onSelectWidget }: GridEditorProps) {
  function handleChange(rglLayout: Layout) {
    onLayoutChange(layoutFromGrid(layout, rglLayout));
  }

  const rowHeight = GRID_HEIGHT / layout.rows;
  const fine = rowHeight < FINE_ROW_HEIGHT;
  const rglLayout: Layout = layout.widgets.map((w): LayoutItem => ({
    i: w.i,
    x: w.x,
    y: w.y,
    w: w.w,
    h: w.h,
    // Every widget can be moved and resized, including the status bar.
    static: false,
    minW: 2,
    minH: 1,
    maxW: layout.cols,
    maxH: layout.rows,
  }));

  return (
    <div>
      <div
        className={cn('grid-editor-canvas', fine && 'grid-editor-canvas--fine')}
        // The CSS gridlines follow the cells of whichever grid the layout uses.
        style={{ width: GRID_WIDTH, '--grid-col': `${GRID_WIDTH / layout.cols}px`, '--grid-row': `${rowHeight}px` } as React.CSSProperties}
      >
        <GridLayout
          width={GRID_WIDTH}
          gridConfig={{
            cols: layout.cols,
            rowHeight,
            maxRows: layout.rows,
            // No gaps, so a cell is exactly as wide and tall as its gridline says.
            margin: [0, 0],
            containerPadding: [0, 0],
          }}
          dragConfig={{ handle: '.widget-drag-handle' }}
          compactor={layoutCompactor}
          layout={rglLayout}
          onLayoutChange={handleChange}
        >
          {layout.widgets.map((widget) => {
            const meta = widgetMeta[widget.i];
            // A widget flagged `static` (the status bar) can be moved and resized, but not removed.
            const removable = !widget.static;
            const selected = widget.i === selectedId;
            return (
              <div
                key={widget.i}
                // Pointer down, not click: a drag never ends in a click, and dragging a widget selects it too.
                onPointerDown={() => onSelectWidget?.(widget.i)}
                className={cn(
                  'h-full border rounded-sm flex items-center justify-between overflow-hidden select-none group',
                  fine ? 'px-1' : 'px-2',
                  'transition-[border-color,box-shadow] duration-[150ms]',
                  'bg-surface border-border cursor-grab hover:border-accent hover:shadow-1',
                  selected && 'border-accent shadow-[0_0_0_1px_var(--accent)]'
                )}
              >
                {/* className kept as widget-drag-handle — react-grid-layout uses it as a DOM selector */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  aria-label={`${meta?.label ?? widget.i}: ${selected ? 'selected' : 'select to show options'}`}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    onSelectWidget?.(widget.i);
                  }}
                  className={cn(
                    'widget-drag-handle outline-none focus-visible:underline flex items-center gap-1.5 flex-1 min-w-0 h-full text-[11px] font-medium text-fg2',
                    '[&_.material-symbols-outlined]:text-[16px] [&_.material-symbols-outlined]:text-fg3 [&_.material-symbols-outlined]:flex-shrink-0',
                    'cursor-grab'
                  )}
                >
                  <Icon name="drag_indicator" />
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                    {meta?.label ?? widget.i}
                  </span>
                </div>
                <span className="flex-shrink-0 text-[10px] text-fg3 tabular-nums mr-1" title="Columns × rows">
                  {widget.w}×{widget.h}
                </span>
                {removable && (
                  <button
                    className={cn(
                      'flex-shrink-0 rounded-full border border-border bg-transparent cursor-pointer flex items-center justify-center text-fg3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-error hover:border-error hover:text-white transition-[opacity,background-color,color,border-color] duration-[150ms] [&_.material-symbols-outlined]:text-[14px]',
                      fine ? 'w-[14px] h-[14px]' : 'w-[22px] h-[22px]',
                      // Touch screens have no hover, so a selected widget always shows its remove button.
                      selected && 'opacity-100'
                    )}
                    title="Remove widget"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => onRemoveWidget(widget.i)}
                    aria-label={`Remove ${meta?.label ?? widget.i}`}
                  >
                    <Icon name="close" />
                  </button>
                )}
              </div>
            );
          })}
        </GridLayout>
      </div>
    </div>
  );
}
