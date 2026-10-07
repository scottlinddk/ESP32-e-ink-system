import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estimateCost, mergeModelTokens, normalizeModelId } from '../aiUsage/pricing';
import {
  AiUsagePayloadError, MAX_MACHINES, windowLabel, localTokensForDay, mergeAiUsage, parseAiUsagePush, projectLimits, sanitizeStored,
} from '../aiUsage/snapshot';
import { localDay, startOfLocalDay } from '../aiUsage/time';
import { buildAiUsage, clearAiUsageCache } from '../aiUsage';

vi.mock('../services/database', () => ({ getSupabaseClient: vi.fn() }));

const NOW = new Date('2026-10-07T10:00:00Z');
const ANTHROPIC_KEY = `sk-ant-admin01-${'a'.repeat(40)}`;
const OPENAI_KEY = `sk-admin-${'b'.repeat(40)}`;

const push = (providers: unknown, machine?: string) => parseAiUsagePush({ ...(machine ? { machine } : {}), providers }, NOW);
const limits = (used: number, resets = '2026-10-07T12:00:00Z', observed = '2026-10-07T09:55:00Z') => ({
  observed_at: observed,
  windows: [{ window_minutes: 10080, used_percent: 31, resets_at: '2026-10-12T08:00:00Z' }, { window_minutes: 300, used_percent: used, resets_at: resets }],
});
const usage = (day = '2026-10-07', input = 1000) => ({
  day, models: [{ model: 'claude-opus-5-5', input_tokens: input, output_tokens: 500, cache_write_tokens: 0, cache_read_tokens: 0 }],
});

describe('AI usage pricing', () => {
  it('normalizes provider prefixes, date snapshots and context suffixes', () => {
    expect(normalizeModelId('anthropic.claude-opus-4-5-20251101')).toBe('claude-opus-4-5');
    expect(normalizeModelId('Claude-Sonnet-4-6[1m]')).toBe('claude-sonnet-4-6');
    expect(normalizeModelId('gpt-6-sol-2026-09-22')).toBe('gpt-6-sol');
  });

  it('prices every token class and flags unknown models as a partial estimate', () => {
    const estimate = estimateCost([
      { model: 'claude-opus-5-5', input: 1_000_000, output: 1_000_000, cacheWrite: 2_000_000, cacheWrite1h: 1_000_000, cacheRead: 1_000_000 },
      { model: 'some-future-model', input: 10, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 },
    ]);
    // 4 input + 20 output + 5 (5-minute writes, 1.25x) + 8 (1-hour writes, 2x) + 0.20 cache read
    expect(estimate.costUsd).toBeCloseTo(37.2, 6);
    expect(estimate.tokens).toBe(5_000_010);
    expect(estimate.partial).toBe(true);
    expect(estimateCost([{ model: 'unknown', input: 5, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 }])).toEqual({ tokens: 5, costUsd: null, partial: false });
  });

  it('adds counts for the same model reported under different IDs', () => {
    const merged = mergeModelTokens(
      [{ model: 'claude-opus-5-5', input: 1, output: 2, cacheWrite: 3, cacheWrite1h: 1, cacheRead: 4 }],
      [{ model: 'claude-opus-5-5-20260901', input: 10, output: 20, cacheWrite: 30, cacheWrite1h: 10, cacheRead: 40 }],
    );
    expect(merged).toEqual([{ model: 'claude-opus-5-5', input: 11, output: 22, cacheWrite: 33, cacheWrite1h: 11, cacheRead: 44 }]);
  });
});

