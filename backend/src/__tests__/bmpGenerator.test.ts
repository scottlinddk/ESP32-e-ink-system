import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DisplayData, DisplayLayout, WidgetLayout } from '../types/index';
import {
  BmpCanvas,
  COL_PX,
  DEFAULT_LAYOUT,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  ROW_PX,
  renderDisplayData,
  renderDisplayDataRaw,
} from '../utils/bmpGenerator';

const STRIDE = 32;

describe('weather error rendering', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it.each(['missing_key', 'invalid_location', 'invalid_key', 'rate_limited', 'timeout', 'invalid_response', 'unavailable'] as const)(
    'renders a short safe %s explanation in bitmap and raw output', (code) => {
      const weather: DisplayLayout = { version: 1, cols: 10, rows: 6, widgets: [{ i: 'weather', x: 0, y: 0, w: 5, h: 2 }] };
      const data = { nextRefresh: 1000, weatherError: { code, message: 'SECRET provider message' } };
      const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
      const raw = renderDisplayDataRaw(data, weather);
      expect(renderDisplayData(data, weather).subarray(62)).toEqual(raw);
      expect(draw.mock.calls.map(([text]) => text).join(' ')).not.toContain('SECRET');
      expect(draw.mock.calls[0][0]).toBe('Weather');
      expect(draw.mock.calls[1][0].length).toBeLessThanOrEqual(15);
      draw.mockClear();
      renderDisplayDataRaw(data, { ...weather, widgets: [{ ...weather.widgets[0], h: 1 }] });
      expect(draw.mock.calls).toHaveLength(1);
      expect(draw.mock.calls[0][0]).not.toBe('Weather');
    });
});

describe('electricity price basis rendering', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it('labels consumer estimates and keeps cents visible in a half-width widget', () => {
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    const energy: DisplayLayout = { version: 1, cols: 10, rows: 6, widgets: [{ i: 'energy', x: 0, y: 0, w: 5, h: 2 }] };
    const first = renderDisplayDataRaw({ nextRefresh: 1000, price: { now: 123, average: 150, trend: 'down', basis: 'consumer' } }, energy);
    const second = renderDisplayDataRaw({ nextRefresh: 1000, price: { now: 124, average: 150, trend: 'down', basis: 'consumer' } }, energy);
    expect(first).not.toEqual(second);
    expect(draw.mock.calls.map(([text]) => text)).toContain('Incl VAT; no fixed fees');
    renderDisplayDataRaw({ nextRefresh: 1000, price: { now: 123, average: 150, trend: 'down' } }, energy);
    expect(draw.mock.calls.map(([text]) => text)).toContain('Excl tax/fees');
  });
  it('names missing tariff codes instead of a generic unavailable label', () => {
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    const energy: DisplayLayout = { version: 1, cols: 10, rows: 6, widgets: [{ i: 'energy', x: 0, y: 0, w: 5, h: 2 }] };
    renderDisplayDataRaw({ nextRefresh: 1000, priceError: { code: 'missing_tariff', message: 'x', missingCodes: ['CD', 'CD R'] } }, energy);
    expect(draw.mock.calls.map(([text]) => text)).toEqual(expect.arrayContaining(['Energy: check tariff', 'Missing: CD, CD R']));
    draw.mockClear();
    renderDisplayDataRaw({ nextRefresh: 1000 }, energy);
    expect(draw.mock.calls.map(([text]) => text)).toContain('Energy: unavailable');
  });
});

