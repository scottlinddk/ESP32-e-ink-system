import type { CustomWebhookData } from '../types';
import { DEFAULT_DISPLAY_LANGUAGE, type DisplayLanguage } from './displayLanguage';
import { displayStrings } from './displayStrings';
import { drawWidgetRows, widgetReading } from './widgetStyle';
import type { DrawingCanvas } from './zoomCanvas';

interface Bounds { x: number; y: number; width: number; height: number; }

export function renderWebhookWidget(canvas: DrawingCanvas, bounds: Bounds, data?: CustomWebhookData, language: DisplayLanguage = DEFAULT_DISPLAY_LANGUAGE): void {
  if (!data || bounds.height < 10) return;
  const t = displayStrings(language).webhook;
  if (bounds.y > 0) canvas.drawHLine(bounds.x, bounds.y, bounds.width);
  drawWidgetRows(canvas, bounds,
    data.state === 'stale' ? t.stale : data.state === 'unavailable' ? t.unavailable : t.title,
    data.rows.map(row => widgetReading(row.label, `${row.value}${row.unit ? ` ${row.unit}` : ''}`, bounds.width - 4)));
}
