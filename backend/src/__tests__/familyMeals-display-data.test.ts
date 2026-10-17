import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDisplayData, DEFAULT_PREFS } from '../services/displayData';
import { fetchFamilyMealsWeek, FamilyMealsSourceError } from '../services/familyMeals';
import type { DisplayLayout, UserPreferences } from '../types';

vi.mock('../services/familyMeals', async (original) => ({ ...await original<typeof import('../services/familyMeals')>(), fetchFamilyMealsWeek: vi.fn() }));

const layout = (...ids: string[]): DisplayLayout => ({ version: 1, cols: 10, rows: 6, widgets: ids.map((i, y) => ({ i, x: 0, y, w: 10, h: 1 })) });
const prefs = (placed: DisplayLayout | null): UserPreferences => ({ ...DEFAULT_PREFS, show_energy_price: false, show_weather: false, show_news: false, layout: placed });
const stored = JSON.stringify({ baseUrl: 'https://meals.example.com', token: `fm_${'a'.repeat(40)}` });
const week = { familyName: null, weekStartDate: '2026-10-12', isoWeek: 42, today: '2026-10-14', planned: false, days: [] };

beforeEach(() => { vi.clearAllMocks(); });

describe('Family Meals in the display data', () => {
  it('does not fetch when the layout shown does not place the widget', async () => {
    const data = await buildDisplayData('u', prefs(layout('status')), { 'family-meals': stored });
    expect(fetchFamilyMealsWeek).not.toHaveBeenCalled();
    expect(data.familyMeals).toBeUndefined();
    expect(data.familyMealsError).toBeUndefined();
  });
  it('fetches with the saved credentials when the widget is placed', async () => {
    vi.mocked(fetchFamilyMealsWeek).mockResolvedValue(week as never);
    const data = await buildDisplayData('u', prefs(layout('family-meals')), { 'family-meals': stored });
    expect(fetchFamilyMealsWeek).toHaveBeenCalledWith('u', JSON.parse(stored), expect.any(AbortSignal));
    expect(data.familyMeals).toBe(week);
  });
  it('follows a draft layout passed in rather than the saved one', async () => {
    vi.mocked(fetchFamilyMealsWeek).mockResolvedValue(week as never);
    await buildDisplayData('u', prefs(layout('status')), { 'family-meals': stored }, layout('family-meals'));
    expect(fetchFamilyMealsWeek).toHaveBeenCalledTimes(1);
    await buildDisplayData('u', prefs(layout('family-meals')), { 'family-meals': stored }, layout('status'));
    expect(fetchFamilyMealsWeek).toHaveBeenCalledTimes(1);
  });
  it('says the widget is not configured when no token is saved, without a request', async () => {
    const data = await buildDisplayData('u', prefs(layout('family-meals')), {});
    expect(data.familyMealsError?.code).toBe('not_configured');
    expect(fetchFamilyMealsWeek).not.toHaveBeenCalled();
  });
  it('reports unreadable stored credentials as a configuration problem', async () => {
    const data = await buildDisplayData('u', prefs(layout('family-meals')), { 'family-meals': 'not json' });
    expect(data.familyMealsError?.code).toBe('invalid_configuration');
  });
  it('keeps a failing source from showing data, with a safe code and message', async () => {
    vi.mocked(fetchFamilyMealsWeek).mockRejectedValue(new FamilyMealsSourceError('invalid_token'));
    const data = await buildDisplayData('u', prefs(layout('family-meals')), { 'family-meals': stored });
    expect(data.familyMeals).toBeUndefined();
    expect(data.familyMealsError).toEqual({ code: 'invalid_token', message: expect.not.stringContaining('fm_') });
  });
  it('maps an unexpected failure to unavailable', async () => {
    vi.mocked(fetchFamilyMealsWeek).mockRejectedValue(new Error(`boom ${stored}`));
    const data = await buildDisplayData('u', prefs(layout('family-meals')), { 'family-meals': stored });
    expect(data.familyMealsError?.code).toBe('unavailable');
    expect(JSON.stringify(data)).not.toContain('fm_a');
  });
});