describe('display status time zone', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it.each([
    ['2026-01-15T12:00:00Z', 'Europe/Copenhagen', '13:00'],
    ['2026-07-15T12:00:00Z', 'Europe/Copenhagen', '14:00'],
    ['2026-07-15T12:00:00Z', 'UTC', '12:00'],
    ['2026-07-15T12:00:00Z', 'America/New_York', '08:00'],
    ['2026-07-15T22:00:00Z', 'Europe/Copenhagen', '00:00'],
    ['2026-07-15T12:00:00Z', undefined, '14:00'],
  ])('renders %s in %s as %s in both output formats', (instant, display_timezone, expected) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(instant!));
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    const prefs = { monta_fields: [], zaptec_fields: [], display_timezone };
    const statusLayout: DisplayLayout = { version: 1, cols: 10, rows: 6, widgets: [{ i: 'status', x: 0, y: 0, w: 10, h: 1 }] };
    const raw = renderDisplayDataRaw({ nextRefresh: 300_000 }, statusLayout, prefs);
    const bmp = renderDisplayData({ nextRefresh: 300_000 }, statusLayout, prefs);
    expect(draw.mock.calls.map(([text]) => text)).toEqual([
      `Refresh: 5min  ${expected}`, `Refresh: 5min  ${expected}`,
    ]);
    expect(bmp.subarray(62)).toEqual(raw);
  });
});

describe('news feed rendering', () => {
  const newsLayout: DisplayLayout = { version: 1, cols: 10, rows: 6, widgets: [{ i: 'news', x: 0, y: 0, w: 10, h: 6 }] };
  it('renders additional headlines when the news widget has room', () => {
    const one = { nextRefresh: 60_000, news: [{ title: 'First', url: '' }] };
    const two = { ...one, news: [...one.news, { title: 'Second', url: '' }] };
    const first = renderDisplayDataRaw(one, newsLayout);
    const both = renderDisplayDataRaw(two, newsLayout);
    expect(first.subarray(0, STRIDE * 12)).toEqual(both.subarray(0, STRIDE * 12));
    expect(first).not.toEqual(both);
  });
  it('distinguishes an empty feed from a failed source', () => {
    expect(renderDisplayDataRaw({ nextRefresh: 60_000, news: [] }, newsLayout))
      .not.toEqual(renderDisplayDataRaw({ nextRefresh: 60_000 }, newsLayout));
  });
  it('renders fixed NewsAPI and Notion setup labels instead of untrusted error messages', () => {
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    try {
      const raw = renderDisplayDataRaw({ nextRefresh: 1000, newsError: { code: 'unsupported_coverage', message: 'PRIVATE_KEY' }, notionError: { code: 'data_source_required', message: 'PRIVATE_ID' } },
        { ...newsLayout, widgets: [{ i: 'news', x: 0, y: 0, w: 10, h: 2 }, { i: 'notion', x: 0, y: 2, w: 10, h: 2 }] });
      expect(raw.some((byte) => byte !== 255)).toBe(true);
      const labels = draw.mock.calls.map(([text]) => text).join(' ');
      expect(labels).toContain('Use RSS feed'); expect(labels).toContain('Select data source');
      expect(labels).not.toContain('PRIVATE');
    } finally { draw.mockRestore(); }
  });
});

const data: DisplayData = {
  price: { now: 125, average: 175, trend: 'down' },
  weather: { temp: 17, condition: 'Mostly cloudy', windSpeed: 2.5, icon: '04d' },
  news: [{ title: 'A very long headline with enough words to overflow several short widgets', url: 'https://example.com' }],
  monta: {
    chargePoints: [{ id: 'm1', name: 'Garage', state: 'available' }],
    activeSessions: [{ id: 's1', energyDeliveredKwh: 4.5, durationMin: 30, startedAt: '2026-09-26T10:00:00Z' }],
    todayKwh: 10,
  },
  zaptec: {
    chargers: [{ id: 'z1', name: 'Driveway', operatingMode: 3 }],
    activeSession: { id: 's2', energyDeliveredKwh: 3.5, chargerName: 'Driveway', startDateTime: '2026-09-26T10:00:00Z' },
    installationName: 'Home',
  },
  notion: {
    databaseName: 'Tasks with a long database name',
    rows: [{ id: 'n1', title: 'A long task description', subtitle: 'Due today' }],
  },
  nextRefresh: 300_000,
};

function layout(...widgets: WidgetLayout[]): DisplayLayout {
  return { version: 1, cols: 10, rows: 6, widgets };
}

