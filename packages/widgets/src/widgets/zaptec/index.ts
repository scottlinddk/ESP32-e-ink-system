import { z } from 'zod';
import type { Widget, PixelRegion, TypographyScale, RenderedWidget, WidgetResult } from '@esp32-eink/types';
import type { ZaptecWidgetConfig, ZaptecData } from './types';

const ZAPTEC_BASE = 'https://api.zaptec.com';

export const configSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  showChargerStatus: z.boolean().default(true),
  showActiveSession: z.boolean().default(true),
  showInstallationInfo: z.boolean().default(false),
});

// Zaptec OperatingMode: 2=Disconnected, 3=Connected, 5=Charging, 6=Completed
function isAvailable(mode: number): boolean { return mode === 2 || mode === 3; }
function isCharging(mode: number): boolean { return mode === 5; }

async function getToken(username: string, password: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'password',
    username,
    password,
    scope: 'openid offline_access',
  });
  const res = await fetch(`${ZAPTEC_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zaptec auth: ${res.status} — ${text}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export const zaptecWidget: Widget<ZaptecWidgetConfig, ZaptecData> = {
  meta: {
    id: 'zaptec',
    name: 'Zaptec EV Charger',
    description: 'Live charger status and session data from Zaptec.',
    category: 'ev',
    requiresOauth: 'zaptec',
  },

  configSchema,

  async fetch(config: ZaptecWidgetConfig, _region: PixelRegion): Promise<WidgetResult<ZaptecData>> {
    try {
      const token = await getToken(config.username, config.password);
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

      const result: ZaptecData = { chargers: [], activeSession: null, installationName: null };
      const tasks: Promise<void>[] = [];

      if (config.showChargerStatus || config.showActiveSession) {
        tasks.push(
          fetch(`${ZAPTEC_BASE}/api/chargers`, { headers }).then(async (r) => {
            if (!r.ok) return;
            const json = (await r.json()) as {
              Data?: Array<{ Id: string; Name: string; OperatingMode: number }>;
            };
            result.chargers = (json.Data ?? []).map((c) => ({
              id: c.Id, name: c.Name, operatingMode: c.OperatingMode,
            }));

            if (config.showActiveSession) {
              const chargingCharger = (json.Data ?? []).find((c) => isCharging(c.OperatingMode));
              if (chargingCharger) {
                await fetch(`${ZAPTEC_BASE}/api/chargers/${chargingCharger.Id}/state`, { headers })
                  .then(async (sr) => {
                    if (!sr.ok) return;
                    const state = (await sr.json()) as Array<{ StateId: number; ValueAsString: string }>;
                    const energyState = state.find((s) => s.StateId === 553); // SessionEnergy (Wh)
                    const startState = state.find((s) => s.StateId === 718); // SessionStartTime
                    result.activeSession = {
                      id: chargingCharger.Id,
                      energyDeliveredKwh: energyState ? parseFloat(energyState.ValueAsString) / 1000 : 0,
                      startDateTime: startState?.ValueAsString ?? new Date().toISOString(),
                      chargerName: chargingCharger.Name,
                    };
                  }).catch(() => {});
              }
            }
          }).catch(() => {})
        );
      }

      if (config.showInstallationInfo) {
        tasks.push(
          fetch(`${ZAPTEC_BASE}/api/installations`, { headers }).then(async (r) => {
            if (!r.ok) return;
            const json = (await r.json()) as { Data?: Array<{ Name: string }> };
            result.installationName = json.Data?.[0]?.Name ?? null;
          }).catch(() => {})
        );
      }

      await Promise.all(tasks);
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  render(data: ZaptecData, region: PixelRegion, typography: TypographyScale): RenderedWidget {
    const elements: RenderedWidget['elements'] = [];
    let y = 2;

    const title = data.installationName ? `Zaptec - ${data.installationName}` : 'Zaptec';
    elements.push({ kind: 'text', text: title, x: 2, y, fontSize: typography.sm });
    y += typography.sm + 3;

    if (data.chargers.length > 0) {
      const available = data.chargers.filter((c) => isAvailable(c.operatingMode)).length;
      const charging = data.chargers.filter((c) => isCharging(c.operatingMode)).length;
      elements.push({
        kind: 'text',
        text: `${available} avail  ${charging} charging`,
        x: 2, y, fontSize: typography.base,
      });
      y += typography.base + 3;
    }

    if (data.activeSession && y < region.heightPx - typography.base - 2) {
      const s = data.activeSession;
      elements.push({
        kind: 'text',
        text: `${s.energyDeliveredKwh.toFixed(1)} kWh  ${s.chargerName}`,
        x: 2, y, fontSize: typography.base,
      });
    }

    return { region, elements };
  },
};
