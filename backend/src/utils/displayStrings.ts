import type { EnergyPriceErrorCode } from './energyPriceErrors';
import type { NewsErrorCode } from './newsErrors';
import type { NotionSourceErrorCode } from '../services/notion';
import type { WeatherErrorCode } from '../types/index';
import { DEFAULT_DISPLAY_LANGUAGE, type DisplayLanguage } from './displayLanguage';

// Every word the widgets draw on the display, per language. Strings must stay within
// the 8x8 bitmap font (see docs/TEXT_RENDERING.md); a test checks both catalogs.
// Widgets size and clip their text, so a longer translation is shortened, not overflowed.

/** A calendar day and its zero-based month, for week ranges. */
export interface MonthDay { day: number; month: number }

export interface DisplayStrings {
  /** Names are in the catalog, not the runtime's locale data, so a Node build without full ICU cannot fall back to English. */
  dates: {
    /** Sunday first, like Date#getDay. */
    weekdays: readonly string[];
    dayMonth: (date: MonthDay) => string;
  };
  energy: {
    estimate: string; spot: string; unit: string; inclVat: string; exclTax: string;
    average: string; missing: string; unavailable: string;
    errors: Record<EnergyPriceErrorCode, string>;
  };
  weather: {
    title: string; wind: string; unavailable: string;
    /** Keyed by the normalised condition in services/weather.ts. */
    conditions: Record<string, string>;
    errors: Record<WeatherErrorCode, string>;
  };
  news: { none: string; unavailable: string; errors: Record<NewsErrorCode, string> };
  chargers: {
    unavailable: (name: string) => string;
    status: (available: number, charging: number) => string;
    createdToday: string;
  };
  notion: {
    unavailable: string; none: string;
    errors: Partial<Record<NotionSourceErrorCode, string>>;
  };
  calendar: { none: string; unavailable: string; allDay: string };
  status: { refresh: string };
  week: {
    title: string; label: string; short: string;
    range: (start: MonthDay, end: MonthDay) => string;
  };
  webhook: { stale: string; unavailable: string; title: string };
  aiUsage: {
    noSource: string; unavailable: string; session: string; weekly: string;
    resets: string; resetsIn: string; reset: string;
    apiCheckKey: string; apiUnavailable: string; apiMonth: string; api: string;
    cacheLabels: ReadonlyArray<readonly [string, string]>;
    input: string; output: string; cacheHit: string;
  };
}

const MONTHS: Record<DisplayLanguage, readonly string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  da: ['jan.', 'feb.', 'mar.', 'apr.', 'maj', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.'],
};

const en: DisplayStrings = {
  dates: {
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    dayMonth: ({ day, month }) => `${day} ${MONTHS.en[month]}`,
  },
  energy: {
    estimate: 'Est', spot: 'Spot', unit: 'DKK/kWh', inclVat: 'Incl VAT; no fixed fees', exclTax: 'Excl tax/fees',
    average: 'Avg', missing: 'Missing', unavailable: 'Energy: unavailable',
    errors: {
      invalid_settings: 'Energy: check settings', missing_tariff: 'Energy: check tariff',
      unavailable: 'Energy: unavailable', timeout: 'Energy: timed out', invalid_response: 'Energy: invalid data',
    },
  },
  weather: {
    title: 'Weather', wind: 'Wind', unavailable: 'Unavailable',
    conditions: {
      clear: 'clear', cloudy: 'cloudy', rain: 'rain', drizzle: 'drizzle', storm: 'storm', snow: 'snow',
      mist: 'mist', fog: 'fog', haze: 'haze', dust: 'dust', smoke: 'smoke', sand: 'sand', ash: 'ash',
      squall: 'squall', tornado: 'tornado',
    },
    errors: {
      missing_key: 'Add API key', invalid_location: 'Check location', invalid_key: 'Check API key',
      rate_limited: 'API limit', unavailable: 'Unavailable', timeout: 'Timed out', invalid_response: 'Invalid data',
    },
  },
  news: {
    none: 'No headlines', unavailable: 'News: unavailable',
    errors: {
      unsupported_coverage: 'Use RSS feed', missing_key: 'Add API key', invalid_key: 'Check API key',
      rate_limited: 'API limit', unavailable: 'Unavailable', timeout: 'Timed out', invalid_response: 'Invalid data',
    },
  },
  chargers: {
    unavailable: (name) => `${name}: unavailable`,
    status: (available, charging) => `${available} avail  ${charging} charging`,
    createdToday: 'Created today',
  },
  notion: {
    unavailable: 'Notion: unavailable', none: 'No items',
    errors: {
      data_source_required: 'Select data source', invalid_data_source: 'Check source ID',
      invalid_configuration: 'Check Notion setup', invalid_token: 'Check Notion key',
      access_denied: 'Share database', rate_limited: 'Notion API limit', timeout: 'Notion timed out',
    },
  },
  calendar: { none: 'No upcoming events', unavailable: 'Calendar: unavailable', allDay: 'All day' },
  status: { refresh: 'Refresh' },
  week: {
    title: 'WEEK', label: 'Week', short: 'W',
    range: (start, end) => start.month === end.month
      ? `${MONTHS.en[start.month]} ${start.day}-${end.day}`
      : `${MONTHS.en[start.month]} ${start.day}-${MONTHS.en[end.month]} ${end.day}`,
  },
  webhook: { stale: 'STALE sensors', unavailable: 'No sensor data', title: 'Sensors' },
  aiUsage: {
    noSource: 'AI usage: no source', unavailable: 'AI usage: unavailable', session: 'Session', weekly: 'Weekly',
    resets: 'Resets', resetsIn: 'in', reset: 'reset',
    apiCheckKey: 'API: check key', apiUnavailable: 'API: unavailable', apiMonth: 'API month', api: 'API',
    cacheLabels: [['Cache read', 'Cache write'], ['Cache rd', 'Cache wr'], ['Rd', 'Wr']],
    input: 'Input', output: 'Output', cacheHit: 'Cache hit',
  },
};