describe('disabled widgets and EV display semantics', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it.each([
    ['energy', 'show_energy_price'], ['weather', 'show_weather'], ['news', 'show_news'],
    ['monta', 'show_monta'], ['zaptec', 'show_zaptec'], ['notion', 'show_notion'],
    ['calendar', 'show_calendar'], ['custom-webhook', 'show_custom_webhook'],
    ['custom-text', 'show_custom_text'], ['custom-image', 'show_custom_image'],
  ])('leaves disabled %s blank in both bitmap formats, even if data remains', (widget, setting) => {
    const single = layout({ i: widget, x: 0, y: 0, w: 10, h: 6 });
    const content = { ...data, customText: 'Private note', customImage: { width: 1, height: 1, pixels: 'AA==', fit: 'contain' as const },
      customWebhook: { state: 'fresh' as const, rows: [{ label: 'Kitchen', value: '20' }], observedAt: null, receivedAt: null, expiresAt: null } };
    const raw = renderDisplayDataRaw(content, single, { [setting]: false });
    expect(raw.every((byte) => byte === 255)).toBe(true);
    expect(renderDisplayData(content, single, { [setting]: false }).subarray(62)).toEqual(raw);
    expect(renderDisplayDataRaw(content, single, { [setting]: true })).not.toEqual(raw);
  });
  it('retains unavailable output for enabled or legacy unspecified sources', () => {
    const single = layout({ i: 'weather', x: 0, y: 0, w: 10, h: 6 });
    expect(renderDisplayDataRaw({ nextRefresh: 1000 }, single, { show_weather: true }))
      .toEqual(renderDisplayDataRaw({ nextRefresh: 1000 }, single));
    expect(renderDisplayDataRaw({ nextRefresh: 1000 }, single).some((byte) => byte !== 255)).toBe(true);
  });
  it('counts Zaptec charging mode 3 and disconnected mode 1, excluding requesting and finished', () => {
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    renderDisplayDataRaw({ ...data, zaptec: { chargers: [1, 2, 3, 5].map((mode) => ({ id: String(mode), name: 'Charger', operatingMode: mode })), activeSession: null, installationName: null } },
      layout({ i: 'zaptec', x: 0, y: 0, w: 10, h: 6 }));
    expect(draw.mock.calls.map(([text]) => text)).toContain('1 avail  1 charging');
  });
  it('does not turn missing EV energy or duration into a false zero', () => {
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    renderDisplayDataRaw({ ...data, monta: { chargePoints: [], activeSessions: [{ id: 'm', energyDeliveredKwh: null, startedAt: null, durationMin: null }], todayKwh: null },
      zaptec: { chargers: [], activeSession: { id: 'z', energyDeliveredKwh: null, startDateTime: null, chargerName: 'Home' }, installationName: null } },
      layout({ i: 'monta', x: 0, y: 0, w: 10, h: 3 }, { i: 'zaptec', x: 0, y: 3, w: 10, h: 3 }));
    const labels = draw.mock.calls.map(([text]) => text);
    expect(labels).toContain('?kWh  ?min'); expect(labels).toContain('?kWh  Home');
    expect(labels.join(' ')).not.toContain('0.0kWh');
  });
});

function isBlack(pixels: Buffer, x: number, y: number): boolean {
  return (pixels[y * STRIDE + Math.floor(x / 8)] & (0x80 >> (x % 8))) === 0;
}

function blackPixels(pixels: Buffer): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (let y = 0; y < DISPLAY_HEIGHT; y++) {
    for (let x = 0; x < DISPLAY_WIDTH; x++) {
      if (isBlack(pixels, x, y)) result.push([x, y]);
    }
  }
  return result;
}

describe('bitmap font orientation', () => {
  it('draws the asymmetric letter F with its stem on the left in MSB-first output', () => {
    const canvas = new BmpCanvas();
    canvas.drawChar('F'.charCodeAt(0), 0, 0);
    const expectedRows = [
      '#######.',
      '.##...#.',
      '.##.#...',
      '.####...',
      '.##.#...',
      '.##.....',
      '####....',
      '........',
    ];
    const raw = canvas.toRawPixels();
    const actualRows = expectedRows.map((_, y) =>
      Array.from({ length: 8 }, (_, x) => isBlack(raw, x, y) ? '#' : '.').join('')
    );
    expect(actualRows).toEqual(expectedRows);
    expect(raw[0]).toBe(0x01); // Left seven pixels black, rightmost pixel white.
    expect(canvas.toBmp().subarray(62)).toEqual(raw);
  });
});

