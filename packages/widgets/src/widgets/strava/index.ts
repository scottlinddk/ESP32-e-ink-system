import { z } from 'zod';
import type { Widget, PixelRegion, TypographyScale, RenderedWidget, WidgetResult } from '@esp32-eink/types';
import type { StravaConfig, StravaData } from './types';

export const configSchema = z.object({
  goals: z.object({
    run_km: z.number().positive().optional(),
    ride_km: z.number().positive().optional(),
    elevation_m: z.number().positive().optional(),
  }),
  sport_types: z.array(z.enum(['Run', 'Ride'])).optional(),
});

function progressBar(current: number, goal: number, width: number): string {
  if (goal <= 0) return '';
  const pct = Math.min(current / goal, 1);
  const filled = Math.round(pct * width);
  return '[' + '#'.repeat(filled) + '.'.repeat(width - filled) + ']';
}

export const stravaWidget: Widget<StravaConfig, StravaData> = {
  meta: {
    id: 'strava',
    name: 'Strava Goals',
    description: 'Year-to-date progress towards your Strava run/ride goals.',
    category: 'general',
  },

  configSchema,

  async fetch(_config: StravaConfig, _region: PixelRegion): Promise<WidgetResult<StravaData>> {
    // Actual data fetching happens in the backend service (needs OAuth tokens + Supabase).
    // The widget fetch() is intentionally a no-op — it is called in-widget only when
    // tokens are embedded in config (edge case). The backend service path is the norm.
    return {
      ok: false,
      error: 'Strava data must be fetched via backend service (OAuth tokens required)',
    };
  },

  render(data: StravaData, region: PixelRegion, typography: TypographyScale): RenderedWidget {
    const elements: RenderedWidget['elements'] = [];
    let y = 2;

    const header = `Strava  ${data.athleteName}`;
    elements.push({ kind: 'text', text: header, x: 2, y, fontSize: typography.sm });
    y += typography.sm + 3;
    elements.push({ kind: 'hline', x: 0, y, width: region.widthPx });
    y += 3;

    if (data.stats.length === 0) {
      elements.push({ kind: 'text', text: 'No Strava data', x: 2, y, fontSize: typography.sm });
    } else {
      for (const stat of data.stats) {
        if (y + typography.sm > region.heightPx - 2) break;
        const distStr = `${stat.sport}  ${Math.round(stat.ytdDistanceKm)}`;
        const goalStr = stat.goalKm ? `/${stat.goalKm}km` : 'km';
        const bar = stat.goalKm ? '  ' + progressBar(stat.ytdDistanceKm, stat.goalKm, 8) : '';
        elements.push({
          kind: 'text',
          text: distStr + goalStr + bar,
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
