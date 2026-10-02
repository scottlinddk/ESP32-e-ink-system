import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPreviewMetadata } from '../previewMetadata';
import { fetchDraftPreviewBmp, fetchPreviewBmp, fetchPreviewFrame } from '../api';
import { DEFAULT_LAYOUT } from '../../types';
import { previewHeaders } from './previewFixtures';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('preview response metadata', () => {
  it('keeps the pixels, exact slideshow page, Unicode name and display size together', async () => {
    const headers = { ...previewHeaders('kitchen'),
      'X-Preview-Layout-ID': 'evening', 'X-Preview-Layout-Name': encodeURIComponent('Aften · Køkken'),
      'X-Preview-Mode': 'slideshow', 'X-Preview-Quiet': 'true',
      'X-Preview-Next-Transition': '2026-10-03T05:00:00.000Z',
      'X-Display-Width': '400', 'X-Display-Height': '300', 'X-Display-Rotation': '90', 'X-Display-Row-Bytes': '50',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('exact pixels', { headers })));
    const result = await fetchPreviewBmp('auth', undefined, 'kitchen');
    expect(await result.blob.text()).toBe('exact pixels');
    expect(result.metadata).toEqual({ deviceId: 'kitchen', layoutId: 'evening', layoutName: 'Aften · Køkken',
      mode: 'slideshow', quiet: true, renderedAt: '2026-10-02T12:34:56.000Z', nextTransition: '2026-10-03T05:00:00.000Z',
      profile: { width: 400, height: 300, rotation: 90, colorMode: 'bw' } });
  });

  it.each([
    ['missing device', 'X-Preview-Device-ID', null],
    ['missing size', 'X-Display-Width', null],
    ['bad row size', 'X-Display-Row-Bytes', '31'],
    ['bad encoding', 'X-Display-Encoding', 'rgb'],
    ['bad rotation', 'X-Display-Rotation', '45'],
    ['bad time', 'X-Preview-Rendered-At', 'yesterday'],
    ['bad URI encoding', 'X-Preview-Layout-Name', '%FF'],
    ['empty name', 'X-Preview-Layout-Name', ''],
    ['unidentified slideshow', 'X-Preview-Mode', 'slideshow'],
    ['wrong response kind', 'X-Preview-Mode', 'draft'],
    ['impossible fixed quiet hours', 'X-Preview-Quiet', 'true'],
  ])('rejects %s without guessing labels or size', (_name, key, value) => {
    const headers = new Headers(previewHeaders('kitchen'));
    if (value === null) headers.delete(key!); else headers.set(key!, value!);
    expect(() => readPreviewMetadata(headers, 'kitchen')).toThrow();
  });

  it('distinguishes explicitly shared defaults from a selected device', () => {
    expect(readPreviewMetadata(new Headers(previewHeaders())).deviceId).toBeNull();
    expect(() => readPreviewMetadata(new Headers(previewHeaders()), 'kitchen')).toThrow('does not match');
    expect(() => readPreviewMetadata(new Headers(previewHeaders('kitchen')))).toThrow('does not match');
  });

  it.each(['bmp', 'raw', 'draft'] as const)('rejects another device’s %s before consuming pixels', async (kind) => {
    const response = new Response('wrong device pixels', { headers: previewHeaders('office', kind === 'draft') });
    const blob = vi.spyOn(response, 'blob');
    const arrayBuffer = vi.spyOn(response, 'arrayBuffer');
    const cancel = vi.spyOn(response.body!, 'cancel');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const pending = kind === 'bmp' ? fetchPreviewBmp('auth', undefined, 'kitchen')
      : kind === 'raw' ? fetchPreviewFrame('auth', 'kitchen') : fetchDraftPreviewBmp('auth', DEFAULT_LAYOUT, undefined, 'kitchen');
    await expect(pending).rejects.toThrow('does not match');
    expect(blob).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(['bmp', 'raw', 'draft'] as const)('rejects late %s pixels after navigation cancels the request', async (kind) => {
    const response = new Response('', { headers: previewHeaders('kitchen', kind === 'draft') });
    let finish!: () => void;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => { started = resolve; });
    if (kind === 'raw') vi.spyOn(response, 'arrayBuffer').mockImplementation(() => new Promise((resolve) => {
      finish = () => resolve(new ArrayBuffer(3904)); started();
    }));
    else vi.spyOn(response, 'blob').mockImplementation(() => new Promise((resolve) => {
      finish = () => resolve(new Blob(['late pixels'])); started();
    }));
    const request = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', request);
    const controller = new AbortController();
    const pending = kind === 'bmp' ? fetchPreviewBmp('auth', controller.signal, 'kitchen')
      : kind === 'raw' ? fetchPreviewFrame('auth', 'kitchen', controller.signal) : fetchDraftPreviewBmp('auth', DEFAULT_LAYOUT, controller.signal, 'kitchen');
    await reading;
    controller.abort(); finish();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(request.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('rejects truncated raw frames instead of sending them over Bluetooth', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(12), { headers: previewHeaders('kitchen') })));
    await expect(fetchPreviewFrame('auth', 'kitchen')).rejects.toThrow('Invalid display image metadata');
  });
});
