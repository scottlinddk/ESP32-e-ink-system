import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from '../../pages/DashboardPage';
import { DeviceLayoutsCard } from '../../components/dashboard/DeviceLayoutsCard';
import { DevicesPage } from '../../pages/DevicesPage';
import { STRINGS } from '../strings';
import { DEFAULT_LAYOUT } from '../../types';

const session = vi.hoisted(() => ({ userId: 'alice', signedIn: true, lang: 'en' as 'en' | 'da' }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: session.userId }, isSignedIn: session.signedIn, getToken: async () => 'auth' }) }));
vi.mock('../appContext', () => ({ useApp: () => ({ t: STRINGS[session.lang], lang: session.lang, toast: vi.fn() }) }));
vi.mock('../../components/dashboard/DeviceDeliveryCard', () => ({ DeviceDeliveryCard: () => null }));
beforeEach(() => { session.userId = 'alice'; session.signedIn = true; session.lang = 'en'; });

function render(path: string, content: React.ReactNode = <DashboardPage />, failed = false) {
  const client = new QueryClient();
  client.setQueryData(['devices', 'alice'], { devices: [{ id: 'kitchen', device_name: 'Kitchen display', device_id: 'hardware' }, { id: 'office', device_name: 'Office display', device_id: 'other' }] });
  client.setQueryData(['preferences', 'alice'], { layout: DEFAULT_LAYOUT });
  for (const id of ['kitchen', 'office']) client.setQueryData(['preferences', 'alice', id], { layout: DEFAULT_LAYOUT, display_timezone: 'UTC',
    active_layout_id: `${id}-one`, display_schedule: { enabled: false, timezone: 'UTC', quiet_hours: { enabled: false, start: '22:00', end: '07:00' },
      pages: [{ id: `${id}-one`, name: `${id} saved layout`, duration_seconds: 60, layout: DEFAULT_LAYOUT }] } });
  if (failed) client.getQueryCache().find({ queryKey: ['preferences', 'alice', 'kitchen'] })!.setState({ status: 'error', error: new Error('offline') });
  const html = renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}>{content}</QueryClientProvider></MemoryRouter>);
  client.clear();
  return html;
}

describe('selected device workspaces', () => {
  it('names the selected device, renders only its saved layouts, and keeps editor links scoped', () => {
    const html = render('/dashboard?device=kitchen');
    expect(html).toContain('Device: Kitchen display');
    expect(html).toContain('kitchen saved layout');
    expect(html).not.toContain('office saved layout');
    expect(html).toContain('/layout?device=kitchen&amp;page=kitchen-one');
    expect(html).toContain('Shared content and defaults');
  });
  it.each(['/dashboard?device=foreign', '/dashboard'])('does not silently pick or edit another device for %s', (path) => {
    const html = render(path);
    expect(html).not.toContain('kitchen saved layout');
    expect(html).not.toContain('office saved layout');
    expect(html).not.toContain('Saved layouts on this device');
    expect(html).toContain(path.includes('foreign') ? 'This device is not available on your account' : 'Choose a device to see its layouts');
  });
  it('hides device forms and preview when its settings fail to load, even with cached data', () => {
    const html = render('/dashboard?device=kitchen', undefined, true);
    expect(html).toContain('Could not load this device');
    expect(html).not.toContain('Saved layouts on this device');
    expect(html).not.toContain('Save display profile');
  });
  it('shows assigned layouts and an explicit Open device link in the device list', () => {
    const html = render('/devices', <DevicesPage />);
    expect(html).toContain('Layout: kitchen saved layout');
    expect(html).toContain('Layout: office saved layout');
    expect(html).toContain('href="/dashboard?device=kitchen"');
  });
  it('does not display another account’s devices or settings', () => {
    session.userId = 'bob';
    const html = render('/dashboard?device=kitchen');
    expect(html).not.toContain('Kitchen display');
    expect(html).not.toContain('kitchen saved layout');
    session.signedIn = false;
    expect(render('/dashboard?device=kitchen')).toBe('');
  });
  it('localizes the selected-device library controls', () => {
    session.lang = 'da';
    const html = render('/dashboard?device=kitchen', <DeviceLayoutsCard deviceId="kitchen" />);
    expect(html).toContain('Gemte layouts på denne enhed');
    expect(html).toContain('Navn på nyt layout');
    expect(html).toContain('Valgt');
  });
});
