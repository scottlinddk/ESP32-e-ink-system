ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS display_timezone text NOT NULL DEFAULT 'Europe/Copenhagen';

COMMENT ON COLUMN public.user_preferences.display_timezone IS
  'IANA time zone for the display status clock; calendar and quiet hours use their own settings';
