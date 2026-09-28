-- Existing accounts keep their NewsAPI source until RSS/Atom is selected.
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS news_source TEXT NOT NULL DEFAULT 'newsapi' CHECK (news_source IN ('newsapi', 'rss')),
  ADD COLUMN IF NOT EXISTS news_feed_url TEXT NOT NULL DEFAULT '' CHECK (length(news_feed_url) <= 2048),
  ADD COLUMN IF NOT EXISTS news_item_limit INTEGER NOT NULL DEFAULT 3 CHECK (news_item_limit BETWEEN 1 AND 10);
