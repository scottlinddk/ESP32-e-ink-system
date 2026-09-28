-- Private calendar URLs use encrypted api_keys rows, never preferences.
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS show_calendar boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS calendar_timezone text NOT NULL DEFAULT 'Europe/Copenhagen',
  ADD COLUMN IF NOT EXISTS calendar_days integer NOT NULL DEFAULT 7 CHECK (calendar_days BETWEEN 1 AND 30),
  ADD COLUMN IF NOT EXISTS calendar_item_limit integer NOT NULL DEFAULT 5 CHECK (calendar_item_limit BETWEEN 1 AND 10);
