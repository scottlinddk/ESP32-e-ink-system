import { z } from 'zod';
import type { Widget, PixelRegion, TypographyScale, RenderedWidget, WidgetResult } from '@esp32-eink/types';
import type { GoogleCalendarConfig, GoogleCalendarData } from './types';

export const configSchema = z.object({
  calendarId: z.string().optional(),
  maxEvents: z.number().int().min(1).max(10).optional(),
  daysAhead: z.number().int().min(1).max(30).optional(),
  label: z.string().optional(),
});

export const googleCalendarWidget: Widget<GoogleCalendarConfig, GoogleCalendarData> = {
  meta: {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Upcoming events from your Google Calendar.',
    category: 'utility',
  },

  configSchema,

  async fetch(_config: GoogleCalendarConfig, _region: PixelRegion): Promise<WidgetResult<GoogleCalendarData>> {
    // Backend service handles fetch (needs OAuth tokens + Supabase).
    return {
      ok: false,
      error: 'Google Calendar data must be fetched via backend service (OAuth tokens required)',
    };
  },

  render(data: GoogleCalendarData, region: PixelRegion, typography: TypographyScale): RenderedWidget {
    const elements: RenderedWidget['elements'] = [];
    let y = 2;

    elements.push({
      kind: 'text',
      text: `${data.label}  ${data.today}`,
      x: 2,
      y,
      fontSize: typography.sm,
    });
    y += typography.sm + 3;
    elements.push({ kind: 'hline', x: 0, y, width: region.widthPx });
    y += 3;

    if (data.events.length === 0) {
      elements.push({ kind: 'text', text: 'No upcoming events', x: 2, y, fontSize: typography.sm });
    } else {
      for (const ev of data.events) {
        if (y + typography.sm > region.heightPx - 2) break;
        elements.push({
          kind: 'text',
          text: `${ev.timeLabel}  ${ev.summary}`,
          x: 2,
          y,
          fontSize: typography.sm,
        });
        y += typography.sm + 2;
      }
    }

    return { region, elements };
  },
};
