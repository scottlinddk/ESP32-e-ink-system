import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getDefaultDeviceId, getDevices, setDefaultDeviceId } from '../services/database';
import router from '../routes/devices';

vi.mock('../middleware/auth', () => ({ requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!req.headers.authorization) { res.status(401).json({ error: 'Sign-in required' }); return; }
  req.clerkUserId = 'clerk-owner'; next();
} }));
vi.mock('@clerk/backend', () => ({ createClerkClient: () => ({ users: { getUser: async () => ({
  emailAddresses: [{ emailAddress: 'owner@example.org' }], primaryEmailAddressId: null, firstName: null, lastName: null,
}) } }) }));
vi.mock('../services/database', () => ({
  upsertUser: vi.fn().mockResolvedValue({ id: 'owner' }), getDevices: vi.fn(), createDevice: vi.fn(),
  updateDeviceName: vi.fn(), deleteDevice: vi.fn(), getDefaultDeviceId: vi.fn(), setDefaultDeviceId: vi.fn(),
}));

const KITCHEN = '0b3c5c8e-1111-4a4a-9b9b-000000000001';
const HALL = '0b3c5c8e-1111-4a4a-9b9b-000000000002';
const device = (id: string) => ({ id, user_id: 'owner', device_id: `hw-${id}`, device_name: id,
  license_key: null, ble_name: null, firmware_version: null, last_seen_at: null });

describe('default dashboard device', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    vi.stubEnv('CLERK_SECRET_KEY', 'test-only');
    const app = express(); app.use(express.json()); app.use('/devices', router);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/devices`;
  });
  afterAll(async () => { vi.unstubAllEnvs(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDevices).mockResolvedValue([device(KITCHEN), device(HALL)]);
    vi.mocked(getDefaultDeviceId).mockResolvedValue(HALL);
    vi.mocked(setDefaultDeviceId).mockResolvedValue(true);
  });
  const put = (body: unknown, authorized = true) => fetch(`${base}/default`, { method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer test' } : {}) }, body: JSON.stringify(body) });

  it('lists the default with the devices', async () => {
    const response = await fetch(base, { headers: { Authorization: 'Bearer test' } });
    expect(await response.json()).toMatchObject({ default_device_id: HALL, devices: [{ id: KITCHEN }, { id: HALL }] });
  });

  it('hides a default that no longer belongs to the user', async () => {
    vi.mocked(getDefaultDeviceId).mockResolvedValue('0b3c5c8e-1111-4a4a-9b9b-00000000dead');
    const response = await fetch(base, { headers: { Authorization: 'Bearer test' } });
    expect((await response.json() as { default_device_id: unknown }).default_device_id).toBeNull();
  });

  it.each([KITCHEN, null])('sets or clears the default: %s', async (id) => {
    const response = await put({ id });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ default_device_id: id });
    expect(setDefaultDeviceId).toHaveBeenCalledWith('owner', id);
  });

  it('refuses another user’s device', async () => {
    vi.mocked(setDefaultDeviceId).mockResolvedValue(false);
    expect((await put({ id: KITCHEN })).status).toBe(404);
  });

  it.each([{}, { id: 'kitchen' }, { id: 42 }])('rejects an invalid id without touching the database: %j', async (body) => {
    expect((await put(body)).status).toBe(400);
    expect(setDefaultDeviceId).not.toHaveBeenCalled();
  });

  it('requires sign-in', async () => {
    expect((await put({ id: KITCHEN }, false)).status).toBe(401);
    expect(setDefaultDeviceId).not.toHaveBeenCalled();
  });
});
