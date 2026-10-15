// The language of the words drawn on a device's display. It is a per-device
// presentation setting and does not affect the web app or the data providers.
export const DISPLAY_LANGUAGES = ['en', 'da'] as const;
export type DisplayLanguage = typeof DISPLAY_LANGUAGES[number];
export const DEFAULT_DISPLAY_LANGUAGE: DisplayLanguage = 'en';

export function isDisplayLanguage(value: unknown): value is DisplayLanguage {
  return typeof value === 'string' && (DISPLAY_LANGUAGES as readonly string[]).includes(value);
}

/** Strict, for untrusted input: an unknown language is an error, never a silent fallback. */
export function parseDisplayLanguage(value: unknown): DisplayLanguage {
  if (!isDisplayLanguage(value)) throw new Error(`Display language must be one of: ${DISPLAY_LANGUAGES.join(', ')}.`);
  return value;
}

/** Lenient, for rendering stored settings: a missing value (an unmigrated row) draws English. */
export function displayLanguageOrDefault(value: unknown): DisplayLanguage {
  return isDisplayLanguage(value) ? value : DEFAULT_DISPLAY_LANGUAGE;
}

/** A decimal number with the language's separator: 1.50 (en) or 1,50 (da). */
export function formatDecimal(value: number, digits: number, language: DisplayLanguage): string {
  const text = value.toFixed(digits);
  return language === 'da' ? text.replace('.', ',') : text;
}
