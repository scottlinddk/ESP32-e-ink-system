import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDevices } from '../services/database';

const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], error: null as Error | null, list: vi.fn() }));
vi.mock('../db/repositories/devices', () => ({
  listDeviceRows: async (userId: string) => { db.list(userId); if (db.error) throw db.error; return db.rows; },
}));

// The repository joins device_delivery in SQL and exposes its telemetry as delivery_* columns.
const legacy = (id: string, fields: Record<string, unknown> = {}) => ({
  id, user_id: 'owner-a', device_id: `hardware-${id}`, device_name: id,
  ble_name: null, license_key: null, firmware_version: '1.0.0', last_seen_at: null,
  delivery_owner_id: null, delivery_last_seen_at: null, delivery_firmware_version: null, ...fields,
});
const report = (fields: Record<string, unknown> = {}) => ({
  delivery_owner_id: 'owner-a', delivery_last_seen_at: '2026-10-01T12:00:00Z', delivery_firmware_version: '1.2.3', ...fields,
});

describe('device list telemetry', () => {
  beforeEach(() => { vi.clearAllMocks(); db.rows = []; db.error = null; });

  it('uses the current owner heartbeat for every device without per-device queries or exposing the delivery row', async () => {
    db.rows = [
      legacy('connected', { ...report() }),
      legacy('older-registration', { last_seen_at: '2026-09-01T12:00:00Z', ...report() }),
      legacy('never-connected'),
    ];
    const devices = await getDevices('owner-a');
    expect(devices.slice(0, 2)).toEqual([
      expect.objectContaining({ last_seen_at: '2026-10-01T12:00:00Z', firmware_version: '1.2.3' }),
      expect.objectContaining({ last_seen_at: '2026-10-01T12:00:00Z', firmware_version: '1.2.3' }),
    ]);
    expect(devices[2]).toMatchObject({ last_seen_at: null, firmware_version: null });
    expect(devices.every((device) => !Object.keys(device).some((key) => key.startsWith('delivery_')))).toBe(true);
    expect(db.list).toHaveBeenCalledTimes(1);
    expect(db.list).toHaveBeenCalledWith('owner-a');
  });

  it('ignores an earlier owner report after reassignment', async () => {
    db.rows = [legacy('reassigned', { ...report({ delivery_owner_id: 'owner-b' }) })];
    expect(await getDevices('owner-a')).toEqual([
      expect.objectContaining({ id: 'reassigned', last_seen_at: null, firmware_version: null }),
    ]);
  });

  it('preserves valid legacy reports, including a real 1.0.0 report and reports newer than delivery', async () => {
    const last_seen_at = '2026-10-01T12:30:00Z';
    db.rows = [
      legacy('legacy-only', { last_seen_at }),
      legacy('legacy-newer', { last_seen_at, firmware_version: '1.4.0', ...report() }),
      legacy('rotated-token', { last_seen_at, ...report({ delivery_last_seen_at: null, delivery_firmware_version: null }) }),
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
      legacy('token-only', { ...report({ delivery_last_seen_at: null, delivery_firmware_version: null }) }),
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