describe('AI usage push contract', () => {
  it('accepts aggregate quota windows and token counts, sorted by window length', () => {
    const parsed = push({ claude: { limits: limits(58.24), usage: usage() } }, 'laptop');
    expect(parsed.machine).toBe('laptop');
    expect(parsed.providers.claude?.limits?.windows.map((window) => window.window_minutes)).toEqual([300, 10080]);
    expect(parsed.providers.claude?.limits?.windows[0].used_percent).toBe(58.2);
  });

  it.each([
    [{ providers: { claude: { limits: limits(5), prompt: 'secret' } } }, 'does not accept "prompt"'],
    [{ providers: { gemini: { usage: usage() } } }, 'does not accept "gemini"'],
    [{ providers: {} }, 'must report limits or usage'],
    [{ machine: 'My Laptop', providers: { claude: { usage: usage() } } }, 'machine must be'],
    [{ providers: { claude: { usage: usage('2026-02-30') } } }, 'usage.day'],
    [{ providers: { claude: { usage: { day: '2026-10-07', models: [{ model: 'x', input_tokens: -1, output_tokens: 0 }] } } } }, 'whole number'],
    [{ providers: { claude: { limits: { ...limits(5), observed_at: '2026-10-08T00:00:00Z' } } } }, 'in the future'],
    [{ providers: { claude: { limits: { observed_at: '2026-10-07T09:00:00Z', windows: [] } } } }, '1–4 windows'],
    [{ providers: { claude: { usage: { day: '2026-10-07', models: [{ model: 'x', input_tokens: 0, output_tokens: 0, cache_write_tokens: 1, cache_write_1h_tokens: 2 }] } } } }, 'cannot exceed'],
  ])('rejects %j', (payload, message) => {
    expect(() => parseAiUsagePush(payload, NOW)).toThrow(AiUsagePayloadError);
    expect(() => parseAiUsagePush(payload, NOW)).toThrow(message);
  });

  it('keeps the newest quota report and per-machine token counts', () => {
    let stored = mergeAiUsage({}, push({ claude: { limits: limits(40), usage: usage('2026-10-07', 100) } }, 'laptop'), NOW);
    stored = mergeAiUsage(stored, push({ claude: { usage: usage('2026-10-07', 200) } }, 'desktop'), NOW);
    // An older quota report from a machine that was offline does not overwrite a newer one.
    stored = mergeAiUsage(stored, push({ claude: { limits: limits(10, undefined, '2026-10-07T08:00:00Z') } }, 'desktop'), NOW);
    expect(stored.claude?.limits?.windows[0].used_percent).toBe(40);
    expect(Object.keys(stored.claude?.usage ?? {}).sort()).toEqual(['desktop', 'laptop']);
    expect(localTokensForDay(stored.claude, '2026-10-07')?.map((entry) => entry.input).sort()).toEqual([100, 200]);
    expect(localTokensForDay(stored.claude, '2026-10-08')).toBeNull();
  });

  it(`keeps at most ${MAX_MACHINES} machines, dropping the least recent`, () => {
    let stored = {};
    for (let index = 0; index <= MAX_MACHINES; index++) {
      stored = mergeAiUsage(stored, push({ openai: { usage: usage() } }, `m${index}`), new Date(NOW.getTime() + index * 1000));
    }
    const machines = Object.keys((stored as { openai: { usage: object } }).openai.usage);
    expect(machines).toHaveLength(MAX_MACHINES);
    expect(machines).not.toContain('m0');
  });

  it('drops malformed stored data instead of trusting it', () => {
    expect(sanitizeStored({ claude: { limits: { windows: 'x' }, usage: { BAD: {} } }, other: {} })).toEqual({});
    expect(sanitizeStored(null)).toEqual({});
  });

  it('labels quota windows, rounding the minute Codex leaves off', () => {
    expect([300, 299, 10080, 10079, 1440, 90, 45].map(windowLabel)).toEqual(['5h', '5h', '7d', '7d', '1d', '90m', '45m']);
  });

  it('shows a window as reset once its reset time has passed', () => {
    const stored = mergeAiUsage({}, push({ claude: { limits: limits(80, '2026-10-07T09:59:00Z') } }), NOW);
    expect(projectLimits(stored.claude?.limits, NOW)).toEqual([
      { label: '5h', usedPercent: null, resetsAt: '2026-10-07T09:59:00.000Z' },
      { label: '7d', usedPercent: 31, resetsAt: '2026-10-12T08:00:00.000Z' },
    ]);
  });
});

