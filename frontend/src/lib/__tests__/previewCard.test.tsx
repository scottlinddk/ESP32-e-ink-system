import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewCard } from '../../components/dashboard/PreviewCard';
import { STRINGS } from '../strings';
import type { PreviewImage } from '../previewMetadata';

const session = vi.hoisted(() => ({ userId: 'alice', lang: 'en' as 'en' | 'da' }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: session.userId }, isSignedIn: true, getToken: async () => 'auth' }) }));
vi.mock('../appContext', () => ({ useApp: () => ({ t: STRINGS[session.lang], lang: session.lang }) }));
beforeEach(() => { session.userId = 'alice'; session.lang = 'en'; });

function render(deviceId = 'kitchen', failed = false) {
  const client = new QueryClient();
  const image: PreviewImage = { blob: new Blob(['bmp']), metadata: {
    deviceId: 'kitchen', layoutId: 'evening', layoutName: 'Rendered evening page', mode: 'slideshow', quiet: true,
    renderedAt: '2026-10-02T12:34:56.000Z', nextTransition: '2026-10-03T05:00:00.000Z',
    profile: { width: 400, height: 300, rotation: 90, colorMode: 'bw' },
  } };
  const queryKey = ['preview', 'alice', 'kitchen', 'bmp'];
  client.setQueryData(queryKey, image);
  // Settings may already have changed while the displayed image is still the previous render.
  client.setQueryData(['preferences', 'alice', 'kitchen'], { display_timezone: 'UTC', active_layout_id: 'new-page',
    display_profile: { width: 250, height: 122 }, display_schedule: { enabled: false, pages: [{ id: 'new-page', name: 'Unsynced new page' }] } });
  if (failed) client.getQueryCache().find({ queryKey })!.setState({ status: 'error', error: new Error('offline') });
  const html = renderToStaticMarkup(<MemoryRouter><QueryClientProvider client={client}>
    <PreviewCard deviceId={deviceId} deviceName="Display" hardwareId="esp32-kitchen" expectedDeviceName="EINK-KITCHEN" />
  </QueryClientProvider></MemoryRouter>);
  client.clear();
  return html;
}

describe('preview identity and labels', () => {
  it('describes the exact rendered image rather than newer saved settings', () => {
    const html = render();
    expect(html).toContain('Rendered layout: Rendered evening page');
    expect(html).toContain('Slideshow · Quiet hours');
    expect(html).toContain('400 × 300 px · 90° · 1-bit');
    expect(html).toContain('dateTime="2026-10-02T12:34:56.000Z"');
    expect(html).toContain('dateTime="2026-10-03T05:00:00.000Z"');
    expect(html).not.toContain('Unsynced new page');
    expect(html).toContain('esp32-kitchen');
    expect(html).toContain('UUID: <code>kitchen');
    expect(html).toContain('Refresh preview');
    expect(html).not.toContain('Refresh now');
    expect(html).toContain('does not confirm what the physical display has received');
    expect(html).toContain('Bluetooth name must be EINK-KITCHEN');
  });

  it('keeps the previous image’s labels after a refresh failure', () => {
    const html = render('kitchen', true);
    expect(html).toContain('Rendered evening page');
    expect(html).toContain('offline');
    expect(html).not.toContain('Unsynced new page');
  });

  it('does not display cached labels for another device or account', () => {
    expect(render('office')).not.toContain('Rendered evening page');
    session.userId = 'bob';
    expect(render()).not.toContain('Rendered evening page');
  });

  it('remounts on device/account changes so image URLs and transfers are disposed', () => {
    const kitchenKey = PreviewCard({ deviceId: 'kitchen' }).key;
    expect(PreviewCard({ deviceId: 'office' }).key).not.toBe(kitchenKey);
    session.userId = 'bob';
    expect(PreviewCard({ deviceId: 'kitchen' }).key).not.toBe(kitchenKey);
  });

  it('localizes the metadata and refresh action', () => {
    session.lang = 'da';
    const html = render();
    expect(html).toContain('Gengivet layout: Rendered evening page');
    expect(html).toContain('Stille timer');
    expect(html).toContain('Opdatér forhåndsvisning');
  });
});
