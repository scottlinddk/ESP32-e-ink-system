import { describe, expect, it } from 'vitest';
import { dayText, renderFamilyMealsWidget, visibleDays } from '../utils/familyMealsRenderer';
import { renderDisplayDataRaw } from '../utils/bmpGenerator';
import { parseDisplayLayout } from '../utils/layoutValidation';
import { parseWidgetOptions } from '../utils/widgetOptions';
import { teletextKind } from '../utils/teletext';
import type { FamilyMealsData, FamilyMealsDay } from '../types';
import type { FamilyMealsView } from '../utils/widgetOptions';

const TITLES = ['Pasta bolognese', 'Fish and chips', 'Chicken curry', 'Leftover curry', null, null, 'Burgers'];
const days: FamilyMealsDay[] = TITLES.map((title, weekday) => ({
  date: `2026-10-${12 + weekday}`, weekday,
  kind: weekday === 3 ? 'leftover' : weekday === 4 ? 'empty' : weekday === 5 ? 'unplanned' : 'dinner',
  title, note: weekday === 4 ? 'Eating out' : null, dinnerTime: title ? '18:00' : null, totalTimeMinutes: null,
}));
const data: FamilyMealsData = { familyName: 'Lind', weekStartDate: '2026-10-12', isoWeek: 42, today: '2026-10-14', planned: true, days };

