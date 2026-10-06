export type TickerView = 'full' | 'condensed';
export type Direction = 'up' | 'down' | 'flat';
export type MarketState = 'OPEN' | 'CLOSED' | 'PRE' | 'POST';
/** `MIXED` is only produced when a page shows symbols in different states. */
export type MarketStatus = MarketState | 'MIXED';
export type TickerLocale = 'da' | 'en';

/** Epoch seconds, as Yahoo reports them. */
export interface TradingPeriod {
  start: number;
  end: number;
}

export interface TradingSessions {
  pre?: TradingPeriod;
  regular?: TradingPeriod;
  post?: TradingPeriod;
}

export interface Quote {
  /** Provider symbol, e.g. `NOVO-B.CO` or `NVDA`. */
  symbol: string;
  name: string;
  /** ISO 4217 code as reported by the provider, e.g. `DKK`. */
  currency: string;
  exchange: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  marketState: MarketState;
  /** Intraday closes, oldest first. Empty when the provider returned no series. */
  series: number[];
}

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  exchangeName: string;
  type: string;
}

export type SearchRegion = 'any' | 'dk';

/** A symbol that could not be loaded. Rendered as an honest "unavailable" row. */
export interface FailedRow {
  symbol: string;
  quote?: undefined;
}
export interface QuoteRow {
  symbol: string;
  quote: Quote;
}
export type TickerRow = QuoteRow | FailedRow;

export interface TickerWidgetData {
  view: TickerView;
  title: string;
  locale: TickerLocale;
  timeZone: string;
  rows: TickerRow[];
  /** 1-based page and total, so the footer always matches the rows shown. */
  page: number;
  pageCount: number;
  marketStatus: MarketStatus;
  /** Epoch milliseconds. */
  fetchedAt: number;
}
