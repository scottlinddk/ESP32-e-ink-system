import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { verifyToken } from '@clerk/backend';
import preferencesRouter from '../routes/preferences';
import { getOrCreateUserFromClerk } from '../routes/preferences-helpers';
import { upsertPreferences } from '../services/database';
import { DEFAULT_PREFS } from '../services/displayData';

vi.mock('@clerk/backend', () => ({ verifyToken: vi.fn() }));
vi.mock('../routes/preferences-helpers', () => ({ getOrCreateUserFromClerk: vi.fn() }));
vi.mock('../services/database', () => ({ getPreferences: vi.fn(), upsertPreferences: vi.fn(), getApiKeys: vi.fn(), upsertApiKey: vi.fn(), deleteApiKey: vi.fn() }));
vi.mock('../lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
const schedule = { enabled: true, timezone: 'Europe/Copenhagen',
  pages: [{ id: 'home', name: 'Home', duration_seconds: 300, layout: { version: 1, cols: 10, rows: 6, widgets: [] } }],
  quiet_hours: { enabled: true, start: '22:00', end: '07:00' },
};
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('CLERK_SECRET_KEY', 'test-only');
  vi.mocked(verifyToken).mockResolvedValue({ sub: 'clerk-owner' } as Awaited<ReturnType<typeof verifyToken>>);
  vi.mocked(getOrCreateUserFromClerk).mockResolvedValue('owner');
  vi.mocked(upsertPreferences).mockResolvedValue(DEFAULT_PREFS);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('schedule preference writes', () => {
  let server: Server;
  let url: string;
  beforeAll(async () => {
    const app = express(); app.use(express.json()); app.use('/preferences', preferencesRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/preferences`;
  });
  afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });
  function post(body: unknown, auth = true) {
    return fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer token' } : {}) } });
  }
  it('persists a complete validated schedule for the authenticated user', async () => {
    expect((await post({ display_schedule: schedule })).status).toBe(200);
    expect(upsertPreferences).toHaveBeenCalledWith('owner', { display_schedule: schedule });
    expect(upsertPreferences).toHaveBeenCalledTimes(1);
  });
  it.each([null, { ...schedule, enabled: false, pages: [] }])('allows disabling a schedule', async (display_schedule) => {
    expect((await post({ display_schedule })).status).toBe(200);
    expect(upsertPreferences).toHaveBeenCalledWith('owner', { display_schedule });
  });
  it('does not save any other fields when the schedule is invalid', async () => {
    expect((await post({ show_weather: false, display_schedule: { ...schedule, pages: [] } })).status).toBe(400);
    expect(getOrCreateUserFromClerk).not.toHaveBeenCalled();
    expect(upsertPreferences).not.toHaveBeenCalled();
  });
  it('rejects malformed page geometry', async () => {
    const invalid = { ...schedule, pages: [{ ...schedule.pages[0], layout: { version: 1, cols: 10, rows: 6, widgets: [{ i: 'energy', x: -1, y: 0, w: 10, h: 6 }] } }] };
    expect((await post({ display_schedule: invalid })).status).toBe(400);
    expect(upsertPreferences).not.toHaveBeenCalled();
  });
  it('requires authentication', async () => {
    expect((await post({ display_schedule: schedule }, false)).status).toBe(401);
    expect(upsertPreferences).not.toHaveBeenCalled();
  });
});
