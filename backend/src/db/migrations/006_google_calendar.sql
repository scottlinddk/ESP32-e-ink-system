ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS show_gcal        BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS gcal_calendar_id TEXT,
  ADD COLUMN IF NOT EXISTS gcal_label       TEXT;
