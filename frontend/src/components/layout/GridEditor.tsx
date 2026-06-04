// =========================================================================
// GridEditor.tsx — drag-and-drop resizable layout editor for the e-ink display
// =========================================================================
import React from 'react';
import { GridLayout, noCompactor, Layout, LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
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
    <div className="grid-editor-wrap">
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
              <div key={widget.i} className={`grid-widget${isStatic ? ' grid-widget--static' : ''}`}>
                <div className="widget-drag-handle">
                  <Icon name={isStatic ? 'lock' : 'drag_indicator'} />
                  <span className="widget-label">{meta?.label ?? widget.i}</span>
                </div>
                {!isStatic && (
                  <button
                    className="widget-remove"
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
