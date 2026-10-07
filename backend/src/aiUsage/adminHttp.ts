import type { AiUsageErrorCode, AiUsageProblem } from './types';

const MESSAGES: Record<AiUsageErrorCode, string> = {
  invalid_key: 'The provider rejected the Admin API key. Check that it is an active admin key.',
  forbidden: 'The key cannot read usage reports. Use an organization Admin API key; individual accounts have no Admin API.',
  rate_limited: 'The usage API rate limit was reached. Try again in a minute.',
  unavailable: 'The usage API is unavailable. Try again later.',
  timeout: 'The usage API did not respond in time. Try again.',
  invalid_response: 'The usage API returned incomplete or invalid data.',
};

/** Only fixed messages leave the provider boundary: never a key, URL or response body. */
export class AiUsageSourceError extends Error {
  constructor(readonly code: AiUsageErrorCode) {
    super(MESSAGES[code]);
    this.name = 'AiUsageSourceError';
  }
}

export function aiUsageProblem(error: unknown): AiUsageProblem {
  const code = error instanceof AiUsageSourceError ? error.code
    : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout'
    : 'unavailable';
  return { code, message: MESSAGES[code] };
}

const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
export const USER_AGENT = 'ESP32-e-ink-system/1.0 (+https://github.com/scottlinddk/ESP32-e-ink-system)';

/** GETs a JSON document with a deadline and a size limit, mapping failures to fixed error codes. */
export async function getJson(url: URL, headers: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new AiUsageSourceError('timeout')), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort(new AiUsageSourceError('timeout'));
  signal?.addEventListener('abort', abort, { once: true });
  try {
    let response: Response;
    try {
      response = await fetch(url, { headers: { ...headers, 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: controller.signal, redirect: 'error' });
    } catch {
      throw new AiUsageSourceError(controller.signal.aborted ? 'timeout' : 'unavailable');
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      if (response.status === 401) throw new AiUsageSourceError('invalid_key');
      if (response.status === 403 || response.status === 404) throw new AiUsageSourceError('forbidden');
      if (response.status === 429) throw new AiUsageSourceError('rate_limited');
      throw new AiUsageSourceError('unavailable');
    }
    if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
      void response.body?.cancel().catch(() => {});
      throw new AiUsageSourceError('invalid_response');
    }
    let text: string;
    try { text = await response.text(); } catch { throw new AiUsageSourceError(controller.signal.aborted ? 'timeout' : 'unavailable'); }
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new AiUsageSourceError('invalid_response');
    try { return JSON.parse(text); } catch { throw new AiUsageSourceError('invalid_response'); }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A finite, non-negative number from a JSON value, or an invalid_response error. */
export function amount(value: unknown): number {
  const number = typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) throw new AiUsageSourceError('invalid_response');
  return number;
}

/** Follows `next_page` cursors, stopping after `maxPages` so a misbehaving API cannot loop. */
export async function collectPages(
  load: (page: string | null) => Promise<unknown>,
  maxPages = 5,
): Promise<Record<string, unknown>[]> {
  const buckets: Record<string, unknown>[] = [];
  let page: string | null = null;
  for (let index = 0; index < maxPages; index++) {
    const body = await load(page);
    if (!isRecord(body) || !Array.isArray(body.data)) throw new AiUsageSourceError('invalid_response');
    for (const bucket of body.data) {
      if (!isRecord(bucket) || !Array.isArray(bucket.results)) throw new AiUsageSourceError('invalid_response');
      buckets.push(bucket);
    }
    if (body.has_more !== true) return buckets;
    if (typeof body.next_page !== 'string' || !body.next_page) throw new AiUsageSourceError('invalid_response');
    page = body.next_page;
  }
  return buckets;
}
