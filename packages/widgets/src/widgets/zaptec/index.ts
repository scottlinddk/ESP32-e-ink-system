import type { ZaptecData, ZaptecWidgetConfig } from './types';
import { z } from 'zod';
import type { Widget } from '@esp32-eink/types';
import { providerJson } from '../evProvider';

const ZAPTEC_BASE = 'https://api.zaptec.com';
export interface ZaptecCredentials { username: string; password: string }

// https://docs.zaptec.com/reference/api_chargers_get
export const ZAPTEC_MODE: Record<number, string> = {
  0: 'unknown', 1: 'disconnected', 2: 'requesting', 3: 'charging', 5: 'finished',
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Zaptec returned an invalid response');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 128) throw new Error('Zaptec returned an invalid ID');
  return value;
}
async function getZaptecToken(credentials: ZaptecCredentials, signal: AbortSignal): Promise<string> {
  const body = new URLSearchParams({ grant_type: 'password', username: credentials.username, password: credentials.password, scope: 'openid' });
  const json = record(await providerJson(`${ZAPTEC_BASE}/oauth/token`, {
    signal, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  }, 'Zaptec'));
  if (typeof json.access_token !== 'string' || !json.access_token || json.access_token.length > 8192 ||
      typeof json.expires_in !== 'number' || !Number.isFinite(json.expires_in) || json.expires_in <= 0) {
    throw new Error('Zaptec returned an invalid access token');
  }
  signal.throwIfAborted();
  return json.access_token;
}
async function list(path: string, token: string, signal: AbortSignal): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (let pageIndex = 0; pageIndex < 5; pageIndex++) {
    const params = new URLSearchParams({ pageIndex: String(pageIndex), pageSize: '100' });
    const json = record(await providerJson(`${ZAPTEC_BASE}/api/${path}?${params}`, {
      signal, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }, 'Zaptec'));
    const data = json.data === null && json.totalCount === 0 ? [] : json.data;
    if (!Array.isArray(data) || data.length > 100 || !Number.isInteger(json.pages) || (json.pages as number) < 0 ||
        !Number.isInteger(json.totalCount) || (json.totalCount as number) < 0) throw new Error('Zaptec returned an invalid page');
    if ((json.pages as number) > 5 || (json.totalCount as number) > 500) throw new Error('Zaptec result exceeds 500 items');
    for (const value of data) {
      const row = record(value);
      const rowId = id(row.id);
      if (seen.has(rowId)) throw new Error('Zaptec returned duplicate items');
      seen.add(rowId);
      rows.push(row);
    }
    if (pageIndex + 1 >= (json.pages as number)) {
      if (rows.length !== json.totalCount) throw new Error('Zaptec returned an incomplete result');
      return rows;
    }
    if (data.length === 0) throw new Error('Zaptec returned an incomplete page');
  }
  throw new Error('Zaptec result exceeds 500 items');
}

export async function fetchZaptecData(
  credentials: ZaptecCredentials, fields: string[],
  signal: AbortSignal = AbortSignal.timeout(10_000),
): Promise<ZaptecData> {
  signal.throwIfAborted();
  if (!credentials || typeof credentials.username !== 'string' || !credentials.username.trim() ||
      typeof credentials.password !== 'string' || !credentials.password.trim()) throw new Error('Zaptec credentials are missing');
  const token = await getZaptecToken(credentials, signal);
  const result: ZaptecData = { chargers: [], activeSession: null, installationName: null };
  const tasks: Promise<void>[] = [];
  if (fields.includes('charger_status') || fields.includes('active_session')) tasks.push((async () => {
    const chargers = await list('chargers', token, signal);
    const mappedChargers = chargers.map((charger) => {
      if (!Number.isInteger(charger.operatingMode)) throw new Error('Zaptec returned an invalid operating mode');
      return { id: id(charger.id), name: typeof charger.name === 'string' ? charger.name.slice(0, 200) : id(charger.id), operatingMode: charger.operatingMode as number };
    });
    if (fields.includes('charger_status')) result.chargers = mappedChargers;
    if (!fields.includes('active_session')) return;
    const charging = mappedChargers.find((charger) => charger.operatingMode === 3);
    if (!charging) return;
    const values = await providerJson(`${ZAPTEC_BASE}/api/chargers/${encodeURIComponent(charging.id)}/state`, {
      signal, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }, 'Zaptec');
    if (!Array.isArray(values) || values.length > 512) throw new Error('Zaptec returned invalid charger state');
    const observation = values.map(record).find((value) => value.stateId === 553);
    const value = observation?.valueAsString;
    let kwh: number | null = null;
    if (value != null) {
      if (typeof value !== 'string' || !value.trim()) throw new Error('Zaptec returned invalid session energy');
      kwh = Number(value);
      if (!Number.isFinite(kwh) || kwh < 0) throw new Error('Zaptec returned invalid session energy');
    }
    // Observation 553 is already kWh. 718 is FinalStopActive, not a start time.
    result.activeSession = { id: charging.id, energyDeliveredKwh: kwh, startDateTime: null, chargerName: charging.name };
  })());
  if (fields.includes('installation_info')) tasks.push((async () => {
    const installations = await list('installation', token, signal);
    const name = installations.length === 1 ? installations[0].name : null;
    if (name != null && typeof name !== 'string') throw new Error('Zaptec returned an invalid installation');
    result.installationName = typeof name === 'string' ? name.slice(0, 200) : null;
  })());
  await Promise.all(tasks);
  signal.throwIfAborted();
  return result;
}

export const configSchema = z.object({
  username: z.string().min(1), password: z.string().min(1),
  showChargerStatus: z.boolean().default(true), showActiveSession: z.boolean().default(true),
  showInstallationInfo: z.boolean().default(false),
});
export const zaptecWidget: Widget<ZaptecWidgetConfig, ZaptecData> = {
  meta: { id: 'zaptec', name: 'Zaptec EV Charger', description: 'Live charger status and session data from Zaptec.', category: 'ev', requiresOauth: 'zaptec' },
  configSchema,
  async fetch(config) {
    try {
      const fields = [config.showChargerStatus && 'charger_status', config.showActiveSession && 'active_session', config.showInstallationInfo && 'installation_info'].filter((value): value is string => !!value);
      return { ok: true, data: await fetchZaptecData(config, fields) };
    } catch { return { ok: false, error: 'Zaptec unavailable. Check credentials and provider access.' }; }
  },
  render(data, region, typography) {
    const elements: import('@esp32-eink/types').RenderedWidget['elements'] = [];
    let y = 2;
    const title = data.installationName ? `Zaptec - ${data.installationName}` : 'Zaptec';
    elements.push({ kind: 'text', text: title, x: 2, y, fontSize: typography.sm });
    y += typography.sm + 3;
    if (data.chargers.length > 0) {
      const available = data.chargers.filter((c) => c.operatingMode === 1).length;
      const charging = data.chargers.filter((c) => c.operatingMode === 3).length;
      elements.push({ kind: 'text', text: `${available} avail  ${charging} charging`, x: 2, y, fontSize: typography.base });
      y += typography.base + 3;
    }
    if (data.activeSession && y < region.heightPx - typography.base - 2) {
      const s = data.activeSession;
      const energyText = s.energyDeliveredKwh === null ? 'Energy unknown' : `${s.energyDeliveredKwh.toFixed(1)} kWh`;
      elements.push({ kind: 'text', text: `${energyText}  ${s.chargerName}`, x: 2, y, fontSize: typography.base });
    }
    return { region, elements };
  },
};
