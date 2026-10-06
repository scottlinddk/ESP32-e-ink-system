import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveDashboardDeviceId } from '../deviceSelection';
import { setDefaultDevice } from '../api';
import type { Device } from '../../types';

const device = (id: string) => ({ id }) as Device;
afterEach(() => { vi.unstubAllGlobals(); });

describe('dashboard device selection', () => {
  it.each([
    ['explicit choice wins over the default', 'a', [device('a'), device('b')], 'b', 'a'],
    ['a stale explicit choice is kept so it can be reported', 'gone', [device('a')], 'a', 'gone'],
    ['the saved default opens', null, [device('a'), device('b')], 'b', 'b'],
    ['a lone device opens', null, [device('a')], null, 'a'],
    ['a removed default falls back to a lone device', null, [device('a')], 'gone', 'a'],
    ['several devices without a default need a choice', null, [device('a'), device('b')], null, null],
    ['nothing is chosen before devices load', null, undefined, 'a', null],
    ['no devices means no selection', null, [], null, null],
  ] as const)('%s', (_, requested, devices, defaultId, expected) => {
    expect(resolveDashboardDeviceId(requested, devices ? [...devices] : undefined, defaultId)).toBe(expected);
  });

  it('saves or clears the default with account auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ default_device_id: null })));
    vi.stubGlobal('fetch', fetchMock);
    expect(await setDefaultDevice('auth', null)).toEqual({ default_device_id: null });
    expect(fetchMock).toHaveBeenCalledWith('/api/devices/default', {
      method: 'PUT', body: JSON.stringify({ id: null }),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer auth' },
    });
  });
});
