import type { Direction, TickerLocale } from './types';

const SEPARATORS: Record<TickerLocale, { group: string; decimal: string }> = {
  da: { group: '.', decimal: ',' },
  en: { group: ',', decimal: '.' },
};

/** Currencies drawn as a prefix glyph. All are in the display's 8x8 font. */
const PREFIX_SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };

export function formatNumber(value: number, decimals: number, locale: TickerLocale): string {
  const { group, decimal } = SEPARATORS[locale];
  const [whole, fraction] = Math.abs(value).toFixed(decimals).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return fraction ? `${grouped}${decimal}${fraction}` : grouped;
}

export function priceDecimals(price: number): number {
  return Math.abs(price) < 1 ? 4 : 2;
}

/** `612,40 kr`, `$187.54`, `€12,30`; unknown currencies get their ISO code. */
export function formatPrice(price: number, currency: string, locale: TickerLocale): string {
  const text = formatNumber(price, priceDecimals(price), locale);
  const prefix = PREFIX_SYMBOLS[currency];
  if (prefix) return `${prefix}${text}`;
  return `${text} ${currency === 'DKK' ? 'kr' : currency}`;
}

export function signOf(direction: Direction, value: number): string {
  if (direction === 'flat' && Math.round(value * 100) === 0) return '';
  return value < 0 ? '-' : '+';
}

/** `-0,80 %` (da) or `-0.80%` (en). */
export function formatPercent(changePercent: number, direction: Direction, locale: TickerLocale): string {
  const sign = signOf(direction, changePercent);
  const body = formatNumber(changePercent, 2, locale);
  return `${sign}${body}${locale === 'da' ? ' %' : '%'}`;
}

/** Absolute change without currency, e.g. `-1,32`. Use the price's decimals so both columns line up. */
export function formatChange(change: number, direction: Direction, locale: TickerLocale, decimals = 2): string {
  return `${signOf(direction, change)}${formatNumber(change, decimals, locale)}`;
}

/** `NOVO-B.CO` is shown as `NOVO-B`; other exchange suffixes are kept. */
export function displaySymbol(symbol: string): string {
  return symbol.replace(/\.CO$/i, '');
}

export function fitText(text: string, widthPx: number, cellPx: number): string {
  const max = Math.max(0, Math.floor(widthPx / cellPx));
  return text.length <= max ? text : text.slice(0, max);
}

export function formatClock(epochMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(epochMs);
}
