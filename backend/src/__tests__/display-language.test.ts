import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiProviderView } from '../aiUsage/types';
import type { DisplayData, DisplayLayout, UserPreferences } from '../types/index';
import { CONDITIONS } from '../services/weather';
import { BmpCanvas, renderDisplayDataRaw } from '../utils/bmpGenerator';
import { bitmapGlyph } from '../utils/bitmapText';
import {
  DISPLAY_LANGUAGES, displayLanguageOrDefault, formatDecimal, parseDisplayLanguage,
} from '../utils/displayLanguage';
import { displayStrings, zonedDate } from '../utils/displayStrings';
import { formatReset, formatResetIn, renderAiUsageWidget } from '../utils/aiUsageRenderer';
import { formatWeekRange } from '../utils/weekNumber';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('display language values', () => {
  it('accepts exactly the supported languages and rejects everything else', () => {
    expect(DISPLAY_LANGUAGES).toEqual(['en', 'da']);
    expect(parseDisplayLanguage('da')).toBe('da');
    for (const bad of ['', 'EN', 'de', 'da-DK', null, undefined, 1, {}, ['da']]) {
      expect(() => parseDisplayLanguage(bad)).toThrow(/one of: en, da/);
    }
  });

  it('draws English for a missing or unknown stored value', () => {
    expect(displayLanguageOrDefault(undefined)).toBe('en');
    expect(displayLanguageOrDefault(null)).toBe('en');
    expect(displayLanguageOrDefault('fr')).toBe('en');
    expect(displayLanguageOrDefault('da')).toBe('da');
  });

  it('formats decimals with the language separator', () => {
    expect(formatDecimal(1.5, 2, 'en')).toBe('1.50');
    expect(formatDecimal(1.5, 2, 'da')).toBe('1,50');
    expect(formatDecimal(-0.254, 2, 'da')).toBe('-0,25');
    expect(formatDecimal(3, 0, 'da')).toBe('3');
  });
});

