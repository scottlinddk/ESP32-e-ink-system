import { z } from 'zod';

const SYMBOL = /^[A-Za-z0-9^][A-Za-z0-9.\-=^]{0,19}$/;

const isTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

export const MAX_SYMBOLS = 10;

export const configSchema = z.object({
  symbols: z
    .array(z.string().trim().regex(SYMBOL, 'Not a valid ticker symbol').transform((s) => s.toUpperCase()))
    .min(1)
    .max(MAX_SYMBOLS)
    .transform((list) => [...new Set(list)]),
  view: z.enum(['full', 'condensed']).default('full'),
  /** Condensed only. Omit to fit as many rows as the region allows. */
  perPage: z.number().int().min(1).max(8).optional(),
  /** How long a page stays before the next one is due. */
  dwellMinutes: z.number().int().min(1).max(1440).default(15),
  title: z.string().trim().min(1).max(24).default('Stock ticker'),
  locale: z.enum(['da', 'en']).default('da'),
  timeZone: z.string().refine(isTimeZone, 'Unknown IANA time zone').default('Europe/Copenhagen'),
});

export type TickerWidgetConfig = z.infer<typeof configSchema>;
