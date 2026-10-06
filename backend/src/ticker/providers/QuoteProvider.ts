import type { Quote, SearchRegion, SymbolSearchResult } from '../types';

/** Fixed diagnostics only: provider or network text can contain URLs and must not reach the display. */
export class QuoteProviderError extends Error {}

export interface QuoteProvider {
  search(query: string, region?: SearchRegion): Promise<SymbolSearchResult[]>;
  /** Resolves one symbol; rejects with `QuoteProviderError` when it cannot be loaded. */
  quote(symbol: string): Promise<Quote>;
}
