-- Additional calendars. Each one is placed in a layout as its own `calendar:<id>` widget.
-- The private ICS URL of each calendar is never stored here: it is an encrypted api_keys
-- row with provider `calendar:<id>`. The backend validates every entry (ID, name, time zone,
-- days, event limit); the CHECK only bounds shape and size.
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS calendar_widgets JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(calendar_widgets) = 'array' AND jsonb_array_length(calendar_widgets) <= 8 AND octet_length(calendar_widgets::text) <= 16000);
