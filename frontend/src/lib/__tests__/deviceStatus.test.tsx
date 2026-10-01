import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevicesPage } from '../../pages/DevicesPage';
import { STRINGS } from '../strings';
import type { Device } from '../../types';

const session = vi.hoisted(() => ({ userId: 'alice', lang: 'en' as 'en' | 'da' }));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: session.userId }, isSignedIn: true, getToken: async () => 'test-token' }),
}));
vi.mock('../appContext', () => ({ useApp: () => ({ t: STRINGS[session.lang], lang: session.lang, toast: vi.fn() }) }));
vi.mock('../../components/dashboard/DeviceDeliveryCard', () => ({ DeviceDeliveryCard: () => null }));

describe('device status header', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    session.userId = 'alice'; session.lang = 'en';
  });
  afterEach(() => { vi.useRealTimers(); });

  function renderDevice(fields: Partial<Device> = {}) {
    const client = new QueryClient();
    client.setQueryData(['devices', 'alice'], { devices: [{
      id: 'device-a', device_id: 'hardware-a', device_name: 'Kitchen', ble_name: null,
      license_key: null, firmware_version: null, last_seen_at: null, ...fields,
    }] });
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><DevicesPage /></QueryClientProvider>);
    client.clear();
    return html;
  }

  it('renders a device on a 30-minute heartbeat schedule online with its reported firmware', () => {
    const html = renderDevice({ last_seen_at: '2026-10-01T11:30:00Z', firmware_version: 'v1.2.3' });
    expect(html).toContain('>Online</span>');
    expect(html).toContain('<b>v1.2.3</b>');
    expect(html).toContain('<b>30m</b>');
    expect(html).not.toContain('Offline');
    expect(html).not.toContain('v1.0.0');
  });

  it.each([null, 'invalid-date'])('shows Never and Unknown for a missing or invalid report (%s)', (last_seen_at) => {
    const html = renderDevice({ last_seen_at });
    expect(html).toContain('>Unknown</span>');
    expect(html).toContain('<b>Never</b>');
    expect(html).toContain('<b>Unknown</b>');
    expect(html).not.toMatch(/69d|NaN|Offline|vnull/);
  });

  it.each([
    ['2026-10-01T10:59:00Z', 'Idle', '1h'],
    ['2026-09-30T12:00:00Z', 'Offline', '1d'],
  ])('preserves the existing status thresholds for real reports', (last_seen_at, status, age) => {
    const html = renderDevice({ last_seen_at, firmware_version: '1.0.0' });
    expect(html).toContain(`>${status}</span>`);
    expect(html).toContain(`<b>${age}</b>`);
    expect(html).toContain('<b>v1.0.0</b>');
  });

  it('localizes unreported status and age', () => {
    session.lang = 'da';
    const html = renderDevice();
    expect(html).toContain('>Ukendt</span>');
    expect(html).toContain('<b>Aldrig</b>');
  });

  it('does not show the previous account device telemetry after switching accounts', () => {
    session.userId = 'bob';
    const html = renderDevice({ firmware_version: 'ALICE_PRIVATE_FIRMWARE' });
    expect(html).not.toContain('Kitchen');
    expect(html).not.toContain('ALICE_PRIVATE_FIRMWARE');
  });
});