class Recorder {
  texts: Array<{ text: string; y: number; black?: boolean }> = [];
  fills: Array<{ x: number; y: number; w: number; h: number; black?: boolean }> = [];
  wrapped: Array<{ text: string; scale?: number }> = [];
  drawText(text: string, _x: number, y: number, _w?: number, _s?: number, black?: boolean) { this.texts.push({ text, y, black }); }
  drawWrappedText(text: string, _x: number, _y: number, _w: number, _l?: number, scale?: number) { this.wrapped.push({ text, scale }); return 0; }
  drawHLine() { /* not recorded */ }
  fillRect(x: number, y: number, w: number, h: number, black?: boolean) { this.fills.push({ x, y, w, h, black }); }
}
function render(height: number, view: FamilyMealsView, value: FamilyMealsData | null = data, language: 'en' | 'da' = 'en', width = 250, problem?: { code: string }) {
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

describe('upcoming view', () => {
  it('shows tonight on the left and only the days still to come on the right', () => {
    const canvas = render(122, 'upcoming');
    const drawn = canvas.texts.map((t) => t.text);
    expect(drawn).toEqual(expect.arrayContaining(['Today', 'Coming days', 'DINNER', 'Thu 15', 'Fri 16', 'Sat 17', 'Sun 18']));
    expect(canvas.wrapped[0]!.text).toBe('Chicken curry');
    expect(drawn.some((text) => text.startsWith('Mon') || text.startsWith('Tue'))).toBe(false);
  });
  it('draws the dish at double size when its longest word fits the column', () => {
    const short: FamilyMealsData = { ...data, days: data.days.map((d) => (d.weekday === 2 ? { ...d, title: 'Beef stew' } : d)) };
    expect(render(122, 'upcoming', short).wrapped[0]).toEqual({ text: 'Beef stew', scale: 2 });
  });
  it('lists leftovers and empty days like the week does, shortened to a line when stacked', () => {
    const drawn = render(122, 'upcoming').texts.map((t) => t.text);
    expect(drawn).toEqual(expect.arrayContaining(['Eating out', '-', 'Burgers']));
    expect(drawn.some((text) => text.startsWith('Leftovers:') && text.endsWith('...'))).toBe(true);
  });
  it('keeps the dinner time and the time it takes together', () => {
    const withTime: FamilyMealsData = { ...data, days: data.days.map((d) => (d.weekday === 2 ? { ...d, totalTimeMinutes: 45 } : d)) };
    expect(render(122, 'upcoming', withTime).wrapped.map((w) => w.text)).toContain('18:00, 45\u00a0min');
  });
  it('says so when nothing is left of the week', () => {
    expect(render(122, 'upcoming', { ...data, today: '2026-10-18' }).wrapped.map((w) => w.text)).toContain('Nothing more this week');
  });
  it('stacks the date above the dish when the column is narrow, and never overflows', () => {
    const texts = render(122, 'upcoming', data, 'en', 200).texts;
    const label = texts.find((t) => t.text === 'Thu 15')!;
    // Thursday is the leftover day; its dish sits one line under its date.
    expect(texts.find((t) => t.y === label.y + 10)!.text.startsWith('Leftovers')).toBe(true);
    for (const height of [30, 60, 122]) for (const { y } of render(height, 'upcoming').texts) expect(y + 8).toBeLessThanOrEqual(height);
  });
  it('is tonight alone on a widget too narrow for two columns', () => {
    expect(render(122, 'upcoming', data, 'en', 120).wrapped[0]!.text).toBe('Chicken curry');
    expect(render(122, 'upcoming', data, 'en', 120).texts[0]!.text).toBe('Tonight 18:00');
  });
  it('does not split a heading word, and says there is no plan for an unplanned today', () => {
    const long: FamilyMealsData = { ...data, days: data.days.map((d) => (d.weekday === 2 ? { ...d, title: 'Extraordinarily spiced stew' } : d)) };
    expect(render(122, 'upcoming', long).wrapped[0]!.scale).toBe(1);
    expect(render(122, 'upcoming', { ...data, today: '2027-01-01' }).wrapped[0]!.text).toBe('No meal plan');
  });
  it('speaks Danish', () => {
    const drawn = render(122, 'upcoming', data, 'da').texts.map((t) => t.text);
    expect(drawn).toEqual(expect.arrayContaining(['I dag', 'Kommende dage', 'AFTENSMAD', 'tors. 15']));
  });
});

describe('planner view', () => {
  it('draws a card per day, two to a row, with today white on black', () => {
    const canvas = render(122, 'planner');
    const drawn = canvas.texts.map((t) => t.text);
    expect(drawn).toEqual(expect.arrayContaining(['Mon 12', 'Tue 13', 'Wed 14', 'Sun 18', 'Chicken curry', 'Meals Week 42']));
    expect(canvas.fills.filter((f) => f.w > 100 && f.h === 25)).toHaveLength(1);
    expect(canvas.texts.find((t) => t.text === 'Wed 14')!.black).toBe(false);
    expect(canvas.texts.find((t) => t.text === 'Mon 12')!.black).toBe(true);
    const rows = new Set(canvas.texts.filter((t) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+$/.test(t.text)).map((t) => t.y));
    expect(rows.size).toBe(4);
  });
  it('puts the dinner time beside the weekday when the card is wide enough', () => {
    const wide = render(122, 'planner').texts.filter((t) => t.text === '18:00');
    expect(wide.length).toBeGreaterThan(0);
    expect(render(122, 'planner', data, 'en', 100).texts.some((t) => t.text === '18:00')).toBe(false);
  });
  it('shows the days from today when the widget is short, and keeps inside it', () => {
    const labels = render(60, 'planner').texts.map((t) => t.text).filter((text) => /^\w{3} \d+$/.test(text));
    expect(labels).toEqual(['Wed 14', 'Thu 15', 'Fri 16', 'Sat 17']);
    for (const height of [25, 40, 60, 90, 122]) for (const { y } of render(height, 'planner').texts) expect(y + 8).toBeLessThanOrEqual(height);
  });
  it('falls back to tonight when not even one card fits', () => {
    expect(render(20, 'planner').texts[0]!.text).toBe('Tonight 18:00');
  });
  it('is one card per row on a narrow widget', () => {
    const rows = new Set(render(122, 'planner', data, 'en', 100).texts.filter((t) => /^\w{3} \d+$/.test(t.text)).map((t) => t.y));
    expect(rows.size).toBe(4);
  });
});

describe('recipe view', () => {
  const recipe: FamilyMealsData = {
    ...data, days: data.days.map((d) => (d.weekday === 2
      ? { ...d, totalTimeMinutes: 45, tags: ['vegetarian', 'gluten free'], ingredients: ['flour 272 g', 'eggs 2 large'] } : d)),
  };
  it('shows the dish with its time and tags as black chips, and the ingredients beside it', () => {
    const canvas = render(122, 'recipe', recipe);
    const drawn = canvas.texts.map((t) => t.text);
    expect(canvas.wrapped[0]!.text).toBe('Chicken curry');
    expect(drawn).toEqual(expect.arrayContaining(['18:00', '45 min', 'vegetarian', 'gluten free', 'Ingredients', 'flour 272 g', 'eggs 2 large']));
    expect(canvas.texts.find((t) => t.text === 'vegetarian')!.black).toBe(false);
  });
  it('is the dish and its times alone when Family Meals sends no ingredients', () => {
    const canvas = render(122, 'recipe');
    expect(canvas.texts.map((t) => t.text)).toEqual(['18:00']);
    expect(canvas.texts.map((t) => t.text)).not.toContain('Ingredients');
  });
  it('tags leftovers, and wraps chips onto another row when they do not fit', () => {
    const leftover: FamilyMealsData = { ...data, today: '2026-10-15' };
    expect(render(122, 'recipe', leftover).texts.map((t) => t.text)).toEqual(expect.arrayContaining(['18:00', 'Leftovers']));
    const many: FamilyMealsData = { ...recipe, days: recipe.days.map((d) => (d.weekday === 2 ? { ...d, tags: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'] } : d)) };
    const rows = new Set(render(122, 'recipe', many, 'en', 120).texts.map((t) => t.y));
    expect(rows.size).toBeGreaterThan(1);
  });
  it('stays inside a short widget', () => {
    for (const height of [12, 22, 40, 70, 122]) for (const { y } of render(height, 'recipe', recipe).texts) expect(y + 8).toBeLessThanOrEqual(height);
  });
  it('explains an empty or unplanned tonight', () => {
    expect(render(122, 'recipe', { ...data, today: '2026-10-16' }).wrapped[0]!.text).toBe('Eating out');
    expect(render(122, 'recipe', { ...data, today: '2026-10-17' }).wrapped[0]!.text).toBe('No meal plan');
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
  it('is a valid layout widget with any of its five views and zoom', () => {
    for (const view of ['full', 'condensed', 'upcoming', 'planner', 'recipe']) expect(layout({ view }).widgets[0]!.options).toEqual({ view });
    expect(() => layout({ view: 'week' })).toThrow();
    expect(() => parseWidgetOptions('family-meals', { items: 3 })).toThrow('unsupported');
    expect(parseWidgetOptions('family-meals', { zoom: 1.4 })).toEqual({ zoom: 1.4 });
  });
  it('draws every view as pixels, each different from the others', () => {
    const drawn = ['full', 'condensed', 'upcoming', 'planner', 'recipe'].map((view) => renderDisplayDataRaw({ familyMeals: data, nextRefresh: 1 }, layout({ view })));
    for (const pixels of drawn) expect(pixels.some((byte) => byte !== 255)).toBe(true);
    expect(new Set(drawn.map((pixels) => Buffer.from(pixels).toString('base64'))).size).toBe(5);
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
