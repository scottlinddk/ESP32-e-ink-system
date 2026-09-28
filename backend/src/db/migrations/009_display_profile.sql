ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS display_profile jsonb;
COMMENT ON COLUMN user_preferences.display_profile IS 'Native monochrome dimensions and clockwise content rotation; null uses legacy 250x122';
