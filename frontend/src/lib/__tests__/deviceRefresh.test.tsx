import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceRefreshControl, deviceRefreshPending } from '../../components/dashboard/DeviceRefreshControl';
import { getDeviceDeliveryStatus, requestDeviceRefresh, type DeviceDeliveryStatus } from '../api';

const session = vi.hoisted(() => ({ id: 'alice', signedIn: true, lang: 'en' as 'en' | 'da' }));
const observed = vi.hoisted(() => ({ mutation: null as null | (() => Promise<DeviceDeliveryStatus>) }));
vi.mock('@tanstack/react-query', async (original) => {
  const actual = await original<typeof import('@tanstack/react-query')>();
  return { ...actual, useMutation: (options: Parameters<typeof actual.useMutation>[0]) => {
    observed.mutation = options.mutationFn as unknown as () => Promise<DeviceDeliveryStatus>;
    return actual.useMutation(options);
  } };
});
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: session.id }, isSignedIn: session.signedIn, getToken: async () => 'auth' }) }));
vi.mock('../appContext', () => ({ useApp: () => ({ lang: session.lang }) }));
beforeEach(() => { session.id = 'alice'; session.signedIn = true; session.lang = 'en'; });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const idle: DeviceDeliveryStatus = {
  configured: true, rotatedAt: null, lastSeenAt: '2026-10-02T10:00:00.000Z', firmwareVersion: '1.0',
  batteryPercent: 0, rssi: -50, lastAppliedHash: 'previous-image',
  refreshRequestId: null, refreshRequestedAt: null, refreshAppliedAt: null,
};
const queued: DeviceDeliveryStatus = { ...idle, refreshRequestId: 'request-one', refreshRequestedAt: '2026-10-02T12:34:56.000Z' };
const applied: DeviceDeliveryStatus = { ...queued, refreshAppliedAt: '2026-10-02T12:36:00.000Z' };

function render(report?: DeviceDeliveryStatus, deviceId = 'kitchen', failed = false) {
  const client = new QueryClient();
  const key = ['device-delivery', 'alice', 'kitchen'];
  if (report) client.setQueryData(key, report);
  if (failed) client.getQueryCache().find({ queryKey: key })!.setState({ status: 'error', error: new Error('Status unavailable') });
  const html = renderToStaticMarkup(<MemoryRouter><QueryClientProvider client={client}>
    <DeviceRefreshControl deviceId={deviceId} deviceName="Kitchen display" hardwareId="ESP32-12AB" timezone="UTC" />
  </QueryClientProvider></MemoryRouter>);
  client.clear();
  return html;
}

describe('selected device update control', () => {
  it('offers a separate screen update for the identified configured device', () => {
    const html = render(idle);
    expect(html).toContain('Kitchen display · ESP32-12AB');
    expect(html).toContain('Update device screen');
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('does not wake a sleeping display');
    expect(html).toContain('next scheduled check-in may be after quiet hours');
    expect(html).toContain('can override quiet hours');
    expect(html).not.toContain('device reported applying');
  });

  it('shows queued state without interpreting an earlier applied image as success', () => {
    const html = render(queued);
    expect(html).toContain('Queued — waiting for the next device check-in.');
    expect(html).toContain('dateTime="2026-10-02T12:34:56.000Z"');
    expect(html).toContain('Check status');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Update device screen/);
    expect(html).not.toContain('device reported applying');
  });

  it('acknowledges only the current request’s reported apply and permits another request', () => {
    const html = render(applied);
    expect(html).toContain('The device reported applying the update.');
    expect(html).toContain('dateTime="2026-10-02T12:36:00.000Z"');
    expect(html).not.toContain('Queued');
    expect(html).not.toContain('disabled=""');
  });

  it('requires configured delivery and links directly to the selected device setup', () => {
    const html = render({ ...idle, configured: false });
    expect(html).toContain('Set up automatic updates first.');
    expect(html).toContain('href="/devices#device-kitchen"');
    expect(html).toContain('disabled=""');
  });

  it('does not reuse another device or account’s queued state', () => {
    expect(render(queued, 'office')).not.toContain('Queued');
    expect(render(queued, 'office')).toContain('Loading delivery status');
    session.id = 'bob';
    expect(render(applied)).not.toContain('device reported applying');
    session.signedIn = false;
    expect(render(queued)).toBe('');
  });

  it('gates updates and offers retry when status fails, even with cached success', () => {
    const html = render(applied, 'kitchen', true);
    expect(html).toContain('Could not load delivery status.');
    expect(html).toContain('Status unavailable');
    expect(html).toContain('Check status');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('device reported applying');
  });

  it('remounts and disposes in-flight requests when account or device changes', () => {
    const props = { deviceId: 'kitchen', timezone: 'UTC' };
    const key = DeviceRefreshControl(props)!.key;
    expect(DeviceRefreshControl({ ...props, deviceId: 'office' })!.key).not.toBe(key);
    session.id = 'bob';
    expect(DeviceRefreshControl(props)!.key).not.toBe(key);
  });

  it('renders Danish controls and queued status', () => {
    session.lang = 'da';
    const html = render(queued);
    expect(html).toContain('Opdatér enhedens skærm');
    expect(html).toContain('I kø — venter på næste kontakt fra enheden.');
    expect(html).toContain('Den vækker ikke en sovende skærm');
  });

  it('polls only an active configured request that has no apply acknowledgement', () => {
    expect(deviceRefreshPending(queued)).toBe(true);
    for (const report of [undefined, idle, applied, { ...queued, configured: false }]) expect(deviceRefreshPending(report)).toBe(false);
    // A later request supersedes the acknowledgement of the earlier request.
    expect(deviceRefreshPending({ ...applied, refreshRequestId: 'request-two', refreshAppliedAt: null })).toBe(true);
  });
});

