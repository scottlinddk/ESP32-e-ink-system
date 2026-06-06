// =========================================================================
// GridEditor.tsx — drag-and-drop resizable layout editor for the e-ink display
// =========================================================================
import React from 'react';
import { GridLayout, noCompactor, Layout, LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { cn } from '@/lib/utils';
import { WidgetLayout, DisplayLayout } from '../../types';
import { Icon } from '../ui/Logo';

// The editor renders at 3× scale so grid cells are large enough to interact with.
const SCALE = 3;
const GRID_COLS = 10;
const GRID_ROWS = 6;
const ROW_HEIGHT = 20 * SCALE;   // 60px per row
const GRID_WIDTH = 250 * SCALE;  // 750px total width

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
}

export function GridEditor({ layout, widgetMeta, onLayoutChange, onRemoveWidget }: GridEditorProps) {
  function handleChange(rglLayout: Layout) {
    const widgets: WidgetLayout[] = (rglLayout as LayoutItem[]).map((item) => {
      const orig = layout.widgets.find((w) => w.i === item.i);
      return {
        i: item.i,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        static: orig?.static,
      };
    });
    onLayoutChange({ ...layout, widgets });
  }

  const rglLayout: Layout = layout.widgets.map((w): LayoutItem => ({
    i: w.i,
    x: w.x,
    y: w.y,
    w: w.w,
    h: w.h,
    static: w.static,
    minW: 2,
    minH: 1,
    maxW: GRID_COLS,
    maxH: GRID_ROWS,
  }));

  return (
    <div>
      <div className="grid-editor-canvas" style={{ width: GRID_WIDTH }}>
        <GridLayout
          width={GRID_WIDTH}
          gridConfig={{
            cols: GRID_COLS,
            rowHeight: ROW_HEIGHT,
            maxRows: GRID_ROWS,
          }}
          dragConfig={{ handle: '.widget-drag-handle' }}
          compactor={noCompactor}
          layout={rglLayout}
          onLayoutChange={handleChange}
        >
          {layout.widgets.map((widget) => {
            const meta = widgetMeta[widget.i];
            const isStatic = !!widget.static;
            return (
              <div
                key={widget.i}
                className={cn(
                  'h-full border rounded-sm flex items-center justify-between px-2 overflow-hidden select-none group',
                  'transition-[border-color,box-shadow] duration-[150ms]',
                  isStatic
                    ? 'bg-bg border-border border-dashed cursor-default opacity-75'
                    : 'bg-surface border-border cursor-grab hover:border-accent hover:shadow-1'
                )}
              >
                {/* className kept as widget-drag-handle — react-grid-layout uses it as a DOM selector */}
                <div
                  className={cn(
                    'widget-drag-handle flex items-center gap-1.5 flex-1 min-w-0 h-full text-[11px] font-medium text-fg2',
                    '[&_.material-symbols-outlined]:text-[16px] [&_.material-symbols-outlined]:text-fg3 [&_.material-symbols-outlined]:flex-shrink-0',
                    isStatic ? 'cursor-default' : 'cursor-grab'
                  )}
                >
                  <Icon name={isStatic ? 'lock' : 'drag_indicator'} />
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                    {meta?.label ?? widget.i}
                  </span>
                </div>
                {!isStatic && (
                  <button
                    className="flex-shrink-0 w-[22px] h-[22px] rounded-full border border-border bg-transparent cursor-pointer flex items-center justify-center text-fg3 opacity-0 group-hover:opacity-100 hover:bg-error hover:border-error hover:text-white transition-[opacity,background-color,color,border-color] duration-[150ms] [&_.material-symbols-outlined]:text-[14px]"
                    title="Remove widget"
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
