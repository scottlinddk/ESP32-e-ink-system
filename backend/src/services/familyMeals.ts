import { createHash } from 'node:crypto';
import type { FamilyMealsData, FamilyMealsDay } from '../types/index';
import { normalizeFamilyMealsCredentials, type FamilyMealsCredentials } from '../utils/familyMealsCredentials';
import { FeedStatusError, fetchPublicFeed } from '../utils/publicFeedFetch';
export type { FamilyMealsCredentials } from '../utils/familyMealsCredentials';

/** The plan changes a few times a week at most, and the panel refreshes every 15 to 60 minutes. */
const CACHE_TTL_MS = 5 * 60 * 1000;
const WEEK_PATH = '/api/widget/week';
const cache = new Map<string, { signature: string; data: FamilyMealsData; expiresAt: number }>();

const MESSAGES = {
  not_configured: 'Add the Family Meals address and API token.',
  invalid_configuration: 'Check the Family Meals address and API token.',
  invalid_token: 'Family Meals rejected the API token. Create a new one and save it.',
  invalid_response: 'Family Meals returned incomplete or invalid data. Try again later.',
  timeout: 'Family Meals did not respond in time. Try again.',
  unavailable: 'Family Meals is unavailable. Try again later.',
} as const;
export type FamilyMealsSourceErrorCode = keyof typeof MESSAGES;
export class FamilyMealsSourceError extends Error {
  constructor(readonly code: FamilyMealsSourceErrorCode) { super(MESSAGES[code]); this.name = 'FamilyMealsSourceError'; }
}

const KINDS: readonly FamilyMealsDay['kind'][] = ['dinner', 'leftover', 'empty', 'unplanned'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

const MAX_INGREDIENTS = 30;
const MAX_TAGS = 8;

function invalid(): never { throw new FamilyMealsSourceError('invalid_response'); }

/** Text is drawn with a bitmap font, so control characters are dropped and the length bounded. */
function text(value: unknown, limit: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return invalid();
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, limit) || null;
}

/** An optional list of short lines: absent is fine, a list of anything but text is not. */
function lines(value: unknown, count: number, limit: number): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > count) return invalid();
  const kept = value.map((line) => (typeof line === 'string' ? text(line, limit) : invalid())).filter((line): line is string => line !== null);
  return kept.length ? kept : undefined;
}

function wholeNumber(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return invalid();
  return value;
}

function isoDate(value: unknown): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return invalid();
  return value;
}

/** Validates the untrusted answer field by field; anything unexpected rejects the whole answer. */
export function parseFamilyMealsWeek(json: unknown): FamilyMealsData {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return invalid();
  const body = json as Record<string, unknown>;
  if (!Array.isArray(body.days) || body.days.length !== 7 || typeof body.planned !== 'boolean') return invalid();
  const days = body.days.map((entry, index): FamilyMealsDay => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return invalid();
    const day = entry as Record<string, unknown>;
    if (typeof day.kind !== 'string' || !KINDS.includes(day.kind as FamilyMealsDay['kind'])) return invalid();
    const weekday = wholeNumber(day.weekday, 0, 6);
    if (weekday !== index) return invalid();
    const ingredients = lines(day.ingredients, MAX_INGREDIENTS, 80);
    const tags = lines(day.tags, MAX_TAGS, 24);
    const dinnerTime = text(day.dinnerTime, 5);
    if (dinnerTime !== null && !TIME.test(dinnerTime)) return invalid();
    return {
      date: isoDate(day.date), weekday, kind: day.kind as FamilyMealsDay['kind'],
      title: text(day.title, 120), note: text(day.note, 80), dinnerTime,
      totalTimeMinutes: day.totalTimeMinutes === null ? null : wholeNumber(day.totalTimeMinutes, 0, 24 * 60),
      ...(ingredients && { ingredients }), ...(tags && { tags }),
    };
  });
  return {
    familyName: text(body.familyName, 60), weekStartDate: isoDate(body.weekStartDate),
    isoWeek: wholeNumber(body.isoWeek, 1, 53), today: isoDate(body.today), planned: body.planned, days,
  };
}

export async function fetchFamilyMealsWeek(userId: string, credentials: FamilyMealsCredentials, signal: AbortSignal = AbortSignal.timeout(10_000)): Promise<FamilyMealsData> {
  try {
    signal.throwIfAborted();
    let creds: FamilyMealsCredentials;
    try { creds = normalizeFamilyMealsCredentials(credentials); }
    catch { throw new FamilyMealsSourceError('invalid_configuration'); }
    const signature = createHash('sha256').update(JSON.stringify(creds)).digest('hex');
    for (const [key, entry] of cache) if (entry.expiresAt <= Date.now()) cache.delete(key);
    const cached = cache.get(userId);
    if (cached?.signature === signature) return cached.data;

    // The token is sent only to the address the user saved, over public HTTPS with a pinned DNS answer, and no redirect is followed.
    const { text: body } = await fetchPublicFeed(`${creds.baseUrl}${WEEK_PATH}`, signal, {
      headers: { Authorization: `Bearer ${creds.token}`, Accept: 'application/json' },
    });
    let json: unknown;
    try { json = JSON.parse(body); } catch { throw new FamilyMealsSourceError('invalid_response'); }
    const data = parseFamilyMealsWeek(json);
    signal.throwIfAborted();
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(userId, { signature, data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch (error) {
    if (signal.aborted) throw new FamilyMealsSourceError('timeout');
    if (error instanceof FamilyMealsSourceError) throw error;
    if (error instanceof FeedStatusError) throw new FamilyMealsSourceError(error.status === 401 ? 'invalid_token' : 'unavailable');
    // Invalid UTF-8 in the body is a malformed answer, not an outage.
    if (error instanceof TypeError && /encoded data|UTF-8/i.test(error.message)) throw new FamilyMealsSourceError('invalid_response');
    throw new FamilyMealsSourceError('unavailable');
  }
}

export function clearFamilyMealsCache(userId?: string): void {
  if (userId) cache.delete(userId); else cache.clear();
}
