import { z } from 'zod';
import type { Widget, PixelRegion, TypographyScale, RenderedWidget, WidgetResult } from '@esp32-eink/types';
import type { MontaWidgetConfig, MontaData } from './types';

const MONTA_BASE = 'https://api.public-api.monta.com';

export const configSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  showChargerStatus: z.boolean().default(true),
  showActiveSession: z.boolean().default(true),
  showTodayStats: z.boolean().default(false),
});

async function getToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`${MONTA_BASE}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Monta auth: ${res.status} — ${body}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

function normaliseMontaState(raw: string): string {
  const map: Record<string, string> = {
    Available: 'available', Charging: 'charging',
    Occupied: 'busy', Unavailable: 'offline', Faulted: 'offline',
  };
  return map[raw] ?? raw.toLowerCase();
}

export const montaWidget: Widget<MontaWidgetConfig, MontaData> = {
  meta: {
    id: 'monta',
    name: 'Monta EV Charging',
    description: 'Live charger status and session data from Monta.',
    category: 'ev',
    requiresOauth: 'monta',
  },

  configSchema,

  async fetch(config: MontaWidgetConfig, _region: PixelRegion): Promise<WidgetResult<MontaData>> {
    try {
      const token = await getToken(config.clientId, config.clientSecret);
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

      const result: MontaData = { chargePoints: [], activeSessions: [], todayKwh: null };
      const tasks: Promise<void>[] = [];

      if (config.showChargerStatus || config.showActiveSession) {
        tasks.push(
          fetch(`${MONTA_BASE}/v1/charge-points`, { headers }).then(async (r) => {
            if (!r.ok) return;
            const json = (await r.json()) as { data?: Array<{ id: string; state: string; name: string }> };
            result.chargePoints = (json.data ?? []).map((cp) => ({
              id: cp.id, state: normaliseMontaState(cp.state), name: cp.name ?? cp.id,
            }));
          }).catch(() => {})
        );
      }

      if (config.showActiveSession) {
        tasks.push(
          fetch(`${MONTA_BASE}/v1/charges?state=charging&limit=10`, { headers }).then(async (r) => {
            if (!r.ok) return;
            const json = (await r.json()) as { data?: Array<{ id: string; totalKwh?: number; startedAt?: string }> };
            const now = Date.now();
            result.activeSessions = (json.data ?? []).map((c) => ({
              id: c.id,
              energyDeliveredKwh: c.totalKwh ?? 0,
              startedAt: c.startedAt ?? new Date().toISOString(),
              durationMin: c.startedAt ? Math.round((now - new Date(c.startedAt).getTime()) / 60_000) : 0,
            }));
          }).catch(() => {})
        );
      }

      if (config.showTodayStats) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        tasks.push(
          fetch(`${MONTA_BASE}/v1/charges?startedAfter=${today.toISOString()}&limit=100`, { headers })
            .then(async (r) => {
              if (!r.ok) return;
              const json = (await r.json()) as { data?: Array<{ totalKwh?: number }> };
              result.todayKwh = (json.data ?? []).reduce((s, c) => s + (c.totalKwh ?? 0), 0);
            }).catch(() => {})
        );
      }

      await Promise.all(tasks);
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  render(data: MontaData, region: PixelRegion, typography: TypographyScale): RenderedWidget {
    const elements: RenderedWidget['elements'] = [];
    let y = 2;

    elements.push({ kind: 'text', text: 'Monta', x: 2, y, fontSize: typography.sm });
    y += typography.sm + 3;

    if (data.chargePoints.length > 0) {
      const available = data.chargePoints.filter((cp) => cp.state === 'available').length;
      const charging = data.chargePoints.filter((cp) => cp.state === 'charging').length;
      elements.push({
        kind: 'text',
        text: `${available} avail  ${charging} charging`,
        x: 2, y, fontSize: typography.base,
      });
      y += typography.base + 3;
    }

    if (data.activeSessions.length > 0) {
      const s = data.activeSessions[0];
      elements.push({
        kind: 'text',
        text: `${s.energyDeliveredKwh.toFixed(1)} kWh  ${s.durationMin} min`,
        x: 2, y, fontSize: typography.base,
      });
      y += typography.base + 3;
    }

    if (data.todayKwh !== null && y < region.heightPx - typography.sm - 2) {
      elements.push({
        kind: 'text',
        text: `Today: ${data.todayKwh.toFixed(1)} kWh`,
        x: 2, y, fontSize: typography.sm,
      });
    }

    return { region, elements };
  },
};