describe('manual device update API', () => {
  it('prevents a status read started during POST from replacing the accepted queued result', async () => {
    const client = new QueryClient();
    const queryKey = ['device-delivery', 'alice', 'kitchen'];
    client.setQueryData(queryKey, idle);
    renderToStaticMarkup(<MemoryRouter><QueryClientProvider client={client}>
      <DeviceRefreshControl deviceId="kitchen" timezone="UTC" />
    </QueryClientProvider></MemoryRouter>);
    let accept!: () => void;
    let started!: () => void;
    const requesting = new Promise<void>((resolve) => { started = resolve; });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise((resolve) => {
      accept = () => resolve(new Response(JSON.stringify(queued), { status: 202 })); started();
    })));
    const update = observed.mutation!();
    await requesting;
    let completeOldRead!: () => void;
    const oldRead = client.fetchQuery({ queryKey, queryFn: () => new Promise<DeviceDeliveryStatus>((resolve) => {
      completeOldRead = () => resolve(idle);
    }) }).catch(() => undefined);
    accept(); await update;
    completeOldRead(); await oldRead;
    expect(client.getQueryData(queryKey)).toEqual(queued);
    client.clear();
  });

  it('uses only the selected device endpoint and returns accepted status without claiming apply', async () => {
    const request = vi.fn().mockImplementation(async () => new Response(JSON.stringify(queued), { status: 202 }));
    vi.stubGlobal('fetch', request);
    const signal = new AbortController().signal;
    expect(await requestDeviceRefresh('auth', 'kitchen', signal)).toEqual(queued);
    expect(request).toHaveBeenCalledWith('/api/devices/kitchen/refresh', {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer auth' },
    });
    await getDeviceDeliveryStatus('auth', 'office', signal);
    expect(request.mock.calls[1][0]).toBe('/api/devices/office/delivery');
    expect(request.mock.calls[1][1].signal).toBe(signal);
  });

  it.each([404, 409, 503])('preserves an actionable HTTP %s error and never falls back to another device', async (status) => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Device cannot accept this request' }), { status }));
    vi.stubGlobal('fetch', request);
    await expect(requestDeviceRefresh('auth', 'selected-device')).rejects.toMatchObject({ status, message: 'Device cannot accept this request' });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toBe('/api/devices/selected-device/refresh');
  });

  it.each(['status', 'request'])('rejects late %s results after the selected workspace was disposed', async (kind) => {
    const response = new Response('{}');
    let finish!: () => void;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => { started = resolve; });
    vi.spyOn(response, 'json').mockImplementation(() => new Promise((resolve) => { finish = () => resolve(applied); started(); }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const controller = new AbortController();
    const pending = kind === 'status' ? getDeviceDeliveryStatus('auth', 'kitchen', controller.signal)
      : requestDeviceRefresh('auth', 'kitchen', controller.signal);
    await reading;
    controller.abort(); finish();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
