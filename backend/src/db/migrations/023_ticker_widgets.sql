-- Stock ticker widgets. Each one is placed in a layout as its own `ticker:<id>`
-- widget. The backend validates every entry (ID, name, symbols, view, page size,
-- page duration, locale); the CHECK only bounds shape and size.
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS ticker_widgets JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(ticker_widgets) = 'array' AND jsonb_array_length(ticker_widgets) <= 6 AND octet_length(ticker_widgets::text) <= 16000);
