// The language of the words drawn on a device's display (widget labels, month and
// weekday names). It is separate from the web app's language and from the news language.
export const DISPLAY_LANGUAGES = ['en', 'da'] as const;
export type DisplayLanguage = typeof DISPLAY_LANGUAGES[number];
export const DEFAULT_DISPLAY_LANGUAGE: DisplayLanguage = 'en';

/** The saved language, or English for a device that has never chosen one. */
export function displayLanguageOf(value: unknown): DisplayLanguage {
  return (DISPLAY_LANGUAGES as readonly string[]).includes(value as string) ? value as DisplayLanguage : DEFAULT_DISPLAY_LANGUAGE;
}

/** Each language is named in itself, so a user who cannot read the current one can still find theirs. */
export const DISPLAY_LANGUAGE_NAMES: Record<DisplayLanguage, string> = { en: 'English', da: 'Dansk' };

/** One example of how a widget reads in each language, shown beside the choice. */
export const DISPLAY_LANGUAGE_EXAMPLES: Record<DisplayLanguage, string> = {
  en: 'Spot: 1.25 DKK/kWh · Wind: 3.0 m/s · Week 41',
  da: 'Spot: 1,25 kr/kWh · Vind: 3,0 m/s · Uge 41',
};
