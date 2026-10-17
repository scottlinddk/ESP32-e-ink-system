import { validatePublicHttpsUrl } from './publicFeedFetch';

/** The Family Meals address and the API token created under its "API access" card. */
export interface FamilyMealsCredentials {
  /** The origin only, e.g. `https://family-meals.example.com`. */
  baseUrl: string;
  token: string;
}

/** Matches the tokens Family Meals issues: `fm_` and 40 URL-safe characters. Looser bounds leave room for a longer format. */
const TOKEN_PATTERN = /^fm_[A-Za-z0-9_-]{20,100}$/;

/** Validate untrusted route input and return only the normalized, supported fields. */
export function normalizeFamilyMealsCredentials(input: unknown): FamilyMealsCredentials {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Family Meals credentials must be an object.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== 'baseUrl' && key !== 'token')) throw new Error('Unsupported Family Meals credential field.');
  if (typeof value.token !== 'string' || !TOKEN_PATTERN.test(value.token.trim())) {
    throw new Error('Use an API token beginning with fm_ from Family Meals.');
  }
  if (typeof value.baseUrl !== 'string') throw new Error('Family Meals credentials require the app address.');
  let origin: string;
  try {
    // The request goes to a fixed path under this origin, so any path, query or fragment pasted along is dropped.
    const url = validatePublicHttpsUrl(value.baseUrl.trim().replace(/[?#].*$/, ''));
    origin = url.origin;
  } catch {
    throw new Error('Use the public HTTPS address of your Family Meals app, for example https://family-meals.example.com.');
  }
  return { baseUrl: origin, token: value.token.trim() };
}
