export type NewsErrorCode = 'unsupported_coverage' | 'missing_key' | 'invalid_key' | 'rate_limited' | 'unavailable' | 'timeout' | 'invalid_response';
export interface NewsProblem { code: NewsErrorCode; message: string }

const MESSAGES: Record<NewsErrorCode, string> = {
  unsupported_coverage: 'NewsAPI does not support this selected coverage. Choose RSS / Atom for Danish or Finnish news, or select supported NewsAPI coverage.',
  missing_key: 'Save a NewsAPI key or select an RSS / Atom feed.',
  invalid_key: 'NewsAPI rejected the saved key or its access. Check the key and subscription.',
  rate_limited: 'NewsAPI request limit reached. Check your quota or use an RSS / Atom feed.',
  unavailable: 'News is unavailable. Try again later or check the selected feed.',
  timeout: 'The news provider did not respond in time. Try again.',
  invalid_response: 'The news provider returned invalid data. Try again later.',
};
export const NEWS_ERROR_LABELS: Record<NewsErrorCode, string> = {
  unsupported_coverage: 'Use RSS feed', missing_key: 'Add API key', invalid_key: 'Check API key',
  rate_limited: 'API limit', unavailable: 'Unavailable', timeout: 'Timed out', invalid_response: 'Invalid data',
};
export class NewsSourceError extends Error {
  constructor(readonly code: NewsErrorCode) { super(MESSAGES[code]); this.name = 'NewsSourceError'; }
}
export function newsProblem(error: unknown): NewsProblem {
  const code = error instanceof NewsSourceError ? error.code
    : error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout' : 'unavailable';
  return { code, message: MESSAGES[code] };
}