describe('display widget boundaries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-26T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['energy', 'weather', 'news', 'monta', 'zaptec', 'notion', 'status'])(
    'keeps %s text and separators inside its assigned rectangle',
    (id) => {
      const widget = { i: id, x: 3, y: 2, w: 2, h: 1 };
      const pixels = blackPixels(renderDisplayDataRaw(data, layout(widget)));
      expect(pixels.length).toBeGreaterThan(0);
      const outside = pixels.filter(([x, y]) =>
        x < widget.x * COL_PX || x >= (widget.x + widget.w) * COL_PX ||
        y < widget.y * ROW_PX || y >= (widget.y + widget.h) * ROW_PX
      );
      expect(outside).toEqual([]);
    }
  );

  it('preserves neighbouring widgets when news is rendered last', () => {
    const neighbours = [
      { i: 'weather', x: 5, y: 0, w: 5, h: 3 },
      { i: 'status', x: 0, y: 1, w: 5, h: 1 },
    ];
    const original = renderDisplayDataRaw(data, layout(...neighbours));
    const combined = renderDisplayDataRaw(data, layout(
      ...neighbours,
      { i: 'news', x: 0, y: 0, w: 5, h: 1 }
    ));
    const changedOutside: Array<[number, number]> = [];
    for (let y = 0; y < DISPLAY_HEIGHT; y++) {
      for (let x = 0; x < DISPLAY_WIDTH; x++) {
        if ((x >= 125 || y >= 20) && isBlack(original, x, y) !== isBlack(combined, x, y)) {
          changedOutside.push([x, y]);
        }
      }
    }
    expect(combined.equals(original)).toBe(false);
    expect(changedOutside).toEqual([]);
  });

  it('keeps a narrow news widget inside the bottom corner', () => {
    const pixels = blackPixels(renderDisplayDataRaw(data, layout({ i: 'news', x: 9, y: 5, w: 1, h: 1 })));
    expect(pixels.length).toBeGreaterThan(25); // Separator plus visible text.
    expect(pixels.every(([x, y]) => x >= 225 && y >= 100 && y < 120)).toBe(true);
  });

  it('skips empty widget rectangles without changing the image', () => {
    const image = renderDisplayDataRaw(data, layout(
      { i: 'news', x: 1, y: 1, w: 0, h: 1 },
      { i: 'energy', x: 1, y: 1, w: 2, h: 0 }
    ));
    expect(image.every((byte) => byte === 0xff)).toBe(true);
  });

  it('clips drawing and clearing to a single pixel and restores the previous bounds', () => {
    const canvas = new BmpCanvas();
    canvas.setPixel(0, 0, true);
    canvas.withClip({ x: 7, y: 3, width: 1, height: 1 }, () => {
      canvas.fillRect(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT, false);
      canvas.fillRect(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT);
      expect(canvas.drawWrappedText('No glyph fits', 7, 3, 1)).toBe(3);
    });
    canvas.setPixel(9, 9, true);
    expect(blackPixels(canvas.toRawPixels())).toEqual([[0, 0], [7, 3], [9, 9]]);
  });

  it('retains the default layout and matching BMP/raw pixel formats', () => {
    const raw = renderDisplayDataRaw(data);
    const bmp = renderDisplayData(data);
    expect(raw).toEqual(renderDisplayDataRaw(data, DEFAULT_LAYOUT));
    expect(raw).toHaveLength(3904);
    expect(bmp.toString('ascii', 0, 2)).toBe('BM');
    expect(bmp.readUInt32LE(2)).toBe(bmp.length);
    expect(bmp.readUInt32LE(10)).toBe(62);
    expect(bmp.readInt32LE(18)).toBe(DISPLAY_WIDTH);
    expect(bmp.readInt32LE(22)).toBe(-DISPLAY_HEIGHT);
    expect(bmp.readUInt16LE(28)).toBe(1);
    expect(bmp.subarray(54, 62)).toEqual(Buffer.from([0, 0, 0, 0, 255, 255, 255, 0]));
    expect(bmp.subarray(62)).toEqual(raw);
    // The six unused bits at the end of each row remain white.
    expect(Array.from({ length: DISPLAY_HEIGHT }, (_, y) => raw[y * STRIDE + 31] & 0x3f))
      .toEqual(Array(DISPLAY_HEIGHT).fill(0x3f));
  });
});

