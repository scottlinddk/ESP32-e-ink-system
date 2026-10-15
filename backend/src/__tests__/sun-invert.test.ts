import { describe, expect, it } from 'vitest';
import type { DisplayLayout } from '../types/index';
import { renderDisplayDataRaw } from '../utils/bmpGenerator';
import { parseDisplayLayout } from '../utils/layoutValidation';
import { isDarkAt, sunAltitude } from '../utils/sunTimes';

const COPENHAGEN = '55.68,12.57';
const layout = (extra: Partial<DisplayLayout> = {}): DisplayLayout => ({ version: 1, cols: 10, rows: 6, widgets: [], ...extra });
const data = { nextRefresh: 300_000 };
const blackPixels = (raw: Buffer) => {
  let count = 0;
  for (let y = 0; y < 122; y++) for (let x = 0; x < 250; x++) if (!(raw[y * 32 + (x >> 3)] & (0x80 >> (x & 7)))) count++;
  return count;
};

describe('sun position', () => {
  it('follows sunrise and sunset in Copenhagen in October (about 05:30Z and 16:00Z)', () => {
    expect(isDarkAt(new Date('2026-10-15T04:30:00Z'), COPENHAGEN)).toBe(true);
    expect(isDarkAt(new Date('2026-10-15T06:30:00Z'), COPENHAGEN)).toBe(false);
    expect(isDarkAt(new Date('2026-10-15T12:00:00Z'), COPENHAGEN)).toBe(false);
    expect(isDarkAt(new Date('2026-10-15T15:30:00Z'), COPENHAGEN)).toBe(false);
    expect(isDarkAt(new Date('2026-10-15T17:00:00Z'), COPENHAGEN)).toBe(true);
    expect(isDarkAt(new Date('2026-10-15T23:30:00Z'), COPENHAGEN)).toBe(true);
  });

  it('puts the sun near its expected height at noon', () => {
    // Noon altitude is 90 - latitude + declination: about 90 - 55.68 - 9.3 = 25° in mid October.
    expect(sunAltitude(new Date('2026-10-15T11:05:00Z'), 55.68, 12.57)).toBeGreaterThan(23);
    expect(sunAltitude(new Date('2026-10-15T11:05:00Z'), 55.68, 12.57)).toBeLessThan(27);
  });

  it('handles polar day and polar night, where no sunrise or sunset exists', () => {
    expect(isDarkAt(new Date('2026-06-21T23:00:00Z'), '69.65,18.96')).toBe(false);
    expect(isDarkAt(new Date('2026-12-21T11:00:00Z'), '69.65,18.96')).toBe(true);
  });

  it('keeps the normal colours when the location cannot be read', () => {
    expect(isDarkAt(new Date('2026-12-21T23:00:00Z'), 'not a place')).toBe(false);
  });

  it('falls back to the default location when none is saved', () => {
    expect(isDarkAt(new Date('2026-12-21T23:00:00Z'), undefined)).toBe(true);
  });
});

describe('inverting from sunset to sunrise', () => {
  it('is accepted by validation and kept as "sun"', () => {
    expect(parseDisplayLayout(layout({ invert: 'sun' })).invert).toBe('sun');
    expect(() => parseDisplayLayout({ ...layout(), invert: 'night' })).toThrow('invert');
  });

  it('draws black at night and white by day with the same layout', () => {
    const prefs = { weather_location: COPENHAGEN };
    const night = renderDisplayDataRaw(data, layout({ invert: 'sun' }), prefs, new Date('2026-10-15T20:00:00Z'));
    const day = renderDisplayDataRaw(data, layout({ invert: 'sun' }), prefs, new Date('2026-10-15T11:00:00Z'));
    expect(blackPixels(night)).toBe(250 * 122);
    expect(blackPixels(day)).toBe(0);
  });

  it('uses the weather location, so the same moment differs between places', () => {
    const when = new Date('2026-06-21T22:00:00Z');
    const copenhagen = renderDisplayDataRaw(data, layout({ invert: 'sun' }), { weather_location: COPENHAGEN }, when);
    const sydney = renderDisplayDataRaw(data, layout({ invert: 'sun' }), { weather_location: '-33.87,151.21' }, when);
    expect(blackPixels(copenhagen)).toBe(250 * 122);
    expect(blackPixels(sydney)).toBe(0);
  });

  it('leaves an always-inverted layout black in daylight', () => {
    const day = renderDisplayDataRaw(data, layout({ invert: true }), { weather_location: COPENHAGEN }, new Date('2026-10-15T11:00:00Z'));
    expect(blackPixels(day)).toBe(250 * 122);
  });
});