/** Every string a catalog can produce, so a missing translation or glyph cannot slip through. */
function leaves(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (typeof value === 'function') return leaves((value as (...args: unknown[]) => unknown)(...sampleArgs(path)), `${path}()`);
  if (Array.isArray(value)) return value.flatMap((item, index) => leaves(item, `${path}[${index}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => leaves(item, `${path}.${key}`));
  return [];
}
function sampleArgs(path: string): unknown[] {
  if (path.endsWith('.range')) return [{ day: 28, month: 8 }, { day: 4, month: 9 }];
  if (path.endsWith('.status')) return [2, 1];
  return ['Monta'];
}
// Glyphs that would be replaced by '?': the sentinel table maps every ASCII code to itself, '?' to 63.
const SENTINEL = Array.from({ length: 95 }, (_, index) => [index + 32, 0, 0, 0, 0, 0, 0, 0]);
const unsupported = (text: string) => Array.from(text.normalize('NFC'))
  .filter((char) => char !== '?' && bitmapGlyph(char.codePointAt(0)!, SENTINEL)[0] === 63);

describe('display string catalogs', () => {
  it('offer the same keys in every language', () => {
    const keys = (language: 'en' | 'da') => leaves(displayStrings(language)).map(([path]) => path);
    expect(keys('da')).toEqual(keys('en'));
  });

  it.each(DISPLAY_LANGUAGES)('draw every %s string with real glyphs, never a "?"', (language) => {
    for (const [path, text] of leaves(displayStrings(language))) {
      expect(text.length, path).toBeGreaterThan(0);
      expect(unsupported(text), `${language} ${path}`).toEqual([]);
    }
  });

  it('translate every weather condition the weather service can produce', () => {
    for (const language of DISPLAY_LANGUAGES) {
      expect(Object.keys(displayStrings(language).weather.conditions).sort(), language).toEqual(Object.values(CONDITIONS).sort());
    }
  });

  it('really differ between English and Danish', () => {
    const en = leaves(displayStrings('en')).map(([, text]) => text);
    const da = leaves(displayStrings('da')).map(([, text]) => text);
    expect(da).not.toEqual(en);
    expect(displayStrings('da').energy.unit).toBe('kr/kWh');
  });
});

describe('date names', () => {
  it('take the date and weekday from the display time zone', () => {
    // 22:30 UTC on Wednesday 14 October is already Thursday 15 October in Copenhagen.
    expect(zonedDate(new Date('2026-10-14T22:30:00Z'), 'Europe/Copenhagen')).toEqual({ day: 15, month: 9, weekday: 4 });
    expect(zonedDate(new Date('2026-10-14T22:30:00Z'), 'UTC')).toEqual({ day: 14, month: 9, weekday: 3 });
    expect(zonedDate(new Date('2027-01-03T12:00:00Z'), 'Pacific/Auckland')).toEqual({ day: 4, month: 0, weekday: 1 });
  });

  it('name every weekday and month, English like the runtime and Danish from the catalog', () => {
    for (let offset = 0; offset < 7; offset++) {
      const at = new Date(Date.UTC(2026, 9, 11 + offset, 12)); // Sunday 11 October 2026 onwards
      expect(displayStrings('en').dates.weekdays[zonedDate(at, 'UTC').weekday]).toBe(new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' }).format(at));
    }
    expect(displayStrings('da').dates.weekdays).toEqual(['søn.', 'man.', 'tirs.', 'ons.', 'tors.', 'fre.', 'lør.']);
    expect(displayStrings('da').dates.weekdays.every((name) => name.length <= 5)).toBe(true);
    expect(displayStrings('da').dates.dayMonth({ day: 3, month: 4 })).toBe('3. maj');
    expect(displayStrings('da').dates.dayMonth({ day: 15, month: 9 })).toBe('15. okt.');
    expect(displayStrings('en').dates.dayMonth({ day: 15, month: 9 })).toBe('15 Oct');
  });
});

describe('week range in Danish', () => {
  it('writes day-first Danish dates and keeps English unchanged', () => {
    expect(formatWeekRange(day('2026-10-05'), day('2026-10-11'), 'da')).toBe('5.-11. okt.');
    expect(formatWeekRange(day('2026-09-28'), day('2026-10-04'), 'da')).toBe('28. sep.-4. okt.');
    expect(formatWeekRange(day('2026-05-04'), day('2026-05-10'), 'da')).toBe('4.-10. maj');
    expect(formatWeekRange(day('2026-10-05'), day('2026-10-11'))).toBe('Oct 5-11');
    expect(formatWeekRange(day('2026-10-05'), day('2026-10-11'), 'en')).toBe('Oct 5-11');
  });
});

describe('AI usage reset times', () => {
  const NOW = new Date('2026-10-07T10:00:00Z');
  it('names weekdays and countdowns in the display language', () => {
    expect(formatReset('2026-10-12T08:00:00Z', NOW, 'Europe/Copenhagen')).toBe('Mon');
    expect(formatReset('2026-10-12T08:00:00Z', NOW, 'Europe/Copenhagen', 'da')).toBe('man.');
    expect(formatResetIn('2026-10-07T10:58:00Z', NOW, 'Europe/Copenhagen', 'da')).toBe('om 58m');
    expect(formatResetIn('2026-10-08T18:00:00Z', NOW, 'Europe/Copenhagen', 'da')).toBe('tors. 20:00');
    expect(formatResetIn('2026-10-07T12:20:00Z', NOW, 'Europe/Copenhagen', 'da')).toBe('14:20');
  });

  it('fits every Danish weekday into the fixed reset column', () => {
    for (let offset = 0; offset < 7; offset++) {
      const at = new Date(Date.UTC(2026, 9, 12 + offset, 12)).toISOString();
      expect(formatReset(at, NOW, 'Europe/Copenhagen', 'da').length).toBeLessThanOrEqual(5);
    }
  });

  it('draws Danish labels without touching the English output', () => {
    const claude: AiProviderView = {
      provider: 'claude', label: 'Claude', limitsObservedAt: '2026-10-07T09:50:00Z',
      limits: [
        { label: '5h', usedPercent: 15, resetsAt: '2026-10-07T10:58:00Z' },
        { label: '7d', usedPercent: 68, resetsAt: '2026-10-08T18:00:00Z' },
      ],
      today: { tokens: 283_601, breakdown: { input: 6, output: 795, cacheRead: 234_100, cacheWrite: 49_500 }, costUsd: 0.23, partial: false },
      monthCostUsd: 45.2,
    };
    const drawn = (language?: 'en' | 'da') => {
      const texts: string[] = [];
      const canvas = { drawText: (text: string) => { texts.push(text); }, drawHLine: () => {}, fillRect: () => {} };
      renderAiUsageWidget(canvas, { x: 0, y: 0, width: 250, height: 122 }, { providers: [claude] },
        { now: NOW, timeZone: 'Europe/Copenhagen', ...(language ? { language } : {}) });
      return texts;
    };
    expect(drawn()).toEqual(drawn('en'));
    expect(drawn('en')).toContain('Weekly');
    expect(drawn('da')).toEqual(expect.arrayContaining(['Session', 'Ugentlig', 'Nulstilles om 58m', 'Cache-træf 83%', 'Input', 'Output']));
    expect(drawn('da')).not.toContain('Weekly');
    // Without the token breakdown the summary line is the billed month.
    const billed = { ...claude, today: null };
    const month = (language: 'en' | 'da') => {
      const texts: string[] = [];
      const canvas = { drawText: (text: string) => { texts.push(text); }, drawHLine: () => {}, fillRect: () => {} };
      renderAiUsageWidget(canvas, { x: 0, y: 0, width: 250, height: 122 }, { providers: [billed] }, { now: NOW, timeZone: 'Europe/Copenhagen', language });
      return texts;
    };
    expect(month('en')).toContain('API month $45.20');
    expect(month('da')).toContain('API måned $45.20');
  });
});

describe('widget text per language', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  const layout = (...ids: string[]): DisplayLayout => ({
    version: 1, cols: 10, rows: 6, widgets: ids.map((i, index) => ({ i, x: 0, y: index, w: 10, h: 1 })),
  });
  const drawn = (data: Partial<DisplayData>, ids: string[], preferences: Partial<UserPreferences> = {}, height = 1) => {
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    const wide: DisplayLayout = { ...layout(...ids), widgets: ids.map((i, index) => ({ i, x: 0, y: index * height, w: 10, h: height })) };
    wide.rows = Math.max(6, ids.length * height);
    renderDisplayDataRaw({ nextRefresh: 30 * 60_000, ...data }, wide, preferences);
    return draw.mock.calls.map(([text]) => text);
  };

  it('keeps English the default, with or without an explicit language', () => {
    const data: Partial<DisplayData> = { price: { now: 25, average: 50, trend: 'down' } };
    expect(drawn(data, ['energy'], {}, 3)).toEqual(['Spot: 0.25 DKK/kWh v', 'Excl tax/fees', 'Avg: 0.50 DKK/kWh']);
    expect(drawn(data, ['energy'], { display_language: 'en' }, 3)).toEqual(drawn(data, ['energy'], {}, 3));
    expect(drawn(data, ['energy'], { display_language: undefined }, 3)).toEqual(drawn(data, ['energy'], {}, 3));
  });

  it('draws unknown stored languages in English rather than failing', () => {
    const data: Partial<DisplayData> = { price: { now: 25, average: 50, trend: 'down' } };
    expect(drawn(data, ['energy'], { display_language: 'fr' as never }, 3)).toEqual(drawn(data, ['energy'], {}, 3));
  });

  it('translates the energy summary and uses a decimal comma', () => {
    const data: Partial<DisplayData> = { price: { now: 125, average: 50, trend: 'up' } };
    expect(drawn(data, ['energy'], { display_language: 'da' }, 3))
      .toEqual(['Spot: 1,25 kr/kWh ^', 'Ekskl. afgifter og gebyrer', 'Gns: 0,50 kr/kWh']);
    const consumer: Partial<DisplayData> = { price: { now: 125, average: 50, trend: 'up', basis: 'consumer' } };
    expect(drawn(consumer, ['energy'], { display_language: 'da' }, 3)[0]).toBe('Est: 1,25 kr/kWh ^');
    expect(drawn(consumer, ['energy'], { display_language: 'da' }, 3)[1]).toBe('Inkl. moms, uden faste gebyrer');
  });

  it('translates the energy errors and the missing tariff codes', () => {
    const problem = { code: 'missing_tariff' as const, message: 'x', missingCodes: ['T1'] };
    expect(drawn({ priceError: problem }, ['energy'], { display_language: 'da' }, 2)).toEqual(['Elpris: tjek tarif', 'Mangler: T1']);
    expect(drawn({ priceError: problem }, ['energy'], {}, 2)).toEqual(['Energy: check tariff', 'Missing: T1']);
    expect(drawn({}, ['energy'], { display_language: 'da' })).toEqual(['Elpris: ikke tilgængelig']);
  });

  it('translates weather conditions, wind and errors', () => {
    const data: Partial<DisplayData> = { weather: { temp: 8, condition: 'drizzle', windSpeed: 2, icon: '09d' } };
    expect(drawn(data, ['weather'], {}, 2)).toEqual(['drizzle  8C', 'Wind: 2.0 m/s']);
    expect(drawn(data, ['weather'], { display_language: 'da' }, 2)).toEqual(['støvregn  8C', 'Vind: 2,0 m/s']);
    const failed: Partial<DisplayData> = { weatherError: { code: 'invalid_key', message: 'x' } };
    expect(drawn(failed, ['weather'], { display_language: 'da' }, 2)).toEqual(['Vejr', 'Tjek API-nøgle']);
    expect(drawn(failed, ['weather'], {}, 2)).toEqual(['Weather', 'Check API key']);
  });

  it('shows an unknown weather condition as delivered instead of dropping it', () => {
    const data: Partial<DisplayData> = { weather: { temp: 8, condition: 'meteors', windSpeed: 2, icon: '01d' } };
    expect(drawn(data, ['weather'], { display_language: 'da' }, 2)[0]).toBe('meteors  8C');
  });

  it('translates news states', () => {
    expect(drawn({ news: [] }, ['news'], { display_language: 'da' })).toEqual(['Ingen overskrifter']);
    expect(drawn({ newsError: { code: 'unsupported_coverage', message: 'x' } }, ['news'], { display_language: 'da' })).toEqual(['Brug RSS-feed']);
    expect(drawn({}, ['news'], { display_language: 'da' })).toEqual(['Nyheder: ikke tilgængelig']);
    expect(drawn({}, ['news'])).toEqual(['News: unavailable']);
  });

  it('translates charger and Notion widgets', () => {
    const monta: Partial<DisplayData> = { monta: { chargePoints: [
      { id: '1', name: 'A', state: 'available' }, { id: '2', name: 'B', state: 'charging' },
    ] as never, activeSessions: [], todayKwh: 12.5 } };
    expect(drawn(monta, ['monta'], { display_language: 'da', monta_fields: ['charger_status', 'today_stats'] }, 2))
      .toEqual(['Monta', '1 ledige  1 lader', 'Sessioner i dag: 12,5 kWh']);
    expect(drawn({}, ['monta'], { display_language: 'da' })).toEqual(['Monta: ikke tilgængelig']);
    expect(drawn({}, ['zaptec'], { display_language: 'da' })).toEqual(['Zaptec: ikke tilgængelig']);
    expect(drawn({ notionError: { code: 'access_denied', message: 'x' } }, ['notion'], { display_language: 'da' })).toEqual(['Del databasen']);
    expect(drawn({ notion: { rows: [] } }, ['notion'], { display_language: 'da' }, 2)).toEqual(['Notion', 'Ingen elementer']);
  });

  it('translates calendar dates, all-day events and empty states', () => {
    const calendar: Partial<DisplayData> = { calendar: { timezone: 'Europe/Copenhagen', events: [
      { title: 'Møde', start: '2026-10-15T12:30:00.000Z', end: '2026-10-15T13:30:00.000Z', allDay: false, dateLabel: '15 Oct', timeLabel: '14:30' },
      { title: 'Ferie', start: '2026-10-16', end: '2026-10-17', allDay: true, dateLabel: '16 Oct', timeLabel: 'All day' },
    ] } };
    expect(drawn(calendar, ['calendar'], {}, 2)).toEqual(['15 Oct 14:30: Møde', '16 Oct All day: Ferie']);
    expect(drawn(calendar, ['calendar'], { display_language: 'da' }, 2)).toEqual(['15. okt. 14:30: Møde', '16. okt. Hele dagen: Ferie']);
    expect(drawn({ calendar: { timezone: 'UTC', events: [] } }, ['calendar'], { display_language: 'da' })).toEqual(['Ingen kommende aftaler']);
    expect(drawn({}, ['calendar'], { display_language: 'da' })).toEqual(['Kalender: ikke tilgængelig']);
  });

  it('translates the status bar but keeps a 24-hour colon clock', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T10:05:00Z'));
    expect(drawn({}, ['status'], { display_timezone: 'Europe/Copenhagen' })).toEqual(['Refresh: 30min  12:05']);
    expect(drawn({}, ['status'], { display_timezone: 'Europe/Copenhagen', display_language: 'da' })).toEqual(['Opdatering: 30min  12:05']);
  });

  it('translates the week number widget', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    const tall = (preferences: Partial<UserPreferences>) => {
      const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
      renderDisplayDataRaw({ nextRefresh: 1000 }, { version: 1, cols: 10, rows: 6, widgets: [{ i: 'week-number', x: 0, y: 0, w: 10, h: 6 }] }, preferences);
      return [...new Set(draw.mock.calls.map(([text]) => text))];
    };
    expect(tall({})).toEqual(['WEEK', '2026', 'Oct 5-11', '76%', '41']);
    expect(tall({ display_language: 'da' })).toEqual(['UGE', '2026', '5.-11. okt.', '76%', '41']);
  });

  it('translates the sensor widget', () => {
    const rows = [{ label: 'Stue', value: '21', unit: 'C' }] as never;
    const fresh: Partial<DisplayData> = { customWebhook: { state: 'fresh', rows, observedAt: null, receivedAt: null, expiresAt: null } };
    expect(drawn(fresh, ['custom-webhook'], { display_language: 'da' }, 2)).toEqual(['Sensorer', 'Stue: 21 C']);
    expect(drawn({ customWebhook: { ...fresh.customWebhook!, state: 'stale' } }, ['custom-webhook'], { display_language: 'da' }, 2)[0]).toBe('FORÆLDEDE sensorer');
    expect(drawn({ customWebhook: { ...fresh.customWebhook!, state: 'unavailable', rows: [] } }, ['custom-webhook'], { display_language: 'da' }, 2)[0]).toBe('Ingen sensordata');
  });

  it('draws the Danish energy chart header and axis with decimal commas', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T10:30:00Z'));
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      hour, start: new Date(Date.UTC(2026, 9, 7, hour - 2)).toISOString(), price: 40 + hour * 10,
    }));
    const data: Partial<DisplayData> = { price: { now: 125, average: 120, trend: 'up', hours } };
    const wide = { version: 1, cols: 10, rows: 6, widgets: [{ i: 'energy', x: 0, y: 0, w: 10, h: 6, options: { view: 'day' } }] } as DisplayLayout;
    const lines = (language?: 'da') => {
      const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
      renderDisplayDataRaw({ nextRefresh: 1000, ...data }, wide, language ? { display_language: language } : {});
      const texts = draw.mock.calls.map(([text]) => text);
      draw.mockRestore();
      return texts;
    };
    expect(lines()[0]).toMatch(/^Spot \d\d: \d+\.\d\d DKK\/kWh$/);
    expect(lines('da')[0]).toMatch(/^Spot \d\d: \d+,\d\d kr\/kWh$/);
    expect(lines('da').some((text) => /^Gns \d+,\d\d$/.test(text))).toBe(true);
    // The shorter Danish unit leaves room for the average beside the header where the English one does not.
    expect(lines().some((text) => /^(Avg|Gns) /.test(text))).toBe(false);
  });
});
