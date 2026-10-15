import { describe, expect, it } from 'vitest';
import { calendarFetchRange, dayOfMonth, daysBetween, isCalendarDay, localDay, monthGrid, monthName, shiftDay, weekdayIndex, weekdayName } from '../utils/calendarDays';

describe('calendar day arithmetic', () => {
  it('validates real calendar days only', () => {
    expect(isCalendarDay('2026-10-15')).toBe(true);
    expect(isCalendarDay('2028-02-29')).toBe(true);
    for (const value of ['2026-02-29', '2026-13-01', '2026-10-32', '2026-1-1', '20261015', '', null, 5]) expect(isCalendarDay(value)).toBe(false);
  });
  it('shifts across month, year and leap-day boundaries', () => {
    expect(shiftDay('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftDay('2026-10-15', 0)).toBe('2026-10-15');
    expect(daysBetween('2026-10-15', '2026-10-18')).toBe(3);
    expect(daysBetween('2026-10-15', '2026-10-12')).toBe(-3);
  });
  it('is not affected by daylight saving', () => {
    expect(shiftDay('2026-03-28', 1)).toBe('2026-03-29');
    expect(shiftDay('2026-03-29', 1)).toBe('2026-03-30');
    expect(shiftDay('2026-10-24', 2)).toBe('2026-10-26');
    expect(daysBetween('2026-10-01', '2026-11-01')).toBe(31);
  });
  it('starts weeks on Monday', () => {
    expect(weekdayIndex('2026-10-12')).toBe(0);
    expect(weekdayIndex('2026-10-18')).toBe(6);
    expect(weekdayName('2026-10-15')).toBe('Thu');
    expect(monthName('2026-10-15')).toBe('October');
    expect(dayOfMonth('2026-10-05')).toBe(5);
  });
  it('finds the calendar day of an instant in a time zone', () => {
    const instant = new Date('2026-10-14T22:30:00Z');
    expect(localDay(instant, 'Europe/Copenhagen')).toBe('2026-10-15');
    expect(localDay(instant, 'UTC')).toBe('2026-10-14');
    expect(localDay(instant, 'Pacific/Honolulu')).toBe('2026-10-14');
  });
});

describe('month grid', () => {
  it('holds whole Monday-first weeks around the month', () => {
    expect(monthGrid('2026-10-15')).toEqual({ start: '2026-09-28', end: '2026-11-01', first: '2026-10-01', last: '2026-10-31', weeks: 5 });
  });
  it('needs four weeks for a February that starts on a Monday', () => {
    expect(monthGrid('2027-02-10')).toMatchObject({ start: '2027-02-01', end: '2027-02-28', weeks: 4 });
  });
  it('needs six weeks when a long month starts late in the week', () => {
    expect(monthGrid('2026-08-10')).toMatchObject({ start: '2026-07-27', end: '2026-09-06', weeks: 6 });
  });
  it('handles December and the turn of the year', () => {
    expect(monthGrid('2026-12-31')).toMatchObject({ first: '2026-12-01', last: '2026-12-31', end: '2027-01-03' });
  });
});

describe('what to fetch', () => {
  it('covers the month grid and the horizon, whichever reaches further', () => {
    expect(calendarFetchRange('2026-10-15', 7)).toEqual({ from: '2026-09-28', to: '2026-11-01' });
    expect(calendarFetchRange('2026-10-15', 30)).toEqual({ from: '2026-09-28', to: '2026-11-13' });
  });
  it('always covers a week ahead for the day views, even with a short horizon', () => {
    expect(calendarFetchRange('2026-10-30', 1)).toEqual({ from: '2026-09-28', to: '2026-11-05' });
  });
  it('never starts after today', () => {
    expect(calendarFetchRange('2026-10-01', 1).from).toBe('2026-09-28');
  });
});
