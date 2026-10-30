import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DisplayData, DisplayLayout } from '../types';
import { BmpCanvas, renderDisplayData, renderDisplayDataRaw } from '../utils/bmpGenerator';
import { fitWidgetText, WidgetCanvas } from '../utils/widgetStyle';
import { ZoomCanvas, type Bounds } from '../utils/zoomCanvas';

afterEach(() => { vi.restoreAllMocks(); });

describe('whole lines in widget bounds', () => {
  it.each([1, 1.2, 2, 3.4])('keeps complete glyphs and marks overflow at zoom %s', zoom => {
    const surface = new BmpCanvas({ width: 400, height: 300, rotation: 0, colorMode: 'bw' });
    const draw = vi.spyOn(surface, 'drawText');
    const bounds = { x: 12, y: 20, width: 56, height: 19 };
    const canvas = new WidgetCanvas(new ZoomCanvas(surface, zoom), bounds);
    canvas.drawText('An overlong label', 14, 22, 52);
    canvas.drawText('Partial row', 14, 32, 52);
    expect(draw.mock.calls).toHaveLength(1);
    const [text, x, y, width, scale] = draw.mock.calls[0];
    expect(text).toBe('An ov…');
    expect(x! + Array.from(text).length * 8 * scale!).toBeLessThanOrEqual((bounds.x + bounds.width) * zoom);
    expect(y! + 8 * scale!).toBeLessThanOrEqual((bounds.y + bounds.height) * zoom);
    expect(width).toBe(52 * zoom);
  });

  it('wraps paragraphs and marks continuation on the final complete line', () => {
    const surface = new BmpCanvas();
    const draw = vi.spyOn(surface, 'drawText');
    const canvas = new WidgetCanvas(surface, { x: 0, y: 0, width: 84, height: 21 });
    canvas.drawWrappedText('First line\nSecond row\nThird line', 2, 2, 80);
    expect(draw.mock.calls.map(([text]) => text)).toEqual(['First line', 'Second ro…']);
  });

  it('measures normalized Unicode characters and handles a one-glyph slot', () => {
    expect(fitWidgetText('a\u030aøæ', 24)).toBe('åøæ');
    expect(fitWidgetText('a\u030aøæ!', 24)).toBe('åø…');
    expect(fitWidgetText('long', 8)).toBe('…');
    expect(fitWidgetText('long', 7)).toBe('');
  });

  it('preserves deliberate inner clipping and white glyphs on a dark background', () => {
    const surface = new BmpCanvas();
    surface.fillRect(0, 0, 40, 20);
    const canvas = new WidgetCanvas(surface, { x: 0, y: 0, width: 40, height: 20 });
    const expected = new BmpCanvas();
    expected.fillRect(0, 0, 40, 20);
    const mask = { x: 0, y: 0, width: 13, height: 20 };
    canvas.withClip(mask, () => canvas.drawText('WEEK', 2, 2, 32, 1, false));
    expected.withClip(mask, () => expected.drawText('WEEK', 2, 2, 32, 1, false));
    expect(surface.toRawPixels()).toEqual(expected.toRawPixels());
  });
});

const sample: DisplayData = {
  nextRefresh: 300_000,
  price: { now: 123, average: 158, trend: 'down', basis: 'consumer' },
  weather: { temp: 17, condition: 'cloudy', windSpeed: 3.5, icon: '04d' },
  customText: 'A long note with several lines of text that must stay inside its own widget.',
  customWebhook: { state: 'fresh', observedAt: null, receivedAt: null, expiresAt: null, rows: [{ label: 'Living room', value: '21.5', unit: '°C' }] },
  battery: { percent: 76 },
};

const layout = (id: string, w = 3, h = 1): DisplayLayout => ({
  version: 1, cols: 10, rows: 6, widgets: [{ i: id, x: 0, y: 0, w, h }],
});

describe('responsive widget readings', () => {
  it.each(['en', 'da'] as const)('preserves the temperature and wind in a narrow %s summary', language => {
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    renderDisplayDataRaw(sample, layout('weather'), { display_language: language });
    expect(draw.mock.calls.map(([text]) => text)).toEqual(['17C', language === 'da' ? '3,5 m/s' : '3.5 m/s']);
  });

  it('shortens a sensor label before its reading and unit', () => {
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    renderDisplayDataRaw(sample, layout('custom-webhook', 5, 2));
    expect(draw.mock.calls.map(([text]) => text)).toContain('Livin…: 21.5 °C');
  });

  it('keeps the price, estimate label, currency, and VAT basis on complete lines', () => {
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    renderDisplayDataRaw(sample, layout('energy', 5, 2));
    expect(draw.mock.calls.map(([text]) => text)).toEqual(['Est 1.23', 'DKK/kWh', 'Incl VAT']);
  });

  it('shows the battery percentage in a one-line fine-grid slot', () => {
    const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
    renderDisplayDataRaw(sample, { ...layout('battery'), rows: 12 });
    expect(draw.mock.calls.map(([text]) => text)).toEqual(['76%']);
  });

  it.each([0, 90, 180, 270] as const)('keeps BMP and raw output identical at rotation %s', rotation => {
    const preferences = { display_profile: { width: 384, height: 300, rotation, colorMode: 'bw' as const } };
    const grid: DisplayLayout = { ...layout('custom-text', 4, 3), zoom: 2, outline: 'thin' };
    grid.widgets[0].options = { zoom: 1.4, align: 'bottom-right' };
    expect(renderDisplayData(sample, grid, preferences).subarray(62)).toEqual(renderDisplayDataRaw(sample, grid, preferences));
  });

  it.each(['energy', 'weather', 'news', 'monta', 'zaptec', 'notion', 'custom-text', 'custom-webhook', 'calendar', 'battery', 'week-number', 'ai-usage', 'status'])(
    '%s never draws a partial text row into its neighbour', id => {
      const draw = vi.spyOn(BmpCanvas.prototype, 'drawText');
      const grid = layout(id, 3, 1);
      grid.widgets[0].y = 2;
      const raw = renderDisplayDataRaw(sample, grid);
      const bounds: Bounds = { x: 0, y: 40, width: 75, height: 20 };
      for (const [text, , y, , scale = 1] of draw.mock.calls) {
        expect(text).not.toBe('');
        expect(y).toBeGreaterThanOrEqual(bounds.y);
        expect(y! + 8 * scale).toBeLessThanOrEqual(bounds.y + bounds.height);
      }
      for (let y = 60; y < 122; y++) expect(raw.subarray(y * 32, (y + 1) * 32).every(byte => byte === 255)).toBe(true);
    });
});
