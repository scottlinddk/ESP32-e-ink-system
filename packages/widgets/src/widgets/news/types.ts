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
  /** Language code: 'da' | 'en' | 'de' | 'sv' | 'no' | 'fi' */
  language: string;
  /** NewsAPI key (resolved from the user's stored keys by the caller) */
  apiKey: string;
}
