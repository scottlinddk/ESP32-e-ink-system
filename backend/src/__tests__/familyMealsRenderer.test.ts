import { describe, expect, it } from 'vitest';
import { dayText, renderFamilyMealsWidget, visibleDays } from '../utils/familyMealsRenderer';
import { renderDisplayDataRaw } from '../utils/bmpGenerator';
import { parseDisplayLayout } from '../utils/layoutValidation';
import { parseWidgetOptions } from '../utils/widgetOptions';
import { teletextKind } from '../utils/teletext';
import type { FamilyMealsData, FamilyMealsDay } from '../types';

const TITLES = ['Pasta bolognese', 'Fish and chips', 'Chicken curry', 'Leftover curry', null, null, 'Burgers'];
const days: FamilyMealsDay[] = TITLES.map((title, weekday) => ({
  date: `2026-10-${12 + weekday}`, weekday,
  kind: weekday === 3 ? 'leftover' : weekday === 4 ? 'empty' : weekday === 5 ? 'unplanned' : 'dinner',
  title, note: weekday === 4 ? 'Eating out' : null, dinnerTime: title ? '18:00' : null, totalTimeMinutes: null,
}));
const data: FamilyMealsData = { familyName: 'Lind', weekStartDate: '2026-10-12', isoWeek: 42, today: '2026-10-14', planned: true, days };

class Recorder {
  texts: Array<{ text: string; y: number; black?: boolean }> = [];
  fills: Array<{ y: number }> = [];
  wrapped: Array<{ text: string; scale?: number }> = [];
  drawText(text: string, _x: number, y: number, _w?: number, _s?: number, black?: boolean) { this.texts.push({ text, y, black }); }
  drawWrappedText(text: string, _x: number, _y: number, _w: number, _l?: number, scale?: number) { this.wrapped.push({ text, scale }); return 0; }
  drawHLine() { /* not recorded */ }
  fillRect(_x: number, y: number) { this.fills.push({ y }); }
}
function render(height: number, view: 'full' | 'condensed', value: FamilyMealsData | null = data, language: 'en' | 'da' = 'en', width = 250, problem?: { code: string }) {
  const canvas = new Recorder();
  renderFamilyMealsWidget(canvas, { x: 0, y: 0, width, height }, value ?? undefined, problem, { view, language });
  return canvas;
}

describe('week view', () => {
  it('draws a header and seven days, with today on a bar in white', () => {
    const canvas = render(122, 'full');
    expect(canvas.texts[0]!.text).toBe('Meals Week 42');
    expect(canvas.texts.filter((t) => t.text === 'Wed' || t.text === 'Chicken curry').every((t) => t.black === false)).toBe(true);
    expect(canvas.texts.find((t) => t.text === 'Mon')!.black).toBe(true);
    expect(canvas.fills).toHaveLength(1);
    expect(canvas.texts.map((t) => t.text)).toEqual(expect.arrayContaining(['Pasta bolognese', 'Leftovers: Leftover curry', 'Eating out', '-', 'Burgers']));
  });
  it('speaks Danish with Danish weekdays', () => {
    const canvas = render(122, 'full', data, 'da');
    expect(canvas.texts[0]!.text).toBe('Madplan Uge 42');
    expect(canvas.texts.map((t) => t.text)).toEqual(expect.arrayContaining(['man.', 'tirs.', 'Rester: Leftover curry', 'Eating out']));
  });
  it('drops the header, then the days already passed, when the widget is short', () => {
    const canvas = render(40, 'full');
    const rows = canvas.texts.filter((t) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(t.text)).map((t) => t.text);
    expect(canvas.texts.some((t) => t.text.startsWith('Meals'))).toBe(false);
    expect(rows).toEqual(['Wed', 'Thu', 'Fri', 'Sat']);
  });
  it('keeps rows inside the widget', () => {
    for (const height of [12, 22, 40, 61, 90, 122]) {
      const canvas = render(height, 'full');
      for (const { y } of canvas.texts) expect(y + 8).toBeLessThanOrEqual(height);
    }
  });
  it('never shows days past Sunday when today is late in the week', () => {
    expect(visibleDays(days, '2026-10-18', 3).map((d) => d.weekday)).toEqual([4, 5, 6]);
    expect(visibleDays(days, '2026-09-01', 3).map((d) => d.weekday)).toEqual([0, 1, 2]);
    expect(visibleDays(days, '2026-10-14', 0)).toEqual([]);
  });
});

describe('tonight view', () => {
  it("shows tonight's dish at double size when there is room, single size when not", () => {
    const roomy = render(122, 'condensed');
    expect(roomy.texts[0]!.text).toBe('Tonight 18:00');
    expect(roomy.wrapped).toEqual([{ text: 'Chicken curry', scale: 2 }]);
    expect(render(30, 'condensed').wrapped[0]!.scale).toBe(1);
    expect(render(122, 'condensed', data, 'en', 120).wrapped[0]!.scale).toBe(1);
  });
  it('says so when today is not in the week or has no plan', () => {
    expect(render(122, 'condensed', { ...data, today: '2027-01-01' }).wrapped[0]!.text).toBe('No meal plan');
    expect(render(122, 'condensed', { ...data, days: data.days.map((d) => ({ ...d, kind: 'unplanned' as const })) }).wrapped[0]!.text).toBe('No meal plan');
  });
});

describe('states', () => {
  it('says there is no plan when the week is not planned', () => {
    expect(render(122, 'full', { ...data, planned: false }).wrapped[0]!.text).toBe('No meal plan');
  });
  it.each([['not_configured', 'Meals: add API key'], ['invalid_token', 'Check Meals key'], ['nope', 'Meals: unavailable']])('shows %s as %s', (code, text) => {
    expect(render(122, 'full', null, 'en', 250, { code }).wrapped[0]!.text).toBe(text);
  });
  it('describes a day by kind', () => {
    expect(dayText(days[4]!, 'en')).toBe('Eating out');
    expect(dayText({ ...days[4]!, note: null }, 'en')).toBe('No dinner');
    expect(dayText(days[5]!, 'da')).toBe('-');
  });
});

describe('integration with layouts and the bitmap canvas', () => {
  const layout = (options?: object) => parseDisplayLayout({ version: 1, cols: 10, rows: 6, widgets: [{ i: 'family-meals', x: 0, y: 0, w: 10, h: 6, ...(options ? { options } : {}) }] });
  it('is a valid layout widget with a full or condensed view and zoom', () => {
    expect(layout({ view: 'condensed' }).widgets[0]!.options).toEqual({ view: 'condensed' });
    expect(() => layout({ view: 'week' })).toThrow();
    expect(() => parseWidgetOptions('family-meals', { items: 3 })).toThrow('unsupported');
    expect(parseWidgetOptions('family-meals', { zoom: 1.4 })).toEqual({ zoom: 1.4 });
  });
  it('has a Tekst TV title', () => {
    expect(teletextKind('family-meals')).toBe('familyMeals');
  });
  it('draws pixels with data and with a problem, and the two differ', () => {
    const withData = renderDisplayDataRaw({ familyMeals: data, nextRefresh: 1 }, layout());
    const withProblem = renderDisplayDataRaw({ familyMealsError: { code: 'invalid_token', message: 'x' }, nextRefresh: 1 }, layout());
    expect(withData.some((byte) => byte !== 255)).toBe(true);
    expect(withProblem.some((byte) => byte !== 255)).toBe(true);
    expect(withData).not.toEqual(withProblem);
  });
});
