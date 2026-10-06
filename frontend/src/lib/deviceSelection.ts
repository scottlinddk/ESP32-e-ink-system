import type { Device } from '../types';

/**
 * The device the dashboard edits. An explicit ?device= always wins, even when it is
 * unavailable, so a stale link is reported instead of silently replaced. Otherwise the
 * saved default opens, and a lone device needs no choice at all.
 */
export function resolveDashboardDeviceId(
  requestedId: string | null,
  devices: Device[] | undefined,
  defaultId: string | null | undefined,
): string | null {
  if (requestedId) return requestedId;
  if (!devices) return null;
  if (defaultId && devices.some((device) => device.id === defaultId)) return defaultId;
  return devices.length === 1 ? devices[0].id : null;
}