describe('AI usage time helpers', () => {
  it('finds the local day and its start across time zones and DST', () => {
    expect(localDay(new Date('2026-10-06T22:30:00Z'), 'Europe/Copenhagen')).toBe('2026-10-07');
    expect(startOfLocalDay(new Date('2026-10-07T10:00:00Z'), 'Europe/Copenhagen').toISOString()).toBe('2026-10-06T22:00:00.000Z');
    // 25 October 2026 is the DST change in Copenhagen: midnight is still at +02:00.
    expect(startOfLocalDay(new Date('2026-10-25T12:00:00Z'), 'Europe/Copenhagen').toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(startOfLocalDay(new Date('2026-10-26T12:00:00Z'), 'Europe/Copenhagen').toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });
});

describe('Admin API usage', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { clearAiUsageCache(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('combines Anthropic token usage with the billed month and the pushed snapshot', async () => {
    fetchMock.mockImplementation(async (url: URL, init: RequestInit) => {
      expect((init.headers as Record<string, string>)['x-api-key']).toBe(ANTHROPIC_KEY);
      if (url.pathname.endsWith('/usage_report/messages')) {
        expect(url.searchParams.get('starting_at')).toBe('2026-10-06T22:00:00Z');
        expect(url.searchParams.getAll('group_by[]')).toEqual(['model']);
        return json({ data: [{ starting_at: 'x', ending_at: 'y', results: [{
          model: 'claude-opus-5-5', uncached_input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_000_000 },
        }] }], has_more: false, next_page: null });
      }
      expect(url.pathname.endsWith('/cost_report')).toBe(true);
      expect(url.searchParams.get('starting_at')).toBe('2026-10-01T00:00:00Z');
      return json({ data: [{ results: [{ amount: '1234.5', currency: 'USD' }] }, { results: [{ amount: '100', currency: 'USD' }] }], has_more: false, next_page: null });
    });
    const stored = mergeAiUsage({}, push({ claude: { limits: limits(58), usage: usage('2026-10-07', 1_000_000) } }), NOW);
    const data = await buildAiUsage({ stored, adminKeys: { claude: ANTHROPIC_KEY }, timeZone: 'Europe/Copenhagen', now: NOW });
    expect(data.providers).toHaveLength(1);
    const claude = data.providers[0];
    expect(claude.monthCostUsd).toBeCloseTo(13.345, 6);
    // 2M input at $4, 1M one-hour cache writes at $8 and 500 output at $20 per million.
    expect(claude.today?.tokens).toBe(3_000_500);
    expect(claude.today?.costUsd).toBeCloseTo(16.01, 6);
    expect(claude.limits.map((limit) => limit.usedPercent)).toEqual([58, 31]);
  });

  it('subtracts cached tokens from OpenAI input and reports a rejected key without leaking it', async () => {
    fetchMock.mockImplementation(async (url: URL) => url.pathname.endsWith('/usage/completions')
      ? json({ object: 'page', data: [{ results: [{ model: 'gpt-6-sol', input_tokens: 1000, input_cached_tokens: 400, output_tokens: 10 }] }], has_more: false })
      : json({ object: 'page', data: [{ results: [{ amount: { value: 2.5, currency: 'usd' } }] }], has_more: false }));
    const data = await buildAiUsage({ stored: {}, adminKeys: { openai: OPENAI_KEY }, timeZone: 'UTC', now: NOW });
    expect(data.providers[0].today?.tokens).toBe(1010);
    expect(data.providers[0].monthCostUsd).toBe(2.5);

    clearAiUsageCache();
    fetchMock.mockImplementation(async () => json({ error: { message: `bad key ${OPENAI_KEY}` } }, 401));
    const rejected = await buildAiUsage({ stored: {}, adminKeys: { openai: OPENAI_KEY }, timeZone: 'UTC', now: NOW });
    expect(rejected.providers[0].adminError?.code).toBe('invalid_key');
    expect(JSON.stringify(rejected)).not.toContain(OPENAI_KEY);
  });

  it('caches reports, and refuses keys that are not admin keys without calling the API', async () => {
    fetchMock.mockImplementation(async () => json({ data: [], has_more: false }));
    await buildAiUsage({ stored: {}, adminKeys: { claude: ANTHROPIC_KEY }, timeZone: 'UTC', now: NOW });
    await buildAiUsage({ stored: {}, adminKeys: { claude: ANTHROPIC_KEY }, timeZone: 'UTC', now: NOW });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const regular = await buildAiUsage({ stored: {}, adminKeys: { claude: 'sk-ant-api03-not-an-admin-key-xxxxxxxxxxxx' }, timeZone: 'UTC', now: NOW });
    expect(regular.providers[0].adminError?.code).toBe('invalid_key');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('omits providers with no snapshot and no key', async () => {
    expect(await buildAiUsage({ stored: {}, adminKeys: {}, timeZone: 'UTC', now: NOW })).toEqual({ providers: [] });
  });
});
