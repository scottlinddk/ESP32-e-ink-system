import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearFamilyMealsCache, FamilyMealsSourceError, fetchFamilyMealsWeek, parseFamilyMealsWeek } from '../services/familyMeals';
import { normalizeFamilyMealsCredentials } from '../utils/familyMealsCredentials';
import { FeedStatusError, fetchPublicFeed } from '../utils/publicFeedFetch';

vi.mock('../utils/publicFeedFetch', async (original) => ({ ...await original<typeof import('../utils/publicFeedFetch')>(), fetchPublicFeed: vi.fn() }));

const token = `fm_${'a'.repeat(40)}`;
const credentials = { baseUrl: 'https://meals.example.com', token };
const day = (weekday: number, overrides: Record<string, unknown> = {}) => ({
  date: `2026-10-${12 + weekday}`, weekday, kind: 'dinner', title: `Dish ${weekday}`, note: null, dinnerTime: '18:00', totalTimeMinutes: 30, ...overrides,
});
const week = (overrides: Record<string, unknown> = {}) => ({
  familyName: 'Lind', weekStartDate: '2026-10-12', isoWeek: 42, today: '2026-10-14', planned: true,
  days: Array.from({ length: 7 }, (_, weekday) => day(weekday)), ...overrides,
});
const reply = (body: unknown) => vi.mocked(fetchPublicFeed).mockResolvedValue({ text: JSON.stringify(body), url: 'https://meals.example.com/api/widget/week' });

beforeEach(() => { vi.clearAllMocks(); clearFamilyMealsCache(); });
afterEach(() => { vi.useRealTimers(); });

describe('Family Meals credentials', () => {
  it('keeps only the origin and trims the token', () => {
    expect(normalizeFamilyMealsCredentials({ baseUrl: ' https://meals.example.com/some/page?x=1#top ', token: ` ${token} ` })).toEqual(credentials);
  });
  it.each([
    null, [], { baseUrl: 'https://meals.example.com' }, { token },
    { baseUrl: 'http://meals.example.com', token }, { baseUrl: 'https://localhost', token }, { baseUrl: 'https://192.168.1.10', token },
    { baseUrl: 'https://user:pw@meals.example.com', token }, { baseUrl: 'https://meals.example.com:8443', token }, { baseUrl: 12, token },
    { baseUrl: 'https://meals.example.com', token: 'fm_short' }, { baseUrl: 'https://meals.example.com', token: 'sk_' + 'a'.repeat(40) },
    { baseUrl: 'https://meals.example.com', token: `fm_${'a'.repeat(19)}\n` }, { baseUrl: 'https://meals.example.com', token, extra: 1 },
  ])('rejects %j without echoing the token', (value) => {
    expect(() => normalizeFamilyMealsCredentials(value)).toThrow();
    try { normalizeFamilyMealsCredentials(value); } catch (error) { expect(String(error)).not.toContain('aaaaaaaa'); }
  });
});

describe('parseFamilyMealsWeek', () => {
  it('accepts the API answer and strips control characters from text', () => {
    const parsed = parseFamilyMealsWeek(week({ days: Array.from({ length: 7 }, (_, i) => day(i, i === 0 ? { title: 'Pasta\u0000\nbake' } : {})) }));
    expect(parsed.days[0]!.title).toBe('Pasta bake');
    expect(parsed.isoWeek).toBe(42);
  });
  it.each([
    ['not an object', 'x'], ['six days', week({ days: week().days.slice(0, 6) })], ['planned missing', week({ planned: undefined })],
    ['unknown kind', week({ days: week().days.map((d, i) => i === 0 ? { ...d, kind: 'party' } : d) })],
    ['weekday out of order', week({ days: [...week().days].reverse() })],
    ['bad date', week({ today: 'tomorrow' })], ['bad time', week({ days: week().days.map((d, i) => i === 0 ? { ...d, dinnerTime: '6pm' } : d) })],
    ['title not text', week({ days: week().days.map((d, i) => i === 0 ? { ...d, title: 7 } : d) })], ['iso week 99', week({ isoWeek: 99 })],
  ])('rejects %s', (_name, body) => {
    expect(() => parseFamilyMealsWeek(body)).toThrow(FamilyMealsSourceError);
  });
});

