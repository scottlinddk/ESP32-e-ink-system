-- Additional RSS/Atom news feeds. Each feed is placed in a layout as its own
-- `news:<id>` widget; the original news source settings are unchanged.
-- The backend validates every entry (ID, name, public HTTPS URL, item limit).
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS news_feeds JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(news_feeds) = 'array' AND jsonb_array_length(news_feeds) <= 20 AND octet_length(news_feeds::text) <= 64000);