const da: DisplayStrings = {
  dates: {
    weekdays: ['søn.', 'man.', 'tirs.', 'ons.', 'tors.', 'fre.', 'lør.'],
    dayMonth: ({ day, month }) => `${day}. ${MONTHS.da[month]}`,
  },
  energy: {
    estimate: 'Est', spot: 'Spot', unit: 'kr/kWh', inclVat: 'Inkl. moms, uden faste gebyrer', exclTax: 'Ekskl. afgifter og gebyrer',
    average: 'Gns', missing: 'Mangler', unavailable: 'Elpris: ikke tilgængelig',
    errors: {
      invalid_settings: 'Elpris: tjek indstillinger', missing_tariff: 'Elpris: tjek tarif',
      unavailable: 'Elpris: ikke tilgængelig', timeout: 'Elpris: timeout', invalid_response: 'Elpris: ugyldige data',
    },
  },
  weather: {
    title: 'Vejr', wind: 'Vind', unavailable: 'Ikke tilgængelig',
    conditions: {
      clear: 'klart', cloudy: 'skyet', rain: 'regn', drizzle: 'støvregn', storm: 'torden', snow: 'sne',
      mist: 'dis', fog: 'tåge', haze: 'dis', dust: 'støv', smoke: 'røg', sand: 'sand', ash: 'aske',
      squall: 'vindstød', tornado: 'tornado',
    },
    errors: {
      missing_key: 'Tilføj API-nøgle', invalid_location: 'Tjek placering', invalid_key: 'Tjek API-nøgle',
      rate_limited: 'API-grænse', unavailable: 'Ikke tilgængelig', timeout: 'Timeout', invalid_response: 'Ugyldige data',
    },
  },
  news: {
    none: 'Ingen overskrifter', unavailable: 'Nyheder: ikke tilgængelig',
    errors: {
      unsupported_coverage: 'Brug RSS-feed', missing_key: 'Tilføj API-nøgle', invalid_key: 'Tjek API-nøgle',
      rate_limited: 'API-grænse', unavailable: 'Ikke tilgængelig', timeout: 'Timeout', invalid_response: 'Ugyldige data',
    },
  },
  chargers: {
    unavailable: (name) => `${name}: ikke tilgængelig`,
    status: (available, charging) => `${available} ledige  ${charging} lader`,
    createdToday: 'Sessioner i dag',
  },
  notion: {
    unavailable: 'Notion: ikke tilgængelig', none: 'Ingen elementer',
    errors: {
      data_source_required: 'Vælg datakilde', invalid_data_source: 'Tjek kilde-ID',
      invalid_configuration: 'Tjek Notion-opsætning', invalid_token: 'Tjek Notion-nøgle',
      access_denied: 'Del databasen', rate_limited: 'Notion API-grænse', timeout: 'Notion timeout',
    },
  },
  calendar: { none: 'Ingen kommende aftaler', unavailable: 'Kalender: ikke tilgængelig', allDay: 'Hele dagen' },
  status: { refresh: 'Opdatering' },
  week: {
    title: 'UGE', label: 'Uge', short: 'U',
    range: (start, end) => start.month === end.month
      ? `${start.day}.-${end.day}. ${MONTHS.da[start.month]}`
      : `${start.day}. ${MONTHS.da[start.month]}-${end.day}. ${MONTHS.da[end.month]}`,
  },
  webhook: { stale: 'FORÆLDEDE sensorer', unavailable: 'Ingen sensordata', title: 'Sensorer' },
  aiUsage: {
    noSource: 'AI-forbrug: ingen kilde', unavailable: 'AI-forbrug: ikke tilgængelig', session: 'Session', weekly: 'Ugentlig',
    resets: 'Nulstilles', resetsIn: 'om', reset: 'reset',
    apiCheckKey: 'API: tjek nøgle', apiUnavailable: 'API: ikke tilgængelig', apiMonth: 'API måned', api: 'API',
    cacheLabels: [['Cache læst', 'Cache skrevet'], ['Cache læs', 'Cache skr'], ['Læs', 'Skr']],
    input: 'Input', output: 'Output', cacheHit: 'Cache-træf',
  },
};

const CATALOG: Record<DisplayLanguage, DisplayStrings> = { en, da };

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The calendar date and weekday (0 = Sunday) of an instant in a time zone. Only numbers are taken from Intl. */
export function zonedDate(at: Date, timeZone: string): MonthDay & { weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, day: 'numeric', month: 'numeric', weekday: 'short' }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return { day: Number(value('day')), month: Number(value('month')) - 1, weekday: WEEKDAY_INDEX[value('weekday')] ?? 0 };
}

export function displayStrings(language: DisplayLanguage = DEFAULT_DISPLAY_LANGUAGE): DisplayStrings {
  return CATALOG[language];
}
