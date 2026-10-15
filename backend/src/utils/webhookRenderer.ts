import type { CustomWebhookData } from '../types';
import { DEFAULT_DISPLAY_LANGUAGE, type DisplayLanguage } from './displayLanguage';
import { displayStrings } from './displayStrings';

interface TextCanvas { drawText(text: string, x: number, y: number, maxWidth: number): void; }
interface Bounds { x: number; y: number; width: number; height: number; }

export function renderWebhookWidget(canvas: TextCanvas, bounds: Bounds, data?: CustomWebhookData, language: DisplayLanguage = DEFAULT_DISPLAY_LANGUAGE): void {
  if (!data || bounds.height < 10) return;
  const t = displayStrings(language).webhook;
  const width = bounds.width - 4;
  let y = bounds.y + 2;
  canvas.drawText(data.state === 'stale' ? t.stale : data.state === 'unavailable' ? t.unavailable : t.title, bounds.x + 2, y, width);
  y += 10;
  for (const row of data.rows) {
    if (y + 8 > bounds.y + bounds.height) break;
    // Both raster output and the UI treat these as plain text, never HTML.
    canvas.drawText(`${row.label}: ${row.value}${row.unit ? ` ${row.unit}` : ''}`, bounds.x + 2, y, width);
    y += 10;
  }
}
