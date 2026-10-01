import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDevices } from '../services/database';

const db = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  error: null as Error | null,
  from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: db.from }) }));

const legacy = (id: string, fields: Record<string, unknown> = {}) => ({
  id, user_id: 'owner-a', device_id: `hardware-${id}`, device_name: id,
  ble_name: null, license_key: null, firmware_version: '1.0.0', last_seen_at: null,
  device_delivery: null, ...fields,
});
const report = (fields: Record<string, unknown> = {}) => ({
  owner_id: 'owner-a', last_seen_at: '2026-10-01T12:00:00Z', firmware_version: '1.2.3', ...fields,
});

describe('device list telemetry', () => {
  beforeAll(() => {
    vi.stubEnv('SUPABASE_URL', 'https://db.example.org');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
  });
  afterAll(() => { vi.unstubAllEnvs(); });
  beforeEach(() => {
    vi.clearAllMocks(); db.rows = []; db.error = null;
    db.from.mockReturnValue({ select: db.select });
    db.select.mockReturnValue({ eq: db.eq });
    db.eq.mockReturnValue({ order: db.order });
    db.order.mockImplementation(async () => ({ data: db.rows, error: db.error }));
  });

  it('uses the current owner heartbeat for every device without per-device queries or exposing the delivery row', async () => {
    db.rows = [
      legacy('connected', { device_delivery: report() }),
      legacy('older-registration', { last_seen_at: '2026-09-01T12:00:00Z', device_delivery: report() }),
      legacy('never-connected'),
    ];
    const devices = await getDevices('owner-a');
    expect(devices.slice(0, 2)).toEqual([
      expect.objectContaining({ last_seen_at: '2026-10-01T12:00:00Z', firmware_version: '1.2.3' }),
      expect.objectContaining({ last_seen_at: '2026-10-01T12:00:00Z', firmware_version: '1.2.3' }),
    ]);
    expect(devices[2]).toMatchObject({ last_seen_at: null, firmware_version: null });
    expect(devices.every((device) => !('device_delivery' in device))).toBe(true);
    expect(db.from).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledWith('devices');
    expect(db.select).toHaveBeenCalledWith('*, device_delivery(owner_id, last_seen_at, firmware_version)');
    expect(db.eq).toHaveBeenCalledWith('user_id', 'owner-a');
    expect(db.order).toHaveBeenCalledWith('created_at', { ascending: true });
  });

  it('ignores an earlier owner report after reassignment', async () => {
    db.rows = [legacy('reassigned', { device_delivery: report({ owner_id: 'owner-b' }) })];
    expect(await getDevices('owner-a')).toEqual([
      expect.objectContaining({ id: 'reassigned', last_seen_at: null, firmware_version: null }),
    ]);
  });

  it('preserves valid legacy reports, including a real 1.0.0 report and reports newer than delivery', async () => {
    const last_seen_at = '2026-10-01T12:30:00Z';
    db.rows = [
      legacy('legacy-only', { last_seen_at }),
      legacy('legacy-newer', { last_seen_at, firmware_version: '1.4.0', device_delivery: report() }),
      legacy('rotated-token', { last_seen_at, device_delivery: report({ last_seen_at: null, firmware_version: null }) }),
    ];
    expect(await getDevices('owner-a')).toEqual([
      expect.objectContaining({ last_seen_at, firmware_version: '1.0.0' }),
      expect.objectContaining({ last_seen_at, firmware_version: '1.4.0' }),
      expect.objectContaining({ last_seen_at, firmware_version: '1.0.0' }),
    ]);
  });

  it('keeps unreported timestamps and firmware unknown instead of synthesizing a report', async () => {
    db.rows = [
      legacy('unreported'),
      legacy('token-only', { device_delivery: report({ last_seen_at: null, firmware_version: null }) }),
    ];
    for (const device of await getDevices('owner-a')) {
      expect(device.last_seen_at).toBeNull();
      expect(device.firmware_version).toBeNull();
    }
  });

  it('does not hide a database failure as an empty device list', async () => {
    db.error = new Error('Database unavailable');
    await expect(getDevices('owner-a')).rejects.toThrow('Database unavailable');
  });
});
