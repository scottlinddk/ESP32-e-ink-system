import { getSupabaseClient } from './database';
import { logger } from '../lib/logger';
import type { DisplayData, DisplayLayout } from '../types/index';

/** Whether a layout places the battery widget, so frames without it never query the database. */
export function layoutHasBattery(layout: DisplayLayout | null | undefined): boolean {
  return Boolean(layout?.widgets.some((widget) => widget.i === 'battery'));
}

/** The charge a device last reported, or undefined if it never reported or the lookup failed. */
export async function loadReportedBattery(owner: string, deviceId: string): Promise<DisplayData['battery']> {
  try {
    const { data, error } = await getSupabaseClient().from('device_delivery')
      .select('battery_percent').eq('device_id', deviceId).eq('owner_id', owner).maybeSingle();
    if (error) throw error;
    const percent = data?.battery_percent;
    return typeof percent === 'number' ? { percent } : undefined;
  } catch (error) {
    // Like any other source, a failed reading stays absent instead of failing the whole frame.
    logger.warn({ err: error }, 'Unable to load reported device battery');
    return undefined;
  }
}

/** Adds the device's reported battery to `data` when the layout shows it. */
export async function withReportedBattery(
  data: DisplayData, layout: DisplayLayout | null | undefined, owner: string, deviceId: string | undefined
): Promise<DisplayData> {
  if (!deviceId || !layoutHasBattery(layout)) return data;
  const battery = await loadReportedBattery(owner, deviceId);
  return battery ? { ...data, battery } : data;
}
