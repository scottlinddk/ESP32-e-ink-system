import type { EnergyPriceErrorCode } from './energyPriceErrors';
import type { NewsErrorCode } from './newsErrors';
import type { NotionSourceErrorCode } from '../services/notion';
import type { FamilyMealsSourceErrorCode } from '../services/familyMeals';
import type { CalendarErrorCode } from './calendarErrors';
import type { WeatherErrorCode } from '../types/index';
import { DEFAULT_DISPLAY_LANGUAGE, type DisplayLanguage } from './displayLanguage';

// Every word the widgets draw on the display, per language. Strings must stay within
// the 8x8 bitmap font (see docs/TEXT_RENDERING.md); a test checks both catalogs.
// Widgets size and clip their text, so a longer translation is shortened, not overflowed.

/** A calendar day and its zero-based month, for week ranges. */
export interface MonthDay { day: number; month: number }
export interface WeatherLabels {
  feelsLike: string; feelsShort: string; humidity: string; pressure: string; windSpeed: string; windDirection: string;
  gusts: string; clouds: string; visibility: string; rain: string; sunrise: string; sunset: string; aqi: string;
  pm25: string; pm10: string;
}

export interface DisplayStrings {
  /** Names are in the catalog, not the runtime's locale data, so a Node build without full ICU cannot fall back to English. */
  dates: {
    /** Sunday first, like Date#getDay. */
    weekdays: readonly string[];
    dayMonth: (date: MonthDay) => string;
  };
  energy: {
    estimate: string; spot: string; unit: string; inclVat: string; exclTax: string;
    average: string; missing: string; unavailable: string; inclVatShort: string; exclTaxShort: string;
    errors: Record<EnergyPriceErrorCode, string>;
  };
  weather: {
    title: string; wind: string; unavailable: string;
    /** Today in the daily forecast. */
    today: string;
    /** Shown in a forecast view when the forecast could not be fetched. */
    noForecast: string;
    /** Labels of the readings, shortest first where space is tight. */
    labels: WeatherLabels;
    /** Shorter labels for a narrow column; same keys as `labels`. */
    short: WeatherLabels;
    /** The eight compass points, north first. */
    compass: readonly string[];
    /** European air quality index 1 to 5. */
    airQuality: readonly string[];
    /** Keyed by the normalised condition in services/weather.ts. */
    conditions: Record<string, string>;
    errors: Record<WeatherErrorCode, string>;
  };
  news: { none: string; unavailable: string; errors: Record<NewsErrorCode, string> };
  chargers: {
    unavailable: (name: string) => string;
    status: (available: number, charging: number) => string;
    compactStatus: (charging: number) => string;
    createdToday: string;
  };
  notion: {
    unavailable: string; none: string;
    errors: Partial<Record<NotionSourceErrorCode, string>>;
  };
  familyMeals: {
    title: string; tonight: string; leftovers: string; nothingPlanned: string; noPlan: string; unavailable: string;
    today: string; comingDays: string; dinner: string; ingredients: string; noMoreDays: string; minutes: string;
    errors: Record<FamilyMealsSourceErrorCode, string>;
  };
  calendar: {
    none: string; unavailable: string; allDay: string; today: string; tomorrow: string;
    /** The footer bar's title. */
    upcoming: string;
    more: (count: number) => string;
    /** Full month names, January first, for the month view's title. */
    months: readonly string[];
    errors: Record<CalendarErrorCode, string>;
  };
  status: { refresh: string };
  week: {
    title: string; label: string; short: string;
    range: (start: MonthDay, end: MonthDay) => string;
  };
  webhook: { stale: string; unavailable: string; title: string };
  /** Tekst TV layouts: the header's name, the word before a page number, and each widget's bar title (uppercase). */
  teletext: {
    title: string; page: string;
    widgets: Record<'energy' | 'weather' | 'news' | 'monta' | 'zaptec' | 'notion' | 'familyMeals' | 'text' | 'webhook' | 'calendar' | 'week' | 'battery' | 'aiUsage' | 'stocks', string>;
  };
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
    average: 'Avg', missing: 'Missing', unavailable: 'Energy: unavailable', inclVatShort: 'Incl VAT', exclTaxShort: 'Excl tax',
    errors: {
      invalid_settings: 'Energy: check settings', missing_tariff: 'Energy: check tariff',
      unavailable: 'Energy: unavailable', timeout: 'Energy: timed out', invalid_response: 'Energy: invalid data',
    },
  },
  weather: {
    title: 'Weather', wind: 'Wind', unavailable: 'Unavailable',
    today: 'Today', noForecast: 'No forecast',
    labels: {
      feelsLike: 'Feels like', feelsShort: 'Feels', humidity: 'Humidity', pressure: 'Pressure', windSpeed: 'Wind speed',
      windDirection: 'Wind direction', gusts: 'Gusts', clouds: 'Cloud cover', visibility: 'Visibility', rain: 'Rain',
      sunrise: 'Sunrise', sunset: 'Sunset', aqi: 'Air quality', pm25: 'PM2.5', pm10: 'PM10',
    },
    short: {
      feelsLike: 'Feels', feelsShort: 'Feels', humidity: 'Humid', pressure: 'Press', windSpeed: 'Wind', windDirection: 'Dir',
      gusts: 'Gust', clouds: 'Cloud', visibility: 'Vis', rain: 'Rain', sunrise: 'Rise', sunset: 'Set', aqi: 'AQI',
      pm25: 'PM2.5', pm10: 'PM10',
    },
    compass: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
    airQuality: ['Good', 'Fair', 'Moderate', 'Poor', 'Very poor'],
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
    compactStatus: (charging) => `${charging} chg`,
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
  familyMeals: {
    title: 'Meals', tonight: 'Tonight', leftovers: 'Leftovers', nothingPlanned: 'No dinner', noPlan: 'No meal plan', unavailable: 'Meals: unavailable',
    today: 'Today', comingDays: 'Coming days', dinner: 'DINNER', ingredients: 'Ingredients', noMoreDays: 'Nothing more this week', minutes: 'min',
    errors: {
      not_configured: 'Meals: add API key', invalid_configuration: 'Check Meals setup', invalid_token: 'Check Meals key',
      invalid_response: 'Meals: invalid data', timeout: 'Meals: timed out', unavailable: 'Meals: unavailable',
    },
  },
  calendar: {
    none: 'No upcoming events', unavailable: 'Calendar: unavailable', allDay: 'All day', today: 'Today', tomorrow: 'Tomorrow', upcoming: 'Upcoming Events',
    more: (count) => `+${count} more`,
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    errors: { not_configured: 'Calendar: add URL', unavailable: 'Calendar: unavailable', timeout: 'Calendar: timed out' },
  },
  status: { refresh: 'Refresh' },
  week: {
    title: 'WEEK', label: 'Week', short: 'W',
    range: (start, end) => start.month === end.month
      ? `${MONTHS.en[start.month]} ${start.day}-${end.day}`
      : `${MONTHS.en[start.month]} ${start.day}-${MONTHS.en[end.month]} ${end.day}`,
  },
  webhook: { stale: 'STALE sensors', unavailable: 'No sensor data', title: 'Sensors' },
  teletext: {
    title: 'TELETEXT', page: 'P',
    widgets: {
      energy: 'POWER', weather: 'WEATHER', news: 'NEWS', monta: 'MONTA', zaptec: 'ZAPTEC', notion: 'NOTION', familyMeals: 'MEALS', text: 'NOTE',
      webhook: 'SENSORS', calendar: 'CALENDAR', week: 'WEEK', battery: 'BATTERY', aiUsage: 'AI USAGE', stocks: 'STOCKS',
    },
  },
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
    average: 'Gns', missing: 'Mangler', unavailable: 'Elpris: ikke tilgængelig', inclVatShort: 'Inkl moms', exclTaxShort: 'Uden afgift',
    errors: {
      invalid_settings: 'Elpris: tjek indstillinger', missing_tariff: 'Elpris: tjek tarif',
      unavailable: 'Elpris: ikke tilgængelig', timeout: 'Elpris: timeout', invalid_response: 'Elpris: ugyldige data',
    },
  },
  weather: {
    title: 'Vejr', wind: 'Vind', unavailable: 'Ikke tilgængelig',
    today: 'I dag', noForecast: 'Ingen prognose',
    labels: {
      feelsLike: 'Føles som', feelsShort: 'Føles', humidity: 'Luftfugtighed', pressure: 'Lufttryk', windSpeed: 'Vindhastighed',
      windDirection: 'Vindretning', gusts: 'Vindstød', clouds: 'Skydække', visibility: 'Sigtbarhed', rain: 'Regn',
      sunrise: 'Solopgang', sunset: 'Solnedgang', aqi: 'Luftkvalitet', pm25: 'PM2.5', pm10: 'PM10',
    },
    short: {
      feelsLike: 'Føles', feelsShort: 'Føles', humidity: 'Fugt', pressure: 'Tryk', windSpeed: 'Vind', windDirection: 'Retn',
      gusts: 'Stød', clouds: 'Sky', visibility: 'Sigt', rain: 'Regn', sunrise: 'Op', sunset: 'Ned', aqi: 'AQI',
      pm25: 'PM2.5', pm10: 'PM10',
    },
    compass: ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'],
    airQuality: ['God', 'Rimelig', 'Moderat', 'Dårlig', 'Meget dårlig'],
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
    compactStatus: (charging) => `${charging} lader`,
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
  familyMeals: {
    title: 'Madplan', tonight: 'I aften', leftovers: 'Rester', nothingPlanned: 'Ingen middag', noPlan: 'Ingen madplan', unavailable: 'Madplan: ikke tilgængelig',
    today: 'I dag', comingDays: 'Kommende dage', dinner: 'AFTENSMAD', ingredients: 'Ingredienser', noMoreDays: 'Ikke mere denne uge', minutes: 'min',
    errors: {
      not_configured: 'Madplan: tilføj nøgle', invalid_configuration: 'Tjek Madplan-opsætning', invalid_token: 'Tjek Madplan-nøgle',
      invalid_response: 'Madplan: ugyldige data', timeout: 'Madplan: timeout', unavailable: 'Madplan: ikke tilgængelig',
    },
  },
  calendar: {
    none: 'Ingen kommende aftaler', unavailable: 'Kalender: ikke tilgængelig', allDay: 'Hele dagen', today: 'I dag', tomorrow: 'I morgen', upcoming: 'Kommende aftaler',
    more: (count) => `+${count} mere`,
    months: ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'],
    errors: { not_configured: 'Kalender: tilføj adresse', unavailable: 'Kalender: ikke tilgængelig', timeout: 'Kalender: timeout' },
  },
  status: { refresh: 'Opdatering' },
  week: {
    title: 'UGE', label: 'Uge', short: 'U',
    range: (start, end) => start.month === end.month
      ? `${start.day}.-${end.day}. ${MONTHS.da[start.month]}`
      : `${start.day}. ${MONTHS.da[start.month]}-${end.day}. ${MONTHS.da[end.month]}`,
  },
  webhook: { stale: 'FORÆLDEDE sensorer', unavailable: 'Ingen sensordata', title: 'Sensorer' },
  teletext: {
    title: 'TEKST TV', page: 'S',
    widgets: {
      energy: 'ELPRIS', weather: 'VEJR', news: 'NYHEDER', monta: 'MONTA', zaptec: 'ZAPTEC', notion: 'NOTION', familyMeals: 'MADPLAN', text: 'NOTE',
      webhook: 'SENSORER', calendar: 'KALENDER', week: 'UGE', battery: 'BATTERI', aiUsage: 'AI-FORBRUG', stocks: 'AKTIER',
    },
  },
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
