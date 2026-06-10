-- Notion widget integration
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS show_notion BOOLEAN DEFAULT false;
