import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DisplayData, DisplayLayout } from '../types/index';
import { BmpCanvas, renderDisplayDataRaw } from '../utils/bmpGenerator';
import { batteryPercent, fillWidth } from '../utils/batteryRenderer';
import { parseDisplayLayout } from '../utils/layoutValidation';
import { layoutHasBattery, withReportedBattery } from '../services/deviceBattery';

const query = vi.hoisted(() => ({ result: { data: null as { battery_percent: number | null } | null, error: null as Error | null }, from: vi.fn() }));
vi.mock('../services/database', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      query.from(table);
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => query.result };
      return chain;
    },
  }),
}));

const COL_PX = 25;
const ROW_PX = 20;
const layout = (w: number, h: number, x = 0, y = 0): DisplayLayout => ({ version: 1, cols: 10, rows: 6, widgets: [{ i: 'battery', x, y, w, h }] });
const base: DisplayData = { nextRefresh: 1000 };

function blackCount(raw: Buffer, region: { x0: number; x1: number; y0: number; y1: number }): number {
  const rowBytes = 32;
  let count = 0;
  for (let y = region.y0; y < region.y1; y++) {
    for (let x = region.x0; x < region.x1; x++) {
      if (!(raw[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7)))) count++;
    }
  }
  return count;
}

describe('battery helpers', () => {
  it('rounds and clamps reported charge, and treats anything else as unknown', () => {
    expect(batteryPercent({ percent: 16.6 })).toBe(17);
    expect(batteryPercent({ percent: 0 })).toBe(0);
    expect(batteryPercent({ percent: 140 })).toBe(100);
    expect(batteryPercent({ percent: -3 })).toBe(0);
    expect(batteryPercent({ percent: Number.NaN })).toBeNull();
    expect(batteryPercent(undefined)).toBeNull();
  });

  it('fills proportionally, never showing a non-empty battery as empty', () => {
    expect(fillWidth(0, 40)).toBe(0);
    expect(fillWidth(100, 40)).toBe(40);
    expect(fillWidth(50, 40)).toBe(20);
    expect(fillWidth(17, 40)).toBe(7);
    expect(fillWidth(1, 40)).toBe(1);
    expect(fillWidth(1, 10)).toBe(1);
  });
});

describe('battery widget', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const drawn = (battery: DisplayData['battery'], w = 5, h = 2) => {
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    renderDisplayDataRaw({ ...base, battery }, layout(w, h));
    return [...new Set(draw.mock.calls.map(([text]) => text))];
  };

  it('is accepted in saved layouts', () => {
    expect(parseDisplayLayout(layout(3, 2)).widgets[0].i).toBe('battery');
  });

  it('shows the reported percentage', () => {
    expect(drawn({ percent: 17 })).toEqual(['17%']);
    expect(drawn({ percent: 100 })).toEqual(['100%']);
  });

  it('shows an unknown reading as --% with an empty cell, not as 0%', () => {
    expect(drawn(undefined)).toEqual(['--%', '?']);
  });

  it('fills more of the cell as the charge rises', () => {
    const region = { x0: 0, x1: 5 * COL_PX, y0: 0, y1: 2 * ROW_PX };
    const counts = [0, 17, 50, 100].map((percent) => blackCount(renderDisplayDataRaw({ ...base, battery: { percent } }, layout(5, 2)), region));
    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
    expect(counts[2]).toBeLessThan(counts[3]);
  });

  it.each([[2, 1], [3, 1], [5, 2], [10, 6]])('keeps a %ix%i widget inside its rectangle', (w, h) => {
    const x = 3, y = 2;
    for (const battery of [undefined, { percent: 17 }, { percent: 100 }]) {
      const raw = renderDisplayDataRaw({ ...base, battery }, layout(Math.min(w, 10 - x), Math.min(h, 6 - y), x, y));
      const whole = { x0: 0, x1: 250, y0: 0, y1: 122 };
      const inside = { x0: x * COL_PX, x1: (x + Math.min(w, 10 - x)) * COL_PX, y0: y * ROW_PX, y1: (y + Math.min(h, 6 - y)) * ROW_PX };
      expect(blackCount(raw, whole)).toBe(blackCount(raw, inside));
      expect(blackCount(raw, inside)).toBeGreaterThan(0);
    }
  });

  it('falls back to the cell alone, without text, when the widget is too narrow for both', () => {
    expect(drawn({ percent: 50 }, 1, 1)).toEqual([]);
    const raw = renderDisplayDataRaw({ ...base, battery: { percent: 50 } }, layout(1, 1));
    expect(blackCount(raw, { x0: 0, x1: COL_PX, y0: 0, y1: ROW_PX })).toBeGreaterThan(0);
    expect(blackCount(raw, { x0: 0, x1: 250, y0: 0, y1: 122 })).toBe(blackCount(raw, { x0: 0, x1: COL_PX, y0: 0, y1: ROW_PX }));
  });
});

