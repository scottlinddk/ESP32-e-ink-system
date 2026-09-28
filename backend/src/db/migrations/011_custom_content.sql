-- Custom content uses the existing user_preferences ownership/RLS policies.
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS show_custom_text BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS custom_text TEXT NOT NULL DEFAULT '' CHECK (char_length(custom_text) <= 2000),
  ADD COLUMN IF NOT EXISTS show_custom_image BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS custom_image JSONB CHECK (custom_image IS NULL OR (
    jsonb_typeof(custom_image) = 'object' AND octet_length(custom_image::text) <= 45000
  ));
