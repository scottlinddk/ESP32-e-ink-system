export interface NewsApiArticle {
  title: string;
  url: string;
  publishedAt: string;
  source: { name: string };
}

export interface NewsApiResponse {
  status: string;
  totalResults: number;
  articles: NewsApiArticle[];
}

export interface NewsWidgetData {
  items: Array<{ title: string; url: string }>;
}

export interface NewsWidgetConfig {
  /** NewsAPI coverage: en (US), de (DE), sv (SE), no (NO). Danish/Finnish require RSS instead. */
  language: string;
  /** NewsAPI key (resolved from the user's stored keys by the caller) */
  apiKey: string;
}
