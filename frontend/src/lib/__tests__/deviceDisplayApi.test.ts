import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDraftPreviewBmp, fetchPreviewBmp, fetchPreviewFrame, getPreferences, getPreviewData, savePreferences } from '../api';
import { DEFAULT_LAYOUT } from '../../types';
import { previewHeaders } from './previewFixtures';

afterEach(() => { vi.unstubAllGlobals(); });
describe('device display API scope', () => {
  it('loads and saves presentation only through the selected device endpoint', async () => {
    const request = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ preferences: { active_layout_id: 'page' }, inherited: false })));
    vi.stubGlobal('fetch', request);
    expect(await getPreferences('auth', 'device-a')).toMatchObject({ preferences: { active_layout_id: 'page' }, inherited: false });
    await savePreferences('auth', { active_layout_id: 'page' }, 'device-a');
    expect(request.mock.calls.map(([url]) => url)).toEqual(['/api/devices/device-a/display', '/api/devices/device-a/display']);
    expect(request.mock.calls[1][1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ active_layout_id: 'page' }), headers: { Authorization: 'Bearer auth' } });
  });
  it('passes device identity to BMP, JSON, raw BLE frames and draft previews', async () => {
    const request = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/raw')) return new Response(new Uint8Array(3904), { headers: previewHeaders('device-a') });
      return new Response(url.startsWith('/api/preview') ? '{}' : 'bmp', { headers: previewHeaders('device-a', url.endsWith('/draft')) });
    });
    vi.stubGlobal('fetch', request);
    const signal = new AbortController().signal;
    await fetchPreviewBmp('auth', signal, 'device-a');
    await getPreviewData('auth', 'device-a');
    await fetchPreviewFrame('auth', 'device-a');
    await fetchDraftPreviewBmp('auth', DEFAULT_LAYOUT, signal, 'device-a');
    expect(request.mock.calls.map(([url]) => url)).toEqual(['/api/image/preview?device_id=device-a', '/api/preview?device_id=device-a', '/api/image/preview/raw?device_id=device-a', '/api/image/preview/draft']);
    expect(request.mock.calls[0][1].signal).toBe(signal);
    expect(JSON.parse(request.mock.calls[3][1].body)).toEqual({ layout: DEFAULT_LAYOUT, device_id: 'device-a' });
  });
  it('does not fall back to shared preferences when a selected device is unavailable', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Device not found' }), { status: 404 }));
    vi.stubGlobal('fetch', request);
    await expect(getPreferences('auth', 'foreign-device')).rejects.toThrow('Device not found');
    expect(request).toHaveBeenCalledOnce();
  });
});
