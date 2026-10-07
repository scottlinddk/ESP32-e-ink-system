import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DisplayLayout } from '../types/index';
import { BmpCanvas, renderDisplayDataRaw } from '../utils/bmpGenerator';
import { parseDisplayLayout } from '../utils/layoutValidation';
import { formatWeekRange, isoWeekInfo } from '../utils/weekNumber';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('ISO week calculation', () => {
  it.each([
    ['2026-10-07T10:00:00Z', 41, 2026, '2026-10-05', '2026-10-11'],
    ['2026-01-01T10:00:00Z', 1, 2026, '2025-12-29', '2026-01-04'],
    // 2026 starts on a Thursday, so it has 53 weeks and its last week runs into 2027.
    ['2026-12-31T10:00:00Z', 53, 2026, '2026-12-28', '2027-01-03'],
    ['2027-01-03T10:00:00Z', 53, 2026, '2026-12-28', '2027-01-03'],
    ['2027-01-04T10:00:00Z', 1, 2027, '2027-01-04', '2027-01-10'],
    // The last days of a calendar year can already belong to week 1 of the next.
    ['2024-12-30T10:00:00Z', 1, 2025, '2024-12-30', '2025-01-05'],
  ])('puts %s in week %i of %i (%s to %s)', (instant, week, year, start, end) => {
    const info = isoWeekInfo(new Date(instant), 'Europe/Copenhagen');
    expect(info).toMatchObject({ week, year, weekStart: day(start), weekEnd: day(end) });
  });

  it('uses the display time zone to decide the date', () => {
    // Sunday 22:30 UTC is already Monday in Copenhagen.
    const instant = new Date('2026-10-04T22:30:00Z');
    expect(isoWeekInfo(instant, 'Europe/Copenhagen')).toMatchObject({ week: 41, weekday: 1 });
    expect(isoWeekInfo(instant, 'UTC')).toMatchObject({ week: 40, weekday: 7 });
  });

  it('counts the year 52 or 53 weeks long and fills to 100% on its last day', () => {
    expect(isoWeekInfo(new Date('2025-06-01T12:00:00Z'), 'UTC').weeksInYear).toBe(52);
    expect(isoWeekInfo(new Date('2026-06-01T12:00:00Z'), 'UTC').weeksInYear).toBe(53);
    expect(isoWeekInfo(new Date('2025-12-29T12:00:00Z'), 'UTC').progress).toBeCloseTo(1 / 371);
    expect(isoWeekInfo(new Date('2027-01-03T12:00:00Z'), 'UTC').progress).toBe(1);
  });

  it('formats the week as a date range across month ends', () => {
    expect(formatWeekRange(day('2026-10-05'), day('2026-10-11'))).toBe('Oct 5-11');
    expect(formatWeekRange(day('2026-09-28'), day('2026-10-04'))).toBe('Sep 28-Oct 4');
    expect(formatWeekRange(day('2026-12-28'), day('2027-01-03'))).toBe('Dec 28-Jan 3');
  });
});

describe('week number widget', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  const layout = (w: number, h: number): DisplayLayout => ({ version: 1, cols: 10, rows: 6, widgets: [{ i: 'week-number', x: 0, y: 0, w, h }] });
  const drawn = (w: number, h: number, display_timezone?: string) => {
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    renderDisplayDataRaw({ nextRefresh: 1000 }, layout(w, h), { display_timezone });
    return [...new Set(draw.mock.calls.map(([text]) => text))];
  };

  it('is accepted in saved layouts', () => {
    expect(parseDisplayLayout(layout(3, 2)).widgets[0].i).toBe('week-number');
  });

  it('shows the week, year, dates and progress when there is room', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    expect(drawn(10, 6)).toEqual(['WEEK', '2026', 'Oct 5-11', '76%', '41']);
  });

  it('falls back to a single line in a small widget', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    expect(drawn(3, 1)).toEqual(['Week 41']);
    expect(drawn(1, 1)).toEqual(['41']);
  });

  it('follows the display time zone', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-04T22:30:00Z'));
    expect(drawn(3, 1, 'Europe/Copenhagen')).toEqual(['Week 41']);
    expect(drawn(3, 1, 'UTC')).toEqual(['Week 40']);
  });

  it('draws the number white where it overlaps the filled part of the year', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    renderDisplayDataRaw({ nextRefresh: 1000 }, layout(10, 6));
    const number = draw.mock.calls.filter(([text]) => text === '41');
    expect(number.map((call) => call[5] ?? true)).toEqual([true, false]);
  });
});