describe('EV charging field selection', () => {
  it('renders a calendar agenda in BMP/raw and distinguishes empty/unavailable results', () => {
    const widgetLayout = layout({ i: 'calendar', x: 0, y: 0, w: 10, h: 4 });
    const calendar = { timezone: 'Europe/Copenhagen', events: [{ title: 'Dentist', start: '2026-10-01T10:00:00Z', end: '2026-10-01T11:00:00Z', allDay: false, dateLabel: '1 Oct', timeLabel: '12:00' }] };
    const agenda = { nextRefresh: 60000, calendar };
    const raw = renderDisplayDataRaw(agenda, widgetLayout);
    expect(raw).toEqual(renderDisplayData(agenda, widgetLayout).subarray(62));
    expect(raw).not.toEqual(renderDisplayDataRaw({ ...agenda, calendar: { ...calendar, events: [] } }, widgetLayout));
    expect(renderDisplayDataRaw({ ...agenda, calendar: { ...calendar, events: [] } }, widgetLayout)).not.toEqual(renderDisplayDataRaw({ nextRefresh: 60000 }, widgetLayout));
    expect(blackPixels(raw).every(([, y]) => y < 80)).toBe(true);
  });
  it.each(['monta', 'zaptec'])('uses default fields when saved %s preferences are null', (widget) => {
    // These JSONB columns are nullable in the database.
    const preferences = JSON.parse('{"monta_fields":null,"zaptec_fields":null}');
    const widgetLayout = layout({ i: widget, x: 0, y: 0, w: 10, h: 3 });
    expect(renderDisplayDataRaw(data, widgetLayout, preferences))
      .toEqual(renderDisplayDataRaw(data, widgetLayout));
    expect(renderDisplayData(data, widgetLayout, preferences))
      .toEqual(renderDisplayData(data, widgetLayout));
  });

  const selections: Array<{ widget: 'monta' | 'zaptec'; field: string; change: (value: DisplayData) => void }> = [
    { widget: 'monta', field: 'charger_status', change: (value) => { value.monta!.chargePoints[0].state = 'charging'; } },
    { widget: 'monta', field: 'active_session', change: (value) => { value.monta!.activeSessions[0].energyDeliveredKwh = 8; } },
    { widget: 'monta', field: 'today_stats', change: (value) => { value.monta!.todayKwh = 20; } },
    { widget: 'zaptec', field: 'charger_status', change: (value) => { value.zaptec!.chargers[0].operatingMode = 2; } },
    { widget: 'zaptec', field: 'active_session', change: (value) => { value.zaptec!.activeSession!.energyDeliveredKwh = 8; } },
    { widget: 'zaptec', field: 'installation_info', change: (value) => { value.zaptec!.installationName = 'Office'; } },
  ];

  it.each(selections)('renders $widget $field only when selected', ({ widget, field, change }) => {
    const changed: DisplayData = structuredClone(data);
    change(changed);
    const widgetLayout = layout({ i: widget, x: 0, y: 0, w: 10, h: 3 });
    const hidden = { monta_fields: [], zaptec_fields: [] };
    const selected = { ...hidden, [`${widget}_fields`]: [field] };
    expect(renderDisplayDataRaw(data, widgetLayout, hidden))
      .toEqual(renderDisplayDataRaw(changed, widgetLayout, hidden));
    expect(renderDisplayDataRaw(data, widgetLayout, selected))
      .not.toEqual(renderDisplayDataRaw(changed, widgetLayout, selected));
    expect(renderDisplayData(data, widgetLayout, selected).subarray(62))
      .toEqual(renderDisplayDataRaw(data, widgetLayout, selected));
  });
});