describe('optional recipe details', () => {
  const withDay = (overrides: Record<string, unknown>) => week({ days: Array.from({ length: 7 }, (_, weekday) => day(weekday, weekday === 2 ? overrides : {})) });
  it('are absent from a day that does not send them, so today\'s answers parse unchanged', () => {
    const parsed = parseFamilyMealsWeek(week());
    expect(parsed.days.every((d) => !('ingredients' in d) && !('tags' in d))).toBe(true);
  });
  it('keep ingredient lines and tags, cleaned and bounded', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `ingredient ${i}`);
    const parsed = parseFamilyMealsWeek(withDay({ ingredients: [' flour\n272 g ', 'x'.repeat(200), ' '], tags: ['vegetarian', 'y'.repeat(60)] }));
    expect(parsed.days[2]!.ingredients).toEqual(['flour 272 g', 'x'.repeat(80)]);
    expect(parsed.days[2]!.tags).toEqual(['vegetarian', 'y'.repeat(24)]);
    expect(parseFamilyMealsWeek(withDay({ ingredients: lines })).days[2]!.ingredients).toHaveLength(30);
  });
  it('treat null or only blank lines as absent', () => {
    expect(parseFamilyMealsWeek(withDay({ ingredients: null, tags: [' ', ''] })).days[2]).not.toHaveProperty('ingredients');
    expect(parseFamilyMealsWeek(withDay({ tags: [' ', ''] })).days[2]).not.toHaveProperty('tags');
  });
  it.each([
    ['ingredients', 'flour'], ['ingredients', [1]], ['ingredients', Array.from({ length: 31 }, () => 'x')],
    ['tags', { a: 1 }], ['tags', [null]], ['tags', Array.from({ length: 9 }, () => 'x')],
  ])('reject %s of %j as invalid data', (field, value) => {
    expect(() => parseFamilyMealsWeek(withDay({ [field]: value }))).toThrow(FamilyMealsSourceError);
  });
});

describe('fetchFamilyMealsWeek', () => {
  it('sends the token only to the saved origin, never following redirects, and returns the week', async () => {
    reply(week());
    const signal = new AbortController().signal;
    const data = await fetchFamilyMealsWeek('user-1', credentials, signal);
    expect(data.days).toHaveLength(7);
    expect(fetchPublicFeed).toHaveBeenCalledWith('https://meals.example.com/api/widget/week', signal, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
  });
  it('caches per user for a few minutes, and a changed credential bypasses the cache', async () => {
    vi.useFakeTimers();
    reply(week());
    await fetchFamilyMealsWeek('user-1', credentials);
    await fetchFamilyMealsWeek('user-1', credentials);
    expect(fetchPublicFeed).toHaveBeenCalledTimes(1);
    await fetchFamilyMealsWeek('user-1', { ...credentials, token: `fm_${'b'.repeat(40)}` });
    expect(fetchPublicFeed).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 6 * 60_000);
    await fetchFamilyMealsWeek('user-1', { ...credentials, token: `fm_${'b'.repeat(40)}` });
    expect(fetchPublicFeed).toHaveBeenCalledTimes(3);
  });
  it('does not share a cache entry between users', async () => {
    reply(week());
    await fetchFamilyMealsWeek('user-1', credentials);
    await fetchFamilyMealsWeek('user-2', credentials);
    expect(fetchPublicFeed).toHaveBeenCalledTimes(2);
  });
  it.each([
    [new FeedStatusError(401), 'invalid_token'], [new FeedStatusError(500), 'unavailable'], [new FeedStatusError(503), 'unavailable'],
    [new Error('Unable to retrieve feed'), 'unavailable'], [new Error('Authenticated feed requests do not follow redirects'), 'unavailable'],
  ])('maps %s to %s without leaking the token', async (error, code) => {
    vi.mocked(fetchPublicFeed).mockRejectedValue(error);
    const failure = await fetchFamilyMealsWeek('user-1', credentials).then(() => undefined, (e: unknown) => e as FamilyMealsSourceError);
    expect(failure).toBeInstanceOf(FamilyMealsSourceError);
    if (!failure) return;
    expect(failure.code).toBe(code);
    expect(failure.message).not.toContain(token);
  });
  it('reports invalid JSON and invalid shapes as invalid_response', async () => {
    vi.mocked(fetchPublicFeed).mockResolvedValue({ text: '<html>', url: '' });
    await expect(fetchFamilyMealsWeek('user-1', credentials)).rejects.toMatchObject({ code: 'invalid_response' });
    reply({ nope: true });
    await expect(fetchFamilyMealsWeek('user-1', credentials)).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('rejects stored credentials that no longer validate, without any request', async () => {
    await expect(fetchFamilyMealsWeek('user-1', { baseUrl: 'http://meals.example.com', token })).rejects.toMatchObject({ code: 'invalid_configuration' });
    expect(fetchPublicFeed).not.toHaveBeenCalled();
  });
  it('reports a cancelled request as a timeout and never caches a failure', async () => {
    const controller = new AbortController();
    vi.mocked(fetchPublicFeed).mockImplementation(async () => { controller.abort(new Error('late')); throw new Error('aborted'); });
    await expect(fetchFamilyMealsWeek('user-1', credentials, controller.signal)).rejects.toMatchObject({ code: 'timeout' });
    reply(week());
    await expect(fetchFamilyMealsWeek('user-1', credentials)).resolves.toBeDefined();
  });
});
