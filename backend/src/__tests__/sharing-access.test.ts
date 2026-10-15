import { beforeEach, describe, expect, it, vi } from 'vitest';
import { redactForCollaborator, resolveDeviceAccess } from '../services/sharing';
import { DEFAULT_PREFS } from '../services/displayData';
import type { UserPreferences } from '../types';

const db = vi.hoisted(() => ({ device: null as unknown, share: null as unknown, shareError: null as unknown, from: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: db.from }) }));

const chain = (table: string) => {
  const query = { select: () => query, eq: () => query,
    maybeSingle: async () => (table === 'devices' ? { data: db.device, error: null } : { data: db.share, error: db.shareError }) };
  return query;
};
const DEVICE = '0b3c5c8e-1111-4a4a-9b9b-000000000001';

describe('device access', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://db.example.org');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
    db.device = { user_id: 'owner' }; db.share = null; db.shareError = null; db.from.mockImplementation(chain);
  });

  it('gives the owner full control', async () => {
    expect(await resolveDeviceAccess('owner', DEVICE, 'owner')).toEqual({ ownerId: 'owner', role: 'owner' });
  });
  it('resolves a collaborator to the owner’s data with their role', async () => {
    db.share = { role: 'viewer', owner_id: 'owner' };
    expect(await resolveDeviceAccess('friend', DEVICE, 'viewer')).toEqual({ ownerId: 'owner', role: 'viewer' });
  });
  it('lets a viewer look but not edit, and never manage', async () => {
    db.share = { role: 'viewer', owner_id: 'owner' };
    await expect(resolveDeviceAccess('friend', DEVICE, 'editor')).rejects.toMatchObject({ statusCode: 403 });
    await expect(resolveDeviceAccess('friend', DEVICE, 'owner')).rejects.toMatchObject({ statusCode: 403 });
    db.share = { role: 'editor', owner_id: 'owner' };
    expect((await resolveDeviceAccess('friend', DEVICE, 'editor')).role).toBe('editor');
    await expect(resolveDeviceAccess('friend', DEVICE, 'owner')).rejects.toMatchObject({ statusCode: 403 });
  });
  it('treats strangers, missing devices and a stale share as not found', async () => {
    await expect(resolveDeviceAccess('stranger', DEVICE)).rejects.toMatchObject({ statusCode: 404 });
    db.share = { role: 'editor', owner_id: 'previous-owner' };
    await expect(resolveDeviceAccess('friend', DEVICE)).rejects.toMatchObject({ statusCode: 404 });
    db.device = null;
    await expect(resolveDeviceAccess('owner', DEVICE)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('still serves owners before migration 027 is applied', async () => {
    db.shareError = { code: '42P01' };
    await expect(resolveDeviceAccess('friend', DEVICE)).rejects.toMatchObject({ statusCode: 404 });
    expect(await resolveDeviceAccess('owner', DEVICE)).toMatchObject({ role: 'owner' });
  });
});

describe('collaborator view of settings', () => {
  it('drops locations, feed URLs, notes and tokens-bearing settings', () => {
    const owner = { ...DEFAULT_PREFS, weather_location: '55.1,10.2', news_feed_url: 'https://example.org/private', custom_text: 'door code 1234',
      energy_price_settings: { grid_company: 'secret' }, show_weather: true, layout: null } as unknown as UserPreferences;
    const view = redactForCollaborator(owner) as unknown as Record<string, unknown>;
    expect(view.weather_location).toBe(DEFAULT_PREFS.weather_location);
    expect(view.news_feed_url).toBe(DEFAULT_PREFS.news_feed_url);
    expect(view.custom_text).toBe(DEFAULT_PREFS.custom_text);
    expect(view.custom_text).not.toBe('door code 1234');
    expect(view.energy_price_settings).toEqual(DEFAULT_PREFS.energy_price_settings);
    expect(view.show_weather).toBe(true);
  });
});