describe('battery in the status bar', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  // Pinned to top left, where the bar draws on its own, so these tests compare drawing and not placement.
  const status = (w: number): DisplayLayout => ({ version: 1, cols: 10, rows: 6, widgets: [{ i: 'status', x: 0, y: 5, w, h: 1, options: { align: 'top-left' } }] });
  const render = (battery: DisplayData['battery'], w: number) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T10:00:00Z'));
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    const raw = renderDisplayDataRaw({ ...base, battery }, status(w));
    return { raw, texts: draw.mock.calls.map(([text]) => text) };
  };
  const row = { x0: 0, x1: 250, y0: 5 * ROW_PX, y1: 6 * ROW_PX };

  it('adds the percentage and cell beside the refresh text', () => {
    expect(render({ percent: 17 }, 10).texts).toEqual(['Refresh: 0min  12:00', '17%']);
  });

  it('stays as before without a reading, instead of showing --%', () => {
    expect(render(undefined, 10).texts).toEqual(['Refresh: 0min  12:00']);
  });

  it('adds black pixels only to the right of the refresh text', () => {
    const without = render(undefined, 10).raw;
    const withBattery = render({ percent: 17 }, 10).raw;
    expect(blackCount(withBattery, row)).toBeGreaterThan(blackCount(without, row));
    // Everything left of the battery is unchanged.
    const left = { ...row, x1: 250 - 52 };
    expect(blackCount(withBattery, left)).toBe(blackCount(without, left));
  });

  it('is left out when it would not fit beside the refresh text', () => {
    expect(render({ percent: 17 }, 7).texts).toEqual(['Refresh: 0min  12:00']);
  });
});

describe('reported battery lookup', () => {
  beforeEach(() => { query.from.mockClear(); query.result = { data: { battery_percent: 17 }, error: null }; });

  it('detects the widget in a layout', () => {
    expect(layoutHasBattery(layout(2, 1))).toBe(true);
    expect(layoutHasBattery({ ...layout(2, 1), widgets: [{ i: 'status', x: 0, y: 0, w: 2, h: 1 }] })).toBe(true);
    expect(layoutHasBattery({ ...layout(2, 1), widgets: [{ i: 'energy', x: 0, y: 0, w: 2, h: 1 }] })).toBe(false);
    expect(layoutHasBattery(null)).toBe(false);
  });

  it('adds the device reading only when the layout shows the battery', async () => {
    expect(await withReportedBattery(base, layout(2, 1), 'owner', 'device')).toMatchObject({ battery: { percent: 17 } });
    expect(await withReportedBattery(base, { ...layout(2, 1), widgets: [] }, 'owner', 'device')).toBe(base);
    expect(query.from).toHaveBeenCalledTimes(1);
  });

  it('skips the lookup without a device, such as a dashboard preview for no device', async () => {
    expect(await withReportedBattery(base, layout(2, 1), 'owner', undefined)).toBe(base);
    expect(query.from).not.toHaveBeenCalled();
  });

  it('leaves the reading absent when none was reported or the lookup fails', async () => {
    query.result = { data: { battery_percent: null }, error: null };
    expect(await withReportedBattery(base, layout(2, 1), 'owner', 'device')).toBe(base);
    query.result = { data: null, error: new Error('database down') };
    expect(await withReportedBattery(base, layout(2, 1), 'owner', 'device')).toBe(base);
  });
});
